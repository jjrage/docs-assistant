import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";

import { toPgVector, type Embedder } from "../search/voyage";
import type { ParsedDocument } from "./blocks";
import { chunkBlocks, embeddingText } from "./chunk";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";

/**
 * Turns an uploaded file into searchable text: download → check it really is a PDF or DOCX → blocks with
 * pages and sections → chunks → embeddings → rows. The document ends `ready` with its counts, or `failed`
 * with a reason an admin can act on. Safe to run again: earlier blocks and chunks of the document are
 * replaced. Takes its database client and embedder as arguments so the seed script and tests run it too.
 */

type Db = SupabaseClient<Database>;

export const documentsBucket = "documents";

/** Problems with the file itself; their message is shown to the admin as is. */
export class DocumentProblem extends Error {
  override name = "DocumentProblem";
}

const signatures = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  docx: [0x50, 0x4b, 0x03, 0x04], // PK.. (a ZIP container)
} as const;

export function looksLike(format: "pdf" | "docx", data: Uint8Array): boolean {
  return signatures[format].every((byte, i) => data[i] === byte);
}

export async function parseFile(
  format: "pdf" | "docx",
  data: Uint8Array,
  maxPages: number,
): Promise<ParsedDocument> {
  if (!looksLike(format, data)) {
    throw new DocumentProblem(`This file is not a valid ${format.toUpperCase()}.`);
  }
  let parsed: ParsedDocument;
  try {
    parsed = format === "pdf" ? await parsePdf(data) : await parseDocx(data);
  } catch {
    throw new DocumentProblem(
      `The ${format.toUpperCase()} could not be read. It may be damaged or password-protected.`,
    );
  }
  if (parsed.pageCount !== null && parsed.pageCount > maxPages) {
    throw new DocumentProblem(
      `The document has ${parsed.pageCount} pages; the limit is ${maxPages}.`,
    );
  }
  if (!parsed.blocks.some((b) => b.kind !== "heading")) {
    throw new DocumentProblem(
      "No text found. Scanned documents (images of pages) are not supported yet.",
    );
  }
  return parsed;
}

async function insertInBatches<T>(rows: T[], size: number, insert: (batch: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

export type ProcessResult =
  | { ok: true; blocks: number; chunks: number; embeddingTokens: number }
  | { ok: false; error: string };

export async function processDocument(
  db: Db,
  embed: Embedder,
  documentId: string,
  options: { maxPages: number },
): Promise<ProcessResult> {
  const { data: doc, error } = await db
    .from("documents")
    .select("id, company_id, title, format, storage_path")
    .eq("id", documentId)
    .single();
  if (error || !doc) return { ok: false, error: `document not found: ${documentId}` };

  await db.from("documents").update({ status: "processing", error: null }).eq("id", doc.id);

  try {
    const file = await db.storage.from(documentsBucket).download(doc.storage_path);
    if (file.error) throw new DocumentProblem("The uploaded file was not found. Upload it again.");
    const data = new Uint8Array(await file.data.arrayBuffer());

    const parsed = await parseFile(doc.format, data, options.maxPages);
    const chunks = chunkBlocks(parsed.blocks);
    const { vectors, tokens } = await embed(
      chunks.map((c) => embeddingText(doc.title, c)),
      "document",
    );

    await clearContent(db, doc.id);
    await insertInBatches(parsed.blocks, 500, async (batch) => {
      const { error: blockError } = await db.from("document_blocks").insert(
        batch.map((b) => ({
          company_id: doc.company_id,
          document_id: doc.id,
          seq: b.seq,
          kind: b.kind,
          page: b.page,
          level: b.level,
          section: b.section,
          text: b.text,
        })),
      );
      if (blockError) throw new Error(`insert blocks: ${blockError.message}`);
    });
    await insertInBatches(chunks, 100, async (batch) => {
      const { error: chunkError } = await db.from("chunks").insert(
        batch.map((c) => ({
          company_id: doc.company_id,
          document_id: doc.id,
          seq: c.seq,
          block_start: c.blockStart,
          block_end: c.blockEnd,
          page: c.page,
          section: c.section,
          content: c.content,
          token_count: c.tokenCount,
          embedding: toPgVector(vectors[c.seq]!),
        })),
      );
      if (chunkError) throw new Error(`insert chunks: ${chunkError.message}`);
    });

    const { error: doneError } = await db
      .from("documents")
      .update({
        status: "ready",
        error: null,
        page_count: parsed.pageCount,
        block_count: parsed.blocks.length,
        chunk_count: chunks.length,
        processed_at: new Date().toISOString(),
      })
      .eq("id", doc.id);
    if (doneError) throw new Error(`finish document: ${doneError.message}`);
    return {
      ok: true,
      blocks: parsed.blocks.length,
      chunks: chunks.length,
      embeddingTokens: tokens,
    };
  } catch (cause) {
    const message =
      cause instanceof DocumentProblem
        ? cause.message
        : "Processing failed on our side. Try again in a minute.";
    if (!(cause instanceof DocumentProblem)) console.error("process document", doc.id, cause);
    await clearContent(db, doc.id);
    await db.from("documents").update({ status: "failed", error: message }).eq("id", doc.id);
    return { ok: false, error: message };
  }
}

async function clearContent(db: Db, documentId: string) {
  await db.from("chunks").delete().eq("document_id", documentId);
  await db.from("document_blocks").delete().eq("document_id", documentId);
}
