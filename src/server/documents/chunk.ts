import type { Block } from "./blocks";

/**
 * Blocks → chunks for retrieval. A chunk is a run of consecutive blocks that share a section (and a page, for
 * PDF, so a citation lands on one page), sized so a search hit carries enough context without diluting it.
 * A heading opens the chunk of its section, so the chunk's text says what it is about. Headings with no text
 * of their own are carried into the next chunk instead of becoming a chunk by themselves.
 */

export type Chunk = {
  seq: number;
  blockStart: number;
  blockEnd: number;
  page: number | null;
  section: string | null;
  content: string;
  tokenCount: number;
};

/** Roughly four characters per token for English prose; good enough for sizing chunks. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export const chunkLimits = { target: 350, max: 500, small: 60 } as const;

const onlyHeadings = (group: Block[]) => group.every((b) => b.kind === "heading");
const tokensOf = (group: Block[]) => group.reduce((sum, b) => sum + estimateTokens(b.text), 0);
/** A chunk's page: where its text (not a heading carried over from the previous page) starts. */
const pageOf = (group: Block[]) => (group.find((b) => b.kind !== "heading") ?? group[0]!).page;
/** A chunk's section: the first one any of its blocks is in (text before the first heading has none). */
const sectionOf = (group: Block[]) => group.find((b) => b.section !== null)?.section ?? null;

export function chunkBlocks(blocks: Block[]): Chunk[] {
  const groups: Block[][] = [];
  let group: Block[] = [];
  let tokens = 0;

  for (const block of blocks) {
    const size = estimateTokens(block.text);
    const headingsOnly = onlyHeadings(group);
    const startsSection = block.kind === "heading" && !headingsOnly;
    // A heading at the foot of a page stays with the text it introduces on the next page.
    const newPage = !headingsOnly && block.page !== group.at(-1)?.page;
    // Table rows stay together up to the hard limit; prose splits once it reaches the target size.
    const full =
      tokens + size > chunkLimits.max ||
      (tokens >= chunkLimits.target && block.kind !== "table_row");

    if (group.length > 0 && (startsSection || newPage || full)) {
      groups.push(group);
      group = [];
      tokens = 0;
    }
    group.push(block);
    tokens += size;
  }
  if (group.length > 0) groups.push(group);

  return mergeSmall(groups).map((g, seq) => {
    const content = g.map((b) => b.text).join("\n\n");
    return {
      seq,
      blockStart: g[0]!.seq,
      blockEnd: g.at(-1)!.seq + 1,
      page: pageOf(g),
      section: sectionOf(g),
      content,
      tokenCount: estimateTokens(content),
    };
  });
}

/**
 * Small leftovers (the tail of a list after a full chunk, a letterhead line before the first heading) join a
 * neighbour on the same page: the previous chunk if it ends in the same section, otherwise the next chunk if
 * it is the same section or the leftover has no section of its own. Anything else stays a small chunk.
 */
function mergeSmall(input: Block[][]): Block[][] {
  const groups = input.map((g) => [...g]);
  const out: Block[][] = [];
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    if (tokensOf(group) >= chunkLimits.small) {
      out.push(group);
      continue;
    }
    const fits = (other: Block[]) => tokensOf(other) + tokensOf(group) <= chunkLimits.max;
    const previous = out.at(-1);
    const next = groups[i + 1];
    const section = sectionOf(group);
    if (
      previous &&
      fits(previous) &&
      previous.at(-1)!.page === group[0]!.page &&
      previous.at(-1)!.section === section
    ) {
      previous.push(...group);
    } else if (
      next &&
      fits(next) &&
      pageOf(next) === pageOf(group) &&
      (section === null || sectionOf(next) === section)
    ) {
      groups[i + 1] = [...group, ...next];
    } else {
      out.push(group);
    }
  }
  return out;
}

/**
 * The text embedded for a chunk: the document title and section first, so a chunk that only says "$75 after
 * the 5th" still lands near a question about late rent.
 */
export function embeddingText(title: string, chunk: Pick<Chunk, "section" | "content">): string {
  return [title, chunk.section, "", chunk.content].filter((part) => part !== null).join("\n");
}
