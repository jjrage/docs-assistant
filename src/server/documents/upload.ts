import "server-only";

import { randomUUID } from "node:crypto";

import { after } from "next/server";

import type { Viewer } from "../auth/viewer";
import { adminDb } from "../db/admin";
import { limits } from "../limits";
import { appEmbedder } from "../search/embedder";
import { documentsBucket, processDocument } from "./process";

/**
 * Upload flow: the server checks the admin's request and creates the document row with a one-time signed
 * upload URL; the browser sends the file straight to storage (no 4.5 MB request limit on the app server);
 * then completeUpload() starts processing after the response. Every query is scoped to the admin's own
 * company, so a sandbox can never touch the template's sample documents.
 */

export type UploadRequest = {
  fileName: string;
  sizeBytes: number;
  title: string;
  effectiveDate: string | null;
  versionLabel: string | null;
  supersedesId: string | null;
};

export type UploadTicket =
  { ok: true; documentId: string; path: string; token: string } | { ok: false; error: string };

function formatOf(fileName: string): "pdf" | "docx" | null {
  const ext = fileName.toLowerCase().split(".").at(-1);
  return ext === "pdf" ? "pdf" : ext === "docx" ? "docx" : null;
}

function maxPages(viewer: Viewer) {
  return viewer.company.kind === "sandbox" ? limits.file.maxPagesSandbox : limits.file.maxPages;
}

export async function requestUpload(viewer: Viewer, request: UploadRequest): Promise<UploadTicket> {
  if (!appEmbedder()) {
    return { ok: false, error: "Indexing is switched off: no VOYAGE_API_KEY is configured." };
  }
  const format = formatOf(request.fileName);
  if (!format) return { ok: false, error: "Upload a PDF or a Word (.docx) file." };
  if (request.sizeBytes <= 0 || request.sizeBytes > limits.file.maxBytes) {
    return { ok: false, error: "Files up to 10 MB, please." };
  }

  const db = adminDb();
  const companyId = viewer.company.id;
  const cap =
    viewer.company.kind === "sandbox" ? limits.documents.perSandbox : limits.documents.perCompany;
  const { count } = await db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if ((count ?? 0) >= cap) {
    return {
      ok: false,
      error:
        viewer.company.kind === "sandbox"
          ? `The demo allows ${cap} uploads of your own. Delete one to upload another.`
          : `This company has reached ${cap} documents.`,
    };
  }

  if (request.supersedesId) {
    const { data: older } = await db
      .from("documents")
      .select("id")
      .eq("id", request.supersedesId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!older) return { ok: false, error: "The document it replaces was not found." };
  }

  const documentId = randomUUID();
  const path = `${companyId}/${documentId}.${format}`;
  const { error } = await db.from("documents").insert({
    id: documentId,
    company_id: companyId,
    title: request.title.trim().slice(0, 200) || request.fileName,
    file_name: request.fileName.slice(0, 255),
    format,
    storage_path: path,
    size_bytes: request.sizeBytes,
    status: "uploading",
    effective_date: request.effectiveDate,
    version_label: request.versionLabel?.trim().slice(0, 40) || null,
    supersedes_id: request.supersedesId,
    uploaded_by: viewer.userId,
  });
  if (error) return { ok: false, error: "Could not start the upload. Try again." };

  const signed = await db.storage.from(documentsBucket).createSignedUploadUrl(path);
  if (signed.error || !signed.data) {
    await db.from("documents").delete().eq("id", documentId);
    return { ok: false, error: "Could not start the upload. Try again." };
  }
  return { ok: true, documentId, path, token: signed.data.token };
}

/** The browser finished sending the file: index it after the response. */
export async function completeUpload(
  viewer: Viewer,
  documentId: string,
): Promise<{ error?: string }> {
  const db = adminDb();
  const { data: doc } = await db
    .from("documents")
    .select("id, status")
    .eq("id", documentId)
    .eq("company_id", viewer.company.id)
    .maybeSingle();
  if (!doc) return { error: "Document not found." };
  if (doc.status !== "uploading" && doc.status !== "failed") return {};

  const embed = appEmbedder();
  if (!embed) return { error: "Indexing is switched off: no VOYAGE_API_KEY is configured." };
  await db.from("documents").update({ status: "processing", error: null }).eq("id", doc.id);
  const pages = maxPages(viewer);
  after(() => processDocument(db, embed, doc.id, { maxPages: pages }));
  return {};
}

export async function deleteDocument(
  viewer: Viewer,
  documentId: string,
): Promise<{ error?: string }> {
  const db = adminDb();
  const { data: doc } = await db
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .eq("company_id", viewer.company.id)
    .maybeSingle();
  if (!doc) return { error: "Document not found." };
  await db.storage.from(documentsBucket).remove([doc.storage_path]);
  await db.from("documents").delete().eq("id", doc.id);
  return {};
}
