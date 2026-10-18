import { extractTextItems, getDocumentProxy, type StructuredTextItem } from "unpdf";

import { finishBlocks, normalizeSpace, type ParsedDocument, type RawBlock } from "./blocks";

/**
 * PDF → blocks. The text layer has no paragraphs or headings, only positioned runs of text, so the layout is
 * rebuilt from geometry:
 *  - runs on the same baseline form a line; a wide gap inside a line separates table cells;
 *  - the most common font size is body text; lines clearly larger are headings, ranked by size into levels;
 *  - a vertical gap larger than normal line spacing, a change of indent or of font size starts a new block;
 *  - indented lines are list items; lines that repeat at the top or bottom of most pages (running headers,
 *    footers, page numbers) are dropped.
 */

type Line = {
  page: number;
  y: number;
  x: number;
  fontSize: number;
  text: string;
  cells: string[];
};

const round = (n: number) => Math.round(n * 2) / 2;

function linesOfPage(items: StructuredTextItem[], page: number): Line[] {
  const visible = items.filter((it) => it.str.length > 0);
  // Group runs whose baselines are within a third of the font size, top of the page first.
  const rows: StructuredTextItem[][] = [];
  for (const item of [...visible].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r[0]!.y - item.y) < Math.max(2, item.fontSize / 3));
    if (row) row.push(item);
    else rows.push([item]);
  }

  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      const cells: string[] = [""];
      let lastEnd: number | null = null;
      let fontSize = 0;
      for (const item of row) {
        const blank = item.str.trim() === "";
        // A wide whitespace run, or a wide gap between runs, separates table cells.
        const gap = lastEnd === null ? 0 : item.x - lastEnd;
        if ((blank && item.width > item.fontSize * 2) || gap > item.fontSize * 2) {
          cells.push("");
        }
        if (!blank) fontSize = Math.max(fontSize, item.fontSize);
        cells[cells.length - 1] += blank && item.width > item.fontSize * 2 ? "" : item.str;
        lastEnd = item.x + item.width;
      }
      const clean = cells.map(normalizeSpace).filter(Boolean);
      return {
        page,
        y: row[0]!.y,
        x: Math.min(...row.filter((it) => it.str.trim()).map((it) => it.x)),
        fontSize: round(fontSize),
        text: clean.join(" "),
        cells: clean,
      };
    })
    .filter((line) => line.text.length > 0);
}

/** Running headers and footers: the same text (page numbers aside) near the edge of most pages. */
function dropRunningLines(pages: Line[][], pageHeight: number): Line[][] {
  const key = (line: Line) => line.text.replace(/\d+/g, "#").toLowerCase();
  const nearEdge = (line: Line) => line.y < pageHeight * 0.08 || line.y > pageHeight * 0.92;
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const k of new Set(lines.filter(nearEdge).map(key)))
      counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const repeated = (line: Line) =>
    pages.length >= 2 && (counts.get(key(line)) ?? 0) >= Math.max(2, pages.length * 0.6);
  const pageNumber = (line: Line) => /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(line.text);
  return pages.map((lines) =>
    lines.filter((line) => !(nearEdge(line) && (repeated(line) || pageNumber(line)))),
  );
}

/** The value that covers the most characters, e.g. the body font size or the left margin. */
function mode(values: { value: number; weight: number }[]): number {
  const totals = new Map<number, number>();
  for (const { value, weight } of values) totals.set(value, (totals.get(value) ?? 0) + weight);
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

export async function parsePdf(data: Uint8Array): Promise<ParsedDocument> {
  const pdf = await getDocumentProxy(data);
  const { totalPages, items } = await extractTextItems(pdf);
  const pageHeight = (await pdf.getPage(1)).getViewport({ scale: 1 }).height;
  const pages = dropRunningLines(
    items.map((pageItems, i) => linesOfPage(pageItems, i + 1)),
    pageHeight,
  );
  const lines = pages.flat();

  const bodySize = mode(lines.map((l) => ({ value: l.fontSize, weight: l.text.length })));
  const leftMargin = mode(
    lines
      .filter((l) => l.fontSize === bodySize)
      .map((l) => ({ value: Math.round(l.x), weight: l.text.length })),
  );
  const isHeading = (l: Line) =>
    l.fontSize >= bodySize * 1.15 && l.text.length <= 140 && l.cells.length === 1;
  const headingSizes = [...new Set(lines.filter(isHeading).map((l) => l.fontSize))].sort(
    (a, b) => b - a,
  );

  // Every line either continues the open block (the last one) or opens a new one.
  const raw: RawBlock[] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    const heading = isHeading(line);
    const tableRow = !heading && line.cells.length >= 2;
    const marker = /^(\d{1,2}[.)]|[a-z][.)]|[•◦▪●\-–*])\s/.test(line.text);
    // List text is indented; a numbered marker hangs a little to the left of it, but not at the margin.
    const indented =
      !heading &&
      (line.x > leftMargin + bodySize * 0.8 || (marker && line.x > leftMargin + bodySize * 0.3));
    const kind = heading
      ? "heading"
      : tableRow
        ? "table_row"
        : indented
          ? "list_item"
          : "paragraph";

    const open = raw.at(-1);
    const continues =
      open !== undefined &&
      previous !== null &&
      previous.page === line.page &&
      open.kind === kind &&
      kind !== "table_row" &&
      previous.fontSize === line.fontSize &&
      // Baselines closer than ~1.6× the font size belong to the same paragraph.
      previous.y - line.y <= line.fontSize * 1.6 &&
      // A list item starts at its marker; its wrapped lines line up with the first.
      !(kind === "list_item" && marker) &&
      Math.abs(previous.x - line.x) <= bodySize * 0.8;

    if (continues) {
      // Join a word hyphenated across lines; otherwise lines meet with a space.
      open.text =
        /[a-z]-$/.test(open.text) && /^[a-z]/.test(line.text)
          ? open.text.slice(0, -1) + line.text
          : `${open.text} ${line.text}`;
    } else {
      raw.push({
        kind,
        page: line.page,
        level: heading ? headingSizes.indexOf(line.fontSize) + 1 : null,
        text: tableRow ? line.cells.join(" | ") : line.text,
      });
    }
    previous = line;
  }

  return {
    pageCount: totalPages,
    blocks: finishBlocks(raw.map((b) => ({ ...b, text: normalizeSpace(b.text) }))),
  };
}
