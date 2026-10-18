-- Company isolation: no company sees another company's documents, search results, questions or files.
-- Sandboxes read their template's sample documents, but never each other's uploads or the template's chats.
begin;
select plan(34);

select tests.load_fixture();

-- Member of company A ---------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('a_member'));

select set_eq($$ select id from public.documents $$, array[tests.id('doc_a')],
  'company A member sees only company A documents');
select is((select count(*)::int from public.document_blocks where company_id <> tests.id('company_a')), 0,
  'company A member reads no block of another company');
select is((select count(*)::int from public.chunks where company_id <> tests.id('company_a')), 0,
  'company A member reads no chunk of another company');
select set_eq($$ select id from public.companies $$, array[tests.id('company_a')],
  'company A member sees only their own company');

-- The search function runs with the caller's rights: asking for every company returns only their own.
select set_eq(
  $$ select chunk_id from public.match_chunks(
       array[tests.id('company_a'), tests.id('company_b'), tests.id('template'), tests.id('sandbox_1')],
       tests.axis(2), 'parking rules', 10) $$,
  $$ select id from public.chunks where document_id = tests.id('doc_a') $$,
  'search with other companies'' ids still returns only company A chunks'
);
select is(
  (select count(*)::int from public.match_chunks(array[tests.id('company_b')], tests.axis(2), 'parking', 10)),
  0,
  'search scoped to company B returns nothing to a company A member'
);

select set_eq($$ select id from public.conversations $$, array[tests.id('conv_a1')],
  'a member sees only their own conversations');
select set_eq($$ select handoff_id from public.turns $$, array[tests.id('handoff_a1')],
  'a member sees only their own answer log');
select set_eq($$ select id from public.handoffs $$, array[tests.id('handoff_a1')],
  'a member sees only their own hand-offs');
select set_eq($$ select user_id from public.memberships $$, array[tests.id('a_member')],
  'a member sees only their own membership');
select throws_ok($$ select count(*) from public.messages $$, '42501', null,
  'a member cannot read the model transcript');

-- Admin of company A ----------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('a_admin'));

select set_eq($$ select id from public.handoffs $$,
  array[tests.id('handoff_a1'), tests.id('handoff_a2')],
  'an admin sees every hand-off of their company and no other');
select is((select count(*)::int from public.turns), 2, 'an admin sees the whole answer log of their company');
select set_eq($$ select id from public.conversations $$,
  array[tests.id('conv_a1'), tests.id('conv_a2')], 'an admin sees the conversations of their company');
select is((select count(*)::int from public.memberships), 3, 'an admin sees the members of their company');
select set_eq($$ select id from public.documents $$, array[tests.id('doc_a')],
  'an admin sees only their own company documents');

-- Admin of company B ----------------------------------------------------------------------------------
select tests.authenticate_as(tests.id('b_admin'));

select set_eq($$ select id from public.documents $$, array[tests.id('doc_b')],
  'company B admin sees only company B documents');
select set_eq($$ select id from public.handoffs $$, array[tests.id('handoff_b')],
  'company B admin sees only company B hand-offs');
select is(
  (select count(*)::int from public.match_chunks(array[tests.id('company_a')], tests.axis(1), 'parking', 10)),
  0,
  'company B admin cannot search company A, even with the right query vector'
);

-- Sandbox visitor 1 (admin of their sandbox) ------------------------------------------------------------
select tests.authenticate_as(tests.id('s1_user'));

select set_eq($$ select id from public.documents $$, array[tests.id('doc_t'), tests.id('doc_s1')],
  'a sandbox sees the template''s sample documents and its own uploads');
select set_eq(
  $$ select chunk_id from public.match_chunks(
       array[tests.id('template'), tests.id('sandbox_1'), tests.id('sandbox_2'), tests.id('company_a')],
       tests.axis(5), 'parking', 10) $$,
  $$ select id from public.chunks where document_id in (tests.id('doc_t'), tests.id('doc_s1')) $$,
  'sandbox search covers the template and its own uploads, not another sandbox'
);
select is((select count(*)::int from public.documents where id = tests.id('doc_s2')), 0,
  'a sandbox does not see another sandbox''s upload');
select is((select count(*)::int from public.handoffs), 0,
  'a sandbox admin sees no hand-off of the template or another sandbox');
select is((select count(*)::int from public.turns where company_id <> tests.id('sandbox_1')), 0,
  'a sandbox admin sees no answer log of the template or another sandbox');
select is((select count(*)::int from public.conversations where company_id <> tests.id('sandbox_1')), 0,
  'a sandbox admin sees no conversation of the template or another sandbox');
select set_eq($$ select user_id from public.memberships $$, array[tests.id('s1_user')],
  'a sandbox admin sees only the sandbox''s own member, not the template''s');

-- Sandbox visitor 2 (member of their sandbox) ----------------------------------------------------------
select tests.authenticate_as(tests.id('s2_user'));

select set_eq($$ select id from public.documents $$, array[tests.id('doc_t'), tests.id('doc_s2')],
  'the other sandbox sees the template and its own upload only');
select set_eq($$ select id from public.handoffs $$, array[tests.id('handoff_s2')],
  'a sandbox member sees their own hand-off');

-- Files in the private bucket ----------------------------------------------------------------------------
select tests.authenticate_as(tests.id('a_admin'));
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 0,
  'even an admin cannot list stored files with their own session (the server signs URLs)');

select tests.authenticate_as(tests.id('s1_user'));
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 0,
  'a sandbox visitor cannot list stored files');

-- Anonymous visitor ------------------------------------------------------------------------------------
select tests.authenticate_as_anon();

select throws_ok($$ select count(*) from public.documents $$, '42501', null,
  'an anonymous visitor cannot read documents');
select throws_ok($$ select count(*) from public.chunks $$, '42501', null,
  'an anonymous visitor cannot read chunks');
select throws_ok(
  $$ select * from public.match_chunks(array[tests.id('company_a')], tests.axis(1), 'parking', 10) $$,
  '42501', null,
  'an anonymous visitor cannot search');
select is((select count(*)::int from storage.objects where bucket_id = 'documents'), 0,
  'an anonymous visitor cannot list stored files');

select tests.clear_authentication();

select * from finish();
rollback;
