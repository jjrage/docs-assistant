import { describe, expect, it } from "vitest";

import { parseDemoMarkdown, plainText } from "./markdown";

const source = `---
title: Pet Policy
slug: pet-policy-2026
format: pdf            # rendered to PDF
doc_type: policy
effective_date: 2026-03-01
version: "2026"
supersedes: pet-policy-2024
---

# Pet Policy

## 1. Deposits

A refundable **pet deposit of $400** is due before the pet moves in.
It is returned with the security deposit.

- Dogs up to 50 lb
- **Two** pets per home

1. Submit the form
2. Pay the deposit

| Fee | Amount |
|---|---|
| Pet rent | $35 per month |
| Waste fine | **$50** |
`;

describe("demo markdown", () => {
  it("reads the front matter", () => {
    const { meta } = parseDemoMarkdown(source);
    expect(meta).toEqual({
      title: "Pet Policy",
      slug: "pet-policy-2026",
      format: "pdf",
      docType: "policy",
      effectiveDate: "2026-03-01",
      version: "2026",
      supersedes: "pet-policy-2024",
    });
  });

  it("parses headings, paragraphs, lists and tables", () => {
    const { nodes } = parseDemoMarkdown(source);
    expect(nodes.map((n) => n.type)).toEqual([
      "heading",
      "heading",
      "paragraph",
      "list",
      "list",
      "table",
    ]);
    const paragraph = nodes[2];
    expect(paragraph?.type === "paragraph" && plainText(paragraph.inlines)).toBe(
      "A refundable pet deposit of $400 is due before the pet moves in. It is returned with the security deposit.",
    );
    const bullets = nodes[3];
    expect(bullets?.type === "list" && bullets.items.map(plainText)).toEqual([
      "Dogs up to 50 lb",
      "Two pets per home",
    ]);
    expect(nodes[5]).toEqual({
      type: "table",
      header: ["Fee", "Amount"],
      rows: [
        ["Pet rent", "$35 per month"],
        ["Waste fine", "$50"],
      ],
    });
  });

  it("rejects a document without a known format", () => {
    expect(() => parseDemoMarkdown("---\ntitle: X\nslug: x\nformat: txt\n---\n")).toThrow(/format/);
  });
});
