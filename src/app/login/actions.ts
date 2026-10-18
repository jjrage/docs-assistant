"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createSandbox, type SandboxRole } from "@/server/auth/sandbox";
import { visitorId } from "@/server/auth/visitor";
import { adminDb } from "@/server/db/admin";
import { userDb } from "@/server/db/user-client";

/** A same-site path to continue to after signing in; anything else falls back to the chat. */
function safeNext(next: unknown): string | null {
  return typeof next === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(next) ? next : null;
}

export type SignInState = { error?: string } | undefined;

const passwordSchema = z.object({
  email: z.string().trim().pipe(z.email()),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function signInWithPassword(
  _state: SignInState,
  form: FormData,
): Promise<SignInState> {
  const parsed = passwordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Enter your e-mail and password." };

  const db = await userDb();
  const { error } = await db.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: "Wrong e-mail or password." };
  redirect(safeNext(parsed.data.next) ?? "/chat");
}

/**
 * "Try it": a private copy of the demo company for this visitor, signed in as a property manager (admin) or a
 * resident (member). Uploads and questions stay in that copy, which is deleted after a day.
 */
export async function startDemo(role: SandboxRole): Promise<SignInState> {
  if (role !== "admin" && role !== "member") return { error: "Unknown role." };
  const sandbox = await createSandbox(adminDb(), role, await visitorId());
  if (!sandbox.ok) return { error: sandbox.error };

  const db = await userDb();
  const { error } = await db.auth.signInWithPassword({
    email: sandbox.email,
    password: sandbox.password,
  });
  if (error) return { error: "Could not start the demo. Try again." };
  redirect(role === "admin" ? "/documents" : "/chat");
}

export async function signOut(): Promise<void> {
  const db = await userDb();
  await db.auth.signOut();
  redirect("/");
}
