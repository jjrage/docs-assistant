/**
 * Which text-layer items of a PDF page to highlight for a cited passage. The quote comes from our parsed
 * blocks (lines joined, table cells separated by " | ", hyphenated words rejoined), the page from pdf.js
 * (one item per run of text), so both are compared without whitespace, cell separators or hyphens. A quote
 * that runs over to the next page matches by its beginning (or, from the next page, by its end).
 */

const normalize = (text: string) => text.toLowerCase().replace(/[\s|\-‐‑–]+/g, "");

export function highlightedItems(items: string[], quote: string): Set<number> {
  let page = "";
  const owner: number[] = [];
  items.forEach((item, index) => {
    const text = normalize(item);
    page += text;
    for (let i = 0; i < text.length; i++) owner.push(index);
  });

  const target = normalize(quote);
  if (target.length === 0) return new Set();

  const whole = page.indexOf(target);
  if (whole >= 0) return new Set(owner.slice(whole, whole + target.length));

  // The longest beginning (or end) of the quote found on the page, if it is long enough to be meaningful.
  // If a prefix occurs, every shorter prefix does too, so the length can be found by bisection.
  const minimum = Math.min(20, target.length);
  for (const piece of [(k: number) => target.slice(0, k), (k: number) => target.slice(-k)]) {
    let low = 0;
    let high = target.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (page.includes(piece(mid))) low = mid;
      else high = mid - 1;
    }
    if (low >= minimum) {
      const at = page.indexOf(piece(low));
      return new Set(owner.slice(at, at + low));
    }
  }
  return new Set();
}
