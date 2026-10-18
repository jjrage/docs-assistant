"use server";

import { redirect } from "next/navigation";

import { switchSandboxRole, type SandboxRole } from "@/server/auth/sandbox";
import { requireViewer } from "@/server/auth/viewer";
import { adminDb } from "@/server/db/admin";

/** Demo sandboxes only: view the same company as the property manager or as a resident. */
export async function switchRole(role: SandboxRole): Promise<void> {
  const viewer = await requireViewer();
  if (viewer.company.kind !== "sandbox" || (role !== "admin" && role !== "member")) return;
  await switchSandboxRole(adminDb(), viewer.company.id, viewer.userId, role);
  redirect(role === "admin" ? "/admin/inbox" : "/chat");
}
