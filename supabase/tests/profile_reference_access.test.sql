-- Phase B Slice 1 — authenticated and anonymous reference-data access.

begin;

select plan(13);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select is(
  (select count(*)::int from public.departments),
  8,
  'authenticated A can read departments'
);

select is(
  (select count(*)::int from public.academic_levels),
  3,
  'authenticated A can read academic levels'
);

select is(
  (select count(*)::int from public.academic_periods),
  2,
  'authenticated A can read academic periods'
);

select throws_ok(
  $$ update public.departments set is_active = false $$,
  '42501', null,
  'authenticated cannot update departments'
);

select throws_ok(
  $$ update public.academic_levels set is_active = false $$,
  '42501', null,
  'authenticated cannot update academic levels'
);

select throws_ok(
  $$ update public.academic_periods set is_active = false $$,
  '42501', null,
  'authenticated cannot update academic periods'
);

select throws_ok(
  $$ insert into public.departments
       (id, key, display_name, is_active, sort_order)
     values
       ('70000000-0000-4000-8000-000000000001', 'not-allowed',
        'Not Allowed', true, 99) $$,
  '42501', null,
  'authenticated cannot insert reference data'
);

select throws_ok(
  $$ delete from public.departments $$,
  '42501', null,
  'authenticated cannot delete reference data'
);

-- ---------------------------------------------------------------------------
-- Anonymous access remains closed
-- ---------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.departments $$,
  '42501', null,
  'anon cannot read departments'
);

select throws_ok(
  $$ select count(*) from public.academic_levels $$,
  '42501', null,
  'anon cannot read academic levels'
);

select throws_ok(
  $$ select count(*) from public.academic_periods $$,
  '42501', null,
  'anon cannot read academic periods'
);

select throws_ok(
  $$ update public.departments set is_active = false $$,
  '42501', null,
  'anon cannot mutate reference data'
);

select throws_ok(
  $$ update public.profiles set department_id = null $$,
  '42501', null,
  'anon cannot update a profile selection'
);

reset role;

select * from finish();

rollback;
