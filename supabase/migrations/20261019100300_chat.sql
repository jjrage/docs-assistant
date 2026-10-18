-- Conversations, the model transcript, the answer log and the hand-off queue.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  turn_count integer not null default 0 check (turn_count >= 0),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  unique (company_id, id)
);

create index conversations_user_idx on public.conversations (user_id, last_activity_at desc);
create index conversations_company_idx on public.conversations (company_id, last_activity_at desc);

-- Content blocks exactly as sent to and received from the Claude API (search results and thinking blocks
-- included), so every turn replays the conversation as it happened. Read only by the app server.
create table public.messages (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  seq integer not null check (seq >= 0),
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null check (jsonb_typeof(content) = 'array'),
  created_at timestamptz not null default now(),
  primary key (conversation_id, seq)
);

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  conversation_id uuid not null,
  asked_by uuid not null references auth.users (id) on delete cascade,
  question text not null check (length(question) between 1 and 2000),
  -- Why the assistant could not answer, in its own words.
  reason text,
  -- What was searched and what came closest, so staff see the context without opening the chat.
  context jsonb not null default '{}' check (jsonb_typeof(context) = 'object'),
  status public.handoff_status not null default 'open',
  answer text check (length(answer) <= 4000),
  answered_by uuid references auth.users (id) on delete set null,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  check ((status = 'answered') = (answer is not null and answered_at is not null))
);

create index handoffs_company_idx on public.handoffs (company_id, status, created_at desc);
create index handoffs_conversation_idx on public.handoffs (conversation_id);

-- One row per question: what was asked, what came back (for display) and what it cost (the log).
-- No foreign key to auth.users: `on delete set null` would update an append-only row. Deleting a user
-- deletes their conversations, and the turns go with them.
create table public.turns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  conversation_id uuid not null,
  seq integer not null check (seq >= 0),
  user_id uuid not null,
  question text not null check (length(question) between 1 and 2000),
  question_embedding extensions.vector(1024),
  -- {"segments": [{"text", "sources": [n]}], "sources": [{"n", "documentId", "title", "page", ...}]}
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  outcome public.turn_outcome not null,
  handoff_id uuid,
  model text not null,
  effort text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  embedding_tokens integer not null default 0,
  -- Integer micro-dollars (1e-6 USD), computed from the token counts and the price list in code.
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  first_token_ms integer,
  total_ms integer not null check (total_ms >= 0),
  search_count smallint not null default 0,
  citation_count smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq),
  foreign key (company_id, conversation_id)
    references public.conversations (company_id, id) on delete cascade,
  foreign key (company_id, handoff_id) references public.handoffs (company_id, id) on delete cascade
);

create index turns_company_idx on public.turns (company_id, created_at desc);
create index turns_user_day_idx on public.turns (user_id, created_at);

create trigger messages_append_only
  before update on public.messages
  for each row execute function private.reject_update();
create trigger turns_append_only
  before update on public.turns
  for each row execute function private.reject_update();
revoke update, delete, truncate on public.messages, public.turns from service_role;
