import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import type { DemoDocument, Inline } from "./markdown";
import type { Letterhead } from "./render-html";

/**
 * Renders a demo document to DOCX with real Word heading styles and list numbering, the structure a Word
 * user would produce and the parser reads back.
 */

const runs = (inlines: Inline[]) => inlines.map((i) => new TextRun({ text: i.text, bold: i.bold }));

const headingLevels = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
} as const;

const border = { style: BorderStyle.SINGLE, size: 4, color: "BCCCDC" };

export async function renderDocx(doc: DemoDocument, letterhead: Letterhead): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: letterhead.company, color: "0F766E", size: 18 })],
    }),
  ];
  let listInstance = 0;

  for (const node of doc.nodes) {
    switch (node.type) {
      case "heading":
        children.push(new Paragraph({ text: node.text, heading: headingLevels[node.level] }));
        if (node.level === 1 && (doc.meta.effectiveDate || doc.meta.version)) {
          const facts = [
            doc.meta.effectiveDate && `Effective ${doc.meta.effectiveDate}`,
            doc.meta.version && `Version ${doc.meta.version}`,
          ].filter(Boolean);
          children.push(
            new Paragraph({
              children: [new TextRun({ text: facts.join(" · "), color: "52606D", size: 18 })],
            }),
          );
        }
        break;
      case "paragraph":
        children.push(new Paragraph({ children: runs(node.inlines), spacing: { after: 120 } }));
        break;
      case "list":
        listInstance++;
        for (const item of node.items) {
          children.push(
            new Paragraph({
              children: runs(item),
              numbering: {
                reference: node.ordered ? "numbered" : "bulleted",
                level: 0,
                instance: listInstance,
              },
            }),
          );
        }
        break;
      case "table":
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [node.header, ...node.rows].map(
              (cells, rowIndex) =>
                new TableRow({
                  tableHeader: rowIndex === 0,
                  children: cells.map(
                    (cell) =>
                      new TableCell({
                        borders: { top: border, bottom: border, left: border, right: border },
                        children: [
                          new Paragraph({
                            children: [new TextRun({ text: cell, bold: rowIndex === 0 })],
                          }),
                        ],
                      }),
                  ),
                }),
            ),
          }),
        );
        children.push(new Paragraph({ text: "" }));
        break;
    }
  }

  const document = new Document({
    creator: letterhead.company,
    title: doc.meta.title,
    styles: { default: { document: { run: { font: "Calibri", size: 21 } } } },
    numbering: {
      config: [
        {
          reference: "bulleted",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT },
          ],
        },
        {
          reference: "numbered",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT },
          ],
        },
      ],
    },
    sections: [
      {
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${letterhead.company} · ${doc.meta.title} · Fictional company — demo document`,
                    color: "7B8794",
                    size: 15,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
