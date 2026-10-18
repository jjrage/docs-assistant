import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import type { SearchOutcome } from "../search/search";
import type { AiConfig } from "./config";
import { costMicroUsd, type TokenUsage } from "./pricing";
import { systemPrompt, tools } from "./prompt";
import {
  SourceRegistry,
  searchResultsIn,
  toSearchResult,
  type Answer,
  type AnswerSource,
} from "./sources";

/**
 * One question, answered from the documents:
 *  1. search with the question itself and attach the passages as search results (citations on);
 *  2. stream Claude's answer; text and citations go to the browser as they arrive;
 *  3. run the tools Claude asks for: another search, or a hand-off to staff;
 *  4. return the new transcript messages, the answer with its numbered sources, and what it cost.
 *
 * Framework-free on purpose: the chat route and the eval runner both call it, with their own database rights
 * (the user's session vs. the service key) and their own hand-off handling.
 */

type MessageParam = Anthropic.Beta.BetaMessageParam;

export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "segment" }
  | { type: "source"; source: AnswerSource }
  | { type: "cite"; n: number }
  | { type: "handoff"; id: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; turnId: string; outcome: TurnOutcome; costMicroUsd: number; totalMs: number };

export type TurnOutcome = "answered" | "not_found" | "refused" | "error";

export type HandoffRequest = {
  question: string;
  reason: string;
  context: { asked: string; searches: string[]; closest: { title: string; page: number | null }[] };
};

export type AnswerDeps = {
  client: Anthropic;
  config: AiConfig;
  companyName: string;
  search: (query: string, count: number) => Promise<SearchOutcome>;
  handOff: (request: HandoffRequest) => Promise<string>;
  emit: (event: ChatEvent) => void;
  now?: () => number;
};

export type TurnResult = {
  messages: MessageParam[];
  answer: Answer;
  outcome: TurnOutcome;
  handoffId: string | null;
  model: string;
  usage: TokenUsage;
  costMicroUsd: number;
  firstTokenMs: number | null;
  totalMs: number;
  searches: string[];
  questionEmbedding: number[];
};

const searchInput = z.object({ query: z.string().min(1).max(500) });
const handoffInput = z.object({
  question: z.string().min(1).max(2000),
  reason: z.string().max(1000),
});

export async function answerQuestion(
  deps: AnswerDeps,
  history: MessageParam[],
  question: string,
): Promise<TurnResult> {
  const now = deps.now ?? (() => performance.now());
  const started = now();
  const { config, emit } = deps;
  const usage: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, embedding: 0 };
  const registry = new SourceRegistry();
  for (const result of searchResultsIn(history))
    registry.rememberTitle(result.source, result.title);

  const answer: Answer = { segments: [], sources: registry.sources };
  const searches = [question];
  let handoffId: string | null = null;
  let refused = false;
  let firstTokenMs: number | null = null;
  let model = config.model;

  emit({ type: "status", text: "Searching the documents…" });
  const initial = await deps.search(question, config.initialResults);
  usage.embedding += initial.embeddingTokens;
  registry.rememberTitles(initial.hits);

  const userMessage: MessageParam = {
    role: "user",
    content: [...initial.hits.map(toSearchResult), { type: "text", text: question }],
  };
  const messages: MessageParam[] = [...history, userMessage];
  const added: MessageParam[] = [userMessage];

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    const stream = deps.client.beta.messages.stream({
      model: config.model,
      max_tokens: config.maxTokens,
      system: [{ type: "text", text: systemPrompt(deps.companyName) }],
      tools,
      messages,
      output_config: { effort: config.effort },
      // Tools and system prompt never change, and every turn appends: the whole prefix stays cached.
      cache_control: { type: "ephemeral" },
      // A safety-classifier decline is retried server-side on the model Anthropic picks for its category.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });

    let segment: Answer["segments"][number] | null = null;
    // Text after a tool call starts a new paragraph.
    let breakBefore = answer.segments.some((s) => s.text.trim().length > 0);
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "text") {
        segment = { text: "", sources: [] };
        answer.segments.push(segment);
        emit({ type: "segment" });
        if (breakBefore) {
          segment.text = "\n\n";
          emit({ type: "text", delta: "\n\n" });
          breakBefore = false;
        }
      } else if (event.type === "content_block_delta" && segment) {
        if (event.delta.type === "text_delta") {
          firstTokenMs ??= Math.round(now() - started);
          segment.text += event.delta.text;
          emit({ type: "text", delta: event.delta.text });
        } else if (
          event.delta.type === "citations_delta" &&
          event.delta.citation.type === "search_result_location"
        ) {
          const cited = registry.cite(event.delta.citation);
          if (!cited) continue;
          if (cited.created) emit({ type: "source", source: cited.source });
          if (!segment.sources.includes(cited.source.n)) {
            segment.sources.push(cited.source.n);
            emit({ type: "cite", n: cited.source.n });
          }
        }
      }
    }

    const message = await stream.finalMessage();
    model = message.model;
    usage.input += message.usage.input_tokens;
    usage.output += message.usage.output_tokens;
    usage.cacheRead += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
    const assistant: MessageParam = { role: "assistant", content: message.content };
    messages.push(assistant);
    added.push(assistant);

    if (message.stop_reason === "refusal") {
      refused = true;
      emit({
        type: "notice",
        message: "I can't help with that one here. Please contact the office directly.",
      });
      break;
    }
    if (message.stop_reason !== "tool_use") break;

    const calls = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      if (call.name === "search_documents") {
        const parsed = searchInput.safeParse(call.input);
        if (!parsed.success) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: "Invalid query.",
          });
          continue;
        }
        emit({ type: "status", text: `Searching for “${parsed.data.query}”…` });
        const found = await deps.search(parsed.data.query, config.toolResults);
        searches.push(parsed.data.query);
        usage.embedding += found.embeddingTokens;
        registry.rememberTitles(found.hits);
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            found.hits.length > 0
              ? found.hits.map(toSearchResult)
              : [{ type: "text", text: "No passages matched this query." }],
        });
      } else if (call.name === "hand_off_to_staff") {
        const parsed = handoffInput.safeParse(call.input);
        if (!parsed.success) {
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: "Invalid hand-off.",
          });
          continue;
        }
        if (!handoffId) {
          handoffId = await deps.handOff({
            ...parsed.data,
            context: {
              asked: question,
              searches,
              closest: initial.hits.slice(0, 3).map((h) => ({ title: h.title, page: h.page })),
            },
          });
          emit({ type: "handoff", id: handoffId });
        }
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            "Handed off to the property management team. Their reply will appear in this chat.",
        });
      } else {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: true,
          content: "Unknown tool.",
        });
      }
    }
    const toolMessage: MessageParam = { role: "user", content: results };
    messages.push(toolMessage);
    added.push(toolMessage);
  }

  const hasText = answer.segments.some((s) => s.text.trim().length > 0);
  const outcome: TurnOutcome = refused
    ? "refused"
    : handoffId
      ? "not_found"
      : hasText
        ? "answered"
        : "error";

  return {
    messages: added,
    answer,
    outcome,
    handoffId,
    model,
    usage,
    costMicroUsd: costMicroUsd(model, usage),
    firstTokenMs,
    totalMs: Math.round(now() - started),
    searches,
    questionEmbedding: initial.embedding,
  };
}

/** A user-facing explanation for an API failure; the details go to the server log. */
export function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) {
    return "The assistant is busy right now. Please try again in a minute.";
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return "The assistant is not available right now.";
  }
  if (error instanceof Anthropic.APIError) return "The assistant hit a problem. Please try again.";
  return "Something went wrong. Please try again.";
}
