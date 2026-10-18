import { Fragment, type ReactNode } from "react";

/**
 * Renders an answer: Claude returns it as text segments, each with the sources it cites. The segments are
 * joined with citation markers in place, then read as a small, safe subset of Markdown (paragraphs, bullet
 * and numbered lists, **bold**). No HTML from the model ever reaches the page.
 */

export type Segment = { text: string; sources: number[] };

const MARK = "\u0000";

export function joinSegments(segments: Segment[]): string {
  return segments.map((s) => s.text + s.sources.map((n) => `${MARK}${n}${MARK}`).join("")).join("");
}

type Block = { kind: "p" | "ul" | "ol"; lines: string[] };

/**
 * Paragraphs are separated by blank lines; single newlines inside one become line breaks. List lines form
 * a list, and consecutive items of the same kind stay one list even with blank lines between them.
 */
export function blocksOf(text: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of text.split(/\n{2,}/)) {
    let paragraph: Block | null = null;
    for (const line of chunk.split("\n")) {
      if (line.trim() === "") continue;
      const item = /^\s*(?:([-*•])|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        paragraph = null;
        const kind = item[1] ? "ul" : "ol";
        const last = blocks.at(-1);
        if (last?.kind === kind) last.lines.push(item[2]!);
        else blocks.push({ kind, lines: [item[2]!] });
      } else if (paragraph) {
        paragraph.lines.push(line);
      } else {
        paragraph = { kind: "p", lines: [line] };
        blocks.push(paragraph);
      }
    }
  }
  return blocks;
}

function inline(text: string, marker: (n: number) => ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = new RegExp(`\\*\\*(.+?)\\*\\*|${MARK}(\\d+)${MARK}`, "g");
  let last = 0;
  let key = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1] !== undefined) out.push(<strong key={key++}>{match[1]}</strong>);
    else out.push(<Fragment key={key++}>{marker(Number(match[2]))}</Fragment>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function AnswerText({
  segments,
  marker,
}: {
  segments: Segment[];
  marker: (n: number) => ReactNode;
}) {
  const blocks = blocksOf(joinSegments(segments));
  return (
    <div className="space-y-2.5 leading-relaxed">
      {blocks.map((block, i) => {
        if (block.kind === "p") {
          return (
            <p key={i}>
              {block.lines.map((line, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(line, marker)}
                </Fragment>
              ))}
            </p>
          );
        }
        const List = block.kind === "ul" ? "ul" : "ol";
        return (
          <List
            key={i}
            className={
              block.kind === "ul" ? "list-disc space-y-1 pl-5" : "list-decimal space-y-1 pl-5"
            }
          >
            {block.lines.map((line, j) => (
              <li key={j}>{inline(line, marker)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
