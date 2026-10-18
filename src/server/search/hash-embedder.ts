import type { Embedder } from "./voyage";

/**
 * A free, deterministic stand-in for Voyage, used by tests and by `npm run db:seed -- --offline` before a
 * key exists: each word is hashed to one of 1024 dimensions and the vector is normalized, so texts that
 * share words are close. Enough to exercise the plumbing and ranking without a network call or an API key.
 */
export function hashVector(text: string): number[] {
  const vector = new Array<number>(1024).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9$]+/g) ?? []) {
    let hash = 2166136261;
    for (const char of word) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    vector[Math.abs(hash) % 1024]! += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

export const hashEmbedder: Embedder = async (texts) => ({
  vectors: texts.map(hashVector),
  tokens: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0),
});
