import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/config/public-env";
import type { Database } from "@/db/database.types";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/**
 * Supabase in the browser, used only to send a file to the signed upload URL the server issued (the file
 * goes straight to storage, not through the app server). Everything else goes through the server.
 */
export function browserDb() {
  client ??= createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return client;
}
