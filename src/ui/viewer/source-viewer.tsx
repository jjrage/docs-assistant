"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import { cn } from "../cn";
import { Spinner } from "../feedback";

// pdf.js needs the browser (canvas, workers): no server rendering.
const PdfView = dynamic(() => import("./pdf-view"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center text-zinc-400">
      <Spinner />
    </div>
  ),
});

type Block = {
  seq: number;
  kind: "heading" | "paragraph" | "list_item" | "table_row";
  level: number | null;
  page: number | null;
  text: string;
};

type Loaded = {
  document: {
    id: string;
    title: string;
    format: "pdf" | "docx";
    pageCount: number | null;
    versionLabel: string | null;
    effectiveDate: string | null;
  };
  blocks: Block[];
};

export type SourceLocation = {
  documentId: string;
  page: number | null;
  /** Cited block ranges, [start, end): several passages of one page can be highlighted together. */
  ranges: { start: number; end: number }[];
};

const cites = (location: SourceLocation, seq: number) =>
  location.ranges.some((r) => seq >= r.start && seq < r.end);

/**
 * Shows cited passages in their document: a PDF opens on the cited page with the passages highlighted; a
 * Word document (no fixed pages) is shown as its text with the cited paragraphs highlighted.
 */
export function SourceViewer({
  location,
  compact = false,
}: {
  location: SourceLocation;
  compact?: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/documents/${location.documentId}/blocks`)
      .then((r) =>
        r.ok ? (r.json() as Promise<Loaded>) : Promise.reject(new Error(String(r.status))),
      )
      .then((data) => live && setLoaded(data))
      .catch(() => live && setFailedFor(location.documentId));
    return () => {
      live = false;
    };
  }, [location.documentId]);

  if (failedFor === location.documentId) {
    return <p className="p-6 text-sm text-red-700">This document is not available.</p>;
  }
  if (!loaded || loaded.document.id !== location.documentId) {
    return (
      <div className="flex h-96 items-center justify-center text-zinc-400">
        <Spinner />
      </div>
    );
  }

  if (loaded.document.format === "pdf") {
    const quotes = location.ranges.map((r) =>
      loaded.blocks
        .filter((b) => b.seq >= r.start && b.seq < r.end)
        .map((b) => b.text)
        .join(" "),
    );
    const first = loaded.blocks.find((b) => cites(location, b.seq));
    return (
      <PdfView
        url={`/api/documents/${location.documentId}/file`}
        page={location.page ?? first?.page ?? 1}
        quotes={quotes}
      />
    );
  }
  return <DocxBlocks blocks={loaded.blocks} location={location} compact={compact} />;
}

function DocxBlocks({
  blocks,
  location,
  compact,
}: {
  blocks: Block[];
  location: SourceLocation;
  compact: boolean;
}) {
  const first = useRef<HTMLDivElement>(null);
  const firstCited = blocks.find((b) => cites(location, b.seq))?.seq;
  useEffect(() => {
    first.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [firstCited]);

  return (
    <div
      className={cn(
        "rounded-md bg-white px-6 py-5 text-sm leading-relaxed text-zinc-800 shadow-sm ring-1 ring-zinc-200",
        compact && "px-4",
      )}
    >
      {blocks.map((block) => {
        const cited = cites(location, block.seq);
        const className = cn(
          "rounded px-1 -mx-1 transition-colors",
          cited && "bg-yellow-200/70",
          block.kind === "heading" &&
            (block.level === 1 ? "mt-2 text-lg font-semibold" : "mt-4 font-semibold"),
          block.kind === "paragraph" && "mt-2",
          block.kind === "list_item" && "mt-1 pl-5 before:-ml-4 before:mr-2 before:content-['•']",
          block.kind === "table_row" &&
            "mt-1 grid auto-cols-fr grid-flow-col gap-3 border-b border-zinc-100 py-1",
        );
        return (
          <div
            key={block.seq}
            ref={block.seq === firstCited ? first : undefined}
            className={className}
          >
            {block.kind === "table_row"
              ? block.text.split(" | ").map((cell, i) => <span key={i}>{cell}</span>)
              : block.text}
          </div>
        );
      })}
    </div>
  );
}
