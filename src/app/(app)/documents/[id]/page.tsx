import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { readableDocument } from "@/server/documents/access";
import { Skeleton } from "@/ui/feedback";
import { formatDate } from "@/ui/format";
import { SourceViewer } from "@/ui/viewer/source-viewer";

export const metadata: Metadata = { title: "Document" };

/** A document on its own page; `?page=` opens a PDF page, `&b=12-14` highlights blocks 12 and 13. */
export default function DocumentPage(props: PageProps<"/documents/[id]">) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-4 py-6 sm:px-8">
      <Link href="/documents" className="text-sm text-brand-700 hover:underline">
        ← Documents
      </Link>
      <Suspense fallback={<Skeleton className="h-[70vh]" />}>
        <DocumentView {...props} />
      </Suspense>
    </div>
  );
}

async function DocumentView({ params, searchParams }: PageProps<"/documents/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const doc = await readableDocument(id);
  if (!doc) notFound();

  const page = Number(query.page) || null;
  const range = typeof query.b === "string" ? /^(\d+)-(\d+)$/.exec(query.b) : null;
  const blockStart = range ? Number(range[1]) : -1;
  const blockEnd = range ? Number(range[2]) : -1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
          {doc.title}
          {doc.versionLabel ? ` (${doc.versionLabel})` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          {doc.format.toUpperCase()}
          {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
          {doc.effectiveDate ? ` · effective ${formatDate(doc.effectiveDate)}` : ""}
        </p>
      </div>
      <SourceViewer location={{ documentId: doc.id, page, blockStart, blockEnd }} />
    </div>
  );
}
