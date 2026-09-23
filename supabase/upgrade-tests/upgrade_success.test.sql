-- Run only through run.sh, after seeding Phase A and applying the real Phase B
-- migration. Ordinary supabase test db files run after every migration.
begin;

select plan(15);

select is(
  (select count(*)::int from auth.users
    where id between '80000000-0000-4000-8000-000000000001'
                 and '80000000-0000-4000-8000-000000000004'),
  4,
  'all four pre-existing confirmed Auth users survive the upgrade'
);

select is(
  (select count(*)::int from public.profiles
    where id between '80000000-0000-4000-8000-000000000001'
                 and '80000000-0000-4000-8000-000000000004'),
  4,
  'all four pre-existing profile rows survive the upgrade'
);

select is(
  (select count(*)::int from public.profiles
    where id between '80000000-0000-4000-8000-000000000001'
                 and '80000000-0000-4000-8000-000000000004'
      and num_nonnulls(department_id, academic_level_id, academic_period_id) = 0),
  4,
  'all-null legacy selections become all-null reference selections'
);

select is(
  num_nonnulls(
    to_regclass('public.departments'),
    to_regclass('public.academic_levels'),
    to_regclass('public.academic_periods')
  ),
  3,
  'all three reference tables exist after the upgrade'
);

select is(
  num_nonnulls(
    to_regclass('public.courses'),
    to_regclass('public.course_applicability')
  ),
  2,
  'both Phase C course foundation tables exist after the upgrade'
);

select is(
  (select count(*)::int from public.courses),
  15,
  'the upgrade installs all fifteen course registry identities'
);

select is(
  (select count(*)::int from public.course_applicability),
  38,
  'the upgrade installs only the approved course applicability tuples'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in (
        'department_id', 'academic_level_id', 'academic_period_id'
      )),
  3,
  'all three typed selection columns exist after the upgrade'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name in ('department', 'level', 'semester')),
  0,
  'the three all-null legacy columns were removed'
);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'f'
      and conname in (
        'profiles_department_id_fkey',
        'profiles_academic_level_id_fkey',
        'profiles_academic_period_id_fkey'
      )),
  3,
  'the upgraded profiles have all three reference foreign keys'
);

select throws_ok(
  $$ update public.profiles
        set department_id = (select id from public.departments limit 1)
      where id = '80000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'the upgraded profile CHECK rejects a partial selection'
);

select throws_ok(
  $$ update public.profiles
        set department_id = '70000000-0000-4000-8000-000000000001',
            academic_level_id = (select id from public.academic_levels limit 1),
            academic_period_id = (select id from public.academic_periods limit 1)
      where id = '80000000-0000-4000-8000-000000000001' $$,
  '23503', null,
  'the upgraded foreign keys reject a nonexistent reference'
);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_legacy_selection_empty_check'),
  0,
  'the temporary legacy-data guard is removed with the legacy columns'
);

select is(
  (select count(*)::int from supabase_migrations.schema_migrations
    where version = '20260918190000'),
  1,
  'the successful upgrade is recorded exactly once'
);

select is(
  (select count(*)::int from supabase_migrations.schema_migrations
    where version = '20260923100000'),
  1,
  'the course foundation migration is recorded exactly once'
);

select * from finish();
rollback;
