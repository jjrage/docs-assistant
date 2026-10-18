-- Test support, installed once per run and kept (not rolled back) so every test file can use it.
-- Lives in the `tests` schema of the local database only; it is not part of the application schema.

create extension if not exists pgtap with schema extensions;

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

-- Named fixture ids keep the tests readable: tests.id('doc_a') instead of a raw uuid.
create or replace function tests.id(p_name text) returns uuid
language sql immutable set search_path = '' as $$
  select v.id
  from (values
    ('company_a',   'a0000000-0000-4000-8000-000000000001'::uuid),
    ('company_b',   'b0000000-0000-4000-8000-000000000001'),
    ('template',    'c0000000-0000-4000-8000-000000000001'),
    ('sandbox_1',   'd1000000-0000-4000-8000-000000000001'),
    ('sandbox_2',   'd2000000-0000-4000-8000-000000000001'),
    ('a_admin',     'a1000000-0000-4000-8000-000000000001'),
    ('a_member',    'a1000000-0000-4000-8000-000000000002'),
    ('a_member2',   'a1000000-0000-4000-8000-000000000003'),
    ('b_admin',     'b1000000-0000-4000-8000-000000000001'),
    ('t_admin',     'c1000000-0000-4000-8000-000000000001'),
    ('s1_user',     'd1100000-0000-4000-8000-000000000001'),
    ('s2_user',     'd2100000-0000-4000-8000-000000000001'),
    ('doc_a',       'a2000000-0000-4000-8000-000000000001'),
    ('doc_b',       'b2000000-0000-4000-8000-000000000001'),
    ('doc_t',       'c2000000-0000-4000-8000-000000000001'),
    ('doc_s1',      'd1200000-0000-4000-8000-000000000001'),
    ('doc_s2',      'd2200000-0000-4000-8000-000000000001'),
    ('conv_a1',     'a3000000-0000-4000-8000-000000000001'),
    ('conv_a2',     'a3000000-0000-4000-8000-000000000002'),
    ('conv_b',      'b3000000-0000-4000-8000-000000000001'),
    ('conv_t',      'c3000000-0000-4000-8000-000000000001'),
    ('conv_s1',     'd1300000-0000-4000-8000-000000000001'),
    ('conv_s2',     'd2300000-0000-4000-8000-000000000001'),
    ('handoff_a1',  'a4000000-0000-4000-8000-000000000001'),
    ('handoff_a2',  'a4000000-0000-4000-8000-000000000002'),
    ('handoff_b',   'b4000000-0000-4000-8000-000000000001'),
    ('handoff_t',   'c4000000-0000-4000-8000-000000000001'),
    ('handoff_s2',  'd2400000-0000-4000-8000-000000000001')
  ) as v (name, id)
  where v.name = p_name;
$$;

create or replace function tests.create_user(p_id uuid, p_email text) returns void
language sql security definer set search_path = '' as $$
  insert into auth.users (id, email, aud, role, instance_id, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at)
  values (p_id, p_email, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000',
          '{}', '{}', now(), now())
  on conflict (id) do nothing;
$$;

-- Act as a signed-in user for the rest of the transaction (as the Data API would after verifying a JWT).
create or replace function tests.authenticate_as(p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function tests.authenticate_as_anon() returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', '{"role": "anon"}', true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function tests.clear_authentication() returns void
language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- A unit vector along one axis: chunks of different documents point in different directions, and a query
-- along axis n is closest to the chunks built along axis n.
create or replace function tests.axis(p_axis integer) returns extensions.vector
language sql immutable set search_path = '' as $$
  select (
    '[' || array_to_string(
      array(select case when i = p_axis then '1' else '0' end from generate_series(1, 1024) as i),
      ',') || ']'
  )::extensions.vector;
$$;

-- A ready document with two blocks and one chunk whose text mentions `p_word` (for full-text search).
create or replace function tests.add_document(
  p_name text, p_company text, p_title text, p_word text, p_axis integer
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := tests.id(p_company);
  v_doc uuid := tests.id(p_name);
begin
  insert into public.documents (id, company_id, title, file_name, format, storage_path, size_bytes, status,
                                page_count, block_count, chunk_count, processed_at)
  values (v_doc, v_company, p_title, p_name || '.pdf', 'pdf', v_company || '/' || v_doc || '.pdf', 1000,
          'ready', 1, 2, 1, now());

  insert into public.document_blocks (company_id, document_id, seq, kind, page, level, section, text)
  values (v_company, v_doc, 0, 'heading', 1, 1, null, p_title),
         (v_company, v_doc, 1, 'paragraph', 1, null, p_title, 'Residents must follow the ' || p_word || ' rules.');

  insert into public.chunks (company_id, document_id, seq, block_start, block_end, page, section, content,
                             token_count, embedding)
  values (v_company, v_doc, 0, 0, 2, 1, p_title,
          p_title || E'\n\nResidents must follow the ' || p_word || ' rules.', 12, tests.axis(p_axis));
end;
$$;

create or replace function tests.add_conversation(
  p_name text, p_company text, p_user text, p_handoff text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := tests.id(p_company);
begin
  insert into public.conversations (id, company_id, user_id, title, turn_count)
  values (tests.id(p_name), v_company, tests.id(p_user), 'Question from ' || p_user, 1);

  insert into public.messages (conversation_id, seq, role, content)
  values (tests.id(p_name), 0, 'user', '[{"type": "text", "text": "Can I keep a parrot?"}]');

  if p_handoff is not null then
    insert into public.handoffs (id, company_id, conversation_id, asked_by, question, reason)
    values (tests.id(p_handoff), v_company, tests.id(p_name), tests.id(p_user), 'Can I keep a parrot?',
            'Not covered by the pet policy');
  end if;

  insert into public.turns (company_id, conversation_id, seq, user_id, question, outcome, handoff_id, model,
                            total_ms)
  values (v_company, tests.id(p_name), 0, tests.id(p_user), 'Can I keep a parrot?',
          case when p_handoff is null then 'answered' else 'not_found' end::public.turn_outcome,
          tests.id(p_handoff), 'claude-opus-5-5', 1500);
end;
$$;

-- Two customer companies, the demo template and two visitor sandboxes reading the template's documents.
-- Company A has an admin and two members; each member has a conversation, both with a hand-off.
create or replace function tests.load_fixture() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tests.create_user(tests.id(u.name), u.email)
  from (values
    ('a_admin', 'admin@alpha.test'), ('a_member', 'member@alpha.test'), ('a_member2', 'member2@alpha.test'),
    ('b_admin', 'admin@beta.test'), ('t_admin', 'admin@template.test'),
    ('s1_user', 'visitor1@sandbox.test'), ('s2_user', 'visitor2@sandbox.test')
  ) as u (name, email);

  insert into public.companies (id, slug, name, kind, library_company_id, expires_at) values
    (tests.id('company_a'), 'alpha-test', 'Alpha Homes (test)', 'standard', null, null),
    (tests.id('company_b'), 'beta-test', 'Beta Rentals (test)', 'standard', null, null),
    (tests.id('template'), 'template-test', 'Template (test)', 'template', null, null),
    (tests.id('sandbox_1'), 'sandbox-1-test', 'Sandbox 1 (test)', 'sandbox', tests.id('template'),
     now() + interval '1 day'),
    (tests.id('sandbox_2'), 'sandbox-2-test', 'Sandbox 2 (test)', 'sandbox', tests.id('template'),
     now() + interval '1 day');

  insert into public.memberships (company_id, user_id, role, display_name) values
    (tests.id('company_a'), tests.id('a_admin'), 'admin', 'Alpha Admin'),
    (tests.id('company_a'), tests.id('a_member'), 'member', 'Alpha Member'),
    (tests.id('company_a'), tests.id('a_member2'), 'member', 'Alpha Member Two'),
    (tests.id('company_b'), tests.id('b_admin'), 'admin', 'Beta Admin'),
    (tests.id('template'), tests.id('t_admin'), 'admin', 'Template Admin'),
    (tests.id('sandbox_1'), tests.id('s1_user'), 'admin', 'Visitor One'),
    (tests.id('sandbox_2'), tests.id('s2_user'), 'member', 'Visitor Two');

  -- Every document is about "parking" and points along a different axis.
  perform tests.add_document('doc_a', 'company_a', 'Alpha Parking Policy', 'parking', 1);
  perform tests.add_document('doc_b', 'company_b', 'Beta Parking Policy', 'parking', 2);
  perform tests.add_document('doc_t', 'template', 'Sample Parking Policy', 'parking', 3);
  perform tests.add_document('doc_s1', 'sandbox_1', 'Visitor One Upload', 'parking', 4);
  perform tests.add_document('doc_s2', 'sandbox_2', 'Visitor Two Upload', 'parking', 5);

  perform tests.add_conversation('conv_a1', 'company_a', 'a_member', 'handoff_a1');
  perform tests.add_conversation('conv_a2', 'company_a', 'a_member2', 'handoff_a2');
  perform tests.add_conversation('conv_b', 'company_b', 'b_admin', 'handoff_b');
  perform tests.add_conversation('conv_t', 'template', 't_admin', 'handoff_t');
  perform tests.add_conversation('conv_s1', 'sandbox_1', 's1_user', null);
  perform tests.add_conversation('conv_s2', 'sandbox_2', 's2_user', 'handoff_s2');

  -- A stored file in every company's folder of the private bucket.
  insert into storage.objects (bucket_id, name, owner_id)
  select 'documents', d.storage_path, null
  from public.documents d;
end;
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

select plan(1);
select pass('test helpers installed');
select * from finish();
