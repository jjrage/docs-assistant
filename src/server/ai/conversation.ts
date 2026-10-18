import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import type { Json } from "@/db/database.types";

import type { Viewer } from "../auth/viewer";
import { adminDb } from "../db/admin";
import { unwrap } from "../db/result";
import { limits } from "../limits";
import { toPgVector } from "../search/voyage";
import type { HandoffRequest, TurnResult } from "./answer";

/**
 * Conversation storage and limits. The transcript is only ever appended (the API sees the history exactly
 * as it happened, which keeps thinking blocks valid and the prompt cache warm); each question also gets one
 * row in the answer log. Every limit is checked before a request reaches the model.
 */

type MessageParam = Anthropic.Beta.BetaMessageParam;

export type OpenResult =
  | { ok: true; conversationId: string; seq: number; history: MessageParam[] }
  | { ok: false; message: string };

const dayAgo = () => new Date(Date.now() - 24 * 3600_000).toISOString();

export async function openConversation(
  viewer: Viewer,
  conversationId: string | null,
  question: string,
): Promise<OpenResult> {
  const db = adminDb();
  const [mine, everyone] = await Promise.all([
    db
      .from("turns")
      .select("id", { count: "exact", head: true })
      .eq("user_id", viewer.userId)
      .gte("created_at", dayAgo()),
    db.from("turns").select("id", { count: "exact", head: true }).gte("created_at", dayAgo()),
  ]);
  if ((everyone.count ?? 0) >= limits.questions.perDay) {
    return {
      ok: false,
      message:
        "The assistant has answered its daily limit for this demo. Please come back tomorrow.",
    };
  }
  if ((mine.count ?? 0) >= limits.questions.perUserPerDay) {
    return {
      ok: false,
      message: "You've reached today's question limit. Please come back tomorrow.",
    };
  }

  if (conversationId) {
    const { data } = await db
      .from("conversations")
      .select("id, turn_count, user_id, company_id")
      .eq("id", conversationId)
      .maybeSingle();
    // A conversation continues only for the person who started it.
    if (data && data.user_id === viewer.userId && data.company_id === viewer.company.id) {
      if (data.turn_count >= limits.questions.turnsPerConversation) {
        return { ok: false, message: "This conversation is long enough. Start a new one." };
      }
      return {
        ok: true,
        conversationId: data.id,
        seq: data.turn_count,
        history: await loadHistory(data.id),
      };
    }
  }

  const created = unwrap(
    await db
      .from("conversations")
      .insert({
        company_id: viewer.company.id,
        user_id: viewer.userId,
        title: question.length > 120 ? `${question.slice(0, 117)}…` : question,
      })
      .select("id")
      .single(),
    "start conversation",
  );
  return { ok: true, conversationId: created.id, seq: 0, history: [] };
}

export async function loadHistory(conversationId: string): Promise<MessageParam[]> {
  const rows = unwrap(
    await adminDb()
      .from("messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("seq"),
    "load history",
  );
  return rows.map((row) => ({
    role: row.role as "user" | "assistant",
    content: row.content as unknown as Anthropic.Beta.BetaContentBlockParam[],
  }));
}

export async function createHandoff(
  viewer: Viewer,
  conversationId: string,
  request: HandoffRequest,
): Promise<string> {
  const row = unwrap(
    await adminDb()
      .from("handoffs")
      .insert({
        company_id: viewer.company.id,
        conversation_id: conversationId,
        asked_by: viewer.userId,
        question: request.question.slice(0, 2000),
        reason: request.reason.slice(0, 1000),
        context: request.context as unknown as NonNullable<Json>,
      })
      .select("id")
      .single(),
    "create hand-off",
  );
  return row.id;
}

/** Appends the turn's transcript, logs the turn and bumps the conversation. Returns the turn id. */
export async function saveTurn(
  viewer: Viewer,
  open: { conversationId: string; seq: number; history: MessageParam[] },
  question: string,
  result: TurnResult,
  effort: string,
): Promise<string> {
  const db = adminDb();
  const { error: messageError } = await db.from("messages").insert(
    result.messages.map((m, i) => ({
      conversation_id: open.conversationId,
      seq: open.history.length + i,
      role: m.role,
      content: (typeof m.content === "string"
        ? [{ type: "text", text: m.content }]
        : m.content) as unknown as NonNullable<Json>,
    })),
  );
  if (messageError) throw new Error(`append messages: ${messageError.message}`);

  const turn = unwrap(
    await db
      .from("turns")
      .insert({
        company_id: viewer.company.id,
        conversation_id: open.conversationId,
        seq: open.seq,
        user_id: viewer.userId,
        question,
        question_embedding: toPgVector(result.questionEmbedding),
        answer: result.answer as unknown as Json,
        outcome: result.outcome,
        handoff_id: result.handoffId,
        model: result.model,
        effort,
        input_tokens: result.usage.input,
        output_tokens: result.usage.output,
        cache_read_tokens: result.usage.cacheRead,
        cache_write_tokens: result.usage.cacheWrite,
        embedding_tokens: result.usage.embedding,
        cost_micro_usd: result.costMicroUsd,
        first_token_ms: result.firstTokenMs,
        total_ms: result.totalMs,
        search_count: result.searches.length,
        citation_count: result.answer.sources.length,
      })
      .select("id")
      .single(),
    "log turn",
  );

  await db
    .from("conversations")
    .update({ turn_count: open.seq + 1, last_activity_at: new Date().toISOString() })
    .eq("id", open.conversationId);
  return turn.id;
}
