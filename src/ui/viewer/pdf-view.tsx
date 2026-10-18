"use client";

import "react-pdf/dist/Page/TextLayer.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import { Button } from "../button";
import { Spinner } from "../feedback";
import { highlightedItems } from "./highlight";

// Set in the module that renders the components (react-pdf's documented requirement).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One page of a PDF with the cited passage highlighted in the text layer and scrolled into view. Document
 * text goes into the text layer as HTML, so it is escaped: an uploaded file is untrusted input.
 */
export default function PdfView({
  url,
  page: initialPage,
  quote,
}: {
  url: string;
  page: number;
  quote: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [pages, setPages] = useState<number | null>(null);
  const [page, setPage] = useState(initialPage);
  const [marked, setMarked] = useState<Set<number>>(new Set());

  // Another citation in the same document: go to its page.
  const [shownFor, setShownFor] = useState(initialPage);
  if (shownFor !== initialPage) {
    setShownFor(initialPage);
    setPage(initialPage);
  }

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const file = useMemo(() => ({ url }), [url]);
  const renderText = useCallback(
    ({ str, itemIndex }: { str: string; itemIndex: number }) =>
      page === initialPage && marked.has(itemIndex)
        ? `<mark>${escapeHtml(str)}</mark>`
        : escapeHtml(str),
    [marked, page, initialPage],
  );

  return (
    <div ref={container} className="w-full">
      <Document
        file={file}
        onLoadSuccess={(doc) => setPages(doc.numPages)}
        loading={
          <div className="flex h-96 items-center justify-center text-zinc-400">
            <Spinner />
          </div>
        }
        error={<p className="p-6 text-sm text-red-700">The PDF could not be loaded.</p>}
      >
        <Page
          pageNumber={page}
          width={width}
          renderAnnotationLayer={false}
          customTextRenderer={renderText}
          onGetTextSuccess={(text) =>
            setMarked(
              highlightedItems(
                text.items.map((item) => ("str" in item ? item.str : "")),
                quote,
              ),
            )
          }
          onRenderTextLayerSuccess={() =>
            container.current
              ?.querySelector(".textLayer mark")
              ?.scrollIntoView({ block: "center", behavior: "smooth" })
          }
          className="overflow-hidden rounded-md shadow-sm ring-1 ring-zinc-200"
        />
      </Document>
      {pages !== null && pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm text-zinc-600">
          <Button
            size="sm"
            variant="secondary"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <span className="tabular">
            Page {page} of {pages}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
