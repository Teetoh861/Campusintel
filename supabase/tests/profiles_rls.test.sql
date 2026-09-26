-- supabase/tests/profiles_rls.test.sql
-- Phase A/B — database tests for the public.profiles security boundary.
--
-- Run with:  supabase test db      (local Docker stack only)
--
-- These tests prove the A1 boundary without any application code:
--   * profile creation is bound to email confirmation, not signup;
--   * creation is idempotent and never overwrites;
--   * an authenticated student can read only their own row;
--   * an authenticated student can update only their complete selection;
--   * profile INSERT/DELETE and privileged-column updates remain unavailable;
--   * anon has nothing;
--   * the private trigger helpers are not callable by browser-facing roles.
--
-- Two authenticated identities are simulated the way PostgREST presents a
-- signed-in user to Postgres: SET ROLE authenticated plus a request.jwt.claims
-- setting carrying `sub`, which is what auth.uid() reads. No real GoTrue
-- sign-in is needed, and no service-role access is used anywhere.
--
-- Note on time: the whole file runs inside one transaction, so now() is
-- constant throughout it (now() is the transaction timestamp). Any assertion
-- about updated_at must therefore compare against now() itself rather than
-- expect it to advance past created_at.

begin;

select plan(36);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
-- Four accounts exercising every creation case:
--   A  inserted unconfirmed, then confirmed  -> transition path (case 2)
--   B  inserted already confirmed            -> already-confirmed path (case 3)
--   C  inserted unconfirmed, stays that way  -> no profile at all (case 1)
--   D  inserted already confirmed            -> used for the cascade test

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'a@example.test', 'x',
   null,  -- unconfirmed at signup
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'b@example.test', 'x',
   now(), -- arrives already confirmed
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'c@example.test', 'x',
   null,  -- never confirms
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'd@example.test', 'x',
   now(), -- already confirmed; deleted later to prove the cascade
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- ---------------------------------------------------------------------------
-- Creation boundary: signup must NOT create a profile
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  0,
  'unconfirmed signup creates no profile (A, pre-confirmation)'
);

select is(
  (select count(*)::int from public.profiles
    where id = '33333333-3333-4333-8333-333333333333'),
  0,
  'unconfirmed account never receives a profile (C)'
);

-- Case 3: an already-confirmed insert creates exactly one profile.
select is(
  (select count(*)::int from public.profiles
    where id = '22222222-2222-4222-8222-222222222222'),
  1,
  'already-confirmed auth insert creates exactly one profile (B)'
);

-- Case 2: confirmation transition NULL -> NOT NULL creates exactly one.
update auth.users
   set email_confirmed_at = now()
 where id = '11111111-1111-4111-8111-111111111111';

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  1,
  'confirmation transition creates exactly one profile (A)'
);

-- ---------------------------------------------------------------------------
-- Default column state
-- ---------------------------------------------------------------------------

select is(
  (select role from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  'student',
  'role defaults to student'
);

select is(
  (select department_id from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  null::uuid,
  'department reference begins NULL'
);

select is(
  (select academic_level_id from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  null::uuid,
  'academic-level reference begins NULL'
);

select is(
  (select academic_period_id from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  null::uuid,
  'academic-period reference begins NULL'
);

select isnt(
  (select created_at from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  null::timestamptz,
  'created_at is populated'
);

select isnt(
  (select updated_at from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  null::timestamptz,
  'updated_at is populated'
);

-- ---------------------------------------------------------------------------
-- Idempotency: a replayed confirmation must not duplicate or overwrite
-- ---------------------------------------------------------------------------
-- Populate a complete selection first, then force the trigger to fire a
-- second time by clearing and re-setting email_confirmed_at. Clearing does not
-- fire the trigger (its WHEN clause requires NULL -> NOT NULL); re-setting
-- does. ON CONFLICT DO NOTHING must leave the row completely untouched.

update public.profiles
   set department_id = (
         select id from public.departments order by sort_order limit 1
       ),
       academic_level_id = (
         select id from public.academic_levels order by sort_order limit 1
       ),
       academic_period_id = (
         select id from public.academic_periods order by sort_order limit 1
       )
 where id = '11111111-1111-4111-8111-111111111111';

update auth.users set email_confirmed_at = null
 where id = '11111111-1111-4111-8111-111111111111';
update auth.users set email_confirmed_at = now()
 where id = '11111111-1111-4111-8111-111111111111';

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  1,
  'replayed confirmation does not duplicate the profile'
);

select is(
  (select department_id from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  (select id from public.departments order by sort_order limit 1),
  'replayed confirmation preserves the department reference'
);

select is(
  (select academic_level_id from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  (select id from public.academic_levels order by sort_order limit 1),
  'replayed confirmation preserves the academic-level reference'
);

select is(
  (select academic_period_id from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  (select id from public.academic_periods order by sort_order limit 1),
  'replayed confirmation preserves the academic-period reference'
);

-- ---------------------------------------------------------------------------
-- Structural guarantees
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_class
    where oid = 'public.profiles'::regclass),
  'row level security is enabled on public.profiles'
);

select throws_ok(
  $$ update public.profiles set role = 'admin'
      where id = '11111111-1111-4111-8111-111111111111' $$,
  '23514', null,
  'role CHECK rejects a value outside (student, operator)'
);

select lives_ok(
  $$ update public.profiles set role = 'operator'
      where id = '11111111-1111-4111-8111-111111111111' $$,
  'role CHECK accepts operator'
);

update public.profiles set role = 'student'
 where id = '11111111-1111-4111-8111-111111111111';

select throws_ok(
  $$ update public.profiles
        set department_id = (
          select id from public.departments order by sort_order limit 1
        )
      where id = '22222222-2222-4222-8222-222222222222' $$,
  '23514', null,
  'profile CHECK rejects a partial selection'
);

-- The trigger must win over a client-supplied updated_at. Asserting that the
-- stored value equals now() (rather than the 2000 date just written) proves
-- the BEFORE UPDATE trigger overwrote it.
update public.profiles
   set updated_at = timestamptz '2000-01-01 00:00:00+00'
 where id = '11111111-1111-4111-8111-111111111111';

select is(
  (select updated_at from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  now(),
  'updated_at trigger overrides a client-supplied updated_at'
);

-- ON DELETE CASCADE: removing the auth account removes the profile.
select is(
  (select count(*)::int from public.profiles
    where id = '44444444-4444-4444-8444-444444444444'),
  1,
  'confirmed account D has a profile before deletion'
);

delete from auth.users
 where id = '44444444-4444-4444-8444-444444444444';

select is(
  (select count(*)::int from public.profiles
    where id = '44444444-4444-4444-8444-444444444444'),
  0,
  'deleting the auth account cascades the profile away'
);

-- ---------------------------------------------------------------------------
-- Identity A — authenticated
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  1,
  'A can select their own profile'
);

select is(
  (select count(*)::int from public.profiles
    where id = '22222222-2222-4222-8222-222222222222'),
  0,
  'A cannot see B''s profile'
);

select is(
  (select count(*)::int from public.profiles),
  1,
  'A sees exactly one row in profiles (no cross-account leakage)'
);

select throws_ok(
  $$ insert into public.profiles (id)
     values ('55555555-5555-4555-8555-555555555555') $$,
  '42501', null,
  'A cannot directly INSERT a profile'
);

select lives_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments order by sort_order desc limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels order by sort_order desc limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods order by sort_order desc limit 1
            )
      where id = '11111111-1111-4111-8111-111111111111' $$,
  'A can UPDATE their own complete active selection'
);

select throws_ok(
  $$ update public.profiles set role = 'operator'
      where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'A cannot UPDATE their own role (no self-promotion)'
);

select lives_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments order by sort_order limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods order by sort_order limit 1
            )
      where id = '22222222-2222-4222-8222-222222222222' $$,
  'A cross-account UPDATE matches no row'
);

select throws_ok(
  $$ delete from public.profiles
      where id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null,
  'A cannot DELETE their own profile'
);

select throws_ok(
  $$ delete from public.profiles
      where id = '22222222-2222-4222-8222-222222222222' $$,
  '42501', null,
  'A cannot DELETE B''s profile'
);

-- Internal trigger helpers must not be callable as RPC by a signed-in user.
-- authenticated holds no USAGE on the private schema, so name resolution
-- fails before execution is ever attempted.
select throws_ok(
  $$ select private.handle_confirmed_user() $$,
  '42501', null,
  'authenticated cannot execute private.handle_confirmed_user()'
);

select throws_ok(
  $$ select private.set_updated_at() $$,
  '42501', null,
  'authenticated cannot execute private.set_updated_at()'
);

-- ---------------------------------------------------------------------------
-- Identity B — authenticated
-- ---------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select is(
  (select num_nonnulls(
      department_id,
      academic_level_id,
      academic_period_id
    ) from public.profiles
    where id = '22222222-2222-4222-8222-222222222222'),
  0,
  'B can select their own unchanged all-null profile'
);

select is(
  (select count(*)::int from public.profiles
    where id = '11111111-1111-4111-8111-111111111111'),
  0,
  'B cannot see A''s profile'
);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501', null,
  'anon cannot read profiles'
);

select throws_ok(
  $$ select private.handle_confirmed_user() $$,
  '42501', null,
  'anon cannot execute private.handle_confirmed_user()'
);

reset role;

select * from finish();

rollback;
