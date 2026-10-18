-- Hybrid search: vector similarity and full-text rank merged with Reciprocal Rank Fusion.
--
-- SECURITY INVOKER: called with the signed-in user's session, row-level security decides which chunks are
-- visible, so a wrong company id from the app still cannot pull another company's text into the prompt.
--
-- Exact search on purpose: candidates are filtered to the caller's companies first (a few hundred chunks),
-- then ranked. An approximate index scanned before the company filter would drop neighbours that belong to
-- other companies and return fewer than the requested rows.
create function public.match_chunks(
  p_company_ids uuid[],
  p_query_embedding extensions.vector(1024),
  p_query_text text,
  p_match_count integer default 8,
  p_candidates integer default 30
)
returns table (
  chunk_id uuid,
  document_id uuid,
  company_id uuid,
  title text,
  format public.document_format,
  effective_date date,
  version_label text,
  supersedes_title text,
  superseded_by_title text,
  page integer,
  section text,
  block_start integer,
  blocks jsonb,
  score double precision,
  vector_rank integer,
  text_rank integer
)
language sql stable security invoker set search_path = '' as $$
  with candidates as (
    select c.id, c.embedding, c.fts
    from public.chunks c
    join public.documents d on d.id = c.document_id
    where c.company_id = any (p_company_ids)
      and d.status = 'ready'
  ),
  -- Any of the query's words may match (plainto_tsquery would require all of them); rank by coverage.
  query as (
    select nullif(replace(plainto_tsquery('english', p_query_text)::text, '&', '|'), '') as text
  ),
  vector_hits as (
    select x.id,
           row_number() over (order by x.embedding operator(extensions.<=>) p_query_embedding)::integer
             as rank
    from candidates x
    order by x.embedding operator(extensions.<=>) p_query_embedding
    limit p_candidates
  ),
  text_hits as (
    select x.id,
           row_number() over (order by ts_rank_cd(x.fts, to_tsquery('english', q.text)) desc)::integer
             as rank
    from candidates x, query q
    where q.text is not null
      and x.fts @@ to_tsquery('english', q.text)
    order by ts_rank_cd(x.fts, to_tsquery('english', q.text)) desc
    limit p_candidates
  ),
  fused as (
    select coalesce(v.id, t.id) as id,
           coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + t.rank), 0) as score,
           v.rank as vector_rank,
           t.rank as text_rank
    from vector_hits v
    full outer join text_hits t on t.id = v.id
    order by score desc
    limit p_match_count
  )
  select c.id,
         c.document_id,
         c.company_id,
         d.title,
         d.format,
         d.effective_date,
         d.version_label,
         older.title,
         newer.title,
         c.page,
         c.section,
         c.block_start,
         (select jsonb_agg(
                   jsonb_build_object('seq', b.seq, 'page', b.page, 'kind', b.kind, 'text', b.text)
                   order by b.seq)
          from public.document_blocks b
          where b.document_id = c.document_id
            and b.seq >= c.block_start
            and b.seq < c.block_end),
         f.score,
         f.vector_rank,
         f.text_rank
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  left join public.documents older on older.id = d.supersedes_id
  left join lateral (
    select n.title
    from public.documents n
    where n.supersedes_id = d.id and n.status = 'ready'
    order by n.effective_date desc nulls last
    limit 1
  ) newer on true
  order by f.score desc;
$$;

grant execute on function
  public.match_chunks(uuid[], extensions.vector, text, integer, integer)
to authenticated, service_role;
