-- Phase C Slice 1 correction — referential integrity and ownership controls.

begin;

select plan(26);

select throws_ok(
  $$ insert into public.course_applicability
       (institutional_course_id, department_id, academic_level_id, academic_period_id)
     select
       institutional_courses.id,
       departments.id,
       academic_levels.id,
       academic_periods.id
     from public.institutional_courses
     cross join public.departments
     cross join public.academic_levels
     cross join public.academic_periods
     where institutional_courses.course_code = 'BUA201'
       and departments.key = 'business-administration'
       and academic_levels.key = '200-level'
       and academic_periods.key = 'first-semester' $$,
  '23505', null,
  'duplicate institutional applicability tuples are rejected'
);

select throws_ok(
  $$ insert into public.institutional_courses
       (id, course_code, display_title, repository_course_id, is_free)
     values (
       '70000000-0000-4000-8000-000000000001',
       'BUA201',
       'Principles of Business Administration I',
       null,
       false
     ) $$,
  '23505', null,
  'duplicate exact institutional code/title identities are rejected'
);

select throws_ok(
  $$ update public.institutional_courses
       set repository_course_id = (
         select id from public.courses where content_key = 'bua218'
       )
     where course_code = 'GST102' $$,
  '23505', null,
  'one repository content identity cannot be linked to two catalogue courses'
);

select throws_ok(
  $$ insert into public.course_applicability
       (institutional_course_id, department_id, academic_level_id, academic_period_id)
     select
       '70000000-0000-4000-8000-000000000002',
       departments.id,
       academic_levels.id,
       academic_periods.id
     from public.departments
     cross join public.academic_levels
     cross join public.academic_periods
     where departments.key = 'business-administration'
       and academic_levels.key = '200-level'
       and academic_periods.key = 'first-semester' $$,
  '23503', null,
  'a nonexistent institutional course identity is rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (institutional_course_id, department_id, academic_level_id, academic_period_id)
     select
       institutional_courses.id,
       '70000000-0000-4000-8000-000000000003',
       academic_levels.id,
       academic_periods.id
     from public.institutional_courses
     cross join public.academic_levels
     cross join public.academic_periods
     where institutional_courses.course_code = 'BUA218'
       and academic_levels.key = '200-level'
       and academic_periods.key = 'first-semester' $$,
  '23503', null,
  'a nonexistent department identity is rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (institutional_course_id, department_id, academic_level_id, academic_period_id)
     select
       institutional_courses.id,
       departments.id,
       '70000000-0000-4000-8000-000000000004',
       academic_periods.id
     from public.institutional_courses
     cross join public.departments
     cross join public.academic_periods
     where institutional_courses.course_code = 'BUA218'
       and departments.key = 'accounting'
       and academic_periods.key = 'first-semester' $$,
  '23503', null,
  'a nonexistent academic-level identity is rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (institutional_course_id, department_id, academic_level_id, academic_period_id)
     select
       institutional_courses.id,
       departments.id,
       academic_levels.id,
       '70000000-0000-4000-8000-000000000005'
     from public.institutional_courses
     cross join public.departments
     cross join public.academic_levels
     where institutional_courses.course_code = 'BUA218'
       and departments.key = 'accounting'
       and academic_levels.key = '200-level' $$,
  '23503', null,
  'a nonexistent academic-period identity is rejected'
);

select lives_ok(
  $$ insert into public.course_applicability
       (institutional_course_id, department_id, academic_level_id, academic_period_id)
     select
       institutional_courses.id,
       departments.id,
       academic_levels.id,
       academic_periods.id
     from public.institutional_courses
     cross join public.departments
     cross join public.academic_levels
     cross join public.academic_periods
     where institutional_courses.course_code = 'BUA218'
       and departments.key = 'accounting'
       and academic_levels.key = '100-level'
       and academic_periods.key = 'first-semester' $$,
  'an institutional course can later gain a distinct applicability tuple'
);

delete from public.course_applicability
using public.institutional_courses,
      public.departments,
      public.academic_levels,
      public.academic_periods
where course_applicability.institutional_course_id = institutional_courses.id
  and course_applicability.department_id = departments.id
  and course_applicability.academic_level_id = academic_levels.id
  and course_applicability.academic_period_id = academic_periods.id
  and institutional_courses.course_code = 'BUA218'
  and departments.key = 'accounting'
  and academic_levels.key = '100-level'
  and academic_periods.key = 'first-semester';

select throws_ok(
  $$ delete from public.institutional_courses where course_code = 'BUA218' $$,
  '23503', null,
  'a referenced institutional identity cannot be deleted'
);

select throws_ok(
  $$ update public.institutional_courses
       set id = '70000000-0000-4000-8000-000000000006'
     where course_code = 'BUA218' $$,
  '23503', null,
  'a referenced institutional identity cannot be changed'
);

select throws_ok(
  $$ delete from public.courses where content_key = 'bua218' $$,
  '23503', null,
  'linked repository content cannot be deleted'
);

select throws_ok(
  $$ update public.courses
       set id = '70000000-0000-4000-8000-000000000007'
     where content_key = 'bua218' $$,
  '23503', null,
  'linked repository content identity cannot be changed'
);

select throws_ok(
  $$ delete from public.departments where key = 'business-administration' $$,
  '23503', null,
  'a referenced department cannot be deleted'
);

select throws_ok(
  $$ delete from public.academic_levels where key = '200-level' $$,
  '23503', null,
  'a referenced academic level cannot be deleted'
);

select throws_ok(
  $$ delete from public.academic_periods where key = 'second-semester' $$,
  '23503', null,
  'a referenced academic period cannot be deleted'
);

select ok(
  has_table_privilege('authenticated', 'public.courses', 'SELECT')
  and has_table_privilege(
    'authenticated', 'public.institutional_courses', 'SELECT'
  )
  and has_table_privilege(
    'authenticated', 'public.course_applicability', 'SELECT'
  ),
  'authenticated students can read repository and institutional course data'
);

select ok(
  not has_table_privilege('authenticated', 'public.courses', 'INSERT')
  and not has_table_privilege('authenticated', 'public.courses', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.courses', 'DELETE')
  and not has_table_privilege('authenticated', 'public.courses', 'TRUNCATE')
  and not has_table_privilege(
    'authenticated', 'public.institutional_courses', 'INSERT'
  )
  and not has_table_privilege(
    'authenticated', 'public.institutional_courses', 'UPDATE'
  )
  and not has_table_privilege(
    'authenticated', 'public.institutional_courses', 'DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'public.institutional_courses', 'TRUNCATE'
  )
  and not has_table_privilege(
    'authenticated', 'public.course_applicability', 'INSERT'
  )
  and not has_table_privilege(
    'authenticated', 'public.course_applicability', 'UPDATE'
  )
  and not has_table_privilege(
    'authenticated', 'public.course_applicability', 'DELETE'
  )
  and not has_table_privilege(
    'authenticated', 'public.course_applicability', 'TRUNCATE'
  ),
  'authenticated students have no mutation privilege on course ownership data'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select is(
  (select count(*)::int from public.courses),
  15,
  'authenticated students can read all repository content identities'
);

select is(
  (select count(*)::int from public.institutional_courses),
  101,
  'authenticated students can read the institutional catalogue'
);

select is(
  (select count(*)::int from public.course_applicability),
  196,
  'authenticated students can read institutional applicability'
);

select throws_ok(
  $$ update public.courses set is_shared = false $$,
  '42501', null,
  'authenticated students cannot change repository content classification'
);

select throws_ok(
  $$ update public.institutional_courses set is_free = false $$,
  '42501', null,
  'authenticated students cannot change institutional catalogue ownership data'
);

select throws_ok(
  $$ delete from public.course_applicability $$,
  '42501', null,
  'authenticated students cannot delete institutional applicability'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.courses $$,
  '42501', null,
  'anonymous callers cannot read the repository content registry'
);

select throws_ok(
  $$ select count(*) from public.institutional_courses $$,
  '42501', null,
  'anonymous callers cannot read the institutional catalogue'
);

select throws_ok(
  $$ select count(*) from public.course_applicability $$,
  '42501', null,
  'anonymous callers cannot read institutional applicability'
);

reset role;

select * from finish();

rollback;
