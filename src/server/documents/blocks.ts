/**
 * A document laid out as blocks: headings, paragraphs, list items and table rows in reading order. Blocks are
 * what the assistant quotes and what the viewer highlights; chunks for search are runs of blocks.
 */

export type BlockKind = "heading" | "paragraph" | "list_item" | "table_row";

export type Block = {
  seq: number;
  kind: BlockKind;
  /** 1-based page for PDF; null for DOCX, which has no fixed pages. */
  page: number | null;
  /** 1 = top level, for headings only. */
  level: number | null;
  /** The headings above this block (and the block itself, for a heading), joined with " › ". */
  section: string | null;
  text: string;
};

export type ParsedDocument = { pageCount: number | null; blocks: Block[] };

export type RawBlock = Omit<Block, "seq" | "section">;

/** Collapses runs of whitespace (PDF text layers and Word runs are full of them). */
export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Numbers the blocks and gives each its section path. A document title (the first heading, when it is the
 * only one of its level) is left out of the paths: every block is in it, so it adds nothing.
 */
export function finishBlocks(raw: RawBlock[]): Block[] {
  const blocks = raw.filter((b) => b.text.length > 0);
  const first = blocks.find((b) => b.kind === "heading");
  const titleLevel =
    first && blocks.filter((b) => b.kind === "heading" && b.level === first.level).length === 1
      ? first.level
      : null;

  const stack: { level: number; text: string }[] = [];
  return blocks.map((block, seq) => {
    if (block.kind === "heading" && block.level !== null && block.level !== titleLevel) {
      while (stack.length > 0 && stack.at(-1)!.level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
    }
    const section = stack.length > 0 ? stack.map((h) => h.text).join(" › ") : null;
    return { ...block, seq, section };
  });
}
