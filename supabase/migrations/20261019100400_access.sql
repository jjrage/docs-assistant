-- Read access: row-level security policies and explicit SELECT grants.
--
-- Writes are never granted to anon or authenticated. The app server checks the user's role in code and
-- writes with the service role, always scoping by the company of the signed-in user.

-- Policy helpers. SECURITY DEFINER so they can read memberships regardless of the caller's own policies;
-- each one only answers questions about the current user (auth.uid()).

create function private.has_role(p_company_id uuid, p_roles public.member_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.role = any (p_roles)
  );
$$;

create function private.is_admin(p_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(p_company_id, array['admin']::public.member_role[]);
$$;

create function private.is_member(p_company_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_role(p_company_id, array['admin', 'member']::public.member_role[]);
$$;

-- Companies whose documents the current user may read: their own, plus the template a sandbox reads its
-- sample documents from.
create function private.readable_company_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.company_id
  from public.memberships m
  where m.user_id = (select auth.uid())
  union
  select c.library_company_id
  from public.memberships m
  join public.companies c on c.id = m.company_id
  where m.user_id = (select auth.uid())
    and c.library_company_id is not null;
$$;

grant execute on function
  private.has_role(uuid, public.member_role[]),
  private.is_admin(uuid),
  private.is_member(uuid),
  private.readable_company_ids()
to authenticated;

alter table public.companies enable row level security;
alter table public.memberships enable row level security;
alter table public.documents enable row level security;
alter table public.document_blocks enable row level security;
alter table public.chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.handoffs enable row level security;
alter table public.turns enable row level security;

-- The model transcript (public.messages) is not granted at all: only the app server reads it.
grant select on
  public.companies,
  public.memberships,
  public.documents,
  public.document_blocks,
  public.chunks,
  public.conversations,
  public.handoffs,
  public.turns
to authenticated;

create policy companies_read on public.companies
  for select to authenticated using (id in (select private.readable_company_ids()));

create policy memberships_read on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin(company_id));

-- Every member reads the documents (the assistant cites them and the viewer opens them).
create policy documents_read on public.documents
  for select to authenticated using (company_id in (select private.readable_company_ids()));
create policy document_blocks_read on public.document_blocks
  for select to authenticated using (company_id in (select private.readable_company_ids()));
create policy chunks_read on public.chunks
  for select to authenticated using (company_id in (select private.readable_company_ids()));

-- A member reads their own conversations; an admin reads every conversation of their company (the log and
-- the hand-off queue link to them). A sandbox never sees its template's conversations.
create policy conversations_read on public.conversations
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin(company_id));
create policy turns_read on public.turns
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin(company_id));
create policy handoffs_read on public.handoffs
  for select to authenticated
  using (asked_by = (select auth.uid()) or private.is_admin(company_id));
