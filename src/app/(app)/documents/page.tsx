import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireViewer, searchableCompanyIds } from "@/server/auth/viewer";
import { userDb } from "@/server/db/user-client";
import { limits } from "@/server/limits";
import { AutoRefresh } from "@/ui/auto-refresh";
import { Card, CardHeader } from "@/ui/card";
import { Badge, Skeleton } from "@/ui/feedback";
import { formatBytes, formatDate } from "@/ui/format";

import { DeleteButton } from "./delete-button";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-8 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Documents</h1>
        <p className="mt-1 text-sm text-zinc-500">
          What the assistant answers from. Each document is split into passages with their page and
          section, so answers can cite them.
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Documents />
      </Suspense>
    </div>
  );
}

const statusTone = {
  uploading: "neutral",
  processing: "info",
  ready: "success",
  failed: "danger",
} as const;

const statusLabel = {
  uploading: "Uploading",
  processing: "Indexing…",
  ready: "Ready",
  failed: "Failed",
} as const;

async function Documents() {
  const viewer = await requireViewer("/documents");
  const db = await userDb();
  const { data } = await db
    .from("documents")
    .select(
      "id, company_id, title, file_name, format, size_bytes, status, error, page_count, chunk_count, effective_date, version_label, supersedes_id, created_at",
    )
    .in("company_id", searchableCompanyIds(viewer))
    .order("title");
  const documents = data ?? [];
  const own = documents.filter((d) => d.company_id === viewer.company.id);
  const samples = documents.filter((d) => d.company_id !== viewer.company.id);
  // Versions of one document often share a title; name them with their version.
  const named = (d: (typeof documents)[number]) =>
    d.version_label ? `${d.title} (${d.version_label})` : d.title;
  const titleOf = new Map(documents.map((d) => [d.id, named(d)]));
  const replacedBy = new Map(
    documents.filter((d) => d.supersedes_id).map((d) => [d.supersedes_id!, named(d)]),
  );
  const busy = documents.some((d) => d.status === "uploading" || d.status === "processing");
  const admin = viewer.role === "admin";
  const sandbox = viewer.company.kind === "sandbox";

  const table = (rows: typeof documents, canDelete: boolean) => (
    <ul className="divide-y divide-zinc-100">
      {rows.map((doc) => (
        <li key={doc.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              {doc.status === "ready" ? (
                <Link
                  href={`/documents/${doc.id}`}
                  className="font-medium text-zinc-900 hover:text-brand-700 hover:underline"
                >
                  {doc.title}
                </Link>
              ) : (
                <span className="font-medium text-zinc-900">{doc.title}</span>
              )}
              <Badge tone={statusTone[doc.status]}>{statusLabel[doc.status]}</Badge>
              {replacedBy.has(doc.id) && <Badge tone="warning">Replaced</Badge>}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {doc.format.toUpperCase()} · {formatBytes(doc.size_bytes)}
              {doc.page_count ? ` · ${doc.page_count} pages` : ""}
              {doc.chunk_count ? ` · ${doc.chunk_count} passages` : ""}
              {doc.effective_date ? ` · effective ${formatDate(doc.effective_date)}` : ""}
              {doc.version_label ? ` · version ${doc.version_label}` : ""}
            </p>
            {doc.supersedes_id && titleOf.has(doc.supersedes_id) && (
              <p className="mt-0.5 text-xs text-zinc-500">
                Replaces {titleOf.get(doc.supersedes_id)}
              </p>
            )}
            {replacedBy.has(doc.id) && (
              <p className="mt-0.5 text-xs text-amber-700">
                Replaced by {replacedBy.get(doc.id)}; kept for history
              </p>
            )}
            {doc.status === "failed" && doc.error && (
              <p className="mt-1 text-sm text-red-700">{doc.error}</p>
            )}
          </div>
          {canDelete && <DeleteButton documentId={doc.id} title={doc.title} />}
        </li>
      ))}
    </ul>
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
      {busy && <AutoRefresh />}
      <div className="space-y-5">
        {(own.length > 0 || !sandbox) && (
          <Card>
            <CardHeader
              title={sandbox ? "Your uploads" : "Company documents"}
              description={
                sandbox
                  ? `Visible only in your demo copy · ${own.length} of ${limits.documents.perSandbox}`
                  : `${own.length} documents`
              }
            />
            {own.length > 0 ? (
              table(own, admin)
            ) : (
              <p className="px-5 py-8 text-center text-sm text-zinc-500">No documents yet.</p>
            )}
          </Card>
        )}
        {samples.length > 0 && (
          <Card>
            <CardHeader
              title="Sample documents"
              description={`${samples.length} documents of the fictional company, shared by every demo copy (read-only)`}
            />
            {table(samples, false)}
          </Card>
        )}
      </div>
      {admin && (
        <Card className="h-fit">
          <CardHeader
            title="Upload a document"
            description={
              sandbox ? "Try one of your own: it stays in your private copy." : undefined
            }
          />
          <div className="px-5 py-4">
            <UploadForm
              replaceable={own
                .filter((d) => d.status === "ready")
                .map((d) => ({ id: d.id, title: d.title }))}
            />
          </div>
        </Card>
      )}
    </div>
  );
}
