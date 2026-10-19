import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { answerQuestion, type ChatEvent, type HandoffRequest } from "@/server/ai/answer";
import { aiConfigFrom } from "@/server/ai/config";
import { processDocument } from "@/server/documents/process";
import { hashEmbedder } from "@/server/search/hash-embedder";
import { searchChunks } from "@/server/search/search";

import { createAdminClient, createTestCompany } from "./admin-client";
import { searchResults, startFakeClaude, type RequestBody, type Reply } from "./fake-claude";

/**
 * The answer loop end to end against the local database (hybrid search over a real indexed PDF) and a local
 * stand-in for the Claude API: what the request carries, how citations become numbered sources with pages,
 * the search tool and the hand-off.
 */

const admin = createAdminClient();
let company: Awaited<ReturnType<typeof createTestCompany>>;
let documentId: string;

beforeAll(async () => {
  company = await createTestCompany(admin, "Answer Test Homes");
  documentId = randomUUID();
  const path = `${company.companyId}/${documentId}.pdf`;
  const data = await readFile("src/server/documents/__fixtures__/files/fixture-handbook.pdf");
  await admin.storage.from("documents").upload(path, data, { contentType: "application/pdf" });
  await admin.from("documents").insert({
    id: documentId,
    company_id: company.companyId,
    title: "Resident Handbook",
    file_name: "handbook.pdf",
    format: "pdf",
    storage_path: path,
    size_bytes: data.byteLength,
    version_label: "2026",
  });
  await processDocument(admin, hashEmbedder, documentId, { maxPages: 40 });
});
afterAll(async () => {
  await company.cleanup();
});

async function ask(
  question: string,
  script: (body: RequestBody, call: number) => Reply,
  model?: string,
) {
  const fake = await startFakeClaude(script);
  const events: ChatEvent[] = [];
  const handoffs: HandoffRequest[] = [];
  try {
    const result = await answerQuestion(
      {
        client: new Anthropic({ apiKey: "sk-ant-test", baseURL: fake.baseURL, maxRetries: 0 }),
        config: aiConfigFrom({ ANTHROPIC_MODEL: model }),
        companyName: "Answer Test Homes",
        search: (query, count) =>
          searchChunks(admin, hashEmbedder, [company.companyId], query, count),
        handOff: async (request) => {
          handoffs.push(request);
          return randomUUID();
        },
        emit: (event) => events.push(event),
      },
      [],
      question,
    );
    return { result, events, handoffs, requests: fake.requests };
  } finally {
    await fake.close();
  }
}

/** Index of the first search result whose blocks mention `text`. */
function resultWith(body: RequestBody, text: string): number {
  return searchResults(body).findIndex((r) => r.content?.some((b) => b.text?.includes(text)));
}

describe("answering a question", () => {
  it("attaches the passages, streams the answer and numbers its sources with document and page", async () => {
    const { result, events, requests } = await ask(
      "How much is the returned payment charge?",
      (body) => {
        const r = resultWith(body, "Returned payment");
        const block = searchResults(body)[r]!.content!.findIndex((b) =>
          b.text?.includes("Returned payment"),
        );
        return {
          stopReason: "end_turn",
          blocks: [
            {
              type: "text",
              text: "A returned payment costs $40",
              cite: { result: r, start: block, end: block + 1 },
            },
            { type: "text", text: "." },
          ],
        };
      },
      // Opus, to check the server-side fallback and its prices (the default model, Haiku, has neither).
      "claude-opus-5-5",
    );

    // The request: documents only as search results with citations, settings we rely on.
    const body = requests[0]!.body;
    expect(requests[0]!.headers["anthropic-beta"]).toContain("server-side-fallback-2026-07-01");
    expect(body.fallbacks).toBe("default");
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.output_config?.effort).toBe("low");
    expect(body.tools.map((t) => [t.name, t.strict])).toEqual([
      ["search_documents", true],
      ["hand_off_to_staff", true],
    ]);
    expect(body.system[0]!.text).not.toContain("Returned payment");
    const results = searchResults(body);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.citations?.enabled === true)).toBe(true);
    expect(body.messages[0]!.content.at(-1)).toEqual({
      type: "text",
      text: "How much is the returned payment charge?",
    });

    // The answer: one source, on page 2 of the handbook, quoting the table row.
    expect(result.outcome).toBe("answered");
    expect(result.answer.sources).toEqual([
      expect.objectContaining({
        n: 1,
        documentId,
        title: "Resident Handbook (2026)",
        page: 2,
        quote: "Returned payment | $40 | Per payment",
      }),
    ]);
    expect(result.answer.segments.map((s) => [s.text, s.sources])).toEqual([
      ["A returned payment costs $40", [1]],
      [".", []],
    ]);
    expect(
      events
        .filter((e) => e.type === "text")
        .map((e) => e.type === "text" && e.delta)
        .join(""),
    ).toBe("A returned payment costs $40.");
    expect(events).toContainEqual({ type: "cite", n: 1 });

    // Cost: 1,500 in + 120 out + 2,000 cache reads + 400 cache writes on Opus 5.5, plus the query embedding.
    expect(result.usage).toMatchObject({
      input: 1500,
      output: 120,
      cacheRead: 2000,
      cacheWrite: 400,
    });
    expect(result.costMicroUsd).toBeGreaterThan(1500 * 4 + 120 * 20 + 2000 * 0.2 + 400 * 5 - 1);
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("runs another search when asked and cites what that search found", async () => {
    const { result, requests } = await ask("¿Cuánto cuesta un pago devuelto?", (body, call) => {
      if (call === 1) {
        return {
          stopReason: "tool_use",
          blocks: [
            {
              type: "tool_use",
              id: "toolu_s",
              name: "search_documents",
              input: { query: "returned payment charge" },
            },
          ],
        };
      }
      const r = resultWith(body, "Returned payment");
      return {
        stopReason: "end_turn",
        blocks: [
          {
            type: "text",
            text: "Un pago devuelto cuesta $40.",
            cite: { result: r, start: 0, end: 1 },
          },
        ],
      };
    });
    expect(requests).toHaveLength(2);
    // The tool result carries search results, not plain text.
    const toolMessage = requests[1]!.body.messages.at(-1)!;
    expect(toolMessage.content[0]!.type).toBe("tool_result");
    expect(toolMessage.content[0]!.content!.every((b) => b.type === "search_result")).toBe(true);
    expect(result.searches).toEqual([
      "¿Cuánto cuesta un pago devuelto?",
      "returned payment charge",
    ]);
    expect(result.answer.sources[0]).toMatchObject({ documentId, page: 2 });
    expect(result.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("hands off once when the documents don't answer, with the context staff need", async () => {
    const { result, handoffs, events } = await ask(
      "Can I install a satellite dish?",
      (_body, call) =>
        call === 1
          ? {
              stopReason: "tool_use",
              blocks: [
                { type: "text", text: "The documents don't cover satellite dishes." },
                {
                  type: "tool_use",
                  id: "toolu_h",
                  name: "hand_off_to_staff",
                  input: {
                    question: "May a resident install a satellite dish?",
                    reason: "Not in the documents.",
                  },
                },
              ],
            }
          : {
              stopReason: "end_turn",
              blocks: [{ type: "text", text: "I've passed it to the team." }],
            },
    );
    expect(result.outcome).toBe("not_found");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({
      question: "May a resident install a satellite dish?",
      context: {
        asked: "Can I install a satellite dish?",
        searches: ["Can I install a satellite dish?"],
      },
    });
    expect(events.some((e) => e.type === "handoff")).toBe(true);
    // The reply after the tool call starts a new paragraph.
    expect(result.answer.segments.map((s) => s.text).join("")).toBe(
      "The documents don't cover satellite dishes.\n\nI've passed it to the team.",
    );
  });

  it("reports a refusal without inventing an answer", async () => {
    const { result, events } = await ask("Something the classifier declines", () => ({
      stopReason: "refusal",
      blocks: [],
    }));
    expect(result.outcome).toBe("refused");
    expect(events.some((e) => e.type === "notice")).toBe(true);
  });

  it("sends no server-side fallback to Haiku, which has none", async () => {
    const { requests } = await ask(
      "How much is the returned payment charge?",
      () => ({ stopReason: "end_turn", blocks: [{ type: "text", text: "$40." }] }),
      "claude-haiku-5-5",
    );
    expect(requests[0]!.body.model).toBe("claude-haiku-5-5");
    expect(requests[0]!.body.fallbacks).toBeUndefined();
    expect(requests[0]!.headers["anthropic-beta"] ?? "").not.toContain("server-side-fallback");
  });
});
