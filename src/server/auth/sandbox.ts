import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";
import { demoCompany } from "@/demo/company";

import { limits } from "../limits";

/**
 * Private demo sandboxes. A visitor who clicks "Try it" gets a company of their own for a day, linked to the
 * template company: the sample documents are read from the template (nothing is copied), while their own
 * uploads, questions, hand-offs and log stay in the sandbox. One user per sandbox; the role switch flips
 * that user between manager (admin) and resident (member).
 */

type Db = SupabaseClient<Database>;

export type SandboxRole = "admin" | "member";

const displayNames: Record<SandboxRole, string> = {
  admin: "You (property manager)",
  member: "You (resident)",
};

export type SandboxResult =
  { ok: true; email: string; password: string } | { ok: false; error: string };

export async function createSandbox(
  db: Db,
  role: SandboxRole,
  visitorId: string,
): Promise<SandboxResult> {
  const { data: template } = await db
    .from("companies")
    .select("id, name")
    .eq("slug", demoCompany.slug)
    .eq("kind", "template")
    .maybeSingle();
  if (!template) return { ok: false, error: "The demo company has not been set up yet." };

  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db
    .from("companies")
    .select("id", { count: "exact", head: true })
    .eq("created_by_visitor", visitorId)
    .gte("created_at", dayAgo);
  if ((count ?? 0) >= limits.sandbox.perVisitorPerDay) {
    return {
      ok: false,
      error:
        "You've started several demos today. Please come back tomorrow, or continue the last one.",
    };
  }

  // Tidy up a few expired sandboxes on the way (the daily cron job does the rest).
  await deleteExpiredSandboxes(db, 3);

  const suffix = randomBytes(5).toString("hex");
  const email = `visitor-${suffix}@sandbox.${demoCompany.domain}`;
  const password = randomBytes(24).toString("base64url");
  const { data: created, error: userError } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { sandbox: true },
  });
  if (userError || !created.user)
    return { ok: false, error: "Could not start the demo. Try again." };

  const { data: company, error: companyError } = await db
    .from("companies")
    .insert({
      slug: `sandbox-${suffix}`,
      name: template.name,
      kind: "sandbox",
      library_company_id: template.id,
      expires_at: new Date(Date.now() + limits.sandbox.lifetimeHours * 3600_000).toISOString(),
      created_by_visitor: visitorId,
    })
    .select("id")
    .single();
  if (companyError || !company) {
    await db.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "Could not start the demo. Try again." };
  }

  const { error: memberError } = await db.from("memberships").insert({
    company_id: company.id,
    user_id: created.user.id,
    role,
    display_name: displayNames[role],
  });
  if (memberError) {
    await db.from("companies").delete().eq("id", company.id);
    await db.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: "Could not start the demo. Try again." };
  }
  return { ok: true, email, password };
}

/** Flips the sandbox user between manager and resident. Only sandboxes allow it. */
export async function switchSandboxRole(
  db: Db,
  companyId: string,
  userId: string,
  role: SandboxRole,
) {
  const { data: company } = await db.from("companies").select("kind").eq("id", companyId).single();
  if (company?.kind !== "sandbox") throw new Error("Only a demo sandbox can switch roles.");
  const { error } = await db
    .from("memberships")
    .update({ role, display_name: displayNames[role] })
    .eq("company_id", companyId)
    .eq("user_id", userId);
  if (error) throw new Error(`switch role: ${error.message}`);
}

/** Deletes sandboxes past their expiry: files, the company (everything cascades) and its users. */
export async function deleteExpiredSandboxes(db: Db, max = 50): Promise<number> {
  const { data: expired } = await db
    .from("companies")
    .select("id, memberships(user_id)")
    .eq("kind", "sandbox")
    .lt("expires_at", new Date().toISOString())
    .limit(max);

  for (const company of expired ?? []) {
    const { data: files } = await db.storage.from("documents").list(company.id);
    if (files?.length) {
      await db.storage.from("documents").remove(files.map((f) => `${company.id}/${f.name}`));
    }
    await db.from("companies").delete().eq("id", company.id);
    for (const member of company.memberships) await db.auth.admin.deleteUser(member.user_id);
  }
  return expired?.length ?? 0;
}
