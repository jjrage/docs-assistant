import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/config/public-env";
import { serverEnv } from "@/config/server-env";
import type { Database } from "@/db/database.types";

export type Db = SupabaseClient<Database>;

let client: Db | undefined;

/**
 * Service-role client. It bypasses row-level security, so it is used only for writes the server has
 * authorized in code (always scoped to the signed-in user's company) and for the model transcript. Pages
 * read with userDb() instead, so the database policies apply.
 */
export function adminDb(): Db {
  client ??= createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return client;
}
