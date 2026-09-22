-- Phase B Slice 1 — inactive reference retention and replacement.
-- Fixture ownership and referential constraints are tested in isolation.

begin;

select plan(15);

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

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

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

reset role;

-- ---------------------------------------------------------------------------
-- Inactive-reference semantics
-- ---------------------------------------------------------------------------

update public.departments
   set is_active = false
 where id = (
   select department_id
   from public.profiles
   where id = '55555555-5555-4555-8555-555555555555'
 );

update public.academic_levels
   set is_active = false
 where id = (
   select academic_level_id
   from public.profiles
   where id = '55555555-5555-4555-8555-555555555555'
 );

update public.academic_periods
   set is_active = false
 where id = (
   select academic_period_id
   from public.profiles
   where id = '55555555-5555-4555-8555-555555555555'
 );

select ok(
  (
    select not departments.is_active
    from public.profiles
    join public.departments
      on departments.id = profiles.department_id
    where profiles.id = '55555555-5555-4555-8555-555555555555'
  ),
  'deactivation preserves an existing historical department reference'
);

select ok(
  (
    select not academic_levels.is_active
       and not academic_periods.is_active
    from public.profiles
    join public.academic_levels
      on academic_levels.id = profiles.academic_level_id
    join public.academic_periods
      on academic_periods.id = profiles.academic_period_id
    where profiles.id = '55555555-5555-4555-8555-555555555555'
  ),
  'deactivation also preserves historical level and period references'
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
  'a historical selection remains structurally complete after deactivation'
);

select throws_ok(
  $$ delete from public.departments
      where id = (
        select department_id
        from public.profiles
        where id = '55555555-5555-4555-8555-555555555555'
      ) $$,
  '23503', null,
  'a referenced historical row cannot be deleted'
);

select throws_ok(
  $$ delete from public.academic_levels
      where id = (
        select academic_level_id
        from public.profiles
        where id = '55555555-5555-4555-8555-555555555555'
      ) $$,
  '23503', null,
  'a referenced academic level cannot be deleted'
);

select throws_ok(
  $$ delete from public.academic_periods
      where id = (
        select academic_period_id
        from public.profiles
        where id = '55555555-5555-4555-8555-555555555555'
      ) $$,
  '23503', null,
  'a referenced academic period cannot be deleted'
);

update public.departments
   set display_name = 'Renamed department in local test'
 where id = (
   select department_id
   from public.profiles
   where id = '55555555-5555-4555-8555-555555555555'
 );

select is(
  (
    select departments.display_name
    from public.profiles
    join public.departments
      on departments.id = profiles.department_id
    where profiles.id = '55555555-5555-4555-8555-555555555555'
  ),
  'Renamed department in local test',
  'display-name changes retain the existing profile reference'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';

select throws_ok(
  $$ update public.profiles
        set department_id = (
              select id
              from public.departments
              where not is_active
              order by sort_order
              limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods order by sort_order limit 1
            )
      where id = '66666666-6666-4666-8666-666666666666' $$,
  '42501', null,
  'active-reference WITH CHECK rejects the visible inactive row'
);

select throws_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments
              where is_active order by sort_order limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels
              where not is_active order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods
              where is_active order by sort_order limit 1
            )
      where id = '66666666-6666-4666-8666-666666666666' $$,
  '42501', null,
  'active-reference WITH CHECK rejects an inactive academic level'
);

select throws_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments
              where is_active order by sort_order limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels
              where is_active order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods
              where not is_active order by sort_order limit 1
            )
      where id = '66666666-6666-4666-8666-666666666666' $$,
  '42501', null,
  'active-reference WITH CHECK rejects an inactive academic period'
);

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
  'B remains all-null after inactive-selection attempts'
);

set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select is(
  (
    select count(*)::int
    from public.profiles
    join public.departments
      on departments.id = profiles.department_id
    where profiles.id = '55555555-5555-4555-8555-555555555555'
      and not departments.is_active
  ),
  1,
  'owner can still read an inactive historical selection'
);

select lives_ok(
  $$ update public.profiles
        set department_id = (
              select id from public.departments
              where is_active order by sort_order limit 1
            ),
            academic_level_id = (
              select id from public.academic_levels
              where is_active order by sort_order limit 1
            ),
            academic_period_id = (
              select id from public.academic_periods
              where is_active order by sort_order limit 1
            )
      where id = '55555555-5555-4555-8555-555555555555' $$,
  'owner can replace an inactive historical selection with active options'
);

select ok(
  (
    select departments.is_active
       and academic_levels.is_active
       and academic_periods.is_active
    from public.profiles
    join public.departments
      on departments.id = profiles.department_id
    join public.academic_levels
      on academic_levels.id = profiles.academic_level_id
    join public.academic_periods
      on academic_periods.id = profiles.academic_period_id
    where profiles.id = '55555555-5555-4555-8555-555555555555'
  ),
  'replacement stores three currently active references'
);


reset role;

select * from finish();

rollback;
