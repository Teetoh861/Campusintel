-- supabase/tests/home_practice_progress.test.sql — Home's practice summary (20261027100000_home_practice_progress.sql,
-- owner's sprint plan of 23 Oct, item 2): one service-role call per page, keyed by the session, with the student's own
-- open attempt, latest graded course, and per course the questions answered in graded attempts and the last score;
-- an open attempt adds nothing until graded; overdue attempts are graded first; legacy attempts and other students'
-- attempts never count.
begin;
select no_plan();

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('e1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('e2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.a(n integer) returns uuid language sql immutable
  as $$ select ('e3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(n text) returns uuid language sql immutable
  as $$ select ('40000000-0000-4000-8000-0000000000' || n)::uuid $$;
-- Practice calls as the application server makes them (the caller sets the service role). Five questions per attempt.
create function pg_temp.start(p_user integer, p_attempt integer, p_course text, p_seconds integer default 1800)
  returns jsonb language sql
  as $$ select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c(p_course), 'new', null, 5,
    p_seconds, '[]', 5, p_seconds) $$;
-- A sheet answering the first p_answered questions: p_right right answers then wrong ones; the rest are left
-- unanswered (fixture read as the owner).
create function pg_temp.sheet(p_attempt integer, p_right integer, p_answered integer) returns jsonb language sql stable
  security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(q.question_id::text, case when q.ordinal < p_right
      then (r.payload ->> 'correctOption')::integer
      else ((r.payload ->> 'correctOption')::integer + 1) % jsonb_array_length(r.payload -> 'options') end), '{}')
  from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = pg_temp.a(p_attempt) and q.ordinal < p_answered $$;
-- Submits 4 of the 5 questions answered, 3 of them right.
create function pg_temp.submit(p_user integer, p_attempt integer) returns jsonb language sql
  as $$ select public.practice_submit(pg_temp.s(p_user), pg_temp.a(p_attempt),
    'e4000000-0000-4000-8000-000000000001', 1, 0, pg_temp.sheet(p_attempt, 3, 4)) $$;
create function pg_temp.progress(p_user integer) returns jsonb language sql
  as $$ select public.practice_progress(pg_temp.s(p_user)) $$;
-- The per-course figures, without the clock: {"08": {"practised": 4, "score": 3, "total": 5}}.
create function pg_temp.figures(p_value jsonb) returns jsonb language sql immutable
  as $$ select coalesce(jsonb_object_agg(right(c ->> 'course_id', 2), c - 'course_id'), '{}')
    from jsonb_array_elements(p_value -> 'courses') c $$;
create function pg_temp.keys_anywhere(p_value jsonb) returns text[] language sql immutable as $$
  with recursive walk(v) as (select p_value union all
    select child from walk, lateral (
      select value from jsonb_each(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end)
      union all select value from jsonb_array_elements(case when jsonb_typeof(walk.v) = 'array' then walk.v else '[]' end)
    ) children(child))
  select coalesce(array_agg(distinct k order by k), '{}') from walk, lateral jsonb_object_keys(
    case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end) k $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable
  as $$ select result from outcome where step = p_step $$;

-- 1. Privileges ------------------------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.practice_progress(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.practice_progress(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.practice_progress(uuid)', 'EXECUTE'),
  'the summary is callable only by the application server, never by a student directly');
select is(pg_get_function_arguments('public.practice_progress(uuid)'::regprocedure), 'p_session_id uuid',
  'it takes the session and nothing else: no student, course or time from the caller');

-- 2. Fixtures: students 1 and 2 with full plans and live sessions -------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
  'home-progress-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array[1, 2]) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.s(n), pg_temp.u(n), now(), now() from unnest(array[1, 2]) n;
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
select pg_temp.u(n), 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test'
from unnest(array[1, 2]) n;

-- 3. Day one, then one open attempt ------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('day-one', pg_temp.progress(1));
insert into outcome values ('unknown-session', public.practice_progress('e2000000-0000-4000-8000-000000000099'));
insert into outcome values ('start-1', pg_temp.start(1, 1, '08'));
insert into outcome values ('open', pg_temp.progress(1));
reset role;
select is(pg_temp.o('day-one') - 'now', '{"state":"ok","open":null,"latest":null,"courses":[]}'::jsonb,
  'day one: nothing open, nothing graded, no figures');
select is(pg_temp.o('unknown-session'), '{"state":"signed-out"}'::jsonb, 'a session that is not live gets nothing');
select is(pg_temp.o('start-1') ->> 'state', 'ready', 'fixture: the first attempt started');
select is((pg_temp.o('open') -> 'open') - 'deadline_at',
  jsonb_build_object('course_id', pg_temp.c('08'), 'content_key', (select content_key from public.courses
    where id = pg_temp.c('08'))), 'an open attempt is offered with its course and route key');
select is((pg_temp.o('open') -> 'open' ->> 'deadline_at')::timestamptz,
  (select deadline_at from public.quiz_attempts where id = pg_temp.a(1)), 'and its own deadline');
select is(pg_temp.o('open') -> 'latest', 'null'::jsonb, 'nothing graded yet');
select is(pg_temp.figures(pg_temp.o('open')), '{}'::jsonb,
  'an open attempt adds no figures until it is graded');

-- 4. Graded, then a second attempt in the same course and an open one in another --------------------------------------
set local role service_role;
insert into outcome values ('submit-1', pg_temp.submit(1, 1));
insert into outcome values ('graded', pg_temp.progress(1));
insert into outcome values ('start-2', pg_temp.start(1, 2, '08'));
insert into outcome values ('start-3', pg_temp.start(1, 3, '07', 600));
insert into outcome values ('two-open', pg_temp.progress(1));
reset role;
select is(pg_temp.o('submit-1') -> 'attempt' -> 'result' ->> 'score', '3', 'fixture: graded 3 of 5');
select is(jsonb_build_object('open', pg_temp.o('graded') -> 'open', 'latest', pg_temp.o('graded') -> 'latest' -> 'course_id'),
  jsonb_build_object('open', null, 'latest', pg_temp.c('08')), 'once graded: nothing open, and the course to continue');
select is(pg_temp.figures(pg_temp.o('graded')), '{"08":{"practised":4,"score":3,"total":5}}'::jsonb,
  'the last score is the graded one; only the 4 questions answered count as practised, not the one left blank');
select is(pg_temp.o('two-open') -> 'open' ->> 'course_id', pg_temp.c('07')::text,
  'with two open attempts, the one closest to its deadline comes first');
select is(pg_temp.figures(pg_temp.o('two-open')), '{"08":{"practised":4,"score":3,"total":5}}'::jsonb,
  'questions of the open attempts (a second one in 08, a first one in 07) are not counted until graded');

-- 5. An attempt whose time is up is graded before it is shown ----------------------------------------------------------
update public.quiz_attempts set created_at = created_at - interval '1 hour', deadline_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.a(3);
set local role service_role;
insert into outcome values ('overdue', pg_temp.progress(1));
reset role;
select is(pg_temp.o('overdue') -> 'open' ->> 'course_id', pg_temp.c('08')::text,
  'an overdue attempt is never offered to resume; the next open one is');
select is((select status from public.quiz_attempts where id = pg_temp.a(3)), 'timed_out', 'it was graded first');
select is(pg_temp.figures(pg_temp.o('overdue')),
  '{"07":{"practised":0,"score":0,"total":5},"08":{"practised":4,"score":3,"total":5}}'::jsonb,
  'once graded it counts, with its graded score and nothing practised (no answer was saved); several courses keep their own figures');

-- 6. Legacy attempts never count ---------------------------------------------------------------------------------------
insert into public.quiz_attempts (id, user_id, course_id, question_count, created_at, status, finished_at) values
  (pg_temp.a(9), pg_temp.u(1), pg_temp.c('01'), 1, now() - interval '3 days', 'submitted', now() - interval '3 days');
insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
select pg_temp.a(9), pool.question_id, 0, pool.item_id, pool.revision from private.practice_pool(pg_temp.c('01')) pool limit 1;
set local role service_role;
insert into outcome values ('legacy', pg_temp.progress(1));
reset role;
select ok(not (pg_temp.figures(pg_temp.o('legacy')) ? '01'), 'a legacy browser-run attempt adds no figures');

-- 7. Two accounts never see each other's progress ----------------------------------------------------------------------
set local role service_role;
insert into outcome values ('other-day-one', pg_temp.progress(2));
insert into outcome values ('other-start', pg_temp.start(2, 20, '08'));
insert into outcome values ('other-open', pg_temp.progress(2));
insert into outcome values ('first-again', pg_temp.progress(1));
reset role;
select is(pg_temp.o('other-day-one') - 'now', '{"state":"ok","open":null,"latest":null,"courses":[]}'::jsonb,
  'another student sees day one, not the first student''s attempts');
select is(jsonb_build_object('open', pg_temp.o('other-open') -> 'open' ->> 'course_id',
    'figures', pg_temp.figures(pg_temp.o('other-open'))),
  jsonb_build_object('open', pg_temp.c('08'), 'figures', '{}'::jsonb),
  'and then only their own open attempt in the same course, with no figures until it is graded');
select is(pg_temp.figures(pg_temp.o('first-again')) -> '08', '{"practised":4,"score":3,"total":5}'::jsonb,
  'the first student''s figures are unchanged by the second student''s attempt');

-- 8. Counts and identities only ---------------------------------------------------------------------------------------
select is(pg_temp.keys_anywhere(pg_temp.o('first-again')),
  array['content_key', 'course_id', 'courses', 'deadline_at', 'latest', 'now', 'open', 'practised', 'score', 'state',
    'total'], 'no question, option, answer or key leaves the database');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e2000000-0000-4000-8000-000000000001"}';
select throws_ok($$ select public.practice_progress('e2000000-0000-4000-8000-000000000001') $$, '42501', null,
  'a student cannot call it directly, even with their own session');
reset role;

select * from finish();
rollback;
