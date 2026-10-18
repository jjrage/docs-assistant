import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "@/config/server-env";
import { deleteExpiredSandboxes } from "@/server/auth/sandbox";
import { adminDb } from "@/server/db/admin";

export const maxDuration = 300;

/**
 * Daily clean-up of expired demo sandboxes (Vercel cron sends `Authorization: Bearer <CRON_SECRET>`).
 * Without a configured secret the endpoint is closed.
 */
export async function GET(request: Request) {
  const secret = serverEnv.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (
    !secret ||
    given.length !== secret.length ||
    !timingSafeEqual(Buffer.from(given), Buffer.from(secret))
  ) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const deleted = await deleteExpiredSandboxes(adminDb(), 200);
  return Response.json({ deleted, ms: Date.now() - started });
}
