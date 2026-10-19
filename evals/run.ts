/**
 * The eval: 50 resident questions answered by the real answer loop (src/server/ai/answer.ts) over the demo
 * company's indexed documents, with real Voyage search and the real model, then graded:
 *
 *  - answer_correct   a judge model (not the model under test) checks the answer against the reference and
 *                     its key facts, with a rubric per case type (answer / not in the documents / newer
 *                     version / prompt injection / ambiguous);
 *  - page_correct     a citation points at the expected passage: same document and page (PDF) or the cited
 *                     paragraph or its section (Word), or a cited passage that itself states every key fact;
 *  - handoff_correct  handed off exactly when the documents don't answer.
 *
 * Cost (Claude tokens + the query embeddings, at list prices) and timing come from the same run.
 *
 * Usage:
 *   npm run eval                                 baseline: claude-opus-5-5, effort low, 1 rep
 *   npm run eval -- --variant v1 --effort medium
 *   npm run eval -- --variant v2 --model claude-sonnet-5-5
 *   npm run eval -- --only q01,q36 --reps 2 --concurrency 2
 *   npm run eval -- --voyage-rpm 2000            pace Voyage for an account with a payment method (default 3)
 *   npm run eval -- --check                      every expected passage is in the index (no API calls)
 *   npm run eval -- --calibrate                  the judge on reference answers (≈100%) and empty or
 *                                                wrong answers (≈0%) before trusting it
 *
 * Writes evals/runs/<variant>/results.jsonl, traces/<id>_rep<k>.json and errors.jsonl (resumable: finished
 * (case, rep) pairs are skipped), then evals/RESULTS.md with every variant run so far.
 */
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

import { parseEnv, publicEnvSchema, serverEnvSchema } from "@/config/env-schema";
import type { Database } from "@/db/database.types";
import { demoCompany } from "@/demo/company";
import { answerQuestion, type HandoffRequest } from "@/server/ai/answer";
import { aiConfigFrom, type Effort } from "@/server/ai/config";
import { costMicroUsd } from "@/server/ai/pricing";
import { systemPrompt } from "@/server/ai/prompt";
import type { AnswerSource } from "@/server/ai/sources";
import { searchChunks } from "@/server/search/search";
import { paced, patient, voyageEmbedder, type Embedder } from "@/server/search/voyage";

import { judge, type Behavior } from "./judge";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// --- arguments --------------------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const variant = flag("variant") ?? "baseline";
if (!/^(baseline|v\d+)$/.test(variant)) throw new Error("--variant must be baseline or v<N>");
const model = flag("model") ?? "claude-opus-5-5";
const effort = (flag("effort") ?? "low") as Effort;
const reps = Number(flag("reps") ?? 1);
const concurrency = Number(flag("concurrency") ?? 3);
// Voyage requests per minute: 3 without a payment method on the account, far more with one.
const voyageRpm = Number(flag("voyage-rpm") ?? 3);
const judgeModel = flag("judge") ?? "claude-sonnet-5-5";
const only = flag("only")?.split(",");
const calibrate = args.includes("--calibrate");
// Only checks that every expected passage is found in the indexed documents; no API calls, no keys.
const checkOnly = args.includes("--check");
const caseTimeoutMs = 180_000;

const { NEXT_PUBLIC_SUPABASE_URL: url } = parseEnv(publicEnvSchema, process.env, "public");
const env = parseEnv(serverEnvSchema, process.env, "server");
if (!checkOnly && (!env.ANTHROPIC_API_KEY || !env.VOYAGE_API_KEY)) {
  throw new Error(
    "The eval calls the real APIs: set ANTHROPIC_API_KEY and VOYAGE_API_KEY in .env.local.",
  );
}
const db = createClient<Database>(url, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? "unused", maxRetries: 4 });
const runsDir = path.join("evals", "runs");
const embed = cachedEmbedder(
  paced(
    voyageEmbedder(env.VOYAGE_API_KEY ?? "unused", patient),
    Math.ceil(60_000 / voyageRpm) + 1000,
  ),
  path.join(runsDir, "query-embeddings.json"),
);

/**
 * Query embeddings cached on disk: every variant asks the same 50 questions, so only the first run pays
 * Voyage for them (the rows still report the original token counts, so cost matches production).
 */
function cachedEmbedder(inner: Embedder, file: string): Embedder {
  let cache: Record<string, { vector: number[]; tokens: number }> | null = null;
  const load = async () => {
    cache ??= existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
    return cache!;
  };
  return async (texts, inputType) => {
    const store = await load();
    const key = (text: string) => `${inputType}:${text}`;
    if (texts.length === 1 && store[key(texts[0]!)]) {
      const hit = store[key(texts[0]!)]!;
      return { vectors: [hit.vector], tokens: hit.tokens };
    }
    const result = await inner(texts, inputType);
    if (texts.length === 1) {
      store[key(texts[0]!)] = { vector: result.vectors[0]!, tokens: result.tokens };
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(store));
    }
    return result;
  };
}

const variantDir = path.join(runsDir, variant);

// --- cases ------------------------------------------------------------------------------------------
type Case = {
  id: string;
  category: string;
  language: string;
  question: string;
  expected_answer: string;
  must_include: string[];
  sources: { doc: string; quote: string }[];
  expected_behavior: Behavior;
  notes: string;
};

type Expected = { documentId: string; page: number | null; seq: number; section: string | null };

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\s|*]+/g, " ")
    .trim();

async function loadCases(
  templateId: string,
): Promise<{ cases: Case[]; expected: Map<string, Expected[]> }> {
  const cases = (JSON.parse(await readFile("evals/questions.json", "utf8")) as Case[]).filter(
    (c) => !only || only.includes(c.id),
  );
  const { data: docs } = await db
    .from("documents")
    .select("id, file_name, status")
    .eq("company_id", templateId);
  const docBySlug = new Map((docs ?? []).map((d) => [d.file_name.replace(/\.(pdf|docx)$/, ""), d]));
  if ((docs ?? []).some((d) => d.status !== "ready"))
    throw new Error("Some demo documents are not indexed.");

  const blocksByDoc = new Map<
    string,
    { seq: number; page: number | null; section: string | null; text: string }[]
  >();
  for (const doc of docs ?? []) {
    const { data } = await db
      .from("document_blocks")
      .select("seq, page, section, text")
      .eq("document_id", doc.id)
      .order("seq");
    blocksByDoc.set(doc.id, data ?? []);
  }

  const expected = new Map<string, Expected[]>();
  const broken: string[] = [];
  for (const c of cases) {
    const found: Expected[] = [];
    for (const source of c.sources) {
      const doc = docBySlug.get(source.doc);
      const quote = normalize(source.quote);
      const block = doc
        ? (blocksByDoc.get(doc.id) ?? []).find(
            (b) =>
              normalize(b.text).includes(quote) || normalize(b.text).includes(quote.slice(0, 50)),
          )
        : undefined;
      if (!doc || !block) broken.push(`${c.id}: "${source.quote.slice(0, 60)}" in ${source.doc}`);
      else
        found.push({
          documentId: doc.id,
          page: block.page,
          seq: block.seq,
          section: block.section,
        });
    }
    expected.set(c.id, found);
  }
  if (broken.length)
    throw new Error(`Expected passages not found in the indexed documents:\n${broken.join("\n")}`);
  return { cases, expected };
}

// --- grading ----------------------------------------------------------------------------------------
function pageCorrect(sources: AnswerSource[], expected: Expected[], keyFacts: string[]): boolean {
  return sources.some(
    (s) =>
      expected.some(
        (e) =>
          e.documentId === s.documentId &&
          (e.page !== null
            ? e.page === s.page
            : (e.seq >= s.blockStart && e.seq < s.blockEnd) ||
              (s.section !== null && s.section === e.section)),
      ) ||
      (keyFacts.length > 0 &&
        keyFacts.every((fact) => normalize(s.quote).includes(normalize(fact)))),
  );
}

function answerText(segments: { text: string; sources: number[] }[]): string {
  return segments.map((s) => s.text + s.sources.map((n) => `[${n}]`).join("")).join("");
}

// --- transcripts in the report's trace format ------------------------------------------------------
type TraceTurn = { role: string; content: string; name?: string };

function trace(messages: Anthropic.Beta.BetaMessageParam[], companyName: string): TraceTurn[] {
  const turns: TraceTurn[] = [{ role: "system", content: systemPrompt(companyName) }];
  const resultTitle = (block: { type: string; title?: string; text?: string }) =>
    block.type === "search_result" ? `• ${block.title}` : (block.text ?? "");
  for (const message of messages) {
    const blocks = (
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : message.content
    ) as {
      type: string;
      text?: string;
      title?: string;
      name?: string;
      input?: unknown;
      content?: unknown;
    }[];
    if (message.role === "user") {
      const results = blocks.filter((b) => b.type === "search_result");
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      for (const block of blocks.filter((b) => b.type === "tool_result")) {
        const content = Array.isArray(block.content) ? (block.content as { type: string }[]) : [];
        turns.push({
          role: "tool_result",
          content: content.map(resultTitle).join("\n") || String(block.content),
        });
      }
      if (text || results.length) {
        turns.push({
          role: "user",
          content: results.length
            ? `${text}\n\n[attached passages]\n${results.map(resultTitle).join("\n")}`
            : text,
        });
      }
    } else {
      const text = blocks
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (text.trim()) turns.push({ role: "assistant", content: text });
      for (const call of blocks.filter((b) => b.type === "tool_use")) {
        turns.push({
          role: "tool_call",
          name: call.name,
          content: JSON.stringify(call.input, null, 2),
        });
      }
    }
  }
  return turns;
}

// --- running ----------------------------------------------------------------------------------------
type Row = {
  prompt_id: string;
  rep: number;
  prompt: string;
  tags: string[];
  status: "ok" | "truncated";
  stop_reason: string | null;
  grade: Record<string, number>;
  explanation: Record<string, string>;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  embedding_tokens: number;
  cost_usd: number;
  latency_s: number;
  first_token_s: number | null;
  tool_calls: number;
  judge_model: string;
  judge_usage: Anthropic.Usage;
  meta: {
    effort: Effort;
    handed_off: boolean;
    sources: string[];
    answer: string;
    searches: string[];
  };
};

async function readJsonl<T>(file: string): Promise<T[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await work(items[next++]!);
    }),
  );
}

async function runCase(
  c: Case,
  rep: number,
  templateId: string,
  companyName: string,
  expected: Expected[],
): Promise<Row> {
  const handoffs: HandoffRequest[] = [];
  const result = await answerQuestion(
    {
      client,
      config: { ...aiConfigFrom({ ANTHROPIC_MODEL: model, ANTHROPIC_EFFORT: effort }) },
      companyName,
      search: (query, count) => searchChunks(db, embed, [templateId], query, count),
      handOff: async (request) => {
        handoffs.push(request);
        return `eval-${c.id}`;
      },
      emit: () => {},
    },
    [],
    c.question,
  );
  if (result.model !== model) {
    throw Object.assign(new Error(`served by ${result.model}, not ${model}`), {
      failure: "served_model_mismatch",
    });
  }

  const answer = answerText(result.answer.segments);
  const handedOff = result.handoffId !== null;
  const verdict = await judge(client, judgeModel, {
    question: c.question,
    behavior: c.expected_behavior,
    referenceAnswer: c.expected_answer,
    keyFacts: c.must_include,
    answer,
    handedOff,
  });

  const grade: Record<string, number> = {
    answer_correct: verdict.correct ? 1 : 0,
    handoff_correct: handedOff === (c.expected_behavior === "say_not_found_and_hand_off") ? 1 : 0,
  };
  const explanation: Record<string, string> = { answer_correct: verdict.explanation };
  if (expected.length > 0) {
    grade.page_correct = pageCorrect(result.answer.sources, expected, c.must_include) ? 1 : 0;
  }

  await mkdir(path.join(variantDir, "traces"), { recursive: true });
  await writeFile(
    path.join(variantDir, "traces", `${c.id}_rep${rep}.json`),
    JSON.stringify(trace(result.messages, companyName), null, 2),
  );

  return {
    prompt_id: c.id,
    rep,
    prompt: c.question,
    tags: [c.category, c.language],
    status: result.stopReason === "max_tokens" ? "truncated" : "ok",
    stop_reason: result.stopReason,
    grade,
    explanation,
    model: result.model,
    usage: {
      input_tokens: result.usage.input,
      output_tokens: result.usage.output,
      cache_read_input_tokens: result.usage.cacheRead,
      cache_creation_input_tokens: result.usage.cacheWrite,
    },
    embedding_tokens: result.usage.embedding,
    cost_usd: result.costMicroUsd / 1_000_000,
    latency_s: result.totalMs / 1000,
    first_token_s: result.firstTokenMs !== null ? result.firstTokenMs / 1000 : null,
    tool_calls: result.searches.length - 1 + (handedOff ? 1 : 0),
    judge_model: verdict.model,
    judge_usage: verdict.usage,
    meta: {
      effort,
      handed_off: handedOff,
      sources: result.answer.sources.map((s) => `${s.title}${s.page ? `, p. ${s.page}` : ""}`),
      answer,
      searches: result.searches,
    },
  };
}

// --- summary ----------------------------------------------------------------------------------------
/** 95% Wilson interval for k of n, as percentage points. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = k / n;
  const center = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.round((center - half) * 100), Math.round((center + half) * 100)];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)]! : 0;
};
const p90 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.max(0, Math.ceil(0.9 * s.length) - 1)]! : 0;
};

function rate(rows: Row[], metric: string, filter: (r: Row) => boolean = () => true) {
  const scored = rows.filter((r) => r.status === "ok" && filter(r) && metric in r.grade);
  const k = scored.filter((r) => r.grade[metric] === 1).length;
  return {
    k,
    n: scored.length,
    pct: scored.length ? Math.round((100 * k) / scored.length) : 0,
    ci: wilson(k, scored.length),
  };
}

async function writeSummary() {
  const variants = (await readdir(runsDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && /^(baseline|v\d+)$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) =>
      a === "baseline" ? -1 : b === "baseline" ? 1 : Number(a.slice(1)) - Number(b.slice(1)),
    );

  const lines = [
    "# Eval results",
    "",
    "Generated by `npm run eval` from `evals/runs/*/results.jsonl`. 50 questions (`evals/questions.json`): 35 answerable",
    "(7 of them in Spanish or Russian), 10 not covered by the documents, 2 where an old and a new policy disagree, 2",
    "against a prompt injection planted in a document, 1 ambiguous. Answers graded by a judge model (not the model under",
    "test) against reference answers; pages and hand-offs checked in code. Cost = Claude tokens + query embeddings at",
    "list prices.",
    "",
    "| Variant | Correct answers | Right page cited | Not-in-docs handed off | Needless hand-offs | Version conflicts | Injections resisted | Cost / answer (median · mean) | Time (median · p90) | First words (median) |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const v of variants) {
    const rows = await readJsonl<Row>(path.join(runsDir, v, "results.jsonl"));
    if (rows.length === 0) continue;
    const errors = await readJsonl<{ prompt_id: string }>(path.join(runsDir, v, "errors.jsonl"));
    const correct = rate(rows, "answer_correct");
    const page = rate(rows, "page_correct");
    const handedOff = rate(rows, "handoff_correct", (r) => r.tags[0] === "unanswerable");
    const needless = rows.filter((r) => r.tags[0] !== "unanswerable" && r.meta.handed_off).length;
    const answerable = rows.filter((r) => r.tags[0] !== "unanswerable").length;
    const versions = rate(rows, "answer_correct", (r) => r.tags[0] === "conflicting_versions");
    const injections = rate(rows, "answer_correct", (r) => r.tags[0] === "prompt_injection");
    const costs = rows.map((r) => r.cost_usd);
    const times = rows.map((r) => r.latency_s);
    const first = rows.map((r) => r.first_token_s).filter((s): s is number => s !== null);
    const label = `${rows[0]!.model}, effort ${rows[0]!.meta.effort}${rows.some((r) => r.rep > 0) ? `, ${Math.max(...rows.map((r) => r.rep)) + 1} reps` : ""}`;
    lines.push(
      `| ${v}: ${label}${errors.length ? ` (${errors.length} errors)` : ""} | **${correct.pct}%** (${correct.k}/${correct.n}; 95% CI ${correct.ci[0]}–${correct.ci[1]}) | ${page.pct}% (${page.k}/${page.n}) | ${handedOff.k}/${handedOff.n} | ${needless}/${answerable} | ${versions.k}/${versions.n} | ${injections.k}/${injections.n} | $${median(costs).toFixed(4)} · $${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)} | ${median(times).toFixed(1)} s · ${p90(times).toFixed(1)} s | ${median(first).toFixed(1)} s |`,
    );
  }
  lines.push("", "By category (correct answers):", "");
  lines.push(
    "| Variant | Answerable (EN) | Answerable (ES/RU) | Not in documents | Version conflicts | Injection | Ambiguous |",
    "|---|---|---|---|---|---|---|",
  );
  for (const v of variants) {
    const rows = await readJsonl<Row>(path.join(runsDir, v, "results.jsonl"));
    if (rows.length === 0) continue;
    const cell = (filter: (r: Row) => boolean) => {
      const r = rate(rows, "answer_correct", filter);
      return `${r.k}/${r.n}`;
    };
    lines.push(
      `| ${v} | ${cell((r) => r.tags[0] === "answerable" && r.tags[1] === "en")} | ${cell((r) => r.tags[0] === "answerable" && r.tags[1] !== "en")} | ${cell((r) => r.tags[0] === "unanswerable")} | ${cell((r) => r.tags[0] === "conflicting_versions")} | ${cell((r) => r.tags[0] === "prompt_injection")} | ${cell((r) => r.tags[0] === "ambiguous")} |`,
    );
  }
  await writeFile(path.join("evals", "RESULTS.md"), `${lines.join("\n")}\n`);
  await writeFile(
    path.join(runsDir, "_state.json"),
    JSON.stringify(
      {
        metrics: [
          { id: "answer_correct", label: "Correct", kind: "binary" },
          { id: "page_correct", label: "Right page", kind: "binary" },
          { id: "handoff_correct", label: "Hand-off OK", kind: "binary" },
        ],
        perf_fields: [
          { id: "cost_usd", label: "Cost", unit: "$" },
          { id: "latency_s", label: "Time", unit: "s" },
          { id: "tool_calls", label: "Tool calls" },
        ],
      },
      null,
      2,
    ),
  );
  console.log(lines.slice(8).join("\n"));
}

// --- calibration ------------------------------------------------------------------------------------
async function runCalibration(cases: Case[]) {
  // Wrong answers the judge must fail: nothing, a non-answer, an answer to a different question, and,
  // where the documents have no answer, a confident made-up one.
  const wrongAnswers = ["", "I don't know.", "Quiet hours are from 11:00 PM to 7:00 AM every day."];
  const madeUp = "Yes. Residents can use it for free; just ask the office to set it up for you.";
  type Check = { c: Case; answer: string; handedOff: boolean; shouldPass: boolean };
  const checks: Check[] = cases.flatMap((c) => {
    const notInDocs = c.expected_behavior === "say_not_found_and_hand_off";
    return [
      { c, answer: c.expected_answer, handedOff: notInDocs, shouldPass: true },
      ...(notInDocs
        ? [{ c, answer: madeUp, handedOff: false, shouldPass: false }]
        : wrongAnswers.map((answer) => ({ c, answer, handedOff: false, shouldPass: false }))),
    ];
  });
  let agree = 0;
  let spent = 0;
  const misses: string[] = [];
  await pool(checks, concurrency, async (check) => {
    const verdict = await judge(client, judgeModel, {
      question: check.c.question,
      behavior: check.c.expected_behavior,
      referenceAnswer: check.c.expected_answer,
      keyFacts: check.c.must_include,
      answer: check.answer,
      handedOff: check.handedOff,
    });
    spent += costMicroUsd(verdict.model, {
      input: verdict.usage.input_tokens,
      output: verdict.usage.output_tokens,
      cacheRead: 0,
      cacheWrite: 0,
      embedding: 0,
    });
    if (verdict.correct === check.shouldPass) agree += 1;
    else {
      misses.push(
        `${check.c.id} ${check.shouldPass ? "reference answer FAILED" : `wrong answer PASSED (${JSON.stringify(check.answer.slice(0, 40))})`}: ${verdict.explanation}`,
      );
    }
  });
  const oracle = checks.filter((c) => c.shouldPass).length;
  for (const miss of misses) console.log(miss);
  console.log(
    `Judge ${judgeModel}: agreed on ${agree}/${checks.length} (${oracle} reference answers should pass, ${checks.length - oracle} wrong ones should fail). Judge cost $${(spent / 1e6).toFixed(3)}.`,
  );
}

// --- main -------------------------------------------------------------------------------------------
async function main() {
  const { data: template } = await db
    .from("companies")
    .select("id, name")
    .eq("slug", demoCompany.slug)
    .eq("kind", "template")
    .single();
  if (!template) throw new Error("Seed the demo company first: npm run db:seed");
  const { cases, expected } = await loadCases(template.id);

  if (checkOnly) {
    const resolved = [...expected.values()].reduce((sum, list) => sum + list.length, 0);
    console.log(
      `${cases.length} cases; all ${resolved} expected passages found in the indexed documents.`,
    );
    return;
  }
  if (calibrate) return runCalibration(cases);

  await mkdir(variantDir, { recursive: true });
  const done = new Set(
    (await readJsonl<Row>(path.join(variantDir, "results.jsonl"))).map(
      (r) => `${r.prompt_id}#${r.rep}`,
    ),
  );
  const todo = cases.flatMap((c) =>
    Array.from({ length: reps }, (_, rep) => ({ c, rep })).filter(
      ({ rep }) => !done.has(`${c.id}#${rep}`),
    ),
  );
  console.log(
    `${variant}: ${model}, effort ${effort}; ${todo.length} runs to go (${done.size} done), judge ${judgeModel}`,
  );

  const started = Date.now();
  await pool(todo, concurrency, async ({ c, rep }) => {
    try {
      const row = await withTimeout(
        runCase(c, rep, template.id, template.name, expected.get(c.id) ?? []),
        caseTimeoutMs,
      );
      await appendFile(path.join(variantDir, "results.jsonl"), `${JSON.stringify(row)}\n`);
      console.log(
        `${c.id}#${rep} ${row.grade.answer_correct ? "✓" : "✗"} answer  ${"page_correct" in row.grade ? (row.grade.page_correct ? "✓" : "✗") : "-"} page  ${row.grade.handoff_correct ? "✓" : "✗"} hand-off  $${row.cost_usd.toFixed(4)}  ${row.latency_s.toFixed(1)} s`,
      );
    } catch (error) {
      const failure =
        (error as { failure?: string }).failure ??
        (error instanceof Error && error.message === "timeout"
          ? "timeout"
          : error instanceof Anthropic.APIError
            ? "api_error"
            : "harness_error");
      await appendFile(
        path.join(variantDir, "errors.jsonl"),
        `${JSON.stringify({ prompt_id: c.id, rep, failure, message: String(error) })}\n`,
      );
      console.log(`${c.id}#${rep} ERROR ${failure}: ${String(error)}`);
    }
  });
  console.log(`Finished in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
  await writeSummary();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
