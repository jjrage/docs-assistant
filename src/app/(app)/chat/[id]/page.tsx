import type { Metadata } from "next";
import { Suspense } from "react";

import { Spinner } from "@/ui/feedback";

import { ChatScreen } from "../screen";

export const metadata: Metadata = { title: "Ask" };

export default function ChatPage({ params }: PageProps<"/chat/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center text-zinc-400">
          <Spinner />
        </div>
      }
    >
      <ChatForId params={params} />
    </Suspense>
  );
}

async function ChatForId({ params }: Pick<PageProps<"/chat/[id]">, "params">) {
  const { id } = await params;
  return (
    <ChatScreen
      conversationId={/^[0-9a-f-]{36}$/.test(id) ? id : "00000000-0000-0000-0000-000000000000"}
    />
  );
}
