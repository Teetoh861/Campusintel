-- Run only through run.sh after the correction reaches and fails its final
-- seed-integrity guard over the already-committed Slice 1 state.
begin;

select plan(12);

select is(
  to_regclass('public.institutional_courses'),
  null::regclass,
  'failed correction leaves no institutional catalogue table'
);

select is(
  (select count(*)::int from public.courses),
  15,
  'failed correction preserves all predecessor repository identities'
);

select is(
  (select count(*)::int from public.course_applicability),
  38,
  'failed correction restores all predecessor applicability rows'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'courses'
      and column_name = 'is_free'),
  1,
  'failed correction restores predecessor free-status ownership'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'course_applicability'
      and column_name = 'course_id'),
  1,
  'failed correction restores predecessor applicability ownership'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'course_applicability'
      and column_name = 'institutional_course_id'),
  0,
  'failed correction leaves no partial institutional applicability column'
);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename = 'institutional_courses'),
  0,
  'failed correction leaves no institutional catalogue policy'
);

select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'institutional_courses'),
  0,
  'failed correction leaves no institutional catalogue grants'
);

select is(
  (select count(*)::int from public.departments
    where key = 'finance-phase-c-catalogue-failure'),
  1,
  'the pre-correction failure sentinel remains unchanged'
);

select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.course_applicability'::regclass
      and contype = 'f'
      and confrelid = 'public.courses'::regclass
      and confupdtype = 'r'
      and confdeltype = 'r'),
  1,
  'failed correction restores the predecessor restrictive content foreign key'
);

select is(
  (select count(*)::int from supabase_migrations.schema_migrations
    where version = '20260923100000'),
  1,
  'the committed Slice 1 migration remains recorded'
);

select is(
  (select count(*)::int from supabase_migrations.schema_migrations
    where version = '20260923160000'),
  0,
  'the failed catalogue correction is not recorded'
);

select * from finish();
rollback;
