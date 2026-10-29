-- supabase/tests/instant_feedback_practice.test.sql — Instant feedback practice
-- (20261029120000_instant_feedback_practice.sql; topics since 20261029150000_practice_by_topic.sql, whose own rules are in
-- practice_by_topic.test.sql): an instant attempt starts through practice_start, records and locks
-- each pick, and reveals a question's correct option and explanation only once it is picked; the same pick replays,
-- a different one is refused with the original; it closes at its last pick or its deadline by counting its picks, so
-- the sweep never fails on them; exam attempts keep their rules; home counts picks straight away.
-- Time is simulated by moving attempt timestamps (the practice functions decide on clock_timestamp()).
begin;
select no_plan();

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('f1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('f2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.a(n integer) returns uuid language sql immutable
  as $$ select ('f3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(n text) returns uuid language sql immutable
  as $$ select ('40000000-0000-4000-8000-0000000000' || n)::uuid $$;
-- Calls as the application server makes them (the caller sets the service role). Instant: 10 questions, 3 hours, on one
-- topic: course 08's "Listening Skills" (20 questions) or course 09's "Islam and Political Culture" (9).
create function pg_temp.istart(p_user integer, p_attempt integer, p_course text default '08') returns jsonb
  language sql as $$ select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c(p_course), 'new',
    null, 10, 10800, '[]', null, null, null, 'instant',
    case p_course when '08' then 'Listening Skills' when '09' then 'Islam and Political Culture' end) $$;
create function pg_temp.estart(p_user integer, p_attempt integer, p_course text default '08') returns jsonb
  language sql as $$ select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c(p_course), 'new',
    null, 5, 1800, '[]', 5, 1800, false) $$;
-- Fixture reads as the owner: the pinned question at an ordinal and a right or wrong option for it.
create function pg_temp.q(p_attempt integer, p_ordinal integer) returns uuid language sql stable security definer
  set search_path = '' as $$ select question_id from public.quiz_attempt_questions
    where attempt_id = pg_temp.a(p_attempt) and ordinal = p_ordinal $$;
create function pg_temp.opt(p_attempt integer, p_ordinal integer, p_right boolean) returns integer language sql stable
  security definer set search_path = '' as $$
  select case when p_right then (r.payload ->> 'correctOption')::integer
      else ((r.payload ->> 'correctOption')::integer + 1) % jsonb_array_length(r.payload -> 'options') end
  from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = pg_temp.a(p_attempt) and q.ordinal = p_ordinal $$;
create function pg_temp.payload(p_attempt integer, p_ordinal integer) returns jsonb language sql stable
  security definer set search_path = '' as $$
  select r.payload from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = pg_temp.a(p_attempt) and q.ordinal = p_ordinal $$;
create function pg_temp.pick(p_user integer, p_attempt integer, p_ordinal integer, p_right boolean) returns jsonb
  language sql as $$ select public.practice_pick(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.q(p_attempt, p_ordinal),
    pg_temp.opt(p_attempt, p_ordinal, p_right)) $$;
create function pg_temp.row_of(p_attempt integer) returns public.quiz_attempts language sql stable security definer
  set search_path = '' as $$ select * from public.quiz_attempts where id = pg_temp.a(p_attempt) $$;
create function pg_temp.answers(p_attempt integer) returns integer language sql stable security definer
  set search_path = '' as $$ select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(p_attempt) $$;
create function pg_temp.all_keys(p_value jsonb) returns text[] language sql immutable as $$
  with recursive walk(v) as (select p_value union all
    select child from walk, lateral (
      select value from jsonb_each(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end)
      union all select value from jsonb_array_elements(case when jsonb_typeof(walk.v) = 'array' then walk.v else '[]' end)
    ) children(child))
  select coalesce(array_agg(distinct k order by k), '{}') from walk, lateral jsonb_object_keys(
    case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end) k $$;
-- Key and explanation fields no unpicked question may carry.
create function pg_temp.leaks(p_value jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from unnest(pg_temp.all_keys(p_value)) k
  where k in ('correct_option', 'correctOption', 'explanation', 'is_correct', 'item_id', 'selected', 'score') $$;
-- The open view's questions other than those at the listed ordinals.
create function pg_temp.unpicked(p_view jsonb, p_picked integer[]) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(e.value), '[]') from jsonb_array_elements(p_view -> 'attempt' -> 'questions')
    with ordinality e(value, n) where not (n - 1 = any(p_picked)) $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable
  as $$ select result from outcome where step = p_step $$;

-- 1. Structure and privileges ----------------------------------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.practice_pick(uuid,uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.practice_pick(uuid,uuid,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.practice_pick(uuid,uuid,uuid,integer)', 'EXECUTE'),
  'a pick reaches the database only through the application server (service role)');
select is((select count(*)::integer from unnest(array['private.practice_explanation(jsonb)',
    'private.practice_instant_questions(uuid)', 'private.practice_finish_instant(uuid,text,timestamptz)',
    'private.practice_pick_answer(text,public.quiz_attempts,public.quiz_attempt_answers,jsonb)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'instant helpers are callable by no API role');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'practice_start'), 1, 'one practice start, now with a mode');
select is((select count(*)::integer from public.quiz_attempts where deadline_at is not null and mode is distinct from 'exam'
    and created_at < now()), 0, 'every server-run attempt from before this migration is an exam');
select is((select count(*)::integer from public.quiz_attempts where deadline_at is null and mode is not null), 0,
  'legacy browser-run attempts have no mode');
select is(jsonb_build_array(private.practice_explanation('{"explanation":"Because."}'),
    private.practice_explanation('{"explanation":"  "}'), private.practice_explanation('{}'),
    private.practice_explanation('{"explanation":null}')),
  '["Because.", null, null, null]'::jsonb, 'an explanation is its text, or null when the question has none');

-- 2. Fixtures: 1 and 2 students with plans; course 08 (use-of-english, 100) and 09 (nigerian-peoples-and-culture) are free.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
  'instant-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array[1, 2, 3]) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.s(n), pg_temp.u(n), now(), now() from unnest(array[1, 2, 3]) n;

-- 3. Starting -------------------------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('start', pg_temp.istart(1, 1));
insert into outcome values ('replay', pg_temp.istart(1, 1));
insert into outcome values ('replay-as-exam', public.practice_start(pg_temp.s(1), pg_temp.a(1), pg_temp.c('08'), 'new',
  null, 5, 1800, '[]', 5, 1800, false));
insert into outcome values ('exam-while-open', pg_temp.estart(1, 2));
insert into outcome values ('instant-elsewhere', pg_temp.istart(1, 3, '09'));
reset role;
select is(pg_temp.o('start') ->> 'state', 'ready', 'an instant attempt starts');
select is(jsonb_build_object('mode', pg_temp.o('start') -> 'attempt' ->> 'mode',
    'count', (pg_temp.o('start') -> 'attempt' ->> 'question_count')::integer,
    'questions', jsonb_array_length(pg_temp.o('start') -> 'attempt' -> 'questions'),
    'seconds', (pg_temp.row_of(1)).duration_seconds),
  '{"mode":"instant","count":10,"questions":10,"seconds":10800}'::jsonb,
  'ten questions from the topic, closed by the server after three hours');
select is(pg_temp.leaks(pg_temp.o('start')), '{}'::text[],
  'no correct option, explanation or mark reaches the browser before a pick');
select is(pg_temp.o('replay') -> 'attempt' ->> 'id', pg_temp.a(1)::text, 'a replayed start returns the same attempt');
select is((select count(*)::integer from public.quiz_attempts where user_id = pg_temp.u(1) and course_id = pg_temp.c('08')),
  1, 'and starts nothing more');
select is(pg_temp.o('replay-as-exam'), '{"state":"conflict"}'::jsonb, 'the same attempt id in another mode is a conflict');
select is(jsonb_build_object('state', pg_temp.o('exam-while-open') ->> 'state',
    'id', pg_temp.o('exam-while-open') -> 'attempt' ->> 'id'),
  jsonb_build_object('state', 'in-progress', 'id', pg_temp.a(1)), 'one open attempt per course across both modes');
select is(pg_temp.o('instant-elsewhere') ->> 'state', 'ready', 'another course may have its own open attempt');
set local role service_role;
select throws_ok($$ select public.practice_start(pg_temp.s(1), pg_temp.a(9), pg_temp.c('07'), 'new', null, 10, 10800,
  '[]', 10, 10800, false, 'instant', 'Bookkeeping & Errors') $$, '22023', null, 'an instant start carries no brief');
select throws_ok($$ select public.practice_start(pg_temp.s(1), pg_temp.a(9), pg_temp.c('07'), 'redo', pg_temp.a(1), 10,
  10800, '[]', null, null, null, 'instant', 'Bookkeeping & Errors') $$, '22023', null, 'and is never a redo');
select throws_ok($$ select public.practice_start(pg_temp.s(1), pg_temp.a(9), pg_temp.c('07'), 'new', null, 10, 10800,
  '[]', null, null, null, 'topic') $$, '22023', null, 'an unknown mode is refused');
select throws_ok($$ select public.practice_start(pg_temp.s(1), pg_temp.a(9), pg_temp.c('07'), 'new', null, 5, 1800,
  '[]', null, null, null) $$, '22023', null, 'an exam start still needs its brief');
reset role;
-- Access is practice_can_start's, unchanged: a free-tier student cannot start a plan course in either mode.
set local role service_role;
insert into outcome values ('locked', public.practice_start(pg_temp.s(3), pg_temp.a(30), pg_temp.c('07'), 'new', null,
  10, 10800, '[]', null, null, null, 'instant', 'Bookkeeping & Errors'));
reset role;
select is(pg_temp.o('locked'), '{"state":"locked"}'::jsonb, 'starting needs course access, as for an exam');

-- 4. Picking ---------------------------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('right', pg_temp.pick(1, 1, 0, true));
insert into outcome values ('right-again', pg_temp.pick(1, 1, 0, true));
insert into outcome values ('right-changed', pg_temp.pick(1, 1, 0, false));
insert into outcome values ('wrong', pg_temp.pick(1, 1, 1, false));
insert into outcome values ('reload', public.practice_attempt(pg_temp.s(1), pg_temp.a(1)));
insert into outcome values ('state', public.practice_state(pg_temp.s(1), pg_temp.c('08')));
insert into outcome values ('progress-open', public.practice_progress(pg_temp.s(1)));
reset role;
select is(jsonb_build_object('state', pg_temp.o('right') ->> 'state', 'correct', pg_temp.o('right') -> 'pick' -> 'is_correct',
    'selected', pg_temp.o('right') -> 'pick' -> 'selected', 'answer', pg_temp.o('right') -> 'pick' -> 'correct_option'),
  jsonb_build_object('state', 'picked', 'correct', true, 'selected', pg_temp.opt(1, 0, true),
    'answer', pg_temp.opt(1, 0, true)), 'a right pick is marked right, with its correct option');
select is(pg_temp.o('right') -> 'pick' -> 'explanation', private.practice_explanation(pg_temp.payload(1, 0)),
  'and the question''s own explanation, or null');
select is(pg_temp.o('right-again') - 'now', pg_temp.o('right') - 'now',
  'the same pick again (double tap, second tab, lost response) returns the same result');
select is(jsonb_build_object('state', pg_temp.o('right-changed') ->> 'state',
    'pick', pg_temp.o('right-changed') -> 'pick'),
  jsonb_build_object('state', 'answer-locked', 'pick', pg_temp.o('right') -> 'pick'),
  'a different pick after the lock is refused and returns the original');
select is((select jsonb_build_object('option', option_index, 'correct', is_correct) from public.quiz_attempt_answers
    where attempt_id = pg_temp.a(1) and question_id = pg_temp.q(1, 0)),
  jsonb_build_object('option', pg_temp.opt(1, 0, true), 'correct', true), 'the stored answer is the first pick');
select is(jsonb_build_object('correct', pg_temp.o('wrong') -> 'pick' -> 'is_correct',
    'selected', pg_temp.o('wrong') -> 'pick' -> 'selected', 'answer', pg_temp.o('wrong') -> 'pick' -> 'correct_option'),
  jsonb_build_object('correct', false, 'selected', pg_temp.opt(1, 1, false), 'answer', pg_temp.opt(1, 1, true)),
  'a wrong pick is marked wrong, with the right option');
select is(pg_temp.leaks(pg_temp.unpicked(pg_temp.o('wrong'), array[0, 1])), '{}'::text[],
  'questions not yet picked still carry no correct option or explanation');
select is(pg_temp.leaks(pg_temp.unpicked(pg_temp.o('reload'), array[0, 1])), '{}'::text[],
  'nor after a reload');
select is((select jsonb_agg(jsonb_build_object('selected', e -> 'selected', 'answer', e -> 'correct_option'))
    from jsonb_array_elements(pg_temp.o('reload') -> 'attempt' -> 'questions') with ordinality x(e, n) where n <= 2),
  jsonb_build_array(jsonb_build_object('selected', pg_temp.opt(1, 0, true), 'answer', pg_temp.opt(1, 0, true)),
    jsonb_build_object('selected', pg_temp.opt(1, 1, false), 'answer', pg_temp.opt(1, 1, true))),
  'a reload shows each picked question with its pick and correct option');
select is(jsonb_build_object('state', pg_temp.o('state') ->> 'state', 'mode', pg_temp.o('state') -> 'attempt' ->> 'mode',
    'answered', pg_temp.o('state') -> 'attempt' -> 'answered'),
  '{"state":"open","mode":"instant","answered":2}'::jsonb, 'the practice page sees the open instant attempt and its picks');
select is((select c from jsonb_array_elements(pg_temp.o('progress-open') -> 'courses') c
    where c ->> 'course_id' = pg_temp.c('08')::text) - 'course_id',
  '{"practised":2,"score":null,"total":null}'::jsonb, 'home counts picks as practised straight away; no score yet');
select is(pg_temp.o('progress-open') -> 'open' ->> 'mode', 'instant', 'home knows the open attempt is instant');
select is((pg_temp.row_of(1)).saved_revision, 2, 'each recorded pick, and only those, moves the sheet on');
set local role service_role;
select throws_ok($$ select public.practice_pick(pg_temp.s(1), pg_temp.a(1), pg_temp.q(3, 0), 0) $$, '22023', null,
  'a question outside the attempt is refused');
select throws_ok(format($$ select public.practice_pick(pg_temp.s(1), pg_temp.a(1), pg_temp.q(1, 2), %s) $$,
  jsonb_array_length(pg_temp.payload(1, 2) -> 'options')), '22023', null, 'an option the question does not have is refused');
select throws_ok($$ select public.practice_save(pg_temp.s(1), pg_temp.a(1), 'f4000000-0000-4000-8000-000000000001', 1, 0,
  jsonb_build_object(pg_temp.q(1, 2)::text, 0)) $$, '22023', null, 'an exam save cannot write an instant attempt');
select throws_ok($$ select public.practice_submit(pg_temp.s(1), pg_temp.a(1), 'f4000000-0000-4000-8000-000000000001', 1, 0,
  '{}') $$, '22023', null, 'nor can an exam submission end one');
reset role;
set local role service_role;
insert into outcome values ('other-student', public.practice_pick(pg_temp.s(2), pg_temp.a(1), pg_temp.q(1, 2), 0));
insert into outcome values ('signed-out', public.practice_pick('f2000000-0000-4000-8000-000000000099', pg_temp.a(1),
  pg_temp.q(1, 2), 0));
reset role;
select is(pg_temp.o('other-student'), '{"state":"not-found"}'::jsonb, 'another student''s attempt is not found');
select is(pg_temp.o('signed-out'), '{"state":"signed-out"}'::jsonb, 'a session that is not live records nothing');
select is(pg_temp.answers(1), 2, 'neither recorded a pick');

-- 5. Finishing at the last pick ----------------------------------------------------------------------------------------
-- Picks 2..9: right on even ordinals, wrong on odd. With 0 right and 1 wrong: 5 right of 10.
set local role service_role;
select pg_temp.pick(1, 1, n, n % 2 = 0) from generate_series(2, 8) n;
insert into outcome values ('last', pg_temp.pick(1, 1, 9, false));
insert into outcome values ('after-end', pg_temp.pick(1, 1, 9, true));
insert into outcome values ('progress-done', public.practice_progress(pg_temp.s(1)));
insert into outcome values ('practise-again', pg_temp.istart(1, 4));
reset role;
select is(jsonb_build_object('state', pg_temp.o('last') ->> 'state', 'status', pg_temp.o('last') -> 'attempt' ->> 'status',
    'result', (pg_temp.o('last') -> 'attempt' -> 'result') - 'finished_at'),
  '{"state":"picked","status":"submitted","result":{"score":5,"total":10,"timed_out":false}}'::jsonb,
  'the last pick closes the attempt with the marks the picks earned');
select is((select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(1) and is_correct), 5,
  'the score is exactly the right picks recorded');
select is(jsonb_build_object('state', pg_temp.o('after-end') ->> 'state', 'pick', pg_temp.o('after-end') -> 'pick'),
  jsonb_build_object('state', 'answer-locked', 'pick', pg_temp.o('last') -> 'pick'),
  'a changed pick after the end still returns the original');
select is((select c from jsonb_array_elements(pg_temp.o('progress-done') -> 'courses') c
    where c ->> 'course_id' = pg_temp.c('08')::text) - 'course_id',
  '{"practised":10,"score":5,"total":10}'::jsonb, 'home shows the last score, correct out of answered');
select is(jsonb_build_object('state', pg_temp.o('practise-again') ->> 'state',
    'mode', pg_temp.o('practise-again') -> 'attempt' ->> 'mode',
    'repeats', (select count(*)::integer from public.quiz_attempt_questions q where q.attempt_id = pg_temp.a(4)
      and q.question_id in (select question_id from public.quiz_attempt_questions where attempt_id = pg_temp.a(1)))),
  '{"state":"ready","mode":"instant","repeats":0}'::jsonb, 'Practise again starts a new attempt of unseen questions first');

-- 6. A pick after the attempt ends, and the deadline -----------------------------------------------------------------
-- Attempt 4: three picks (2 right), then its three hours pass.
set local role service_role;
select pg_temp.pick(1, 4, n, n < 2) from generate_series(0, 2) n;
reset role;
update public.quiz_attempts set created_at = clock_timestamp() - interval '4 hours',
  deadline_at = clock_timestamp() - interval '1 hour' where id = pg_temp.a(4);
-- Attempt 1 finished before attempt 4's deadline, so attempt 4 is the latest finished once it closes.
update public.quiz_attempts set created_at = clock_timestamp() - interval '8 hours',
  deadline_at = clock_timestamp() - interval '5 hours', finished_at = clock_timestamp() - interval '6 hours'
  where id = pg_temp.a(1);
set local role service_role;
insert into outcome values ('late-pick', pg_temp.pick(1, 4, 3, true));
reset role;
select is(jsonb_build_object('state', pg_temp.o('late-pick') ->> 'state',
    'status', pg_temp.o('late-pick') -> 'attempt' ->> 'status', 'score', pg_temp.o('late-pick') -> 'attempt' -> 'result' -> 'score'),
  '{"state":"graded","status":"timed_out","score":2}'::jsonb,
  'a pick after the deadline is refused: the attempt closes with the picks made in time');
select is(pg_temp.answers(4), 3, 'and the late pick is not recorded');
select is(pg_temp.leaks(pg_temp.o('late-pick') -> 'pick'), '{}'::text[], 'nor marked');
set local role service_role;
insert into outcome values ('progress-late', public.practice_progress(pg_temp.s(1)));
reset role;
select is((select c from jsonb_array_elements(pg_temp.o('progress-late') -> 'courses') c
    where c ->> 'course_id' = pg_temp.c('08')::text) - 'course_id',
  '{"practised":13,"score":2,"total":3}'::jsonb, 'an attempt left early scores correct out of the questions answered');

-- 7. The sweep with picks recorded -----------------------------------------------------------------------------------
-- Attempt 3 (course 09, instant) gets picks, attempt 5 (student 2, exam) a saved sheet; both pass their deadline.
set local role service_role;
select pg_temp.pick(1, 3, n, true) from generate_series(0, 3) n;
insert into outcome values ('exam-start', pg_temp.estart(2, 5));
select public.practice_save(pg_temp.s(2), pg_temp.a(5), 'f4000000-0000-4000-8000-000000000002', 1, 0,
  jsonb_build_object(pg_temp.q(5, 0)::text, pg_temp.opt(5, 0, true)));
reset role;
update public.quiz_attempts set created_at = clock_timestamp() - interval '4 hours',
  deadline_at = clock_timestamp() - interval '1 hour' where id in (pg_temp.a(3), pg_temp.a(5));
select is(private.close_overdue_practice_all(), 2, 'the sweep closes an instant attempt with picks and an exam together');
select is(jsonb_build_object('instant', jsonb_build_object('status', (pg_temp.row_of(3)).status, 'score', (pg_temp.row_of(3)).score,
      'answers', pg_temp.answers(3)),
    'exam', jsonb_build_object('status', (pg_temp.row_of(5)).status, 'score', (pg_temp.row_of(5)).score)),
  '{"instant":{"status":"timed_out","score":4,"answers":4},"exam":{"status":"timed_out","score":1}}'::jsonb,
  'without failing or undoing its batch: the instant attempt counts its picks, the exam is graded from its sheet');
select is(private.close_overdue_practice_all(), 0, 'and a second sweep finds nothing to close');
-- Attempt 8 (course 09): started, never picked, abandoned.
set local role service_role;
select pg_temp.istart(1, 8, '09');
reset role;
update public.quiz_attempts set created_at = clock_timestamp() - interval '4 hours',
  deadline_at = clock_timestamp() - interval '1 minute' where id = pg_temp.a(8);
set local role service_role;
insert into outcome values ('progress-abandoned', public.practice_progress(pg_temp.s(1)));
reset role;
select is(jsonb_build_object('status', (pg_temp.row_of(8)).status, 'course', (select c - 'course_id'
    from jsonb_array_elements(pg_temp.o('progress-abandoned') -> 'courses') c where c ->> 'course_id' = pg_temp.c('09')::text)),
  '{"status":"timed_out","course":{"practised":4,"score":4,"total":4}}'::jsonb,
  'an instant attempt closed with no pick has no score, so the last score stays the one before it');

-- 8. Exams are unchanged -----------------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('exam-default', public.practice_start(pg_temp.s(2), pg_temp.a(6), pg_temp.c('08'), 'new',
  null, 5, 1800, '[]', 5, 1800, false));
reset role;
select is(jsonb_build_object('state', pg_temp.o('exam-default') ->> 'state', 'mode', (pg_temp.row_of(6)).mode),
  '{"state":"ready","mode":"exam"}'::jsonb, 'a start that names no mode is an exam, as before');
set local role service_role;
select throws_ok($$ select public.practice_pick(pg_temp.s(2), pg_temp.a(6), pg_temp.q(6, 0), 0) $$, '22023', null,
  'an exam attempt takes no picks');
reset role;
select is(pg_temp.answers(6), 0, 'and an open exam still has no marked answer');

-- 9. Owners never read open picks directly ----------------------------------------------------------------------------
-- Attempt 7: open, one pick. The answer rows stay hidden from the owner until the attempt has closed.
set local role service_role;
select pg_temp.istart(1, 7);
select pg_temp.pick(1, 7, 0, true);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"f1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000001"}';
select is((select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(7)), 0,
  'an open instant attempt''s answer rows are not readable by its owner');
reset role;

select * from finish();
rollback;
