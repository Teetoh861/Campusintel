-- Phase C Slice 1 correction — separated repository content and institutional
-- catalogue ownership, exact source-backed seed and applicability.

begin;

select plan(36);

select is(
  (select count(*)::int from public.courses),
  35,
  'the repository content registry contains exactly thirty-five identities: fifteen seeded, nineteen official banks and one created for its study guide'
);

select is(
  (select jsonb_object_agg(content_key, id::text) from public.courses),
  jsonb_build_object(
    'entrepreneurship-innovation', '40000000-0000-4000-8000-000000000001',
    'principles-business-administration', '40000000-0000-4000-8000-000000000002',
    'business-statistics', '40000000-0000-4000-8000-000000000003',
    'leadership-governance', '40000000-0000-4000-8000-000000000004',
    'business-mathematics', '40000000-0000-4000-8000-000000000005',
    'consumer-behaviour', '40000000-0000-4000-8000-000000000006',
    'financial-accounting-1', '40000000-0000-4000-8000-000000000007',
    'use-of-english', '40000000-0000-4000-8000-000000000008',
    'nigerian-peoples-and-culture', '40000000-0000-4000-8000-000000000009',
    'international-organisational-behaviour', '40000000-0000-4000-8000-000000000010',
    'principles-business-administration-2', '40000000-0000-4000-8000-000000000011',
    'quantitative-analysis-management', '40000000-0000-4000-8000-000000000012',
    'philosophy-logic-human-existence', '40000000-0000-4000-8000-000000000013',
    'introduction-financial-management', '40000000-0000-4000-8000-000000000014',
    'bua218', '40000000-0000-4000-8000-000000000015'
  ) || jsonb_build_object(
    'introduction-financial-accounting-1', 'bf4eae11-b8cf-51d1-bfb1-5f32b1b2d55a',
    'introduction-actuarial-science', 'd1b6b70d-037b-5e9e-a4d4-17103525cc56',
    'principles-management', 'fa9abff6-1f94-5735-bbd3-c9104da6df05',
    'introduction-computer', '0264c494-3ae3-5279-b2a2-2ae91167839e',
    'introduction-business-1', '3377fae6-5ab9-5742-95e3-75b94650a294',
    'principles-economics-1', 'e01c0d3f-3f5e-5197-b96f-ac7935fc2fe8',
    'introduction-microeconomics', 'da06b311-1382-53a8-8057-d3513764c222',
    'elements-banking', '58f61fa3-cc23-5d99-bde7-5581043985ed',
    'introduction-finance', '203d7e61-c829-5419-a664-5a478e05a8a6',
    'fundamentals-deposit-insurance', '8e4bf369-a375-52bc-b5c2-fa55b4d5676c',
    'introduction-insurance', 'cd0f182c-a770-5232-892c-22fdc00d8686',
    'business-statistics-1', '66dc36be-2c4d-5821-ac32-a5c8e4ae4886',
    'mathematics-business', 'e6ebc3e3-e990-5459-84af-06a4f05aea89',
    'principles-marketing', '0d6682a1-b7b0-5109-b86a-2fabbfbea8b4',
    'marketing-communication', 'ced55987-74eb-5998-929a-c1d5275c5a3b',
    'managerial-economics', 'caf0ea5d-6cc0-5bd0-8719-c6f1a95ceec1',
    'legal-methods-1', '4df568c2-4a68-52ab-80d6-380e5921d119',
    'introduction-sociology-1', 'f0a98038-5829-537e-bb07-a06605f6e2a4',
    'business-taxation-2', 'b7bba625-d122-5afa-8b13-127d96411059'
  ) || jsonb_build_object(
    'introduction-cost-accounting', '0412653e-c891-5f49-abd8-927ed986fb78'
  ),
  'all fifteen seeded identities keep their stable IDs, and the nineteen official-bank identities and the study guide course are exact'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'courses'
  ),
  array['id', 'content_key', 'is_shared']::text[],
  'the repository registry owns only content identity and editorial sharing classification'
);

select is(
  (select count(distinct content_key)::int from public.courses),
  34,
  'repository content keys remain unique'
);

select is(
  (select count(*)::int from public.institutional_courses),
  154,
  'the updated catalogue adds five distinct BUA identities and retains historical identities'
);

select ok(
  (
    select count(distinct id) = 154
      and count(distinct (course_code, display_title)) = 154
    from public.institutional_courses
  ),
  'institutional IDs and exact source code/title identities are unique'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'institutional_courses'
  ),
  array[
    'id', 'course_code', 'display_title', 'repository_course_id', 'is_free'
  ]::text[],
  'the institutional catalogue has only institutional identity, optional content link and free status'
);

select is(
  (
    select count(*)::int
    from public.institutional_courses
    where repository_course_id is not null
  ),
  34,
  'thirty-four confirmed catalogue-to-content links are established, nineteen of them official banks and one a study guide course'
);

select is(
  (
    select count(distinct repository_course_id)::int
    from public.institutional_courses
    where repository_course_id is not null
  ),
  34,
  'confirmed content links are one-to-one'
);

select is(
  (
    select count(*)::int
    from public.institutional_courses
    where repository_course_id is null
  ),
  120,
  'institutional catalogue courses may exist without repository content'
);

select is(
  (
    select count(*)::int
    from public.institutional_courses
    where course_code = 'GST102'
      and display_title = 'Philosophy & Logic of Science'
      and repository_course_id is null
      and is_free
  ),
  1,
  'an unbuilt institutional course remains queryable and independently free'
);

select is(
  (
    select array_agg(
      institutional_courses.course_code || '=' || courses.content_key
      order by institutional_courses.course_code
    )
    from public.institutional_courses
    join public.courses
      on courses.id = institutional_courses.repository_course_id
  ),
  array[
    'ACC-CM201=financial-accounting-1',
    'ACC101=introduction-financial-accounting-1',
    'ACS101=introduction-actuarial-science',
    'AMS101=principles-management',
    'AMS103=introduction-computer',
    'BUA101=introduction-business-1',
    'BUA201=principles-business-administration',
    'BUA202=principles-business-administration-2',
    'BUA203=business-statistics',
    'BUA204=quantitative-analysis-management',
    'BUA205=leadership-governance',
    'BUA216=introduction-financial-management',
    'BUA218=bua218',
    'ECO101=principles-economics-1',
    'ECO201=introduction-microeconomics',
    'ENT211=entrepreneurship-innovation',
    'FIN-CM209=elements-banking',
    'FIN101=introduction-finance',
    'FIN216=fundamentals-deposit-insurance',
    'GST111=use-of-english',
    'GST112=nigerian-peoples-and-culture',
    'GST212=philosophy-logic-human-existence',
    'INS101=introduction-insurance',
    'LAG-ACS209=business-statistics-1',
    'LAG-ACS213=mathematics-business',
    'LAG-BUA111=principles-marketing',
    'LAG-BUA123=marketing-communication',
    'LAG-BUA125=managerial-economics',
    'LAG-BUA210=business-mathematics',
    'LAG-BUA221=consumer-behaviour',
    'PUL101=legal-methods-1',
    'SOC101=introduction-sociology-1',
    'TAX-CM223=business-taxation-2'
  ]::text[],
  'the thirty-three confirmed content links resolve to the exact repository identities'
);

select is(
  (
    select array_agg(content_key order by content_key)
    from public.courses
    where content_key in (
      'business-mathematics',
      'consumer-behaviour',
      'financial-accounting-1',
      'international-organisational-behaviour'
    )
      and not exists (
        select 1
        from public.institutional_courses
        where repository_course_id = courses.id
      )
  ),
  array['international-organisational-behaviour']::text[],
  'the remaining unresolved repository content record stays unlinked'
);

select is(
  (
    select array_agg(course_code order by course_code)
    from public.institutional_courses
    where course_code in ('LAG-BUA210', 'LAG-BUA221', 'ACC-CM201', 'LAG-BUA222')
      and repository_course_id is null
  ),
  array['LAG-BUA222']::text[],
  'only the unapproved runtime alias remains unresolved'
);

select is(
  (select count(*)::int from public.course_applicability),
  267,
  'the BUA correction replaces two mappings with five and preserves all faculty-wide GST tuples'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'course_applicability'
  ),
  array[
    'institutional_course_id',
    'department_id',
    'academic_level_id',
    'academic_period_id'
  ]::text[],
  'applicability contains only the institutional course and selection dimensions'
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
    'institutional_course_id',
    'department_id',
    'academic_level_id',
    'academic_period_id'
  ]::name[],
  'the exact institutional applicability tuple is the primary key'
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
  'all applicability foreign keys restrict updates and deletes'
);

select is(
  (
    select count(*)::int
    from pg_constraint
    where conrelid = 'public.course_applicability'::regclass
      and contype = 'f'
      and confrelid = 'public.institutional_courses'::regclass
  ),
  1,
  'applicability references institutional identity rather than repository content'
);

select is(
  (
    select count(*)::int
    from public.course_applicability
    left join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    where institutional_courses.id is null
  ),
  0,
  'every applicability row resolves to an institutional catalogue identity'
);

select is(
  (
    select array_agg(department_key || '=' || mapping_count order by department_key)
    from (
      select departments.key as department_key, count(*)::text as mapping_count
      from public.course_applicability
      join public.departments
        on departments.id = course_applicability.department_id
      group by departments.key
    ) counts
  ),
  array[
    'accounting=29',
    'actuarial-science=31',
    'business-administration=41',
    'ehrm=32',
    'finance=31',
    'insurance=30',
    'procurement=40',
    'taxation=33'
  ]::text[],
  'department totals preserve the six prior sections and add the v1.1 source rows'
);

select is(
  (
    select count(*)::int
    from public.course_applicability
    join public.academic_levels
      on academic_levels.id = course_applicability.academic_level_id
    where academic_levels.key = '300-level'
  ),
  8,
  'exactly eight approved BUA 300L First Semester mappings exist'
);

select is(
  (
    select count(*)::int
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    join public.departments
      on departments.id = course_applicability.department_id
    where departments.key in ('actuarial-science', 'procurement')
      and institutional_courses.course_code not in (
        'GST111', 'GST102', 'GST112', 'GST212'
      )
  ),
  63,
  'Actuarial Science and Procurement receive 27 and 36 source-backed non-GST mappings'
);

select ok(
  (
    select count(*) = 8
      and count(distinct department_id) = 8
      and bool_and(academic_levels.key = '100-level')
      and bool_and(academic_periods.key = 'first-semester')
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    join public.academic_levels
      on academic_levels.id = course_applicability.academic_level_id
    join public.academic_periods
      on academic_periods.id = course_applicability.academic_period_id
    where institutional_courses.course_code = 'GST111'
  ),
  'GST111 is faculty-wide at 100L First Semester'
);

select ok(
  (
    select count(*) = 8
      and count(distinct department_id) = 8
      and bool_and(academic_levels.key = '100-level')
      and bool_and(academic_periods.key = 'first-semester')
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    join public.academic_levels
      on academic_levels.id = course_applicability.academic_level_id
    join public.academic_periods
      on academic_periods.id = course_applicability.academic_period_id
    where institutional_courses.course_code = 'GST102'
  ),
  'GST102 is faculty-wide at 100L First Semester without invented content'
);

select ok(
  (
    select count(*) = 8
      and count(distinct departments.id) = 8
      and bool_and(academic_levels.key = '100-level')
      and bool_and(academic_periods.key = 'second-semester')
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    join public.departments
      on departments.id = course_applicability.department_id
    join public.academic_levels
      on academic_levels.id = course_applicability.academic_level_id
    join public.academic_periods
      on academic_periods.id = course_applicability.academic_period_id
    where institutional_courses.course_code = 'GST112'
  ),
  'GST112 remains faculty-wide at 100L Second Semester only'
);

select ok(
  (
    select count(*) = 8
      and count(distinct department_id) = 8
      and bool_and(academic_levels.key = '200-level')
      and bool_and(academic_periods.key = 'second-semester')
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    join public.academic_levels
      on academic_levels.id = course_applicability.academic_level_id
    join public.academic_periods
      on academic_periods.id = course_applicability.academic_period_id
    where institutional_courses.course_code = 'GST212'
  ),
  'GST212 is faculty-wide at 200L Second Semester'
);

select is(
  (
    with prior_confirmed (
      content_key,
      department_key,
      academic_level_key,
      academic_period_key
    ) as (
      values
        ('entrepreneurship-innovation', 'accounting', '200-level', 'first-semester'),
        ('entrepreneurship-innovation', 'taxation', '200-level', 'first-semester'),
        ('entrepreneurship-innovation', 'ehrm', '200-level', 'first-semester'),
        ('entrepreneurship-innovation', 'business-administration', '200-level', 'first-semester'),
        ('entrepreneurship-innovation', 'finance', '200-level', 'first-semester'),
        ('entrepreneurship-innovation', 'insurance', '200-level', 'first-semester'),
        ('principles-business-administration', 'business-administration', '200-level', 'first-semester'),
        ('business-statistics', 'business-administration', '200-level', 'first-semester'),
        ('leadership-governance', 'business-administration', '200-level', 'first-semester'),
        ('use-of-english', 'accounting', '100-level', 'first-semester'),
        ('use-of-english', 'business-administration', '100-level', 'first-semester'),
        ('use-of-english', 'actuarial-science', '100-level', 'first-semester'),
        ('use-of-english', 'taxation', '100-level', 'first-semester'),
        ('use-of-english', 'insurance', '100-level', 'first-semester'),
        ('use-of-english', 'procurement', '100-level', 'first-semester'),
        ('use-of-english', 'ehrm', '100-level', 'first-semester'),
        ('use-of-english', 'finance', '100-level', 'first-semester'),
        ('nigerian-peoples-and-culture', 'accounting', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'business-administration', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'actuarial-science', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'taxation', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'insurance', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'procurement', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'ehrm', '100-level', 'second-semester'),
        ('nigerian-peoples-and-culture', 'finance', '100-level', 'second-semester'),
        ('principles-business-administration-2', 'business-administration', '200-level', 'second-semester'),
        ('quantitative-analysis-management', 'business-administration', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'accounting', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'business-administration', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'actuarial-science', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'taxation', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'insurance', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'procurement', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'ehrm', '200-level', 'second-semester'),
        ('philosophy-logic-human-existence', 'finance', '200-level', 'second-semester'),
        ('introduction-financial-management', 'business-administration', '200-level', 'second-semester'),
        ('introduction-financial-management', 'insurance', '200-level', 'second-semester'),
        ('bua218', 'business-administration', '200-level', 'second-semester')
    )
    select count(*)::int
    from prior_confirmed
    where exists (
      select 1
      from public.course_applicability
      join public.institutional_courses
        on institutional_courses.id = course_applicability.institutional_course_id
      join public.courses
        on courses.id = institutional_courses.repository_course_id
      join public.departments
        on departments.id = course_applicability.department_id
      join public.academic_levels
        on academic_levels.id = course_applicability.academic_level_id
      join public.academic_periods
        on academic_periods.id = course_applicability.academic_period_id
      where courses.content_key = prior_confirmed.content_key
        and departments.key = prior_confirmed.department_key
        and academic_levels.key = prior_confirmed.academic_level_key
        and academic_periods.key = prior_confirmed.academic_period_key
    )
  ),
  38,
  'all thirty-eight previously confirmed mappings remain represented through catalogue links'
);

select is(
  (
    select count(*)::int
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    where institutional_courses.repository_course_id is not null
  ),
  103,
  'the approved links expose existing mappings without adding applicability: 45 before, plus 58 for the nineteen official banks'
);

select is(
  (
    select count(*)::int
    from public.course_applicability
    join public.institutional_courses
      on institutional_courses.id = course_applicability.institutional_course_id
    join public.departments
      on departments.id = course_applicability.department_id
    join public.academic_levels
      on academic_levels.id = course_applicability.academic_level_id
    join public.academic_periods
      on academic_periods.id = course_applicability.academic_period_id
    where institutional_courses.course_code = 'GST112'
      and departments.key = 'business-administration'
      and academic_levels.key = '200-level'
      and academic_periods.key = 'second-semester'
  ),
  0,
  'the uncertain BUA 200L Second Semester GST112 row is absent'
);

select is(
  (
    select array_agg(course_code order by course_code)
    from public.institutional_courses
    where is_free
  ),
  array['GST102', 'GST111', 'GST112', 'GST212']::text[],
  'the exact four source-identified GST courses own free-tier status'
);

select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'courses'
      and column_name = 'is_free'
  )
  and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'institutional_courses'
      and column_name = 'is_shared'
  ),
  'free and shared classifications have separate owners rather than being conflated'
);

select is(
  jsonb_build_object(
    'true', (
      select array_agg(content_key order by content_key)
      from public.courses where is_shared is true
    ),
    'false', (
      select array_agg(content_key order by content_key)
      from public.courses where is_shared is false
    ),
    'unknown', (
      select array_agg(content_key order by content_key)
      from public.courses where is_shared is null
    )
  ),
  jsonb_build_object(
    'true', array[
      'entrepreneurship-innovation',
      'introduction-financial-management',
      'nigerian-peoples-and-culture',
      'philosophy-logic-human-existence',
      'use-of-english'
    ]::text[],
    'false', array[
      'bua218',
      'business-statistics',
      'leadership-governance',
      'principles-business-administration',
      'principles-business-administration-2',
      'quantitative-analysis-management'
    ]::text[],
    'unknown', array[
      'business-mathematics',
      'business-statistics-1',
      'business-taxation-2',
      'consumer-behaviour',
      'elements-banking',
      'financial-accounting-1',
      'fundamentals-deposit-insurance',
      'international-organisational-behaviour',
      'introduction-actuarial-science',
      'introduction-business-1',
      'introduction-computer',
      'introduction-cost-accounting',
      'introduction-finance',
      'introduction-financial-accounting-1',
      'introduction-insurance',
      'introduction-microeconomics',
      'introduction-sociology-1',
      'legal-methods-1',
      'managerial-economics',
      'marketing-communication',
      'mathematics-business',
      'principles-economics-1',
      'principles-management',
      'principles-marketing'
    ]::text[]
  ),
  'seeded sharing classifications remain exactly intact; the nineteen official-bank identities and the study guide course are unresolved'
);

select is(
  (
    select array_agg(
      institutional_courses.course_code || '=' || coalesce(courses.content_key, 'unlinked')
      order by institutional_courses.course_code
    )
    from public.institutional_courses
    left join public.courses
      on courses.id = institutional_courses.repository_course_id
    where course_code in (
      'EHR206', 'HER206',
      'ACS207', 'ACS-CM207',
      'FIN101', 'FIN-CM101',
      'FIN120', 'FIN-CM210',
      'IRP121', 'LAG-EHR222',
      'ACC121', 'ACC-CM204'
    )
  ),
  array[
    'ACC-CM204=unlinked',
    'ACC121=introduction-cost-accounting',
    'ACS-CM207=unlinked',
    'ACS207=unlinked',
    'EHR206=unlinked',
    'FIN-CM101=unlinked',
    'FIN-CM210=unlinked',
    'FIN101=introduction-finance',
    'FIN120=unlinked',
    'HER206=unlinked',
    'IRP121=unlinked',
    'LAG-EHR222=unlinked'
  ]::text[],
  'ambiguous code/title relationships remain separate: FIN101 links to its own official bank and ACC121 to the course made for its study guide; the other ten stay unlinked'
);

select is(
  (
    select count(*)::int
    from pg_class
    where oid in (
      'public.courses'::regclass,
      'public.institutional_courses'::regclass,
      'public.course_applicability'::regclass
    ) and relrowsecurity
  ),
  3,
  'RLS is enabled on all three platform-owned course tables'
);

select is(
  (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'courses', 'institutional_courses', 'course_applicability'
      )
      and cmd = 'SELECT' and permissive = 'PERMISSIVE'
  ),
  3,
  'all course ownership tables have authenticated read policies only'
);

select * from finish();

rollback;
