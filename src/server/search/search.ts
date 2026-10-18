import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/db/database.types";

import { toPgVector, type Embedder } from "./voyage";

/**
 * One retrieval: embed the query, then hybrid search in Postgres. The database client decides whose rights
 * apply: the chat passes the signed-in user's client (row-level security filters the chunks), evals pass the
 * service client with the demo company's id.
 */

type Db = SupabaseClient<Database>;

export type HitBlock = { seq: number; page: number | null; kind: string; text: string };

export type SearchHit = {
  chunkId: string;
  documentId: string;
  title: string;
  format: "pdf" | "docx";
  effectiveDate: string | null;
  versionLabel: string | null;
  supersedesTitle: string | null;
  supersededByTitle: string | null;
  page: number | null;
  section: string | null;
  blockStart: number;
  blocks: HitBlock[];
  score: number;
};

export type SearchOutcome = { hits: SearchHit[]; embedding: number[]; embeddingTokens: number };

export async function searchChunks(
  db: Db,
  embed: Embedder,
  companyIds: string[],
  query: string,
  count = 6,
): Promise<SearchOutcome> {
  const { vectors, tokens } = await embed([query], "query");
  const embedding = vectors[0]!;
  const { data, error } = await db.rpc("match_chunks", {
    p_company_ids: companyIds,
    p_query_embedding: toPgVector(embedding),
    p_query_text: query,
    p_match_count: count,
  });
  if (error) throw new Error(`search: ${error.message}`);
  const hits = (data ?? []).map((row): SearchHit => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    title: row.title,
    format: row.format,
    effectiveDate: row.effective_date,
    versionLabel: row.version_label,
    supersedesTitle: row.supersedes_title,
    supersededByTitle: row.superseded_by_title,
    page: row.page,
    section: row.section,
    blockStart: row.block_start,
    blocks: (row.blocks ?? []) as HitBlock[],
    score: row.score,
  }));
  return { hits, embedding, embeddingTokens: tokens };
}
