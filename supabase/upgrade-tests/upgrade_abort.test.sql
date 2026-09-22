-- Run only through run.sh, after the real Phase B migration rejects a Phase A
-- database containing non-null legacy selections.
begin;

select plan(10);

select is(
  (select count(*)::int from public.profiles
    where id between '80000000-0000-4000-8000-000000000001'
                 and '80000000-0000-4000-8000-000000000004'),
  4,
  'all pre-existing profile rows remain after the rejected migration'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('department', 'level', 'semester')),
  3,
  'all three legacy columns remain after rejection'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_semester_check'
  ),
  'the Phase A semester constraint remains after rejection'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in (
        'department_id', 'academic_level_id', 'academic_period_id'
      )),
  0,
  'no new selection column was left behind'
);

select is(
  num_nonnulls(
    to_regclass('public.departments'),
    to_regclass('public.academic_levels'),
    to_regclass('public.academic_periods')
  ),
  0,
  'no reference table or seeded data was left behind'
);

select is(
  (select count(*)::int from public.profiles
    where id between '80000000-0000-4000-8000-000000000001'
                 and '80000000-0000-4000-8000-000000000004'
      and num_nonnulls(department, level, semester) = 1
      and (
        department = 'Legacy department sentinel'
        or level = 777
        or semester = 2
      )),
  1,
  'the one field-specific legacy sentinel remains unchanged'
);

select is(
  (select count(*)::int from public.profiles
    where id between '80000000-0000-4000-8000-000000000001'
                 and '80000000-0000-4000-8000-000000000004'
      and num_nonnulls(department, level, semester) = 0),
  3,
  'the other three all-null profiles remain unchanged'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'Profiles are updatable by their owner with active selection'),
  0,
  'no Phase B profile policy was left behind'
);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_legacy_selection_empty_check'),
  0,
  'failed validation did not leave a temporary guard behind'
);

select is(
  (select count(*)::int from supabase_migrations.schema_migrations
    where version = '20260918190000'),
  0,
  'a rejected migration is not recorded as applied'
);

select * from finish();
rollback;
