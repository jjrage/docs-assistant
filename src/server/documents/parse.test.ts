import { readFile } from "node:fs/promises";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { finishBlocks, type Block } from "./blocks";
import { chunkBlocks, chunkLimits, embeddingText } from "./chunk";
import { parseDocx } from "./parse-docx";
import { parsePdf } from "./parse-pdf";

// Rendered from __fixtures__/content by `npm run demo:docs -- <content> <files>`, like the demo documents.
const fixture = (name: string) =>
  readFile(path.join(__dirname, "__fixtures__", "files", name)).then((b) => new Uint8Array(b));

const find = (blocks: Block[], text: string) => {
  const block = blocks.find((b) => b.text.includes(text));
  if (!block) throw new Error(`no block contains "${text}"`);
  return block;
};

describe("PDF parsing", () => {
  let blocks: Block[];
  let pageCount: number | null;
  beforeAll(async () => {
    ({ blocks, pageCount } = await parsePdf(await fixture("fixture-handbook.pdf")));
  });

  it("keeps the page of every block", () => {
    expect(pageCount).toBe(4);
    expect(blocks.every((b) => b.page !== null && b.page >= 1 && b.page <= 4)).toBe(true);
    expect(find(blocks, "Clause 1.1 explains").page).toBe(1);
    expect(find(blocks, "Rent paid after the 5th").page).toBe(2);
    expect(find(blocks, "Clause 6.3 explains").page).toBe(4);
  });

  it("finds headings by font size and ranks them", () => {
    expect(find(blocks, "Fixture Resident Handbook")).toMatchObject({ kind: "heading", level: 1 });
    expect(find(blocks, "2. Late Charges")).toMatchObject({ kind: "heading", level: 2 });
    expect(find(blocks, "Late charge amounts")).toMatchObject({ kind: "heading", level: 3 });
  });

  it("builds section paths without the document title", () => {
    expect(find(blocks, "Clause 2.1 explains").section).toBe("2. Late Charges");
    expect(find(blocks, "Returned payment").section).toBe("2. Late Charges › Late charge amounts");
    expect(find(blocks, "Clause 3.1 explains").section).toBe("3. Security Deposit");
  });

  it("joins the lines of a paragraph and keeps paragraphs apart", () => {
    const clause = find(blocks, "Clause 1.1 explains");
    expect(clause.kind).toBe("paragraph");
    expect(clause.text).toMatch(
      /^Clause 1\.1 explains .* Sentence 6 of clause 1\.1 .* in plain words\.$/,
    );
    expect(clause.text).not.toContain("Clause 1.2");
  });

  it("reads table rows as cells", () => {
    expect(find(blocks, "Rent paid after the 5th")).toMatchObject({
      kind: "table_row",
      text: "Rent paid after the 5th | $75",
    });
    expect(find(blocks, "Situation").text).toBe("Situation | Charge");
  });

  it("reads bulleted and numbered list items one by one", () => {
    expect(find(blocks, "water leaks")).toMatchObject({
      kind: "list_item",
      text: "Call the emergency line for water leaks",
    });
    expect(find(blocks, "Describe the problem")).toMatchObject({
      kind: "list_item",
      text: "1. Describe the problem",
    });
  });

  it("drops the running footer and page numbers", () => {
    expect(blocks.some((b) => b.text.includes("Fictional company — demo document"))).toBe(false);
    expect(blocks.some((b) => /Page \d of 4/.test(b.text))).toBe(false);
  });
});

describe("DOCX parsing", () => {
  let blocks: Block[];
  beforeAll(async () => {
    ({ blocks } = await parseDocx(await fixture("fixture-checklist.docx")));
  });

  it("has no pages and uses Word's heading styles", () => {
    expect(blocks.every((b) => b.page === null)).toBe(true);
    expect(find(blocks, "Before You Leave")).toMatchObject({ kind: "heading", level: 2 });
    expect(find(blocks, "Keys")).toMatchObject({ kind: "heading", level: 3 });
  });

  it("locates text by section", () => {
    expect(find(blocks, "Unreturned keys cost $25 each.").section).toBe("Before You Leave › Keys");
    expect(find(blocks, "We mail the deposit").section).toBe("Deposit Return");
  });

  it("reads list items and table rows", () => {
    expect(find(blocks, "Return all keys")).toMatchObject({ kind: "list_item" });
    expect(find(blocks, "Carpet cleaning").text).toBe("Carpet cleaning | $120");
    expect(find(blocks, "60 days").text).toBe(
      "Give written notice at least 60 days before your move-out date.",
    );
  });
});

describe("chunking", () => {
  let blocks: Block[];
  beforeAll(async () => {
    ({ blocks } = await parsePdf(await fixture("fixture-handbook.pdf")));
  });

  it("covers every block exactly once, in order", () => {
    const chunks = chunkBlocks(blocks);
    expect(chunks[0]!.blockStart).toBe(0);
    expect(chunks.at(-1)!.blockEnd).toBe(blocks.length);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.blockStart).toBe(chunks[i - 1]!.blockEnd);
    }
  });

  it("keeps a chunk's text on one page and under the size limit", () => {
    for (const chunk of chunkBlocks(blocks)) {
      const text = blocks
        .slice(chunk.blockStart, chunk.blockEnd)
        .filter((b) => b.kind !== "heading");
      expect(new Set(text.map((b) => b.page)).size).toBeLessThanOrEqual(1);
      expect(chunk.tokenCount).toBeLessThanOrEqual(chunkLimits.max);
    }
  });

  it("starts a chunk at a section heading", () => {
    const chunk = chunkBlocks(blocks).find((c) => c.content.startsWith("3. Security Deposit"));
    expect(chunk).toMatchObject({ section: "3. Security Deposit", page: 2 });
  });

  it("keeps the tail of a list with the rest of its section", () => {
    const chunk = chunkBlocks(blocks).find((c) => c.content.includes("2. Attach a photo"));
    expect(chunk?.content).toContain("Call the emergency line for water leaks");
  });

  it("puts the title and section in front of the embedded text", () => {
    const chunk = chunkBlocks(blocks).find((c) => c.section === "3. Security Deposit")!;
    expect(embeddingText("Resident Handbook", chunk)).toMatch(
      /^Resident Handbook\n3\. Security Deposit\n\n3\. Security Deposit\n\nClause 3\.1/,
    );
  });
});

describe("section paths", () => {
  it("nests headings by level and leaves out a lone title", () => {
    const blocks = finishBlocks([
      { kind: "heading", page: 1, level: 1, text: "Handbook" },
      { kind: "heading", page: 1, level: 2, text: "Pets" },
      { kind: "heading", page: 1, level: 3, text: "Dogs" },
      { kind: "paragraph", page: 1, level: null, text: "Leash required." },
      { kind: "heading", page: 1, level: 2, text: "Parking" },
      { kind: "paragraph", page: 1, level: null, text: "Permits required." },
      { kind: "paragraph", page: 1, level: null, text: "" },
    ]);
    expect(blocks.map((b) => b.section)).toEqual([
      null,
      "Pets",
      "Pets › Dogs",
      "Pets › Dogs",
      "Parking",
      "Parking",
    ]);
    expect(blocks.map((b) => b.seq)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
