/**
 * Seeds the demo template company: Ostervale Property Management with its documents (demo/files, rendered
 * from demo/content by `npm run demo:docs`) indexed through the same pipeline as an upload, and two fixed
 * accounts (a property manager and a resident). Re-running replaces the template and every demo sandbox.
 *
 * Usage: npm run db:seed   (after npm run db:start; needs VOYAGE_API_KEY in .env.local)
 *        npm run db:seed -- --offline   (no key: word-hash vectors, enough to click through the UI; the
 *                                        app's search needs a real re-seed once the key is there)
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { isLocalSupabase, parseEnv, publicEnvSchema, serverEnvSchema } from "@/config/env-schema";
import type { Database } from "@/db/database.types";
import { demoCompany, localDemoPassword, templateAccounts } from "@/demo/company";
import { parseDemoMarkdown, type DemoMeta } from "@/demo/markdown";
import { documentsBucket, processDocument } from "@/server/documents/process";
import { limits } from "@/server/limits";
import { hashEmbedder } from "@/server/search/hash-embedder";
import { patient, voyageEmbedder } from "@/server/search/voyage";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { NEXT_PUBLIC_SUPABASE_URL: url } = parseEnv(publicEnvSchema, process.env, "public");
const env = parseEnv(serverEnvSchema, process.env, "server");
const offline = process.argv.includes("--offline");
if (!env.VOYAGE_API_KEY && !offline) {
  throw new Error(
    "Set VOYAGE_API_KEY in .env.local (the demo documents are indexed with Voyage AI), or run with --offline.",
  );
}
// A fixed password is fine for a local database; anywhere else it must come from the environment so the
// public repository never holds a working credential.
const password = env.DEMO_USER_PASSWORD ?? (isLocalSupabase(url) ? localDemoPassword : undefined);
if (!password)
  throw new Error("Set DEMO_USER_PASSWORD to seed a database that is not the local one.");

const db = createClient<Database>(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const embed =
  offline || !env.VOYAGE_API_KEY ? hashEmbedder : voyageEmbedder(env.VOYAGE_API_KEY, patient);

const mime = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function ensureUser(email: string, displayName: string): Promise<string> {
  const existing = (await allUsers()).find((u) => u.email === email);
  if (existing) {
    const { error } = await db.auth.admin.updateUserById(existing.id, {
      password,
      user_metadata: { full_name: displayName },
    });
    if (error) throw error;
    return existing.id;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: displayName },
  });
  if (error) throw error;
  return data.user.id;
}

async function removeFolder(folder: string) {
  const { data: files } = await db.storage.from(documentsBucket).list(folder, { limit: 1000 });
  if (files?.length) {
    await db.storage.from(documentsBucket).remove(files.map((f) => `${folder}/${f.name}`));
  }
}

async function main() {
  console.log(`Seeding ${demoCompany.name} into ${url}`);

  // Remove the previous template and every sandbox reading it (with their files and visitor accounts).
  const { data: previous } = await db
    .from("companies")
    .select("id, kind")
    .or(`slug.eq.${demoCompany.slug},kind.eq.sandbox`);
  for (const company of previous ?? []) {
    if (company.kind === "standard")
      throw new Error(`Refusing to replace a real company (${company.id}).`);
    await removeFolder(company.id);
  }
  await db.from("companies").delete().eq("kind", "sandbox");
  await db.from("companies").delete().eq("slug", demoCompany.slug);
  for (const user of await allUsers()) {
    if (user.email?.endsWith(`@sandbox.${demoCompany.domain}`))
      await db.auth.admin.deleteUser(user.id);
  }

  const { data: company, error } = await db
    .from("companies")
    .insert({ slug: demoCompany.slug, name: demoCompany.name, kind: "template" })
    .select("id")
    .single();
  if (error) throw error;

  for (const account of Object.values(templateAccounts)) {
    const userId = await ensureUser(account.email, account.displayName);
    const { error: memberError } = await db.from("memberships").insert({
      company_id: company.id,
      user_id: userId,
      role: account.role,
      display_name: account.displayName,
    });
    if (memberError) throw memberError;
  }

  // Documents: rows first (so "supersedes" can point at any of them), then files, then indexing.
  const contentDir = path.join("demo", "content", "docs");
  const metas: (DemoMeta & { id: string })[] = [];
  for (const file of (await readdir(contentDir)).filter((f) => f.endsWith(".md")).sort()) {
    const { meta } = parseDemoMarkdown(await readFile(path.join(contentDir, file), "utf8"));
    metas.push({ ...meta, id: randomUUID() });
  }
  const idOf = new Map(metas.map((m) => [m.slug, m.id]));

  for (const meta of metas) {
    const fileName = `${meta.slug}.${meta.format}`;
    const data = await readFile(path.join("demo", "files", fileName));
    const storagePath = `${company.id}/${meta.id}.${meta.format}`;
    const uploaded = await db.storage
      .from(documentsBucket)
      .upload(storagePath, data, { contentType: mime[meta.format] });
    if (uploaded.error) throw uploaded.error;
    const { error: docError } = await db.from("documents").insert({
      id: meta.id,
      company_id: company.id,
      title: meta.title,
      file_name: fileName,
      format: meta.format,
      storage_path: storagePath,
      size_bytes: data.byteLength,
      effective_date: meta.effectiveDate,
      version_label: meta.version,
    });
    if (docError) throw docError;
  }
  for (const meta of metas.filter((m) => m.supersedes)) {
    const older = idOf.get(meta.supersedes!);
    if (!older) throw new Error(`${meta.slug} supersedes unknown document ${meta.supersedes}`);
    await db.from("documents").update({ supersedes_id: older }).eq("id", meta.id);
  }

  let chunks = 0;
  let tokens = 0;
  for (const meta of metas) {
    const result = await processDocument(db, embed, meta.id, { maxPages: limits.file.maxPages });
    if (!result.ok) throw new Error(`${meta.slug}: ${result.error}`);
    chunks += result.chunks;
    tokens += result.embeddingTokens;
    console.log(`  ${meta.title}: ${result.blocks} blocks, ${result.chunks} chunks`);
  }

  console.log(
    `Done: ${metas.length} documents, ${chunks} chunks, ${tokens.toLocaleString("en-US")} embedding tokens.`,
  );
  if (isLocalSupabase(url)) {
    console.log(
      `Accounts: ${templateAccounts.admin.email} and ${templateAccounts.member.email}, password "${password}" (local only).`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
