import type { Metadata } from "next";
import { Suspense } from "react";

import { answerLog } from "@/server/admin/data";
import { summarizeLog } from "@/server/admin/insights";
import { requireAdmin } from "@/server/auth/viewer";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant, formatMicroUsd, formatMs } from "@/ui/format";

export const metadata: Metadata = { title: "Answer log" };

const outcomeLabel = {
  answered: ["Answered", "success"],
  not_found: ["Handed off", "warning"],
  refused: ["Declined", "neutral"],
  error: ["Error", "danger"],
} as const;

export default function AnswerLogPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Answer log</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Every answer with what it cost and how long it took: Claude tokens (including cached ones)
          plus the embedding of the question, at list prices.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Log />
      </Suspense>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="tabular mt-1 text-xl font-semibold text-zinc-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
    </Card>
  );
}

async function Log() {
  const viewer = await requireAdmin("/admin/log");
  const rows = await answerLog(viewer);
  const summary = summarizeLog(
    rows.map((r) => ({
      outcome: r.outcome,
      costMicroUsd: r.cost_micro_usd,
      totalMs: r.total_ms,
      firstTokenMs: r.first_token_ms,
    })),
  );
  if (rows.length === 0) {
    return <Card className="p-8 text-center text-sm text-zinc-500">No answers yet.</Card>;
  }
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Questions"
          value={String(summary.questions)}
          hint={`${summary.answered} answered · ${summary.handedOff} handed off`}
        />
        <Stat
          label="Average cost per answer"
          value={formatMicroUsd(summary.averageCostMicroUsd)}
          hint={`${formatMicroUsd(summary.totalCostMicroUsd)} in total`}
        />
        <Stat
          label="Time to answer (median)"
          value={summary.medianMs !== null ? formatMs(summary.medianMs) : "—"}
          hint={summary.p90Ms !== null ? `90% within ${formatMs(summary.p90Ms)}` : undefined}
        />
        <Stat
          label="First words (median)"
          value={summary.medianFirstTokenMs !== null ? formatMs(summary.medianFirstTokenMs) : "—"}
          hint="Answers stream as they are written"
        />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-zinc-100 text-xs text-zinc-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">When</th>
              <th className="px-4 py-2.5 font-medium">Question</th>
              <th className="px-4 py-2.5 font-medium">Outcome</th>
              <th className="px-4 py-2.5 text-right font-medium">Sources</th>
              <th className="px-4 py-2.5 text-right font-medium">Tokens in / cached / out</th>
              <th className="px-4 py-2.5 text-right font-medium">Cost</th>
              <th className="px-4 py-2.5 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((row) => {
              const [label, tone] = outcomeLabel[row.outcome];
              return (
                <tr key={row.id} className="align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-zinc-500">
                    {formatInstant(row.created_at)}
                    <span className="block text-zinc-400">{row.askedBy}</span>
                  </td>
                  <td className="max-w-md px-4 py-2.5 text-zinc-800">
                    {row.question}
                    <span className="block text-xs text-zinc-400">
                      {row.model} · effort {row.effort ?? "default"} · {row.search_count}{" "}
                      {row.search_count === 1 ? "search" : "searches"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={tone}>{label}</Badge>
                  </td>
                  <td className="tabular px-4 py-2.5 text-right text-zinc-700">
                    {row.citation_count}
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-2.5 text-right text-zinc-700">
                    {(row.input_tokens + row.cache_write_tokens).toLocaleString("en-US")} /{" "}
                    {row.cache_read_tokens.toLocaleString("en-US")} /{" "}
                    {row.output_tokens.toLocaleString("en-US")}
                  </td>
                  <td className="tabular px-4 py-2.5 text-right font-medium text-zinc-900">
                    {formatMicroUsd(row.cost_micro_usd)}
                  </td>
                  <td className="tabular whitespace-nowrap px-4 py-2.5 text-right text-zinc-700">
                    {formatMs(row.total_ms)}
                    {row.first_token_ms !== null && (
                      <span className="block text-xs text-zinc-400">
                        first words {formatMs(row.first_token_ms)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
