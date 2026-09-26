-- Phase B Slice 1 — complete profile selection and owner-scoped writes.
-- Fixtures roll back; no hosted Auth users or data are touched.

begin;

select plan(20);

-- ---------------------------------------------------------------------------
-- Confirmed-account fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000',
   '55555555-5555-4555-8555-555555555555',
   'authenticated', 'authenticated', 'phase-b-a@example.test', 'x',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '66666666-6666-4666-8666-666666666666',
   'authenticated', 'authenticated', 'phase-b-b@example.test', 'x',
   now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

select is(
  (
    select count(*)::int
    from public.profiles
    where id in (
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'
    )
  ),
  2,
  'Phase A confirmation trigger still creates both profiles'
);

select is(
  (
    select count(*)::int
    from public.profiles
    where id in (
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666'
    )
      and num_nonnulls(
        department_id,
        academic_level_id,
        academic_period_id
      ) = 0
  ),
  2,
  'newly created profiles retain the all-null selection state'
);


-- ---------------------------------------------------------------------------
-- Identity A: reference reads and owner-scoped selection writes
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles
        set department_id = (
          select id from public.departments order by sort_order limit 1
        )
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student policy rejects a partial selection'
);

select throws_ok(
  $$ update public.profiles
        set department_id = '70000000-0000-4000-8000-000000000002',
            academic_level_id = (
              select id from public.academic_levels order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods order by sort_order limit 1
            )
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student policy rejects a nonexistent reference'
);

select throws_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments order by sort_order limit 1
            ),
            academic_level_id = '70000000-0000-4000-8000-000000000004',
            academic_period_id = (
              select id from public.academic_periods order by sort_order limit 1
            )
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student policy rejects a nonexistent academic level'
);

select throws_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments order by sort_order limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels order by sort_order limit 1
            ),
            academic_period_id = '70000000-0000-4000-8000-000000000005'
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student policy rejects a nonexistent academic period'
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
      where id = '55555555-5555-4555-8555-555555555555' $$,
  'owner can save one complete active selection atomically'
);

select is(
  (
    select num_nonnulls(
      department_id,
      academic_level_id,
      academic_period_id
    )
    from public.profiles
    where id = '55555555-5555-4555-8555-555555555555'
  ),
  3,
  'the successful owner selection is complete'
);

select throws_ok(
  $$ update public.profiles
        set department_id = null,
            academic_level_id = null,
            academic_period_id = null
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'students cannot clear a completed selection back to all-null'
);

select throws_ok(
  $$ update public.profiles set role = 'operator'
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student cannot update role'
);

select throws_ok(
  $$ update public.profiles
        set id = '77777777-7777-4777-8777-777777777777'
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student cannot update profile identity'
);

select throws_ok(
  $$ update public.profiles set created_at = now()
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student cannot update created_at'
);

select throws_ok(
  $$ update public.profiles set updated_at = now()
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student cannot update updated_at'
);

select throws_ok(
  $$ insert into public.profiles (id)
     values ('77777777-7777-4777-8777-777777777777') $$,
  '42501', null,
  'student still cannot insert a profile'
);

select throws_ok(
  $$ delete from public.profiles
      where id = '55555555-5555-4555-8555-555555555555' $$,
  '42501', null,
  'student still cannot delete a profile'
);

-- An owner-scoped UPDATE against B is intentionally a successful no-op. RLS
-- hides B from A, and the privileged assertion below proves B was unchanged.
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
      where id = '66666666-6666-4666-8666-666666666666' $$,
  'A cross-account UPDATE matches no row'
);

reset role;

select is(
  (
    select num_nonnulls(
      department_id,
      academic_level_id,
      academic_period_id
    )
    from public.profiles
    where id = '66666666-6666-4666-8666-666666666666'
  ),
  0,
  'B remains unchanged after A cross-account UPDATE attempt'
);

-- Table constraints remain a separate integrity layer even for privileged
-- database operations that bypass student RLS.
select throws_ok(
  $$ update public.profiles
        set department_id = (
          select id from public.departments order by sort_order limit 1
        )
      where id = '66666666-6666-4666-8666-666666666666' $$,
  '23514', null,
  'table constraint independently rejects partial selection storage'
);

select throws_ok(
  $$ update public.profiles
        set department_id = '70000000-0000-4000-8000-000000000003',
            academic_level_id = (
              select id from public.academic_levels order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods order by sort_order limit 1
            )
      where id = '66666666-6666-4666-8666-666666666666' $$,
  '23503', null,
  'foreign keys independently reject nonexistent references'
);


reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.profiles $$,
  '42501', null,
  'anon remains unable to read profiles'
);

reset role;

select * from finish();

rollback;
