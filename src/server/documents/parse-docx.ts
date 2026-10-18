import mammoth from "mammoth";
import { parse, type HTMLElement } from "node-html-parser";

import { finishBlocks, normalizeSpace, type ParsedDocument, type RawBlock } from "./blocks";

/**
 * DOCX → blocks. Mammoth maps Word's structure (heading styles, list numbering, tables) to HTML, which is
 * walked here into blocks. The HTML itself is never stored or shown: the viewer renders the blocks.
 * Word documents have no fixed pages, so DOCX blocks carry no page number; citations point to the section.
 */

function textOf(element: HTMLElement): string {
  return normalizeSpace(element.textContent);
}

function walk(element: HTMLElement, blocks: RawBlock[]) {
  for (const child of element.childNodes) {
    if (child.nodeType !== 1) continue;
    const node = child as HTMLElement;
    const tag = node.tagName?.toLowerCase();
    const heading = /^h([1-6])$/.exec(tag ?? "");
    if (heading) {
      blocks.push({ kind: "heading", page: null, level: Number(heading[1]), text: textOf(node) });
    } else if (tag === "p") {
      blocks.push({ kind: "paragraph", page: null, level: null, text: textOf(node) });
    } else if (tag === "ul" || tag === "ol") {
      for (const item of node.querySelectorAll(":scope > li")) {
        // A nested list becomes items of its own, after its parent's text.
        const nested = item.querySelectorAll(":scope > ul, :scope > ol");
        for (const list of nested) list.remove();
        blocks.push({ kind: "list_item", page: null, level: null, text: textOf(item) });
        for (const list of nested) walk(parse(`<div>${list.outerHTML}</div>`), blocks);
      }
    } else if (tag === "table") {
      for (const row of node.querySelectorAll("tr")) {
        const cells = row
          .querySelectorAll("th, td")
          .map(textOf)
          .filter((cell) => cell.length > 0);
        if (cells.length > 0) {
          blocks.push({ kind: "table_row", page: null, level: null, text: cells.join(" | ") });
        }
      }
    } else {
      walk(node, blocks);
    }
  }
}

export async function parseDocx(data: Uint8Array): Promise<ParsedDocument> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(data) });
  const raw: RawBlock[] = [];
  walk(parse(`<div>${html}</div>`), raw);
  return { pageCount: null, blocks: finishBlocks(raw) };
}
