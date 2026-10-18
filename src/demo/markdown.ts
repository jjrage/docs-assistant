/**
 * The small Markdown dialect the demo documents are written in (see demo/content): front matter, one `#`
 * title, `##`/`###` headings, paragraphs, `- ` and `1. ` lists, pipe tables and **bold**. Parsed into a
 * tree that the PDF and DOCX renderers share, so both formats carry exactly the same text.
 */

export type DemoMeta = {
  title: string;
  slug: string;
  format: "pdf" | "docx";
  docType: string;
  effectiveDate: string | null;
  version: string | null;
  supersedes: string | null;
};

/** A run of text, bold or not. */
export type Inline = { text: string; bold: boolean };

export type DemoNode =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; inlines: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "table"; header: string[]; rows: string[][] };

export type DemoDocument = { meta: DemoMeta; nodes: DemoNode[] };

function frontMatter(source: string): { fields: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) throw new Error("missing front matter");
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (field) fields[field[1]!] = field[2]!.replace(/^"(.*)"$/, "$1");
  }
  return { fields, body: source.slice(match[0].length) };
}

function nullable(value: string | undefined): string | null {
  return value === undefined || value === "" || value === "null" ? null : value;
}

export function parseInlines(text: string): Inline[] {
  const inlines: Inline[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  for (const part of parts) {
    if (!part) continue;
    const bold = /^\*\*([^*]+)\*\*$/.exec(part);
    inlines.push(bold ? { text: bold[1]!, bold: true } : { text: part, bold: false });
  }
  return inlines;
}

/** Text without Markdown markup, as a reader (or a PDF text layer) sees it. */
export function plainText(inlines: Inline[]): string {
  return inlines.map((i) => i.text).join("");
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\*\*/g, ""));
}

export function parseDemoMarkdown(source: string): DemoDocument {
  const { fields, body } = frontMatter(source);
  const format = fields.format;
  if (format !== "pdf" && format !== "docx") throw new Error(`unknown format: ${format}`);
  if (!fields.title || !fields.slug) throw new Error("title and slug are required");

  const meta: DemoMeta = {
    title: fields.title,
    slug: fields.slug,
    format,
    docType: fields.doc_type ?? "policy",
    effectiveDate: nullable(fields.effective_date),
    version: nullable(fields.version),
    supersedes: nullable(fields.supersedes),
  };

  const nodes: DemoNode[] = [];
  const lines = body.split(/\r?\n/);
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length > 0) {
      nodes.push({ type: "paragraph", inlines: parseInlines(paragraph.join(" ")) });
      paragraph = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^-\s+(.*)$/.exec(line);
    const numbered = /^\d+\.\s+(.*)$/.exec(line);

    if (line.trim() === "") {
      flush();
    } else if (heading) {
      flush();
      nodes.push({
        type: "heading",
        level: heading[1]!.length as 1 | 2 | 3,
        text: heading[2]!.replace(/\*\*/g, ""),
      });
    } else if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const previous = nodes.at(-1);
      const item = parseInlines((bullet ?? numbered)![1]!);
      if (previous?.type === "list" && previous.ordered === ordered) previous.items.push(item);
      else nodes.push({ type: "list", ordered, items: [item] });
    } else if (line.trimStart().startsWith("|")) {
      flush();
      const header = tableCells(line);
      const rows: string[][] = [];
      // Skip the |---|---| separator, then read rows until the table ends.
      if (/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")) i++;
      while ((lines[i + 1] ?? "").trimStart().startsWith("|")) {
        rows.push(tableCells(lines[++i]!));
      }
      nodes.push({ type: "table", header, rows });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return { meta, nodes };
}
