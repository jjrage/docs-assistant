-- Documents, their parsed blocks and the chunks the assistant searches.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  file_name text not null check (length(file_name) between 1 and 255),
  format public.document_format not null,
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes > 0),
  status public.document_status not null default 'uploading',
  -- Why processing failed, in words an admin can act on.
  error text,
  page_count integer check (page_count > 0),
  block_count integer check (block_count >= 0),
  chunk_count integer check (chunk_count >= 0),
  -- Versioning: when this version took effect and which older document it replaces.
  effective_date date,
  version_label text check (length(version_label) <= 40),
  supersedes_id uuid,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (company_id, id),
  foreign key (company_id, supersedes_id)
    references public.documents (company_id, id) on delete set null (supersedes_id),
  check (supersedes_id is distinct from id)
);

create index documents_company_idx on public.documents (company_id, created_at desc);

-- One row per paragraph, list item, table row or heading, in reading order. PDF blocks carry their page;
-- DOCX has no pages (Word computes them when laying out), so its blocks are located by section.
create table public.document_blocks (
  company_id uuid not null,
  document_id uuid not null,
  seq integer not null check (seq >= 0),
  kind public.block_kind not null,
  page integer check (page >= 1),
  -- Heading level (1 = top) for headings.
  level smallint check (level between 1 and 6),
  -- Path of the headings above this block, e.g. "4. Rent › 4.2 Late Charges".
  section text,
  text text not null check (length(text) > 0),
  primary key (document_id, seq),
  foreign key (company_id, document_id) references public.documents (company_id, id) on delete cascade
);

create index document_blocks_company_idx on public.document_blocks (company_id);

-- A run of consecutive blocks from one section (and one page, for PDF) sized for retrieval. The text the
-- model sees is the blocks themselves, so citations point at whole paragraphs.
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  document_id uuid not null,
  seq integer not null check (seq >= 0),
  block_start integer not null check (block_start >= 0),
  block_end integer not null,
  page integer check (page >= 1),
  section text,
  content text not null,
  token_count integer not null check (token_count > 0),
  embedding extensions.vector(1024) not null,
  fts tsvector generated always as (
    setweight(to_tsvector('english', coalesce(section, '')), 'A')
    || setweight(to_tsvector('english', content), 'B')
  ) stored,
  unique (document_id, seq),
  check (block_end > block_start),
  foreign key (company_id, document_id) references public.documents (company_id, id) on delete cascade
);

-- Search always runs inside one company's documents (a few hundred chunks), so an exact scan through this
-- index beats an approximate one; see match_chunks.
create index chunks_company_idx on public.chunks (company_id);
create index chunks_fts_idx on public.chunks using gin (fts);

-- Private bucket: nobody reads it through the Storage API with their own session. The app server checks
-- access to the document row (row-level security) and hands out a short-lived signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
);
