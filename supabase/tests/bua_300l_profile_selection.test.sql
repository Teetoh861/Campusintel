-- A confirmed student saves real reference IDs; the same three filters used
-- by the student read model must return exactly the approved offering.
begin;
-- This suite isolates reference/ownership rules, with no running calendar. Running-semester admission
-- is covered by own_course_access_review.test.sql, including first picks, changes and rollover re-picks.
update private.academic_terms set resumes_on=resumes_on-interval '2 years';

select no_plan();

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000', '63000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'bua-300l@example.test', 'x', now(), '{}', '{}', now(), now()
);
insert into auth.sessions (id, user_id, created_at, updated_at) values (
  '63000000-0000-4000-8000-000000000002', '63000000-0000-4000-8000-000000000001', now(), now()
);

-- Invoker security keeps both the profile and catalogue reads under student RLS.
create temporary view selected_courses with (security_invoker = true) as
select c.* from public.profiles me
join public.course_applicability a on a.department_id = me.department_id
  and a.academic_level_id = me.academic_level_id and a.academic_period_id = me.academic_period_id
join public.institutional_courses c on c.id = a.institutional_course_id
where me.id = auth.uid();
grant select on selected_courses to authenticated;

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"63000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"63000000-0000-4000-8000-000000000002"}';
select set_config('test.bua_entitlement', public.get_my_entitlement()::text, true);

select lives_ok($sql$
  update public.profiles set
    department_id = (select id from public.departments where key = 'business-administration'),
    academic_level_id = (select id from public.academic_levels where key = '300-level'),
    academic_period_id = (select id from public.academic_periods where key = 'first-semester')
  where id = auth.uid()
$sql$, 'a live student can save BUA 300L First Semester');

select is((select count(*)::int from selected_courses), 8,
  'the saved BUA 300L First Semester profile selects exactly eight courses');
select is((select array_agg(course_code order by course_code) from selected_courses),
  array['BUA303', 'BUA305', 'BUA310', 'BUA313', 'BUA319', 'BUA321', 'BUA323', 'BUS254']::text[],
  'the student sees all approved courses without BUA302, BUA325, FBA311 or CIL318');
select is((select display_title from selected_courses where course_code = 'BUA303'), 'Management Theory',
  'the profile selects Management Theory under its distinct BUA303 identity');
select is((select count(*)::int from selected_courses where repository_course_id is not null), 0,
  'the new selection does not invent available content');

select lives_ok($sql$
  update public.profiles set academic_level_id = (select id from public.academic_levels where key = '200-level')
  where id = auth.uid()
$sql$, 'the student can switch to the existing BUA 200L selection');
select is((select array_agg(course_code order by course_code) from selected_courses),
  array['ACC-CM201', 'BUA201', 'BUA203', 'BUA205', 'ENT211', 'LAG-BUA210', 'LAG-BUA221']::text[],
  'BUA 200L First Semester retains its exact existing offering');
select is((select count(*)::int from selected_courses where repository_course_id is not null), 7,
  'all seven BUA 200L First Semester courses now link to existing study materials');

select lives_ok($sql$
  update public.profiles set academic_level_id = (select id from public.academic_levels where key = '100-level')
  where id = auth.uid()
$sql$, 'the student can switch to the existing BUA 100L selection');
select is((select array_agg(course_code order by course_code) from selected_courses),
  array['AMS101', 'AMS103', 'BUA101', 'ECO101', 'FIN101', 'GST102', 'GST111',
        'INS101', 'LAG-BUA111', 'LAG-BUA123', 'LAG-BUA125']::text[],
  'BUA 100L First Semester retains its exact existing offering, including free GST');
select is((select array_agg(course_code order by course_code) from selected_courses where is_free),
  array['GST102', 'GST111']::text[], 'existing GST courses remain free');

select lives_ok($sql$
  update public.profiles set
    academic_level_id = (select id from public.academic_levels where key = '300-level'),
    academic_period_id = (select id from public.academic_periods where key = 'second-semester')
  where id = auth.uid()
$sql$, 'the student can select BUA 300L Second Semester');
select is((select count(*)::int from selected_courses), 0,
  'the first-semester correction does not leak into an unconfirmed second-semester offering');

select lives_ok($sql$
  update public.profiles set
    department_id = (select id from public.departments where key = 'finance'),
    academic_period_id = (select id from public.academic_periods where key = 'first-semester')
  where id = auth.uid()
$sql$, 'the student can select another department at 300L');
select is((select count(*)::int from selected_courses), 0,
  'BUA 300L courses do not leak into another department');
select lives_ok($sql$
  update public.profiles set department_id = (select id from public.departments where key = 'accounting')
  where id = auth.uid()
$sql$, 'Accounting 300L remains selectable');
select is((select count(*)::int from selected_courses), 0, 'Accounting 300L has no invented course offering');
select is(public.get_my_entitlement(), current_setting('test.bua_entitlement')::jsonb,
  'changing academic selection preserves the student entitlement');

reset role;
select * from finish();
rollback;
