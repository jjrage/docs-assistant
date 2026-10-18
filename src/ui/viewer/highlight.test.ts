import { describe, expect, it } from "vitest";

import { highlightedItems } from "./highlight";

const page = [
  "2. Late Charges",
  "",
  "Rent paid after the 5th",
  " ",
  "$75",
  "Returned payment",
  " ",
  "$40",
  "If rent is late, a manage-",
  "ment fee applies.",
];

describe("PDF highlight", () => {
  it("finds a table row quoted with a cell separator", () => {
    expect([...highlightedItems(page, "Returned payment | $40")]).toEqual([5, 7]);
  });

  it("finds a paragraph hyphenated across lines", () => {
    expect([...highlightedItems(page, "If rent is late, a management fee applies.")]).toEqual([
      8, 9,
    ]);
  });

  it("matches a quote that runs over to the next page by its beginning", () => {
    const quote = "If rent is late, a management fee applies. And the paragraph goes on overleaf";
    expect([...highlightedItems(page, quote)]).toEqual([8, 9]);
  });

  it("matches the rest of a quote from the previous page by its end", () => {
    const quote = "Text from the previous page that ends here: Rent paid after the 5th $75";
    expect([...highlightedItems(page, quote)]).toEqual([2, 4]);
  });

  it("highlights nothing when the quote is not on the page", () => {
    expect(highlightedItems(page, "Pets are welcome").size).toBe(0);
    expect(highlightedItems(page, "   ").size).toBe(0);
  });
});
