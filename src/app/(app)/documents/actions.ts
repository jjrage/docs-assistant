"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/server/auth/viewer";
import {
  completeUpload,
  deleteDocument,
  requestUpload,
  type UploadTicket,
} from "@/server/documents/upload";

const uploadSchema = z.object({
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  title: z.string().max(200),
  effectiveDate: z.iso.date().nullable(),
  versionLabel: z.string().max(40).nullable(),
  supersedesId: z.uuid().nullable(),
});

export async function startUpload(input: z.input<typeof uploadSchema>): Promise<UploadTicket> {
  const viewer = await requireAdmin();
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the file and the fields." };
  return requestUpload(viewer, parsed.data);
}

export async function finishUpload(documentId: string): Promise<{ error?: string }> {
  const viewer = await requireAdmin();
  if (!z.uuid().safeParse(documentId).success) return { error: "Document not found." };
  const result = await completeUpload(viewer, documentId);
  revalidatePath("/documents");
  return result;
}

export async function removeDocument(documentId: string): Promise<{ error?: string }> {
  const viewer = await requireAdmin();
  if (!z.uuid().safeParse(documentId).success) return { error: "Document not found." };
  const result = await deleteDocument(viewer, documentId);
  revalidatePath("/documents");
  return result;
}
