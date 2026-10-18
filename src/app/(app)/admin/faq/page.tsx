import type { Metadata } from "next";
import { Suspense } from "react";

import { frequentQuestions } from "@/server/admin/data";
import { requireAdmin } from "@/server/auth/viewer";
import { Card, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

export const metadata: Metadata = { title: "Frequent questions" };

export default function FrequentQuestionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Frequent questions</h1>
        <p className="mt-1 text-sm text-zinc-500">
          What people asked in the last 30 days, grouped by meaning (different words and languages
          land in one group). Groups the documents don&apos;t answer show what to write next.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-80" />}>
        <Groups />
      </Suspense>
    </div>
  );
}

async function Groups() {
  const viewer = await requireAdmin("/admin/faq");
  const { groups, total } = await frequentQuestions(viewer);
  if (groups.length === 0) {
    return <Card className="p-8 text-center text-sm text-zinc-500">No questions yet.</Card>;
  }
  return (
    <Card>
      <CardHeader title={`${groups.length} topics`} description={`${total} questions`} />
      <ul className="divide-y divide-zinc-100">
        {groups.map((group) => (
          <li key={`${group.question}-${group.lastAskedAt}`} className="flex gap-4 px-5 py-4">
            <span className="tabular w-10 shrink-0 text-right text-lg font-semibold text-zinc-900">
              {group.count}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-zinc-900">{group.question}</p>
              {group.variants.length > 1 && (
                <p className="mt-1 text-xs text-zinc-500">
                  Also asked as:{" "}
                  {group.variants
                    .slice(1)
                    .map((v) => `“${v}”`)
                    .join(" · ")}
                </p>
              )}
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                {group.handedOff > 0 ? (
                  <Badge tone="warning">
                    {group.handedOff === group.count
                      ? "Not in the documents"
                      : `${group.handedOff} handed off`}
                  </Badge>
                ) : (
                  <Badge tone="success">Answered from the documents</Badge>
                )}
                Last asked {formatInstant(group.lastAskedAt)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
