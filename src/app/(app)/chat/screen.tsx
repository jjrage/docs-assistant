import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { conversationTurns, recentConversations } from "@/server/ai/history";
import { requireViewer } from "@/server/auth/viewer";
import { cn } from "@/ui/cn";
import { Skeleton, Spinner } from "@/ui/feedback";

import { Chat } from "./chat";

/** The chat screen: recent conversations on the left, the conversation in the middle. */
export function ChatScreen({ conversationId }: { conversationId: string | null }) {
  return (
    <div className="flex min-h-0 flex-1">
      <nav className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-zinc-200 bg-white/60 xl:flex">
        <div className="px-4 pb-2 pt-5">
          <Link
            href="/chat"
            className="flex w-full items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm ring-1 ring-zinc-200 hover:bg-zinc-50"
          >
            New question
          </Link>
        </div>
        <Suspense fallback={<Skeleton className="mx-4 mt-3 h-40" />}>
          <Conversations current={conversationId} />
        </Suspense>
      </nav>
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center text-zinc-400">
            <Spinner />
          </div>
        }
      >
        <Conversation conversationId={conversationId} />
      </Suspense>
    </div>
  );
}

async function Conversation({ conversationId }: { conversationId: string | null }) {
  const viewer = await requireViewer(conversationId ? `/chat/${conversationId}` : "/chat");
  const turns = conversationId ? await conversationTurns(conversationId) : [];
  if (turns === null) notFound();
  return (
    <Chat
      key={conversationId ?? "new"}
      conversationId={conversationId}
      initialTurns={turns}
      showCost={viewer.role === "admin"}
    />
  );
}

async function Conversations({ current }: { current: string | null }) {
  const viewer = await requireViewer();
  const conversations = await recentConversations(viewer);
  if (conversations.length === 0) {
    return <p className="px-5 py-3 text-xs text-zinc-400">Your questions will be listed here.</p>;
  }
  return (
    <ul className="space-y-0.5 px-2 py-2">
      {conversations.map((c) => (
        <li key={c.id}>
          <Link
            href={`/chat/${c.id}`}
            className={cn(
              "block truncate rounded-lg px-3 py-2 text-sm",
              c.id === current
                ? "bg-brand-50 font-medium text-brand-800"
                : "text-zinc-600 hover:bg-zinc-100",
            )}
          >
            {c.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}
