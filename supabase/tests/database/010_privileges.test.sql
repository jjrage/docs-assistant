-- Deny by default: the browser-facing roles can read only what policies allow and can change nothing.
begin;
select plan(9);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'every table in public has row-level security enabled'
);

-- Privileges are checked by oid: a check by name may be evaluated before the schema filter and trip over a
-- same-named table in another schema.
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   cross join unnest(array['anon', 'authenticated']) as r (role_name)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p (privilege)
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and has_table_privilege(r.role_name, c.oid, p.privilege)),
  0,
  'anon and authenticated cannot insert, update, delete or truncate any table'
);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p')
     and has_table_privilege('anon', c.oid, 'SELECT')),
  0,
  'anon cannot read any table'
);

select ok(
  not has_table_privilege('authenticated', 'public.messages', 'SELECT'),
  'the model transcript is readable only by the app server'
);

select ok(
  has_function_privilege('authenticated',
    'public.match_chunks(uuid[], extensions.vector, text, integer, integer)', 'EXECUTE')
  and not has_function_privilege('anon',
    'public.match_chunks(uuid[], extensions.vector, text, integer, integer)', 'EXECUTE'),
  'signed-in users can search; anonymous visitors cannot'
);

-- A table or function added by a future migration is not exposed by accident.
create table public.zz_probe (id integer);
create function public.zz_probe_fn() returns integer language sql as 'select 1';

select ok(
  not has_table_privilege('anon', 'public.zz_probe', 'SELECT')
  and not has_table_privilege('authenticated', 'public.zz_probe', 'SELECT'),
  'new tables are not readable by default'
);

select ok(
  not has_function_privilege('anon', 'public.zz_probe_fn()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.zz_probe_fn()', 'EXECUTE'),
  'new functions are not executable by default'
);

select ok(
  (select not public from storage.buckets where id = 'documents'),
  'the documents bucket is private'
);

select tests.load_fixture();
select throws_ok(
  $$ update public.turns set question = 'edited' $$,
  '42501',
  null,
  'the answer log is append-only, even for the table owner'
);

select * from finish();
rollback;
