import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { parseEnv, publicEnvSchema, serverEnvSchema } from "@/config/env-schema";
import type { Database } from "@/db/database.types";

/** Service-role client for integration tests: it plays the app server. */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = parseEnv(publicEnvSchema, process.env, "public");
  const { SUPABASE_SECRET_KEY } = parseEnv(serverEnvSchema, process.env, "server");
  return createClient<Database>(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Admin = ReturnType<typeof createAdminClient>;

/** A throwaway company; delete it (and its files) with the returned cleanup. */
export async function createTestCompany(admin: Admin, name = "Integration Test Homes") {
  const slug = `it-${randomUUID().slice(0, 8)}`;
  const { data, error } = await admin
    .from("companies")
    .insert({ slug, name, kind: "standard" })
    .select("id")
    .single();
  if (error) throw error;
  const companyId = data.id;
  return {
    companyId,
    async cleanup() {
      const { data: files } = await admin.storage.from("documents").list(companyId);
      if (files?.length) {
        await admin.storage.from("documents").remove(files.map((f) => `${companyId}/${f.name}`));
      }
      await admin.from("companies").delete().eq("id", companyId);
    },
  };
}
