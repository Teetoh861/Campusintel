-- Phase C Slice 1 — course registry shape, approved seed and exact mappings.

begin;

select plan(29);

select is(
  (select count(*)::int from public.courses),
  15,
  'all fifteen repository courses have registry identities'
);

select is(
  (select count(distinct content_key)::int from public.courses),
  15,
  'all registry content keys are unique'
);

select ok(
  (select bool_and(content_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
     from public.courses),
  'every registry content key has the constrained stable-key format'
);

select is(
  (select count(*)::int from public.course_applicability),
  38,
  'only the thirty-eight approved applicability tuples are seeded'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'courses'
      and column_name in ('id', 'content_key', 'is_shared', 'is_free')
  ),
  4,
  'the registry stores identity and the two independent course properties'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'courses'
      and column_name in ('slug', 'code', 'title', 'level', 'semester')
  ),
  0,
  'presentation and legacy descriptive course fields stay repository-owned'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'course_applicability'
      and column_name in (
        'course_id',
        'department_id',
        'academic_level_id',
        'academic_period_id'
      )
  ),
  4,
  'applicability contains exactly the four relationship dimensions'
);

select is(
  (
    select array_agg(att.attname order by key_columns.ordinality)
    from pg_constraint constraint_row
    cross join unnest(constraint_row.conkey)
      with ordinality as key_columns(attnum, ordinality)
    join pg_attribute att
      on att.attrelid = constraint_row.conrelid
     and att.attnum = key_columns.attnum
    where constraint_row.conrelid = 'public.course_applicability'::regclass
      and constraint_row.contype = 'p'
  ),
  array[
    'course_id',
    'department_id',
    'academic_level_id',
    'academic_period_id'
  ]::name[],
  'the exact applicability tuple is the primary key'
);

select is(
  (
    select count(*)::int
    from pg_constraint
    where conrelid = 'public.course_applicability'::regclass
      and contype = 'f'
      and confupdtype = 'r'
      and confdeltype = 'r'
  ),
  4,
  'all applicability references restrict key updates and row deletion'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.courses'::regclass)
  and (
    select relrowsecurity
    from pg_class
    where oid = 'public.course_applicability'::regclass
  ),
  'RLS is enabled on both platform-owned course tables'
);

select is(
  (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and tablename in ('courses', 'course_applicability')
      and cmd = 'SELECT'
  ),
  2,
  'both course tables have authenticated read policies'
);

select is(
  (
    select array_agg(departments.key order by departments.key)
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    where courses.content_key = 'entrepreneurship-innovation'
  ),
  array[
    'accounting',
    'business-administration',
    'ehrm',
    'finance',
    'insurance',
    'taxation'
  ]::text[],
  'ENT211 has exactly its six confirmed department memberships'
);

select ok(
  (
    select count(*) = 6
       and bool_and(academic_levels.key = '200-level')
       and bool_and(academic_periods.key = 'first-semester')
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'entrepreneurship-innovation'
  ),
  'multi-department ENT211 remains one exact level and period relationship per department'
);

select is(
  (
    select array_agg(departments.key order by departments.key)
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    where courses.content_key = 'introduction-financial-management'
  ),
  array['business-administration', 'insurance']::text[],
  'BUA216 has exactly its two confirmed department memberships'
);

select is(
  (
    select count(*)::int
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'principles-business-administration'
      and departments.key = 'business-administration'
      and academic_levels.key = '200-level'
      and academic_periods.key = 'first-semester'
  ),
  1,
  'a supported exact Department + Level + Semester tuple matches once'
);

select is(
  (
    select count(*)::int
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'principles-business-administration'
      and (
        departments.key <> 'business-administration'
        or academic_levels.key <> '200-level'
        or academic_periods.key <> 'first-semester'
      )
  ),
  0,
  'the association does not create Cartesian department, level or period matches'
);

select is(
  (
    select array_agg(courses.content_key order by courses.content_key)
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where departments.key = 'business-administration'
      and academic_levels.key = '200-level'
      and academic_periods.key = 'first-semester'
  ),
  array[
    'business-statistics',
    'entrepreneurship-innovation',
    'leadership-governance',
    'principles-business-administration'
  ]::text[],
  'Business Administration 200L First Semester has its exact approved set'
);

select is(
  (
    select array_agg(courses.content_key order by courses.content_key)
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where departments.key = 'business-administration'
      and academic_levels.key = '200-level'
      and academic_periods.key = 'second-semester'
  ),
  array[
    'bua218',
    'introduction-financial-management',
    'philosophy-logic-human-existence',
    'principles-business-administration-2',
    'quantitative-analysis-management'
  ]::text[],
  'Business Administration 200L Second Semester has its exact approved set'
);

select ok(
  (
    select count(*) = 8
       and count(distinct department_id) = 8
       and bool_and(academic_levels.key = '100-level')
       and bool_and(academic_periods.key = 'first-semester')
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'use-of-english'
  ),
  'GST111 is faculty-wide at 100L First Semester only'
);

select ok(
  (
    select count(*) = 8
       and count(distinct department_id) = 8
       and bool_and(academic_levels.key = '100-level')
       and bool_and(academic_periods.key = 'second-semester')
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'nigerian-peoples-and-culture'
  ),
  'GST112 is faculty-wide at 100L Second Semester only'
);

select ok(
  (
    select count(*) = 8
       and count(distinct department_id) = 8
       and bool_and(academic_levels.key = '200-level')
       and bool_and(academic_periods.key = 'second-semester')
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'philosophy-logic-human-existence'
  ),
  'GST212 is faculty-wide at 200L Second Semester only'
);

select is(
  (
    select count(*)::int
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    where courses.content_key in (
      'business-mathematics',
      'consumer-behaviour',
      'financial-accounting-1',
      'international-organisational-behaviour'
    )
  ),
  0,
  'unresolved runtime-to-catalog identities receive no guessed applicability'
);

select is(
  (
    select count(*)::int
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    join public.academic_periods academic_periods
      on academic_periods.id = applicability.academic_period_id
    where courses.content_key = 'nigerian-peoples-and-culture'
      and departments.key = 'business-administration'
      and academic_levels.key = '200-level'
      and academic_periods.key = 'second-semester'
  ),
  0,
  'the uncertain BUA 200L GST112 row is absent'
);

select is(
  (
    select count(*)::int
    from public.course_applicability applicability
    join public.academic_levels academic_levels
      on academic_levels.id = applicability.academic_level_id
    where academic_levels.key = '300-level'
  ),
  0,
  'no 300L applicability is invented'
);

select is(
  (
    select count(*)::int
    from public.course_applicability applicability
    join public.courses courses on courses.id = applicability.course_id
    join public.departments departments
      on departments.id = applicability.department_id
    where departments.key in ('actuarial-science', 'procurement')
      and courses.content_key not in (
        'use-of-english',
        'nigerian-peoples-and-culture',
        'philosophy-logic-human-existence'
      )
  ),
  0,
  'Actuarial Science and Procurement receive no inferred non-GST courses'
);

select is(
  (
    select array_agg(content_key order by content_key)
    from public.courses
    where is_shared is true
  ),
  array[
    'entrepreneurship-innovation',
    'introduction-financial-management',
    'nigerian-peoples-and-culture',
    'philosophy-logic-human-existence',
    'use-of-english'
  ]::text[],
  'only catalog-confirmed shared or general courses are classified as shared'
);

select is(
  (
    select array_agg(content_key order by content_key)
    from public.courses
    where is_shared is false
  ),
  array[
    'bua218',
    'business-statistics',
    'leadership-governance',
    'principles-business-administration',
    'principles-business-administration-2',
    'quantitative-analysis-management'
  ]::text[],
  'only catalog-confirmed department-specific courses are classified as not shared'
);

select is(
  (
    select array_agg(content_key order by content_key)
    from public.courses
    where is_shared is null
  ),
  array[
    'business-mathematics',
    'consumer-behaviour',
    'financial-accounting-1',
    'international-organisational-behaviour'
  ]::text[],
  'all unresolved runtime-to-catalog identities keep unknown sharing classification'
);

select is(
  (
    select array_agg(content_key order by content_key)
    from public.courses
    where is_free is true
  ),
  array[
    'nigerian-peoples-and-culture',
    'philosophy-logic-human-existence',
    'use-of-english'
  ]::text[],
  'the exact independently confirmed free-tier course set is seeded'
);

select * from finish();

rollback;
