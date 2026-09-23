-- Phase C Slice 1 — referential integrity and platform-owned access controls.

begin;

select plan(18);

select throws_ok(
  $$ insert into public.course_applicability
       (course_id, department_id, academic_level_id, academic_period_id)
     select
       courses.id, departments.id, academic_levels.id, academic_periods.id
     from public.courses courses
     cross join public.departments departments
     cross join public.academic_levels academic_levels
     cross join public.academic_periods academic_periods
     where courses.content_key = 'principles-business-administration'
       and departments.key = 'business-administration'
       and academic_levels.key = '200-level'
       and academic_periods.key = 'first-semester' $$,
  '23505', null,
  'duplicate exact applicability tuples are rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (course_id, department_id, academic_level_id, academic_period_id)
     select
       '70000000-0000-4000-8000-000000000001',
       departments.id, academic_levels.id, academic_periods.id
     from public.departments departments
     cross join public.academic_levels academic_levels
     cross join public.academic_periods academic_periods
     where departments.key = 'business-administration'
       and academic_levels.key = '200-level'
       and academic_periods.key = 'first-semester' $$,
  '23503', null,
  'a nonexistent course identity is rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (course_id, department_id, academic_level_id, academic_period_id)
     select
       courses.id,
       '70000000-0000-4000-8000-000000000002',
       academic_levels.id,
       academic_periods.id
     from public.courses courses
     cross join public.academic_levels academic_levels
     cross join public.academic_periods academic_periods
     where courses.content_key = 'bua218'
       and academic_levels.key = '200-level'
       and academic_periods.key = 'first-semester' $$,
  '23503', null,
  'a nonexistent department identity is rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (course_id, department_id, academic_level_id, academic_period_id)
     select
       courses.id,
       departments.id,
       '70000000-0000-4000-8000-000000000003',
       academic_periods.id
     from public.courses courses
     cross join public.departments departments
     cross join public.academic_periods academic_periods
     where courses.content_key = 'bua218'
       and departments.key = 'accounting'
       and academic_periods.key = 'first-semester' $$,
  '23503', null,
  'a nonexistent academic-level identity is rejected'
);

select throws_ok(
  $$ insert into public.course_applicability
       (course_id, department_id, academic_level_id, academic_period_id)
     select
       courses.id,
       departments.id,
       academic_levels.id,
       '70000000-0000-4000-8000-000000000004'
     from public.courses courses
     cross join public.departments departments
     cross join public.academic_levels academic_levels
     where courses.content_key = 'bua218'
       and departments.key = 'accounting'
       and academic_levels.key = '200-level' $$,
  '23503', null,
  'a nonexistent academic-period identity is rejected'
);

select lives_ok(
  $$ insert into public.course_applicability
       (course_id, department_id, academic_level_id, academic_period_id)
     select
       courses.id,
       departments.id,
       academic_levels.id,
       academic_periods.id
     from public.courses courses
     cross join public.departments departments
     cross join public.academic_levels academic_levels
     cross join public.academic_periods academic_periods
     where courses.content_key = 'bua218'
       and departments.key = 'accounting'
       and academic_levels.key = '100-level'
       and academic_periods.key = 'first-semester' $$,
  'one course can later use a different level and period in another department'
);

delete from public.course_applicability applicability
using public.courses courses,
      public.departments departments,
      public.academic_levels academic_levels,
      public.academic_periods academic_periods
where applicability.course_id = courses.id
  and applicability.department_id = departments.id
  and applicability.academic_level_id = academic_levels.id
  and applicability.academic_period_id = academic_periods.id
  and courses.content_key = 'bua218'
  and departments.key = 'accounting'
  and academic_levels.key = '100-level'
  and academic_periods.key = 'first-semester';

select throws_ok(
  $$ delete from public.courses where content_key = 'bua218' $$,
  '23503', null,
  'a mapped course identity cannot be deleted'
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
    'authenticated', 'public.course_applicability', 'SELECT'
  ),
  'authenticated students can read the platform course data'
);

select ok(
  not has_table_privilege('authenticated', 'public.courses', 'INSERT')
  and not has_table_privilege('authenticated', 'public.courses', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.courses', 'DELETE')
  and not has_table_privilege('authenticated', 'public.courses', 'TRUNCATE')
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
  'authenticated students have no mutation privilege on platform course data'
);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select is(
  (select count(*)::int from public.courses),
  15,
  'authenticated students can read all registry identities'
);

select is(
  (select count(*)::int from public.course_applicability),
  38,
  'authenticated students can read approved applicability'
);

select throws_ok(
  $$ update public.courses set is_free = true $$,
  '42501', null,
  'authenticated students cannot change course properties'
);

select throws_ok(
  $$ delete from public.course_applicability $$,
  '42501', null,
  'authenticated students cannot delete applicability'
);

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select count(*) from public.courses $$,
  '42501', null,
  'anonymous callers cannot read the course registry'
);

select throws_ok(
  $$ select count(*) from public.course_applicability $$,
  '42501', null,
  'anonymous callers cannot read course applicability'
);

reset role;

select * from finish();

rollback;
