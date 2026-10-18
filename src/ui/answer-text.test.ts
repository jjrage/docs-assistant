import { describe, expect, it } from "vitest";

import { blocksOf, joinSegments } from "./answer-text";

describe("answer text", () => {
  it("puts citation markers right after the text they support", () => {
    expect(
      joinSegments([
        { text: "The pet deposit is $400", sources: [1] },
        { text: " and pet rent is $35 a month", sources: [1, 2] },
        { text: ".", sources: [] },
      ]),
    ).toBe(
      "The pet deposit is $400\u00001\u0000 and pet rent is $35 a month\u00001\u0000\u00002\u0000.",
    );
  });

  it("reads paragraphs, line breaks and lists", () => {
    expect(
      blocksOf(
        "Yes, two pets.\nDogs up to 75 lb.\n\n- Deposit: $400\n- Rent: $35\n\n1. Fill the form\n2. Pay\n\nThat's it.",
      ),
    ).toEqual([
      { kind: "p", lines: ["Yes, two pets.", "Dogs up to 75 lb."] },
      { kind: "ul", lines: ["Deposit: $400", "Rent: $35"] },
      { kind: "ol", lines: ["Fill the form", "Pay"] },
      { kind: "p", lines: ["That's it."] },
    ]);
  });

  it("keeps list items together across blank lines", () => {
    expect(blocksOf("- one\n\n- two")).toEqual([{ kind: "ul", lines: ["one", "two"] }]);
  });
});
