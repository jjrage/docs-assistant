import { connection } from "next/server";

import { publicEnv } from "@/config/public-env";
import { adminDb } from "@/server/db/admin";

type Status = "ok" | "unreachable";

async function authStatus(): Promise<Status> {
  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/**
 * One real query. Besides checking the database, it is the activity that keeps a free Supabase project
 * from being paused: the scheduled keep-alive workflow calls this endpoint several times a day.
 */
async function databaseStatus(): Promise<Status> {
  try {
    const { error } = await adminDb()
      .from("companies")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(3_000));
    return error ? "unreachable" : "ok";
  } catch {
    return "unreachable";
  }
}

/** Liveness check for local development and deployment: the app is up and can reach Supabase. */
export async function GET() {
  // Always evaluate at request time; a prerendered health check would report stale status.
  await connection();
  const [auth, database] = await Promise.all([authStatus(), databaseStatus()]);
  const ok = auth === "ok" && database === "ok";
  return Response.json(
    { status: ok ? "ok" : "degraded", dependencies: { auth, database } },
    { status: ok ? 200 : 503 },
  );
}
