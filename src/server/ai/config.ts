/**
 * Assistant settings. The model and its cost are the owner's decision: ANTHROPIC_MODEL and ANTHROPIC_EFFORT
 * override the defaults (measured on the eval set before changing them).
 */
export type Effort = "low" | "medium" | "high";

export type AiConfig = {
  model: string;
  effort: Effort;
  /** Thinking is always on with Claude Opus 5.5 and counts toward max_tokens. */
  maxTokens: number;
  /** API requests per question: a couple of extra searches and a hand-off, not a runaway loop. */
  maxIterations: number;
  /** Passages attached to the question before the first request. */
  initialResults: number;
  /** Passages returned by each search_documents call. */
  toolResults: number;
};

export function aiConfigFrom(env: {
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_EFFORT?: Effort;
}): AiConfig {
  return {
    model: env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
    effort: env.ANTHROPIC_EFFORT ?? "low",
    maxTokens: 16000,
    maxIterations: 4,
    initialResults: 6,
    toolResults: 5,
  };
}
