-- Run only through run.sh after the real Phase C migration reaches and fails
-- its final seed-integrity guard.
begin;

select plan(12);

select is(
  num_nonnulls(
    to_regclass('public.courses'),
    to_regclass('public.course_applicability')
  ),
  0,
  'failed Phase C leaves no registry tables or partial seed data'
);

select is(
  (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and tablename in ('courses', 'course_applicability')
  ),
  0,
  'failed Phase C leaves no course policies'
);

select is(
  (
    select count(*)::int
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('courses', 'course_applicability')
  ),
  0,
  'failed Phase C leaves no course grants'
);

select is(
  (select count(*)::int from public.departments),
  8,
  'all Phase B department data remains after Phase C rejection'
);

select is(
  (select count(*)::int from public.academic_levels),
  3,
  'all Phase B academic-level data remains after Phase C rejection'
);

select is(
  (select count(*)::int from public.academic_periods),
  2,
  'all Phase B academic-period rows remain after Phase C rejection'
);

select is(
  (
    select count(*)::int
    from public.academic_periods
    where key = 'first-semester-phase-c-failure'
  ),
  1,
  'the pre-migration failure sentinel remains unchanged'
);

select is(
  (
    select count(*)::int
    from pg_class
    where oid in (
      'public.departments'::regclass,
      'public.academic_levels'::regclass,
      'public.academic_periods'::regclass
    )
      and relrowsecurity
  ),
  3,
  'Phase B reference RLS remains enabled'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'department_id', 'academic_level_id', 'academic_period_id'
      )
  ),
  3,
  'Phase B profile selection columns remain intact'
);

select is(
  (
    select count(*)::int
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and conname in (
        'profiles_department_id_fkey',
        'profiles_academic_level_id_fkey',
        'profiles_academic_period_id_fkey'
      )
  ),
  3,
  'Phase B profile reference constraints remain intact'
);

select is(
  (
    select count(*)::int
    from supabase_migrations.schema_migrations
    where version = '20260918190000'
  ),
  1,
  'the successful Phase B migration remains recorded'
);

select is(
  (
    select count(*)::int
    from supabase_migrations.schema_migrations
    where version = '20260923100000'
  ),
  0,
  'the failed Phase C migration is not recorded'
);

select * from finish();
rollback;
