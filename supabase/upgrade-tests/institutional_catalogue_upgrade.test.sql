-- Run only through run.sh after upgrading directly from committed Slice 1.
begin;

select plan(12);

select is(
  (select count(*)::int from public.courses),
  15,
  'direct upgrade preserves all fifteen repository content identities'
);

select is(
  (select count(distinct content_key)::int from public.courses),
  15,
  'direct upgrade preserves all repository content keys uniquely'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'courses'
      and column_name = 'is_free'),
  0,
  'direct upgrade moves free status out of repository content'
);

select is(
  (select count(*)::int from public.institutional_courses),
  101,
  'direct upgrade installs 101 institutional catalogue identities'
);

select is(
  (select count(*)::int from public.institutional_courses
    where repository_course_id is not null),
  11,
  'direct upgrade installs exactly eleven confirmed content links'
);

select is(
  (select count(*)::int from public.institutional_courses
    where repository_course_id is null),
  90,
  'direct upgrade permits ninety institutional identities without content'
);

select is(
  (select count(*)::int from public.course_applicability),
  196,
  'direct upgrade replaces the content-limited seed with 196 confirmed catalogue rows'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'course_applicability'
      and column_name = 'institutional_course_id'),
  1,
  'direct upgrade makes institutional identity the applicability owner'
);

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'course_applicability'
      and column_name = 'course_id'),
  0,
  'direct upgrade removes the repository-content applicability dimension'
);

select is(
  (select count(*)::int from pg_class
    where oid in (
      'public.courses'::regclass,
      'public.institutional_courses'::regclass,
      'public.course_applicability'::regclass
    ) and relrowsecurity),
  3,
  'direct upgrade leaves RLS enabled on all course ownership tables'
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
  1,
  'the forward catalogue correction is recorded once'
);

select * from finish();
rollback;
