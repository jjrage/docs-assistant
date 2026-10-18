import "server-only";

import type { Viewer } from "../auth/viewer";
import { userDb } from "../db/user-client";
import type { TurnOutcome } from "./answer";
import type { Answer, AnswerSource, AnswerSegment } from "./sources";

/**
 * Conversations as the chat shows them, read with the signed-in user's session (row-level security: a
 * member sees their own, an admin every conversation of the company).
 */

export type ChatTurn = {
  key: string;
  question: string;
  segments: AnswerSegment[];
  sources: AnswerSource[];
  outcome: TurnOutcome | null;
  handoff: { id: string; status: "open" | "answered"; answer: string | null } | null;
  costMicroUsd: number | null;
  totalMs: number | null;
};

export async function conversationTurns(conversationId: string): Promise<ChatTurn[] | null> {
  const db = await userDb();
  const { data: conversation } = await db
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;

  const [{ data: turns }, { data: handoffs }] = await Promise.all([
    db
      .from("turns")
      .select("id, question, answer, outcome, handoff_id, cost_micro_usd, total_ms")
      .eq("conversation_id", conversationId)
      .order("seq"),
    db.from("handoffs").select("id, status, answer").eq("conversation_id", conversationId),
  ]);
  const handoffById = new Map((handoffs ?? []).map((h) => [h.id, h]));
  return (turns ?? []).map((turn) => {
    const answer = (turn.answer ?? { segments: [], sources: [] }) as unknown as Answer;
    const handoff = turn.handoff_id ? handoffById.get(turn.handoff_id) : undefined;
    return {
      key: turn.id,
      question: turn.question,
      segments: answer.segments,
      sources: answer.sources,
      outcome: turn.outcome,
      handoff: handoff ? { id: handoff.id, status: handoff.status, answer: handoff.answer } : null,
      costMicroUsd: turn.cost_micro_usd,
      totalMs: turn.total_ms,
    };
  });
}

export async function recentConversations(viewer: Viewer) {
  const db = await userDb();
  const { data } = await db
    .from("conversations")
    .select("id, title, last_activity_at")
    .eq("user_id", viewer.userId)
    .order("last_activity_at", { ascending: false })
    .limit(20);
  return data ?? [];
}
