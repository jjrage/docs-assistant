import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import { serverEnv } from "@/config/server-env";
import { answerQuestion, describeFailure, type ChatEvent } from "@/server/ai/answer";
import { aiConfigFrom } from "@/server/ai/config";
import { createHandoff, openConversation, saveTurn } from "@/server/ai/conversation";
import { getViewer, searchableCompanyIds } from "@/server/auth/viewer";
import { userDb } from "@/server/db/user-client";
import { limits } from "@/server/limits";
import { appEmbedder } from "@/server/search/embedder";
import { searchChunks } from "@/server/search/search";

/**
 * The chat endpoint: one POST per question, answered with a stream of newline-delimited JSON events (text,
 * sources as they are cited, search status, hand-off). Search runs with the signed-in user's database
 * session, so row-level security decides which passages can reach the model.
 */

export const maxDuration = 120;

const bodySchema = z.object({
  conversationId: z.uuid().nullable().optional(),
  question: z.string().trim().min(1).max(limits.questions.maxChars),
});

let client: Anthropic | undefined;

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const embed = appEmbedder();
  if (!serverEnv.ANTHROPIC_API_KEY || !embed) {
    return Response.json(
      { error: "The assistant is switched off in this deployment (no AI keys configured)." },
      { status: 503 },
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: `Please ask in up to ${limits.questions.maxChars} characters.` },
      { status: 400 },
    );
  }
  const { question } = parsed.data;

  const open = await openConversation(viewer, parsed.data.conversationId ?? null, question);
  if (!open.ok) return Response.json({ error: open.message }, { status: 429 });

  const db = await userDb();
  const config = aiConfigFrom(serverEnv);
  client ??= new Anthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY });
  const anthropic = client;
  const encoder = new TextEncoder();
  let streaming = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the person closes the page mid-answer, the turn still finishes and is saved; there is just no
      // one left to stream to.
      const emit = (event: ChatEvent) => {
        if (!streaming) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          streaming = false;
        }
      };
      emit({ type: "conversation", id: open.conversationId });
      try {
        const result = await answerQuestion(
          {
            client: anthropic,
            config,
            companyName: viewer.company.name,
            search: (query, count) =>
              searchChunks(db, embed, searchableCompanyIds(viewer), query, count),
            handOff: (handoff) => createHandoff(viewer, open.conversationId, handoff),
            emit,
          },
          open.history,
          question,
        );
        const turnId = await saveTurn(viewer, open, question, result, config.effort);
        emit({
          type: "done",
          turnId,
          outcome: result.outcome,
          costMicroUsd: result.costMicroUsd,
          totalMs: result.totalMs,
        });
      } catch (error) {
        console.error("chat turn", error);
        emit({ type: "error", message: describeFailure(error) });
      } finally {
        if (streaming) controller.close();
      }
    },
    cancel() {
      streaming = false;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
