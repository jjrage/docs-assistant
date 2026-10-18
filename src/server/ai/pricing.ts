/**
 * What an answer cost, in integer micro-dollars (1e-6 USD). A price of $X per million tokens is X
 * micro-dollars per token, so the arithmetic stays in whole numbers until display.
 *
 * Claude list prices (per 1M tokens, Oct 2026): Opus 5.5 $4 in / $20 out, Sonnet 5.5 $2 / $10, Haiku 5.5
 * $0.10 / $0.50. Cache reads are $0.20 on Opus 5.5 and Sonnet 5.5; cache writes (5-minute TTL) cost 1.25× the
 * input price. Voyage voyage-4 embeddings: $0.06 per 1M tokens.
 */

type Price = { input: number; output: number; cacheRead: number };

const claude: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  // Haiku's cache-read price is not in our price notes; the usual 10% of input is assumed.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

const voyagePerToken = 0.06;

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  embedding: number;
};

export function knownModel(model: string): boolean {
  return model in claude;
}

export function costMicroUsd(model: string, usage: TokenUsage): number {
  // An unknown model is priced as Opus, the most expensive we use, so the log never under-reports.
  const price = claude[model] ?? claude["claude-opus-5-5"]!;
  const micro =
    usage.input * price.input +
    usage.output * price.output +
    usage.cacheRead * price.cacheRead +
    usage.cacheWrite * price.input * 1.25 +
    usage.embedding * voyagePerToken;
  return Math.round(micro);
}
