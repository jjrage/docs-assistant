import "server-only";

import { randomUUID } from "node:crypto";

import { cookies } from "next/headers";

const VISITOR_COOKIE = "visitor";

/**
 * A random id in a long-lived cookie, used only for per-visitor demo limits (how many sandboxes a browser
 * starts per day). No IP addresses are stored.
 */
export async function visitorId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(VISITOR_COOKIE)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing;
  const id = randomUUID();
  jar.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });
  return id;
}
