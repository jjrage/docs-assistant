import "server-only";

import type { HandoffRequest } from "../ai/answer";
import type { Viewer } from "../auth/viewer";
import { adminDb } from "../db/admin";
import { userDb } from "../db/user-client";
import { groupQuestions, parseVector, type QuestionRow } from "./insights";

/**
 * Data for the admin pages, read with the admin's own session (row-level security limits it to their
 * company). The only write, replying to a hand-off, goes through the server and is scoped to that company.
 */

async function memberNames(viewer: Viewer): Promise<Map<string, string>> {
  const db = await userDb();
  const { data } = await db
    .from("memberships")
    .select("user_id, display_name")
    .eq("company_id", viewer.company.id);
  return new Map((data ?? []).map((m) => [m.user_id, m.display_name]));
}

export type InboxItem = {
  id: string;
  question: string;
  reason: string | null;
  context: HandoffRequest["context"] | null;
  status: "open" | "answered";
  answer: string | null;
  askedBy: string;
  createdAt: string;
  answeredAt: string | null;
};

export async function inbox(viewer: Viewer): Promise<InboxItem[]> {
  const db = await userDb();
  const [{ data }, names] = await Promise.all([
    db
      .from("handoffs")
      .select("id, question, reason, context, status, answer, asked_by, created_at, answered_at")
      .eq("company_id", viewer.company.id)
      .order("created_at", { ascending: false })
      .limit(100),
    memberNames(viewer),
  ]);
  return (data ?? []).map((h) => ({
    id: h.id,
    question: h.question,
    reason: h.reason,
    context: (h.context as unknown as HandoffRequest["context"]) ?? null,
    status: h.status,
    answer: h.answer,
    askedBy: names.get(h.asked_by) ?? "A resident",
    createdAt: h.created_at,
    answeredAt: h.answered_at,
  }));
}

export async function replyToHandoff(
  viewer: Viewer,
  handoffId: string,
  answer: string,
): Promise<{ error?: string }> {
  const { data, error } = await adminDb()
    .from("handoffs")
    .update({
      status: "answered",
      answer,
      answered_by: viewer.userId,
      answered_at: new Date().toISOString(),
    })
    .eq("id", handoffId)
    .eq("company_id", viewer.company.id)
    .eq("status", "open")
    .select("id");
  if (error) return { error: "Could not save the reply. Try again." };
  if (!data?.length) return { error: "This question was already answered." };
  return {};
}

export async function frequentQuestions(viewer: Viewer, days = 30) {
  const db = await userDb();
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const { data } = await db
    .from("turns")
    .select("question, question_embedding, outcome, created_at")
    .eq("company_id", viewer.company.id)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  const rows: QuestionRow[] = [];
  for (const turn of data ?? []) {
    const embedding = parseVector(turn.question_embedding);
    if (embedding) {
      rows.push({
        question: turn.question,
        embedding,
        outcome: turn.outcome,
        createdAt: turn.created_at,
      });
    }
  }
  return { groups: groupQuestions(rows), total: rows.length };
}

export async function answerLog(viewer: Viewer, limit = 200) {
  const db = await userDb();
  const [{ data }, names] = await Promise.all([
    db
      .from("turns")
      .select(
        "id, conversation_id, user_id, question, outcome, model, effort, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, embedding_tokens, cost_micro_usd, first_token_ms, total_ms, search_count, citation_count, created_at",
      )
      .eq("company_id", viewer.company.id)
      .order("created_at", { ascending: false })
      .limit(limit),
    memberNames(viewer),
  ]);
  return (data ?? []).map((t) => ({ ...t, askedBy: names.get(t.user_id) ?? "A member" }));
}
