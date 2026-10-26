-- supabase/tests/academic_calendar.test.sql — The semester calendar behind the course lock
-- (20261026100000_course_selection_lock.sql): four months from the resumption date the team enters, moves only before
-- resumption, extensions per department or for all, no change once a semester has ended, ends always in order, and
-- the lock following each department's own end. Every date here is relative to today; none depends on the seeded
-- default.
begin;
select no_plan();

delete from private.academic_term_extensions;
delete from private.academic_terms;
delete from private.course_selection_events;
create temporary table cal on commit drop as select (now() at time zone 'Africa/Lagos')::date as today;
grant select on cal to authenticated, service_role;
create function pg_temp.term(p_session text, p_period text) returns private.academic_terms language sql as
  $$ select t.* from private.academic_terms t join public.academic_periods p on p.id = t.academic_period_id
     where t.session_label = p_session and p.key = p_period $$;
create function pg_temp.end_for(p_department text, p_session text, p_period text) returns date language sql as
  $$ select e.last_day from private.academic_term_ends((select id from public.departments where key = p_department)) e
     where e.term_id = (pg_temp.term(p_session, p_period)).id $$;

-- Four months, exactly ----------------------------------------------------------------------------------------------
insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by) values
  ('2040/2041', '30000000-0000-4000-8000-000000000001', '2040-11-09', 'test', 'test'),
  ('2041/2042', '30000000-0000-4000-8000-000000000001', '2041-10-31', 'test', 'test');
select is((pg_temp.term('2040/2041', 'first-semester')).last_day, date '2041-03-08',
  'resuming on 9 November, the last day is 8 March and the semester ends at 00:00 Lagos on 9 March');
select is(private.academic_day_end(date '2041-03-08'), timestamptz '2041-03-09 00:00:00+01', 'the end is Lagos midnight');
select is((pg_temp.term('2041/2042', 'first-semester')).last_day, date '2042-02-27',
  'month ends clamp: resuming on 31 October, the semester ends with 28 February');
select throws_ok($$update private.academic_terms set last_day = '2041-04-01' where session_label = '2040/2041'$$,
  '428C9', null, 'the last day cannot be set by hand');
select throws_ok($$insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  values ('2040/2042', '30000000-0000-4000-8000-000000000002', '2042-04-01', 'test', 'test')$$, '23514', null,
  'a session spans two consecutive years');
select throws_ok($$insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  values ('2040/2041', '30000000-0000-4000-8000-000000000001', '2043-01-01', 'test', 'test')$$, '23505', null,
  'one row per session and semester');
delete from private.academic_terms;

-- Setting and moving a semester -------------------------------------------------------------------------------------
set local role service_role;
select throws_ok($$select public.admin_set_academic_term('2030/2031', 'first-semester', current_date + 400, 'Ops', '')$$,
  '22023', null, 'a reason is required');
select throws_ok($$select public.admin_set_academic_term('2030/2031', 'third-semester', current_date + 400, 'Ops', 'calendar')$$,
  '22023', null, 'an unknown semester is refused');
select throws_ok($$select public.admin_set_academic_term('2030-2031', 'first-semester', current_date + 400, 'Ops', 'calendar')$$,
  '22023', null, 'a malformed session is refused');
select is(public.admin_set_academic_term('2030/2031', 'first-semester', (select today - 1 from cal), 'Ops', 'calendar')->>'state',
  'past-date', 'a semester cannot be entered with a past resumption date');
select is(public.admin_set_academic_term('2030/2031', 'first-semester', (select today + 20 from cal), 'Ops',
  'university calendar published')->>'state', 'created', 'the team enters a resumption date');
select is(public.admin_set_academic_term('2030/2031', 'first-semester', (select today + 20 from cal), 'Ops',
  'university calendar published')->>'state', 'unchanged', 'entering it again changes nothing');
select is(public.admin_set_academic_term('2030/2031', 'first-semester', (select today + 27 from cal), 'Ops',
  'resumption moved by a week')->>'state', 'moved', 'and moves it before the semester resumes');
reset role;
select is((pg_temp.term('2030/2031', 'first-semester')).last_day,
  (select (today + 27 + interval '4 months' - interval '1 day')::date from cal), 'the end moves with it');
select is((select jsonb_agg(event || ' ' || actor order by id) from private.course_selection_events where event like 'calendar.%'),
  '["calendar.term-created operator:Ops", "calendar.term-moved operator:Ops"]'::jsonb, 'both are recorded');
-- Overlapping semesters are refused, and nothing is written.
set local role service_role;
select throws_ok($$select public.admin_set_academic_term('2030/2031', 'second-semester', (select today + 60 from cal), 'Ops',
  'typo')$$, '22023', 'Semester dates refused: overlapping-semesters', 'a semester cannot start before the previous one ends');
reset role;
select is((select count(*)::integer from private.academic_terms), 1, 'the refused semester was not kept');
-- Once resumed, a semester cannot be moved.
update private.academic_terms set resumes_on = (select today - 30 from cal);
set local role service_role;
select is(public.admin_set_academic_term('2030/2031', 'first-semester', (select today + 5 from cal), 'Ops',
  'too late')->>'state', 'resumed', 'a semester that has resumed keeps its date');
reset role;

-- Extensions --------------------------------------------------------------------------------------------------------
-- The current semester resumed 30 days ago; the previous one ended long ago.
insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  select '2029/2030', '30000000-0000-4000-8000-000000000002', today - 300, 'test', 'test' from cal;
create temporary table base on commit drop as select (pg_temp.term('2030/2031', 'first-semester')).last_day as last_day;
grant select on base to authenticated, service_role;
set local role service_role;
select throws_ok($$select public.admin_set_department_end('2030/2031', 'first-semester', 'nowhere',
  (select last_day + 7 from base), 'Ops', 'exam delay')$$, '22023', null, 'an unknown department is refused');
select is(public.admin_set_department_end('2030/2031', 'first-semester', 'accounting', (select last_day - 1 from base),
  'Ops', 'exam delay')->>'state', 'before-last-day', 'an extension cannot shorten the semester');
select is(public.admin_set_department_end('2030/2031', 'first-semester', 'accounting', (select last_day + 14 from base),
  'Ops', 'accounting exams moved')->>'state', 'changed', 'one department is extended');
reset role;
select is(pg_temp.end_for('accounting', '2030/2031', 'first-semester'), (select last_day + 14 from base),
  'that department ends later');
select is(pg_temp.end_for('finance', '2030/2031', 'first-semester'), (select last_day from base),
  'another keeps the semester''s own end');
set local role service_role;
select is(public.admin_set_department_end('2030/2031', 'first-semester', 'all', (select last_day + 21 from base), 'Ops',
  'strike')->>'departments', '8', 'all departments are extended at once (D8)');
reset role;
select is((select count(distinct e.last_day)::integer from public.departments d
    cross join lateral private.academic_term_ends(d.id) e where e.term_id = (pg_temp.term('2030/2031', 'first-semester')).id),
  1, 'every department shares the new end');
select is((select last_day from private.academic_term_extensions e join public.departments d on d.id = e.department_id
  where d.key = 'accounting'), (select last_day + 21 from base), 'including the one extended before');
set local role service_role;
select is(public.admin_set_department_end('2030/2031', 'first-semester', 'finance', (select last_day from base), 'Ops',
  'strike over for finance')->>'state', 'changed', 'setting the semester''s own last day again');
reset role;
select ok(not exists (select 1 from private.academic_term_extensions e join public.departments d on d.id = e.department_id
  where d.key = 'finance'), 'removes that department''s extension');
select is((select count(*)::integer from private.course_selection_events where event = 'calendar.department-end-set'), 10,
  'every department change is recorded');
-- The next semester's end bounds an extension.
insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  select '2030/2031', '30000000-0000-4000-8000-000000000002', last_day + 30, 'test', 'test' from base;
set local role service_role;
select throws_ok($$select public.admin_set_department_end('2030/2031', 'first-semester', 'taxation',
  (select (last_day + 30 + interval '4 months')::date from base), 'Ops', 'typo')$$, '22023',
  'Semester dates refused: ends-out-of-order', 'an extension cannot end after the next semester');
-- D11: an ended semester is never extended.
select is(public.admin_set_department_end('2029/2030', 'second-semester', 'accounting', (select today + 10 from cal), 'Ops',
  'late request')->>'state', 'ended', 'a semester that has ended cannot be extended');
select is(public.admin_set_department_end('2031/2032', 'first-semester', 'accounting', (select today + 10 from cal), 'Ops',
  'typo')->>'state', 'not-found', 'an unknown semester is reported');
reset role;
-- 'all' is refused as a whole when one department has already reached its end.
update private.academic_term_extensions set last_day = (select today - 1 from cal)
  where department_id = (select id from public.departments where key = 'ehrm');
set local role service_role;
select is(public.admin_set_department_end('2030/2031', 'first-semester', 'all', (select last_day + 28 from base), 'Ops',
  'strike')->>'state', 'ended', 'an extension for all is refused if any department has ended');
reset role;
select is((select count(*)::integer from private.academic_term_extensions where last_day = (select last_day + 28 from base)),
  0, 'and changes nothing');
delete from private.academic_term_extensions where department_id = (select id from public.departments where key = 'ehrm');

-- The lock follows each department's end ----------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'cal-acc@example.test', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c4000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'cal-fin@example.test', now(), now(), now());
update public.profiles set department_id = d.id, academic_level_id = '20000000-0000-4000-8000-000000000002',
    academic_period_id = '30000000-0000-4000-8000-000000000001'
  from public.departments d
  where (profiles.id, d.key) in (('c4000000-0000-4000-8000-000000000001'::uuid, 'accounting'),
    ('c4000000-0000-4000-8000-000000000002'::uuid, 'finance'));
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  select id, 'paid', now(), now() + interval '1 year', 'none', 'test' from auth.users
  where id in ('c4000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000002');
select is(private.course_selection_state('c4000000-0000-4000-8000-000000000002',
    private.academic_day_end((select last_day from base)))->>'state', 'reselect',
  'finance is released at the semester''s own end');
select is(private.course_selection_state('c4000000-0000-4000-8000-000000000001',
    private.academic_day_end((select last_day from base)))->>'state', 'locked', 'accounting is still locked then');
select is(private.course_selection_state('c4000000-0000-4000-8000-000000000001',
    private.academic_day_end((select last_day + 21 from base)) - interval '1 microsecond')->>'state', 'locked',
  'until the last instant of its extended semester');
select is(private.course_selection_state('c4000000-0000-4000-8000-000000000001',
    private.academic_day_end((select last_day + 21 from base)))->>'state', 'reselect', 'and released exactly at its end');
select is(private.course_selection_state('c4000000-0000-4000-8000-000000000001')->>'last_day',
  (select (last_day + 21)::text from base), 'the student''s last day is their department''s');

-- The operator view ---------------------------------------------------------------------------------------------------
set local role service_role;
select is(jsonb_array_length(public.admin_academic_calendar()->'terms'), 3, 'the calendar lists every semester');
select is((select t->'extensions'->0->>'department' from jsonb_array_elements(public.admin_academic_calendar()->'terms') t
  where t->>'session' = '2030/2031' and t->>'semester' = 'first-semester'), 'accounting', 'with its extensions');
reset role;
set local role authenticated;
select throws_ok($$select public.admin_academic_calendar()$$, '42501', null, 'students cannot read the calendar');
reset role;

select * from finish();
rollback;
