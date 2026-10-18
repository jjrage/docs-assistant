import "server-only";

import { getViewer } from "../auth/viewer";
import { adminDb } from "../db/admin";
import { userDb } from "../db/user-client";
import { documentsBucket } from "./process";

/**
 * Reading a document for the viewer. Access is decided by row-level security: the document row is read
 * with the signed-in user's session, and only if that works does the server sign a short-lived URL for the
 * file (nobody can read the bucket with their own session).
 */

export type ViewerDocument = {
  id: string;
  title: string;
  format: "pdf" | "docx";
  pageCount: number | null;
  versionLabel: string | null;
  effectiveDate: string | null;
};

export async function readableDocument(
  id: string,
): Promise<(ViewerDocument & { storagePath: string }) | null> {
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await getViewer())) return null;
  const db = await userDb();
  const { data } = await db
    .from("documents")
    .select("id, title, format, page_count, version_label, effective_date, storage_path, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status !== "ready") return null;
  return {
    id: data.id,
    title: data.title,
    format: data.format,
    pageCount: data.page_count,
    versionLabel: data.version_label,
    effectiveDate: data.effective_date,
    storagePath: data.storage_path,
  };
}

export async function signedFileUrl(storagePath: string): Promise<string | null> {
  const { data } = await adminDb().storage.from(documentsBucket).createSignedUrl(storagePath, 60);
  return data?.signedUrl ?? null;
}

export type ViewerBlock = {
  seq: number;
  kind: "heading" | "paragraph" | "list_item" | "table_row";
  level: number | null;
  page: number | null;
  text: string;
};

export async function documentBlocks(id: string): Promise<ViewerBlock[]> {
  const db = await userDb();
  const { data } = await db
    .from("document_blocks")
    .select("seq, kind, level, page, text")
    .eq("document_id", id)
    .order("seq");
  return data ?? [];
}
