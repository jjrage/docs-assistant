import type { Metadata } from "next";

import { ChatScreen } from "./screen";

export const metadata: Metadata = { title: "Ask" };

export default function NewChatPage() {
  return <ChatScreen conversationId={null} />;
}
