/**
 * Voyage AI embeddings over its REST API. voyage-4 is multilingual (a question in Spanish finds an English
 * paragraph) and returns 1024-dimensional vectors, the size the chunks table stores. Documents and queries
 * are embedded with different input types, as Voyage recommends for retrieval.
 */

export type InputType = "document" | "query";
export type Embeddings = { vectors: number[][]; tokens: number };
export type Embedder = (texts: string[], inputType: InputType) => Promise<Embeddings>;

export const embeddingModel = "voyage-4";
export const embeddingDimensions = 1024;

const endpoint = "https://api.voyageai.com/v1/embeddings";
/** Inputs per request; Voyage allows 1,000 and 320K tokens for voyage-4, chunks are far smaller. */
const batchSize = 128;

type VoyageResponse = {
  data: { embedding: number[]; index: number }[];
  usage: { total_tokens: number };
};

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * How long to keep retrying a rate-limited or failing request. Interactive use (the chat) gives up quickly;
 * batch jobs (seeding, evals) wait out per-minute limits.
 */
export type RetryPolicy = { attempts: number; maxWaitMs: number };
const interactive: RetryPolicy = { attempts: 3, maxWaitMs: 8_000 };
export const patient: RetryPolicy = { attempts: 8, maxWaitMs: 65_000 };

async function request(
  apiKey: string,
  input: string[],
  inputType: InputType,
  retry: RetryPolicy,
): Promise<VoyageResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input,
        model: embeddingModel,
        input_type: inputType,
        output_dimension: embeddingDimensions,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.ok) return (await response.json()) as VoyageResponse;

    // Rate limits and server errors are retried with backoff; anything else is a configuration problem.
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retry.attempts) {
      const after = Number(response.headers.get("retry-after"));
      const backoff = 2000 * 2 ** attempt * (0.75 + Math.random() / 2);
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : backoff;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, retry.maxWaitMs)));
      continue;
    }
    const detail = (await response.text()).slice(0, 300);
    throw new EmbeddingError(`Voyage AI returned ${response.status}: ${detail}`, response.status);
  }
}

export function voyageEmbedder(apiKey: string, retry: RetryPolicy = interactive): Embedder {
  return async (texts, inputType) => {
    const vectors: number[][] = [];
    let tokens = 0;
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize);
      const result = await request(apiKey, batch, inputType, retry);
      const ordered = [...result.data].sort((a, b) => a.index - b.index);
      if (ordered.length !== batch.length) {
        throw new EmbeddingError("Voyage AI returned a different number of embeddings", null);
      }
      vectors.push(...ordered.map((d) => d.embedding));
      tokens += result.usage.total_tokens;
    }
    return { vectors, tokens };
  };
}

/** pgvector's text form, which PostgREST passes through to a vector column or argument. */
export function toPgVector(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
