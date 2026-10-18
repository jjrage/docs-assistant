import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processDocument } from "@/server/documents/process";
import { toPgVector } from "@/server/search/voyage";

import { createAdminClient, createTestCompany } from "./admin-client";
import { hashEmbedder as fakeEmbedder, hashVector } from "@/server/search/hash-embedder";

const admin = createAdminClient();
let company: Awaited<ReturnType<typeof createTestCompany>>;

async function upload(file: string, format: "pdf" | "docx", title: string) {
  const id = randomUUID();
  const storagePath = `${company.companyId}/${id}.${format}`;
  const data = await readFile(file);
  const { error } = await admin.storage.from("documents").upload(storagePath, data, {
    contentType:
      format === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (error) throw error;
  const inserted = await admin.from("documents").insert({
    id,
    company_id: company.companyId,
    title,
    file_name: file.split("/").at(-1)!,
    format,
    storage_path: storagePath,
    size_bytes: data.byteLength,
  });
  if (inserted.error) throw inserted.error;
  return id;
}

beforeAll(async () => {
  company = await createTestCompany(admin);
});
afterAll(async () => {
  await company.cleanup();
});

describe("processing an uploaded document", () => {
  const fixtures = "src/server/documents/__fixtures__/files";

  it("indexes a PDF into blocks and chunks with pages, then finds it by meaning and by words", async () => {
    const id = await upload(`${fixtures}/fixture-handbook.pdf`, "pdf", "Resident Handbook");
    const result = await processDocument(admin, fakeEmbedder, id, { maxPages: 40 });
    expect(result).toMatchObject({ ok: true });

    const { data: doc } = await admin.from("documents").select("*").eq("id", id).single();
    expect(doc).toMatchObject({ status: "ready", page_count: 4, error: null });
    expect(doc!.chunk_count).toBeGreaterThan(5);

    const query = "How much is the charge for a returned payment?";
    const { data: hits, error } = await admin.rpc("match_chunks", {
      p_company_ids: [company.companyId],
      p_query_embedding: toPgVector(hashVector(query)),
      p_query_text: query,
      p_match_count: 3,
    });
    expect(error).toBeNull();
    const top = hits![0]!;
    expect(top).toMatchObject({ title: "Resident Handbook", page: 2, format: "pdf" });
    expect(top.section).toBe("2. Late Charges › Late charge amounts");
    expect(JSON.stringify(top.blocks)).toContain("Returned payment | $40 | Per payment");
    // Both signals found it; fusion put it first.
    expect(top.vector_rank).not.toBeNull();
    expect(top.text_rank).not.toBeNull();
  });

  it("indexes a DOCX by section", async () => {
    const id = await upload(`${fixtures}/fixture-checklist.docx`, "docx", "Move-Out Checklist");
    expect(await processDocument(admin, fakeEmbedder, id, { maxPages: 40 })).toMatchObject({
      ok: true,
    });
    const { data: blocks } = await admin
      .from("document_blocks")
      .select("page, section, text")
      .eq("document_id", id)
      .order("seq");
    expect(blocks!.every((b) => b.page === null)).toBe(true);
    expect(blocks!.find((b) => b.text.startsWith("Unreturned keys"))?.section).toBe(
      "Before You Leave › Keys",
    );
  });

  it("re-processing replaces the earlier content instead of duplicating it", async () => {
    const id = await upload(`${fixtures}/fixture-checklist.docx`, "docx", "Checklist again");
    await processDocument(admin, fakeEmbedder, id, { maxPages: 40 });
    await processDocument(admin, fakeEmbedder, id, { maxPages: 40 });
    const { count } = await admin
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", id);
    const { data: doc } = await admin.from("documents").select("chunk_count").eq("id", id).single();
    expect(count).toBe(doc!.chunk_count);
  });

  it("fails with a readable reason when the file is not what it claims to be", async () => {
    const id = randomUUID();
    const storagePath = `${company.companyId}/${id}.pdf`;
    await admin.storage
      .from("documents")
      .upload(storagePath, Buffer.from("just some text"), { contentType: "application/pdf" });
    await admin.from("documents").insert({
      id,
      company_id: company.companyId,
      title: "Not a PDF",
      file_name: "fake.pdf",
      format: "pdf",
      storage_path: storagePath,
      size_bytes: 14,
    });
    expect(await processDocument(admin, fakeEmbedder, id, { maxPages: 40 })).toEqual({
      ok: false,
      error: "This file is not a valid PDF.",
    });
    const { data: doc } = await admin
      .from("documents")
      .select("status, error")
      .eq("id", id)
      .single();
    expect(doc).toEqual({ status: "failed", error: "This file is not a valid PDF." });
  });

  it("refuses a PDF over the page limit", async () => {
    const id = await upload(`${fixtures}/fixture-handbook.pdf`, "pdf", "Too long");
    expect(await processDocument(admin, fakeEmbedder, id, { maxPages: 3 })).toEqual({
      ok: false,
      error: "The document has 4 pages; the limit is 3.",
    });
  });
});
