-- supabase/migrations/20260911094005_create_profiles.sql
-- Phase A1 — authentication foundation.
--
-- Creates the entire student profile security boundary in ONE migration:
-- the internal function schema, public.profiles, Row Level Security, the
-- grant matrix, the updated_at trigger and the confirmed-account profile
-- creation triggers. Table creation and RLS are deliberately not split
-- across migrations: a profiles table must never exist, even briefly, in a
-- state where RLS is not enabled.
--
-- Design notes:
--   * auth.users remains the source of truth for credentials and email.
--     Email is deliberately NOT copied into profiles, so a user changing
--     their email can never orphan or re-key their profile data.
--   * The immutable auth account UUID is the only identity key.
--   * A1 gives authenticated users SELECT on their own row and nothing
--     else. No INSERT, UPDATE or DELETE grant or policy exists. Phase B
--     adds column-level UPDATE for department/level/semester only, and
--     must never grant UPDATE(role).

-- ---------------------------------------------------------------------------
-- Internal function schema
-- ---------------------------------------------------------------------------
-- Trigger helpers live here rather than in public so they are not reachable
-- as RPC endpoints. `private` is not listed in config.toml's api.schemas, so
-- PostgREST does not expose it.

create schema if not exists private;

-- A newly created schema grants nothing to PUBLIC, but be explicit: without
-- USAGE on the schema these functions cannot be reached by name at all, even
-- if a future migration accidentally grants EXECUTE on one of them.
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

comment on schema private is
  'Internal trigger helpers. Not exposed through the Data API and not '
  'callable by anon or authenticated. Never place RPC endpoints here.';

-- ---------------------------------------------------------------------------
-- public.profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  -- The auth account UUID is both the primary key and the foreign key. A
  -- primary key on the FK column is what structurally enforces "exactly one
  -- profile per account" — no unique index or application check required.
  id uuid primary key references auth.users (id) on delete cascade,

  -- Student selections. Nullable at creation; populated in Phase B, which is
  -- also where they become editable. Plain text/smallint on purpose: the
  -- department/course association is separate Phase B content work and is
  -- deliberately not modelled here.
  department text,
  level smallint,
  semester smallint,

  -- 'operator' is the future content-operator capability. It is NOT the
  -- existing custom /admin authentication system, which remains entirely
  -- separate and is not backed by this column.
  role text not null default 'student',

  -- timestamptz normalises to UTC internally. Note that the widely
  -- copy-pasted `timezone('utc', now())` returns a naive timestamp and
  -- discards the offset, which is strictly worse here.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_role_check
    check (role in ('student', 'operator')),
  constraint profiles_semester_check
    check (semester is null or semester in (1, 2))
);

comment on table public.profiles is
  'One row per confirmed auth account. Created only by the confirmation '
  'trigger in the private schema. Email lives in auth.users and is never '
  'copied here.';
comment on column public.profiles.id is
  'Immutable auth.users UUID. Primary key and the only identity reference.';
comment on column public.profiles.role is
  'student | operator. Students have no UPDATE grant in A1, and must never '
  'be granted UPDATE(role) in any later phase.';

-- ---------------------------------------------------------------------------
-- Row Level Security — start closed
-- ---------------------------------------------------------------------------
-- Enabled in the same statement block that created the table. With RLS on
-- and no policy for an operation, that operation is denied by default; each
-- policy below is a deliberate exception to that deny posture.

alter table public.profiles enable row level security;

-- Supabase's default privileges grant browser-facing roles broad access to
-- new tables in `public`. Revoke first, then grant back only what A1 needs,
-- otherwise the policies below would sit on top of permissive grants.
revoke all on table public.profiles from anon, authenticated;

-- A1's entire authenticated capability: read your own row.
grant select on table public.profiles to authenticated;

-- No INSERT grant  — profiles are created only by the confirmation trigger.
-- No UPDATE grant  — Phase B adds column-level UPDATE for the three
--                    selection fields only.
-- No DELETE grant  — removal happens via ON DELETE CASCADE from auth.users.
-- No anon grants   — anonymous users get nothing at all.

create policy "Profiles are selectable by their owner"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- `(select auth.uid())` rather than a bare call: Postgres caches it as an
-- InitPlan instead of re-evaluating it per row.

-- Deliberately absent, and load-bearing:
--   * no INSERT policy — a browser-supplied account id is never trusted;
--   * no UPDATE policy — nothing about a profile is student-editable in A1;
--   * no DELETE policy;
--   * no policy scoped to anon.
-- ROW LEVEL SECURITY is intentionally not FORCEd: the table owner bypass is
-- exactly what lets the SECURITY DEFINER trigger below insert the row.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
-- A trigger owns this column because clients cannot write it. Column
-- privileges are checked against the columns a statement names, so a trigger
-- assigning NEW.updated_at is not a privilege violation for the caller.

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Not SECURITY DEFINER: it only mutates the NEW record of a row the caller is
-- already permitted to update, so invoker rights are sufficient.

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile creation boundary — confirmation, not signup
-- ---------------------------------------------------------------------------
-- The common `after insert on auth.users` pattern is wrong for this
-- requirement. With email confirmation enabled, Supabase inserts the
-- auth.users row at SIGNUP with email_confirmed_at NULL and populates it
-- later on confirmation. Triggering on insert alone would create application
-- state for unconfirmed, unverified addresses.
--
-- The profile id can only ever come from NEW.id on the auth.users row that
-- fired the trigger. The function takes no arguments and reads no request
-- payload, so there is no channel through which a caller could supply an id
-- for someone else's account.

create or replace function private.handle_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Insert only the id; role and both timestamps come from column defaults.
  -- ON CONFLICT DO NOTHING (not DO UPDATE) so a replayed confirmation can
  -- never overwrite a profile whose selections have since been populated.
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- SECURITY DEFINER is required and is the only place it is used: the trigger
-- must insert despite RLS and despite `authenticated` holding no INSERT
-- grant. `set search_path = ''` prevents search_path hijacking inside a
-- definer function, which is why every relation above is schema-qualified.

comment on function private.handle_confirmed_user() is
  'Creates exactly one public.profiles row for a confirmed auth account. '
  'Idempotent via ON CONFLICT DO NOTHING; never overwrites an existing row.';

-- Case 2: normal email signup that later confirms (NULL -> NOT NULL).
create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function private.handle_confirmed_user();

-- Case 3: a row that legitimately arrives already confirmed (auto-confirm,
-- an OAuth identity, or an admin-created account). Without this, such an
-- account would never receive a profile, because the update above never fires.
create trigger on_auth_user_created_confirmed
  after insert on auth.users
  for each row
  when (new.email_confirmed_at is not null)
  execute function private.handle_confirmed_user();

-- Case 1 (unconfirmed signup -> no profile) is covered by the absence of any
-- unconditional insert trigger.

-- ---------------------------------------------------------------------------
-- Internal function privileges
-- ---------------------------------------------------------------------------
-- These are trigger helpers, not application RPC endpoints. Postgres grants
-- EXECUTE on new functions to PUBLIC by default, so revoke it explicitly.
-- Triggers continue to fire regardless: the trigger machinery does not
-- perform an EXECUTE privilege check against the calling user.

revoke all on function private.set_updated_at() from public;
revoke all on function private.set_updated_at() from anon, authenticated;

revoke all on function private.handle_confirmed_user() from public;
revoke all on function private.handle_confirmed_user() from anon, authenticated;
