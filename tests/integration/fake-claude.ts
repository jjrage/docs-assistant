import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A local stand-in for the Messages API that streams scripted replies in the API's server-sent-event
 * format, so the chat plumbing can be tested end to end without a key or a bill. Each test supplies a
 * script: given the request body, the next reply as a list of content blocks.
 */

export type RequestBody = {
  model: string;
  messages: { role: string; content: Block[] }[];
  system: { type: string; text: string }[];
  tools: { name: string; strict?: boolean }[];
  fallbacks?: unknown;
  cache_control?: unknown;
  output_config?: { effort?: string };
};

export type Block = {
  type: string;
  text?: string;
  source?: string;
  title?: string;
  content?: Block[];
  citations?: { enabled: boolean };
  tool_use_id?: string;
};

export type ScriptedBlock =
  | { type: "text"; text: string; cite?: { result: number; start: number; end: number } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export type Reply = { blocks: ScriptedBlock[]; stopReason: "end_turn" | "tool_use" | "refusal" };

/** Every search_result block in the request, in order (the index citations use). */
export function searchResults(body: RequestBody): Block[] {
  const found: Block[] = [];
  const visit = (blocks: Block[] | undefined) => {
    for (const block of blocks ?? []) {
      if (block.type === "search_result") found.push(block);
      else if (block.type === "tool_result") visit(block.content);
    }
  };
  for (const message of body.messages) visit(message.content);
  return found;
}

function sse(events: unknown[]): string {
  return events
    .map((data) => `event: ${(data as { type: string }).type}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
}

function render(body: RequestBody, reply: Reply, id: string): string {
  const results = searchResults(body);
  const events: unknown[] = [
    {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 1500,
          output_tokens: 1,
          cache_creation_input_tokens: 400,
          cache_read_input_tokens: 2000,
        },
      },
    },
  ];
  reply.blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "", citations: null },
      });
      if (block.cite) {
        const result = results[block.cite.result]!;
        const cited = (result.content ?? [])
          .slice(block.cite.start, block.cite.end)
          .map((b) => b.text)
          .join("");
        events.push({
          type: "content_block_delta",
          index,
          delta: {
            type: "citations_delta",
            citation: {
              type: "search_result_location",
              cited_text: cited,
              source: result.source,
              title: result.title,
              search_result_index: block.cite.result,
              start_block_index: block.cite.start,
              end_block_index: block.cite.end,
            },
          },
        });
      }
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
      });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push(
    {
      type: "message_delta",
      delta: { stop_reason: reply.stopReason, stop_sequence: null },
      usage: { output_tokens: 120 },
    },
    { type: "message_stop" },
  );
  return sse(events);
}

export async function startFakeClaude(script: (body: RequestBody, call: number) => Reply) {
  const requests: { headers: Record<string, string | string[] | undefined>; body: RequestBody }[] =
    [];
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as RequestBody;
      requests.push({ headers: req.headers, body });
      const reply = script(body, requests.length);
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(render(body, reply, `msg_${requests.length}`));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
