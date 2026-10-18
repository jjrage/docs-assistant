import { connection } from "next/server";

import { publicEnv } from "@/config/public-env";

/** Liveness check for local development and deployment: the app is up and can reach Supabase. */
export async function GET() {
  // Always evaluate at request time; a prerendered health check would report stale status.
  await connection();
  let supabase: "ok" | "unreachable" = "unreachable";
  try {
    const response = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.ok) supabase = "ok";
  } catch {
    // reported as unreachable
  }
  return Response.json(
    { status: supabase === "ok" ? "ok" : "degraded", dependencies: { supabase } },
    { status: supabase === "ok" ? 200 : 503 },
  );
}
