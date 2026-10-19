import type { Metadata } from "next";
import { Suspense } from "react";

import { Spinner } from "@/ui/feedback";

import { ChatScreen } from "./screen";

export const metadata: Metadata = { title: "Ask" };

/**
 * The chat. A conversation is `?c=<id>` on this one route, so the chat that starts a conversation stays
 * mounted when the conversation gets its URL (nothing typed or opened is lost).
 */
export default function ChatPage({ searchParams }: PageProps<"/chat">) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-zinc-400">
          <Spinner />
        </div>
      }
    >
      <ChatForQuery searchParams={searchParams} />
    </Suspense>
  );
}

async function ChatForQuery({ searchParams }: Pick<PageProps<"/chat">, "searchParams">) {
  const { c } = await searchParams;
  return (
    <ChatScreen conversationId={typeof c === "string" && /^[0-9a-f-]{36}$/.test(c) ? c : null} />
  );
}
