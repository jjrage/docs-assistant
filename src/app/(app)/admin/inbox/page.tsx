import type { Metadata } from "next";
import { Suspense } from "react";

import { inbox } from "@/server/admin/data";
import { requireAdmin } from "@/server/auth/viewer";
import { Card } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatInstant } from "@/ui/format";

import { ReplyForm } from "./reply-form";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Inbox</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Questions the documents don&apos;t answer. The assistant said so instead of guessing and
          passed them here; your reply appears in the person&apos;s chat.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-80" />}>
        <Items />
      </Suspense>
    </div>
  );
}

async function Items() {
  const viewer = await requireAdmin("/admin/inbox");
  const items = await inbox(viewer);
  if (items.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-zinc-500">
        Nothing here yet. Ask something the documents don&apos;t cover (EV charging, say) as a
        resident, then come back.
      </Card>
    );
  }
  const open = items.filter((i) => i.status === "open");
  const answered = items.filter((i) => i.status === "answered");
  return (
    <div className="space-y-6">
      {open.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            Waiting for a reply ({open.length})
          </h2>
          {open.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </section>
      )}
      {answered.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-zinc-900">Answered</h2>
          {answered.map((item) => (
            <Item key={item.id} item={item} />
          ))}
        </section>
      )}
    </div>
  );
}

function Item({ item }: { item: Awaited<ReturnType<typeof inbox>>[number] }) {
  const asked = item.context?.asked;
  return (
    <Card className="space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        <Badge tone={item.status === "open" ? "warning" : "success"}>
          {item.status === "open" ? "Open" : "Answered"}
        </Badge>
        <span>
          {item.askedBy} · {formatInstant(item.createdAt)}
        </span>
      </div>
      <p className="font-medium text-zinc-900">{item.question}</p>
      {asked && asked !== item.question && (
        <p className="text-sm text-zinc-600">
          <span className="text-zinc-400">Asked as:</span> “{asked}”
        </p>
      )}
      {item.reason && (
        <p className="text-sm text-zinc-600">
          <span className="text-zinc-400">Why it came here:</span> {item.reason}
        </p>
      )}
      {item.context?.closest && item.context.closest.length > 0 && (
        <p className="text-xs text-zinc-500">
          Closest passages found:{" "}
          {item.context.closest
            .map((c) => (c.page ? `${c.title}, p. ${c.page}` : c.title))
            .join(" · ")}
        </p>
      )}
      {item.status === "answered" ? (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-zinc-800 ring-1 ring-inset ring-emerald-200">
          <p className="whitespace-pre-wrap">{item.answer}</p>
          {item.answeredAt && (
            <p className="mt-1 text-xs text-zinc-500">Replied {formatInstant(item.answeredAt)}</p>
          )}
        </div>
      ) : (
        <ReplyForm handoffId={item.id} />
      )}
    </Card>
  );
}
