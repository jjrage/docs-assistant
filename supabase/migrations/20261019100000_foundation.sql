-- Foundation: deny-by-default privileges, schemas, extensions, shared types and helpers.

-- Supabase grants anon and authenticated full access to new tables and EXECUTE on new functions in
-- public. This project denies by default: every privilege the app relies on is granted explicitly in a
-- later migration, and tests assert that nothing else is reachable.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

create extension if not exists vector with schema extensions;

-- Helpers for policies. Not exposed through the Data API.
create schema private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create type public.member_role as enum ('admin', 'member');
-- standard: a real customer. template: the demo company whose sample documents sandboxes read.
-- sandbox: a private copy of the demo for one visitor, deleted after a day.
create type public.company_kind as enum ('standard', 'template', 'sandbox');
create type public.document_format as enum ('pdf', 'docx');
create type public.document_status as enum ('uploading', 'processing', 'ready', 'failed');
create type public.block_kind as enum ('heading', 'paragraph', 'list_item', 'table_row');
create type public.turn_outcome as enum ('answered', 'not_found', 'refused', 'error');
create type public.handoff_status as enum ('open', 'answered');

-- Append-only tables (the model transcript, the answer log) reject updates from every role, including
-- the service role. Deleting a whole conversation or company still cascades.
create function private.reject_update() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;
