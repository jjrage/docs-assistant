import type { DemoDocument, Inline } from "./markdown";

/**
 * Renders a demo document to print-ready HTML for Chromium's PDF output. Headings are noticeably larger
 * than body text (the PDF parser finds sections by font size, as it would in most real documents).
 */

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const inlines = (runs: Inline[]) =>
  runs.map((r) => (r.bold ? `<strong>${escape(r.text)}</strong>` : escape(r.text))).join("");

export type Letterhead = { company: string; address: string; phone: string; website: string };

export function renderHtml(doc: DemoDocument, letterhead: Letterhead): string {
  const { meta } = doc;
  const facts = [
    meta.effectiveDate &&
      `Effective ${new Date(`${meta.effectiveDate}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })}`,
    meta.version && `Version ${meta.version}`,
  ].filter((fact): fact is string => Boolean(fact));

  const body = doc.nodes
    .map((node) => {
      switch (node.type) {
        case "heading":
          // The document title is printed in the letterhead block below.
          return node.level === 1 ? "" : `<h${node.level}>${escape(node.text)}</h${node.level}>`;
        case "paragraph":
          return `<p>${inlines(node.inlines)}</p>`;
        case "list": {
          const tag = node.ordered ? "ol" : "ul";
          return `<${tag}>${node.items.map((item) => `<li>${inlines(item)}</li>`).join("")}</${tag}>`;
        }
        case "table":
          return `<table><thead><tr>${node.header.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${node.rows
            .map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody></table>`;
      }
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escape(meta.title)}</title>
<style>
  @page { size: Letter; margin: 0.9in 0.85in 0.95in 0.85in; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1f2933; }
  .letterhead { border-bottom: 2px solid #0f766e; padding-bottom: 10pt; margin-bottom: 16pt; }
  .company { font-size: 9pt; color: #0f766e; letter-spacing: 0.04em; text-transform: uppercase; }
  h1 { font-size: 22pt; line-height: 1.2; margin: 4pt 0 4pt; color: #102a43; }
  .facts { font-size: 9pt; color: #52606d; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; color: #102a43; break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 12pt 0 4pt; color: #243b53; break-after: avoid; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
  li { margin-bottom: 3pt; }
  table { border-collapse: collapse; width: 100%; margin: 4pt 0 10pt; font-size: 10pt; }
  th, td { border: 1px solid #bcccdc; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #f0f4f8; }
  tr { break-inside: avoid; }
</style>
</head>
<body>
<div class="letterhead">
  <div class="company">${escape(letterhead.company)}</div>
  <h1>${escape(meta.title)}</h1>
  ${facts.length ? `<div class="facts">${facts.map(escape).join(" · ")}</div>` : ""}
</div>
${body}
</body>
</html>`;
}

/** Running footer: the parser drops lines that repeat on every page, as real PDFs carry them too. */
export function footerTemplate(doc: DemoDocument, letterhead: Letterhead): string {
  return `<div style="font-family: Arial, sans-serif; font-size: 7.5pt; color: #7b8794; width: 100%; padding: 0 0.85in; display: flex; justify-content: space-between;">
  <span>${escape(letterhead.company)} · ${escape(doc.meta.title)} · Fictional company — demo document</span>
  <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
</div>`;
}
