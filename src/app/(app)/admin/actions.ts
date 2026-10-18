"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { replyToHandoff } from "@/server/admin/data";
import { requireAdmin } from "@/server/auth/viewer";

const replySchema = z.object({
  handoffId: z.uuid(),
  answer: z.string().trim().min(2, "Write a reply first.").max(4000),
});

export type ReplyState = { error?: string; sent?: boolean } | undefined;

export async function sendReply(_state: ReplyState, form: FormData): Promise<ReplyState> {
  const viewer = await requireAdmin("/admin/inbox");
  const parsed = replySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the reply." };
  const result = await replyToHandoff(viewer, parsed.data.handoffId, parsed.data.answer);
  if (result.error) return { error: result.error };
  revalidatePath("/admin/inbox");
  return { sent: true };
}
