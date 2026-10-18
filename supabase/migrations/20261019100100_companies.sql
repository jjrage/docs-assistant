-- Companies (tenants) and their members.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind public.company_kind not null default 'standard',
  -- A sandbox reads the sample documents of its template company (read-only) next to its own uploads.
  library_company_id uuid references public.companies (id) on delete cascade,
  expires_at timestamptz,
  -- Random id from the cookie of the visitor who started a sandbox, for the per-visitor daily limit.
  created_by_visitor text,
  created_at timestamptz not null default now(),
  check ((kind = 'sandbox') = (expires_at is not null)),
  check (kind = 'sandbox' or library_company_id is null)
);

comment on table public.companies is 'A tenant. Every company-owned row carries company_id.';

create index companies_expiry_idx on public.companies (expires_at) where kind = 'sandbox';
create index companies_visitor_idx on public.companies (created_by_visitor, created_at)
  where created_by_visitor is not null;

create table public.memberships (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index memberships_user_idx on public.memberships (user_id);
