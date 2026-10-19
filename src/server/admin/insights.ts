/**
 * Pure helpers for the admin pages: grouping questions that mean the same thing (their embeddings are
 * already stored, from search) and summarizing the answer log.
 */

export type QuestionRow = {
  question: string;
  embedding: number[];
  outcome: "answered" | "not_found" | "refused" | "error";
  createdAt: string;
};

export type QuestionGroup = {
  question: string;
  variants: string[];
  count: number;
  handedOff: number;
  lastAskedAt: string;
};

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * Greedy grouping: each question joins the first group whose first question is at least `threshold`
 * similar, else starts a group. Good enough for the few hundred questions a month an admin looks at, and
 * stable (the same input gives the same groups). Largest groups first.
 *
 * The threshold is measured on voyage-4 query embeddings: rewordings and translations of one question score
 * 0.68–0.77, while none of the 1,176 pairs of different eval questions reaches 0.65 except two that ask the
 * same thing (when rent is late, in English and Russian). At 0.6 a first wrong pair joins (keys at move-in
 * and keys at move-out).
 */
export function groupQuestions(rows: QuestionRow[], threshold = 0.65): QuestionGroup[] {
  const groups: (QuestionGroup & { anchor: number[] })[] = [];
  const newestFirst = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const row of newestFirst) {
    const group = groups.find((g) => cosine(g.anchor, row.embedding) >= threshold);
    if (group) {
      group.count += 1;
      if (row.outcome === "not_found") group.handedOff += 1;
      const normalized = row.question.trim().toLowerCase();
      if (
        group.variants.length < 4 &&
        !group.variants.some((v) => v.trim().toLowerCase() === normalized)
      ) {
        group.variants.push(row.question);
      }
    } else {
      groups.push({
        anchor: row.embedding,
        question: row.question,
        variants: [row.question],
        count: 1,
        handedOff: row.outcome === "not_found" ? 1 : 0,
        lastAskedAt: row.createdAt,
      });
    }
  }
  return groups
    .sort((a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt))
    .map(({ anchor: _anchor, ...group }) => group);
}

/** pgvector's text form "[0.1,0.2,…]" back to numbers. */
export function parseVector(text: string | null): number[] | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as number[]) : null;
  } catch {
    return null;
  }
}

export type LogRow = {
  outcome: "answered" | "not_found" | "refused" | "error";
  costMicroUsd: number;
  totalMs: number;
  firstTokenMs: number | null;
};

export type LogSummary = {
  questions: number;
  answered: number;
  handedOff: number;
  totalCostMicroUsd: number;
  averageCostMicroUsd: number;
  medianMs: number | null;
  p90Ms: number | null;
  medianFirstTokenMs: number | null;
};

/** Nearest-rank percentile of a list of numbers; null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1]!;
}

export function summarizeLog(rows: LogRow[]): LogSummary {
  const total = rows.reduce((sum, r) => sum + r.costMicroUsd, 0);
  const firstTokens = rows.map((r) => r.firstTokenMs).filter((ms): ms is number => ms !== null);
  return {
    questions: rows.length,
    answered: rows.filter((r) => r.outcome === "answered").length,
    handedOff: rows.filter((r) => r.outcome === "not_found").length,
    totalCostMicroUsd: total,
    averageCostMicroUsd: rows.length ? Math.round(total / rows.length) : 0,
    medianMs: percentile(
      rows.map((r) => r.totalMs),
      50,
    ),
    p90Ms: percentile(
      rows.map((r) => r.totalMs),
      90,
    ),
    medianFirstTokenMs: percentile(firstTokens, 50),
  };
}
