import type Anthropic from "@anthropic-ai/sdk";

import type { SearchHit } from "../search/search";

/**
 * Search hits ⇄ Claude's search_result blocks ⇄ the sources shown under an answer.
 *
 * Each hit becomes one search_result whose text blocks are the document's own blocks (paragraphs, list
 * items, table rows), so a citation names whole paragraphs. Its `source` is the viewer link of that passage,
 * `/documents/<id>?page=<n>#b<first block>`: a citation carries it back, so it resolves to document, page
 * and paragraphs without another lookup, even when it points at a search result from an earlier turn.
 */

export type AnswerSource = {
  /** 1-based number shown in the answer, in order of first citation. */
  n: number;
  documentId: string;
  title: string;
  page: number | null;
  section: string | null;
  /** Cited blocks, [blockStart, blockEnd), as document block numbers. */
  blockStart: number;
  blockEnd: number;
  quote: string;
};

export type AnswerSegment = { text: string; sources: number[] };

export type Answer = { segments: AnswerSegment[]; sources: AnswerSource[] };

/** A short label for a document: "Pet Policy (2026)". */
export function documentLabel(hit: Pick<SearchHit, "title" | "versionLabel">): string {
  return hit.versionLabel && !hit.title.includes(hit.versionLabel)
    ? `${hit.title} (${hit.versionLabel})`
    : hit.title;
}

/**
 * What the model sees as the title: the document, where in it, and whether it is in effect. Versions are
 * spelled out so the model can follow the newer rule when two documents disagree.
 */
export function resultTitle(hit: SearchHit): string {
  const where = hit.page ? `page ${hit.page}` : hit.section ? `section "${hit.section}"` : null;
  const facts = [
    where,
    hit.section && hit.page ? `section "${hit.section}"` : null,
    hit.effectiveDate ? `effective ${hit.effectiveDate}` : null,
    hit.supersedesTitle ? `replaces the earlier "${hit.supersedesTitle}"` : null,
    hit.supersededByTitle
      ? `OUTDATED: replaced by a newer "${hit.supersededByTitle}", kept for history`
      : null,
  ].filter((f): f is string => f !== null);
  return `${documentLabel(hit)} — ${facts.join("; ")}`;
}

export function sourceId(hit: Pick<SearchHit, "documentId" | "page" | "blockStart">): string {
  return `/documents/${hit.documentId}${hit.page ? `?page=${hit.page}` : ""}#b${hit.blockStart}`;
}

export function parseSourceId(
  source: string,
): { documentId: string; page: number | null; blockStart: number } | null {
  const match = /^\/documents\/([0-9a-f-]{36})(?:\?page=(\d+))?#b(\d+)$/.exec(source);
  if (!match) return null;
  return {
    documentId: match[1]!,
    page: match[2] ? Number(match[2]) : null,
    blockStart: Number(match[3]),
  };
}

export function toSearchResult(hit: SearchHit): Anthropic.Beta.BetaSearchResultBlockParam {
  return {
    type: "search_result",
    source: sourceId(hit),
    title: resultTitle(hit),
    content: hit.blocks.map((block) => ({ type: "text", text: block.text })),
    citations: { enabled: true },
  };
}

/**
 * Collects the sources cited in an answer, numbered in order of first use. The same passage cited twice
 * keeps one number; a citation of a narrower range inside the same result gets its own number only if it
 * names different paragraphs.
 */
export class SourceRegistry {
  readonly sources: AnswerSource[] = [];
  private readonly titles = new Map<string, string>();

  /** Remembers the display title for each search result the model has seen (any turn). */
  rememberTitles(hits: SearchHit[]) {
    for (const hit of hits) this.titles.set(sourceId(hit), documentLabel(hit));
  }

  rememberTitle(source: string, title: string) {
    if (!this.titles.has(source)) this.titles.set(source, title);
  }

  /** Returns the source for a citation, adding it if new; `created` tells whether it was. */
  cite(citation: Anthropic.Beta.BetaCitationSearchResultLocation): {
    source: AnswerSource;
    created: boolean;
  } | null {
    const where = parseSourceId(citation.source);
    if (!where) return null;
    const blockStart = where.blockStart + citation.start_block_index;
    const blockEnd = where.blockStart + citation.end_block_index;
    const existing = this.sources.find(
      (s) =>
        s.documentId === where.documentId && s.blockStart === blockStart && s.blockEnd === blockEnd,
    );
    if (existing) return { source: existing, created: false };

    const title = this.titles.get(citation.source) ?? citation.title?.split(" — ")[0] ?? "Document";
    const source: AnswerSource = {
      n: this.sources.length + 1,
      documentId: where.documentId,
      title,
      page: where.page,
      section: sectionFromTitle(citation.title),
      blockStart,
      blockEnd,
      quote: citation.cited_text,
    };
    this.sources.push(source);
    return { source, created: true };
  }
}

function sectionFromTitle(title: string | null): string | null {
  return /section "([^"]+)"/.exec(title ?? "")?.[1] ?? null;
}

/** Search results anywhere in a conversation (user content and tool results), for their titles. */
export function searchResultsIn(
  messages: Anthropic.Beta.BetaMessageParam[],
): { source: string; title: string }[] {
  const found: { source: string; title: string }[] = [];
  const visit = (blocks: unknown) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks as {
      type?: string;
      source?: string;
      title?: string;
      content?: unknown;
    }[]) {
      if (block.type === "search_result" && block.source && block.title) {
        found.push({ source: block.source, title: block.title.split(" — ")[0]! });
      } else if (block.type === "tool_result") {
        visit(block.content);
      }
    }
  };
  for (const message of messages) visit(message.content);
  return found;
}
