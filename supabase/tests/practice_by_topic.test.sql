-- supabase/tests/practice_by_topic.test.sql — Practice by topic (20261029150000_practice_by_topic.sql): a course's topics
-- are the distinct section labels of its pool in configured order, then first appearance, without unlabelled questions
-- or catch-all labels; the count read sits behind the content boundary; an instant start names one of the course's
-- topics and draws only from it, never-seen first across runs; a topic outside the course starts nothing; progress per
-- topic matches the student's own rows; topics and starts follow the student's own course access.
begin;
select no_plan();

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('f4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('f5000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.a(n integer) returns uuid language sql immutable
  as $$ select ('f6000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(n text) returns uuid language sql immutable
  as $$ select ('40000000-0000-4000-8000-0000000000' || n)::uuid $$;
-- An instant start as the application server makes it: 10 questions, 3 hours, on one topic.
create function pg_temp.tstart(p_user integer, p_attempt integer, p_course text, p_topic text) returns jsonb
  language sql as $$ select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c(p_course), 'new',
    null, 10, 10800, '[]', null, null, null, 'instant', p_topic) $$;
-- Fixture reads as the owner.
create function pg_temp.pinned(p_attempt integer) returns uuid[] language sql stable security definer set search_path = ''
  as $$ select coalesce(array_agg(question_id order by question_id), '{}') from public.quiz_attempt_questions
    where attempt_id = pg_temp.a(p_attempt) $$;
create function pg_temp.pinned_topics(p_attempt integer) returns text[] language sql stable security definer
  set search_path = '' as $$
  select coalesce(array_agg(distinct private.practice_topic_of(r.payload)), '{}') from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = pg_temp.a(p_attempt) $$;
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
create function pg_temp.pick(p_user integer, p_attempt integer, p_ordinal integer, p_right boolean) returns jsonb
  language sql as $$ select public.practice_pick(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.q(p_attempt, p_ordinal),
    pg_temp.opt(p_attempt, p_ordinal, p_right)) $$;
-- The pool's questions with a topic, counted as the owner.
create function pg_temp.topical(p_course text) returns integer language sql stable security definer set search_path = ''
  as $$ select count(*)::integer from private.practice_pool(pg_temp.c(p_course)) pool
    where private.practice_topic_of(pool.payload) is not null $$;
grant execute on function pg_temp.topical(text) to authenticated;
create function pg_temp.attempts(p_user integer) returns integer language sql stable security definer set search_path = ''
  as $$ select count(*)::integer from public.quiz_attempts where user_id = pg_temp.u(p_user) $$;
create function pg_temp.topic_list(p_course text, p_sections jsonb) returns jsonb language sql stable
  as $$ select coalesce(jsonb_agg(jsonb_build_array(topic, bank_size) order by ordinal), '[]')
    from public.published_cbt_topics(pg_temp.c(p_course), p_sections) $$;
create function pg_temp.progress_of(p_result jsonb, p_topic text) returns jsonb language sql immutable
  as $$ select t - 'topic' from jsonb_array_elements(p_result -> 'topics') t where t ->> 'topic' = p_topic $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable
  as $$ select result from outcome where step = p_step $$;

-- 1. Structure and privileges ----------------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.published_cbt_topics(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.published_cbt_topics(uuid,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.published_cbt_topics(uuid,jsonb)', 'EXECUTE'),
  'the topic list is for signed-in students only, like published_cbt_summary');
select is(pg_get_function_result('public.published_cbt_topics(uuid,jsonb)'::regprocedure),
  'TABLE(ordinal integer, topic text, bank_size integer)', 'the topic list carries counts and nothing else');
select ok(has_function_privilege('service_role', 'public.practice_topic_progress(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.practice_topic_progress(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.practice_topic_progress(uuid,uuid)', 'EXECUTE'),
  'progress per topic is read only through the application server');
select is((select count(*)::integer from unnest(array['private.practice_topic_of(jsonb)',
    'private.practice_topics(uuid,jsonb)', 'private.practice_draw_from(uuid,uuid,uuid,integer,jsonb,text)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'topic helpers are callable by no API role');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'practice_start'), 1, 'one practice start, now with a topic');

-- 2. What a topic is ---------------------------------------------------------------------------------------------------
select is(jsonb_build_array(private.practice_topic_of('{"section":"  Listening Skills "}'),
    private.practice_topic_of('{"section":""}'), private.practice_topic_of('{}'),
    private.practice_topic_of('{"section":"Exam Practice"}'), private.practice_topic_of('{"section":"practice examination"}'),
    private.practice_topic_of('{"section":"MASTER QUESTION BANK"}')),
  '["Listening Skills", null, null, null, null, null]'::jsonb,
  'a topic is the trimmed section label; unlabelled questions and catch-all labels are no topic');

-- 3. Fixtures: 1 and 2 with plans, 3 on the free tier. ---------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
  'topic-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array[1, 2, 3]) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.s(n), pg_temp.u(n), now(), now() from unnest(array[1, 2, 3]) n;
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
select pg_temp.u(n), 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test' from unnest(array[1, 2]) n;

-- First appearance, from the items themselves (publication order), for the order checks below.
create temporary table appearance on commit drop as
select i.course_id, private.practice_topic_of(r.payload) as topic, min(n.position) as first
from (select i.id, row_number() over (partition by i.course_id order by i.created_at, i.id) as position
  from public.managed_content_items i where i.kind = 'cbt_question') n
join public.managed_content_items i on i.id = n.id
join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
where private.practice_topic_of(r.payload) is not null
group by i.course_id, private.practice_topic_of(r.payload);
grant select on appearance to authenticated;

-- 4. The topic list ----------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f5000000-0000-4000-8000-000000000003"}';
select is(pg_temp.topic_list('08', '["Comprehension & Summary", "Not a label", " Listening Skills"]') -> 0,
  '["Comprehension & Summary", 20]'::jsonb, 'configured sections come first, in the configured order');
select is(pg_temp.topic_list('08', '["Comprehension & Summary", "Not a label", " Listening Skills"]') -> 1,
  '["Listening Skills", 20]'::jsonb, 'a configured name matches its trimmed label; unknown names are skipped');
select is((select jsonb_agg(e -> 0) from jsonb_array_elements(pg_temp.topic_list('08',
    '["Comprehension & Summary", "Listening Skills"]')) with ordinality x(e, n) where n > 2),
  (select jsonb_agg(topic order by first) from appearance where course_id = pg_temp.c('08')
    and topic not in ('Comprehension & Summary', 'Listening Skills')),
  'the rest follow in order of first appearance');
select is(pg_temp.topic_list('08', '[]'), (select jsonb_agg(jsonb_build_array(topic, 20) order by first) from appearance
    where course_id = pg_temp.c('08')), 'with no configured sections, first appearance alone; every topic counted');
select is((select jsonb_agg(e -> 0) from jsonb_array_elements(pg_temp.topic_list('09', '[]')) e
    where e ->> 0 = 'Practice Examination'), null, 'a catch-all label is left out of the list');
select is((select sum((e ->> 1)::integer)::integer from jsonb_array_elements(pg_temp.topic_list('09', '[]')) e),
  pg_temp.topical('09'), 'the topics count every labelled question outside the catch-all, which stays in Exam mode');
select ok(pg_temp.topical('09') < (select bank_size from public.published_cbt_summary(array[pg_temp.c('09')])),
  'so the topics hold fewer questions than the exam pool');
select is(pg_temp.topic_list('13', '["Master Question Bank"]'), '[]'::jsonb,
  'a course whose only label is a catch-all has no topics: Exam mode only');
select throws_ok($$ select * from public.published_cbt_topics(pg_temp.c('07'), '[]') $$, 'CI403', null,
  'a course the student cannot read has no topic list (CI403), like the summary');
select throws_ok($$ select * from public.published_cbt_topics(pg_temp.c('08'), '{}') $$, '22023', null,
  'the configured sections are a list');
select throws_ok($$ select * from public.published_cbt_topics(pg_temp.c('08'), '[1]') $$, '22023', null,
  'of names');
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"f5000000-0000-4000-8000-0000000000ff"}';
select throws_ok($$ select * from public.published_cbt_topics(pg_temp.c('08'), '[]') $$, '42501', null,
  'a session that is not live reads no topics');
reset role;

-- 5. Starting a topic ------------------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('unknown', pg_temp.tstart(1, 90, '08', 'No Such Topic'));
insert into outcome values ('other-course', pg_temp.tstart(1, 91, '08', 'Islam and Political Culture'));
insert into outcome values ('catch-all', pg_temp.tstart(1, 92, '09', 'Practice Examination'));
insert into outcome values ('locked', pg_temp.tstart(3, 93, '07', 'Bookkeeping & Errors'));
select throws_ok($$ select pg_temp.tstart(1, 94, '08', null) $$, '22023', null, 'an instant start names a topic');
select throws_ok($$ select pg_temp.tstart(1, 94, '08', ' Listening Skills') $$, '22023', null,
  'as the database trims it');
select throws_ok($$ select pg_temp.tstart(1, 94, '08', repeat('x', 201)) $$, '22023', null, 'of at most 200 characters');
select throws_ok($$ select public.practice_start(pg_temp.s(1), pg_temp.a(94), pg_temp.c('08'), 'new', null, 5, 1800, '[]',
  5, 1800, false, 'exam', 'Listening Skills') $$, '22023', null, 'an exam names no topic');
reset role;
select is(jsonb_build_array(pg_temp.o('unknown'), pg_temp.o('other-course'), pg_temp.o('catch-all')),
  '[{"state":"unknown-topic"},{"state":"unknown-topic"},{"state":"unknown-topic"}]'::jsonb,
  'an unknown topic, another course''s topic and a catch-all label are refused');
select is(pg_temp.o('locked'), '{"state":"locked"}'::jsonb, 'access is judged as before (practice_can_start)');
select is(pg_temp.attempts(1) + pg_temp.attempts(3), 0, 'and a refused start starts nothing');

-- Run 1: Listening Skills (20 questions): 6 right, 4 wrong.
set local role service_role;
insert into outcome values ('run1', pg_temp.tstart(1, 1, '08', 'Listening Skills'));
insert into outcome values ('replay-other-topic', pg_temp.tstart(1, 1, '08', 'The Sounds of English'));
select pg_temp.pick(1, 1, n, n < 6) from generate_series(0, 9) n;
reset role;
select is(jsonb_build_object('state', pg_temp.o('run1') ->> 'state', 'topic', pg_temp.o('run1') -> 'attempt' ->> 'topic',
    'count', (pg_temp.o('run1') -> 'attempt' ->> 'question_count')::integer,
    'bank', (pg_temp.o('run1') -> 'attempt' ->> 'bank_size')::integer),
  '{"state":"ready","topic":"Listening Skills","count":10,"bank":20}'::jsonb,
  'ten questions from a topic of twenty; the attempt names its topic');
select is(pg_temp.pinned_topics(1), array['Listening Skills'], 'only that topic''s questions are drawn');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.o('run1') -> 'attempt' -> 'questions') q
  where q ? 'correct_option' or q ? 'explanation' or q ? 'selected'), 0, 'and none is revealed before its pick');
select is(pg_temp.o('replay-other-topic'), '{"state":"conflict"}'::jsonb,
  'the same attempt id for another topic is a conflict');

-- Run 2: the ten not yet seen. Three picked, then left open.
set local role service_role;
insert into outcome values ('run2', pg_temp.tstart(1, 2, '08', 'Listening Skills'));
insert into outcome values ('same-topic-while-open', pg_temp.tstart(1, 3, '08', 'Listening Skills'));
select pg_temp.pick(1, 2, n, true) from generate_series(0, 2) n;
insert into outcome values ('progress-open', public.practice_topic_progress(pg_temp.s(1), pg_temp.c('08')));
reset role;
select is(pg_temp.o('run2') ->> 'state', 'ready', 'Practise again starts the next run');
select is((select count(*)::integer from unnest(pg_temp.pinned(2)) q where q = any(pg_temp.pinned(1))), 0,
  'never-seen first: the second run shares no question with the first');
select is(jsonb_build_object('state', pg_temp.o('same-topic-while-open') ->> 'state',
    'id', pg_temp.o('same-topic-while-open') -> 'attempt' ->> 'id'),
  jsonb_build_object('state', 'in-progress', 'id', pg_temp.a(2)), 'the same topic returns its open run to finish');
select is(pg_temp.progress_of(pg_temp.o('progress-open'), 'Listening Skills'),
  '{"practised":13,"score":6,"total":10}'::jsonb,
  'picks count as practised straight away; the last score is the last finished run''s');
select is(pg_temp.progress_of(pg_temp.o('progress-open'), 'Listening Skills') -> 'practised',
  (select to_jsonb(count(distinct a.question_id)::integer) from public.quiz_attempt_answers a
    where a.attempt_id in (pg_temp.a(1), pg_temp.a(2))), 'practised is exactly the student''s answered questions');

-- Finish run 2 (7 more picks, 4 right), then run 3 has no unseen question left: it avoids the run just finished.
set local role service_role;
select pg_temp.pick(1, 2, n, n < 7) from generate_series(3, 9) n;
insert into outcome values ('run3', pg_temp.tstart(1, 4, '08', 'Listening Skills'));
insert into outcome values ('progress', public.practice_topic_progress(pg_temp.s(1), pg_temp.c('08')));
insert into outcome values ('progress-other', public.practice_topic_progress(pg_temp.s(2), pg_temp.c('08')));
reset role;
select is(pg_temp.progress_of(pg_temp.o('progress'), 'Listening Skills'), '{"practised":20,"score":7,"total":10}'::jsonb,
  '"20 of 20 questions practised · Last score 7/10"');
select is(jsonb_array_length(pg_temp.o('progress') -> 'topics'), 1, 'only topics the student has practised are listed');
select is((select count(*)::integer from unnest(pg_temp.pinned(4)) q where q = any(pg_temp.pinned(2))), 0,
  'with every question seen, the next run avoids the one just finished');
select is(pg_temp.o('progress-other'), '{"state":"ok","topics":[]}'::jsonb, 'another student''s progress is their own');

-- A small topic is drawn whole.
set local role service_role;
insert into outcome values ('small', pg_temp.tstart(2, 5, '09', 'Islam and Political Culture'));
reset role;
select is(jsonb_build_object('count', (pg_temp.o('small') -> 'attempt' ->> 'question_count')::integer,
    'topics', to_jsonb(pg_temp.pinned_topics(5))),
  '{"count":9,"topics":["Islam and Political Culture"]}'::jsonb, 'a topic of nine questions gives nine');

-- 6. Switching topics (student 2, course 08) ---------------------------------------------------------------------------
-- Run 10 on The Sounds of English: 2 right, 1 wrong, left open. Then another topic.
set local role service_role;
select pg_temp.tstart(2, 10, '08', 'The Sounds of English');
select pg_temp.pick(2, 10, n, n < 2) from generate_series(0, 2) n;
insert into outcome values ('switch', pg_temp.tstart(2, 11, '08', 'Comprehension & Summary'));
insert into outcome values ('switch-progress', public.practice_topic_progress(pg_temp.s(2), pg_temp.c('08')));
insert into outcome values ('switch-refused', pg_temp.tstart(2, 12, '08', 'No Such Topic'));
reset role;
-- Read straight after the refused start, before the next switch closes the run.
insert into outcome values ('after-refused', (select to_jsonb(status) from public.quiz_attempts where id = pg_temp.a(11)));
set local role service_role;
insert into outcome values ('switch-back', pg_temp.tstart(2, 13, '08', 'The Sounds of English'));
reset role;
select is(jsonb_build_object('state', pg_temp.o('switch') ->> 'state', 'topic', pg_temp.o('switch') -> 'attempt' ->> 'topic'),
  '{"state":"ready","topic":"Comprehension & Summary"}'::jsonb, 'another topic starts in one step');
select is(jsonb_build_object('status', (select status from public.quiz_attempts where id = pg_temp.a(10)),
    'score', (select score from public.quiz_attempts where id = pg_temp.a(10)),
    'picks', (select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(10))),
  '{"status":"submitted","score":2,"picks":3}'::jsonb, 'the run it replaces closes with its picks and their score');
select is(pg_temp.progress_of(pg_temp.o('switch-progress'), 'The Sounds of English'),
  '{"practised":3,"score":2,"total":3}'::jsonb, 'and counts as that topic''s last score: 2/3');
select is(jsonb_build_object('refused', pg_temp.o('switch-refused') ->> 'state',
    'open', pg_temp.o('after-refused')),
  '{"refused":"unknown-topic","open":"in_progress"}'::jsonb, 'a refused switch leaves the open run as it was');
select is(jsonb_build_object('state', pg_temp.o('switch-back') ->> 'state',
    'closed', (select status from public.quiz_attempts where id = pg_temp.a(11)),
    'open', (select count(*)::integer from public.quiz_attempts where user_id = pg_temp.u(2) and course_id = pg_temp.c('08')
      and status = 'in_progress')),
  '{"state":"ready","closed":"submitted","open":1}'::jsonb, 'switching again leaves one open run per course');

-- 7. An open exam blocks practice (student 3, course 08: free) --------------------------------------------------------
set local role service_role;
insert into outcome values ('exam', public.practice_start(pg_temp.s(3), pg_temp.a(6), pg_temp.c('08'), 'new', null, 50,
  1800, '[]', 50, 1800, false));
insert into outcome values ('during-exam', pg_temp.tstart(3, 14, '08', 'Listening Skills'));
reset role;
select is(jsonb_build_object('state', pg_temp.o('during-exam') ->> 'state',
    'exam', pg_temp.o('during-exam') -> 'attempt' ->> 'id', 'mode', pg_temp.o('during-exam') -> 'attempt' ->> 'mode'),
  jsonb_build_object('state', 'exam-open', 'exam', pg_temp.a(6), 'mode', 'exam'),
  'a practice start during an open exam is refused, naming the exam to resume');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.o('during-exam') -> 'attempt' -> 'questions') q
  where q ? 'correct_option' or q ? 'explanation' or q ? 'selected'), 0, 'and reveals nothing of it');
select is((select string_agg(mode || ':' || status, ',') from public.quiz_attempts where user_id = pg_temp.u(3)),
  'exam:in_progress', 'nothing starts and the exam is untouched');
select is(jsonb_build_object('state', pg_temp.o('exam') ->> 'state', 'topic', pg_temp.o('exam') -> 'attempt' -> 'topic',
    'topics', jsonb_array_length(to_jsonb(pg_temp.pinned_topics(6))) > 1),
  '{"state":"ready","topic":null,"topics":true}'::jsonb, 'an exam names no topic and draws from every topic');
select throws_ok($$ update public.quiz_attempts set topic = 'Listening Skills' where id = pg_temp.a(6) $$, '23514', null,
  'only an instant attempt has a topic');

-- 8. Course access (20261029100000_own_course_access.sql) ---------------------------------------------------------------
-- Students 20 and 21: Business Administration 200L first semester with a plan. BUA201 (02) is on their list, BUA202 (11)
-- is not. 21's and 22's grants are still pending their semester binding.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
  'topic-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array[20, 21, 22]) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.s(n), pg_temp.u(n), now(), now() from unnest(array[20, 21, 22]) n;
update public.profiles set first_name = 'Ada', department_id = '10000000-0000-4000-8000-000000000002',
  academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
where id in (pg_temp.u(20), pg_temp.u(21), pg_temp.u(22));
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
select pg_temp.u(n), 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test' from unnest(array[20, 21, 22]) n;
update public.entitlement_grants set course_term_id = null, course_department_id = null
where user_id in (pg_temp.u(21), pg_temp.u(22));
delete from private.entitlement_events where user_id in (pg_temp.u(21), pg_temp.u(22)) and event = 'course.grant-bound';
create function pg_temp.bindings(p_user integer) returns integer language sql stable security definer set search_path = ''
  as $$ select count(*)::integer from private.entitlement_events where user_id = pg_temp.u(p_user)
    and event = 'course.grant-bound' $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-000000000020","role":"authenticated","session_id":"f5000000-0000-4000-8000-000000000020"}';
select ok((select count(*) from public.published_cbt_topics(pg_temp.c('02'), '[]')) > 0, 'an own course lists its topics');
select throws_ok($$ select * from public.published_cbt_topics(pg_temp.c('11'), '[]') $$, 'CI403', null,
  'a course outside the student''s list has no topic list (CI403)');
set local request.jwt.claims = '{"sub":"f4000000-0000-4000-8000-000000000022","role":"authenticated","session_id":"f5000000-0000-4000-8000-000000000022"}';
select ok((select count(*) from public.published_cbt_topics(pg_temp.c('02'), '[]')) > 0,
  'a pending grant is bound by the topic read, which then lists the topics');
reset role;
select is(pg_temp.bindings(22), 1, 'bound once');
set local role service_role;
insert into outcome values ('outside-topic', pg_temp.tstart(20, 20, '11',
  'Week 10 — Nigeria''s Banking, Financial System, and Securities Market'));
insert into outcome values ('outside-exam', public.practice_start(pg_temp.s(20), pg_temp.a(21), pg_temp.c('11'), 'new', null,
  5, 1800, '[]', 5, 1800, false));
insert into outcome values ('own-topic', pg_temp.tstart(20, 22, '02', 'Ethics & CSR'));
reset role;
select is(jsonb_build_array(pg_temp.o('outside-topic'), pg_temp.o('outside-exam')),
  '[{"state":"locked"},{"state":"locked"}]'::jsonb, 'a topic or exam start for a course outside the list is refused');
select is((select count(*)::integer from public.quiz_attempts where user_id = pg_temp.u(20) and course_id = pg_temp.c('11')),
  0, 'and pins no attempt');
select is(pg_temp.o('own-topic') ->> 'state', 'ready', 'an own course''s topic starts');

-- A pending grant binds once, inside the start, which then goes ahead; a replay binds nothing more.
select is(pg_temp.bindings(21), 0, 'student 21''s grant is pending');
set local role service_role;
insert into outcome values ('pending', pg_temp.tstart(21, 23, '02', 'Ethics & CSR'));
insert into outcome values ('pending-replay', pg_temp.tstart(21, 23, '02', 'Ethics & CSR'));
reset role;
select is(jsonb_build_object('state', pg_temp.o('pending') ->> 'state', 'replay', pg_temp.o('pending-replay') ->> 'state',
    'bindings', pg_temp.bindings(21),
    'bound', (select course_term_id is not null and course_department_id is not null from public.entitlement_grants
      where user_id = pg_temp.u(21))),
  '{"state":"ready","replay":"ready","bindings":1,"bound":true}'::jsonb,
  'a start with a pending grant binds it once, then starts');

-- A revoked plan starts no topic.
select is(public.admin_change_grant((select id from public.entitlement_grants where user_id = pg_temp.u(20)), 'revoke',
  null, null, 'Ops', 'test') ->> 'state', 'changed', 'the plan is revoked');
set local role service_role;
insert into outcome values ('revoked', pg_temp.tstart(20, 24, '02', 'Accounting & Operations'));
reset role;
select is(pg_temp.o('revoked'), '{"state":"locked"}'::jsonb, 'after a revoke, another topic is refused');
select is((select status from public.quiz_attempts where id = pg_temp.a(22)), 'in_progress',
  'and the refused switch leaves the open run as it was');

-- 9. A closed topic run reveals the keys of its picked questions only ---------------------------------------------------
-- Questions of a view carrying any key (a pick, the correct option, the explanation or the review's item identity).
create function pg_temp.keyed(p_view jsonb) returns integer language sql immutable
  as $$ select count(*)::integer from jsonb_array_elements(p_view -> 'attempt' -> 'questions') q
    where q ? 'selected' or q ? 'correct_option' or q ? 'explanation' or q ? 'item_id' or q ? 'revision' $$;
-- Keyed questions that the student never answered.
create function pg_temp.unanswered_keyed(p_view jsonb) returns integer language sql stable security definer
  set search_path = '' as $$ select count(*)::integer from jsonb_array_elements(p_view -> 'attempt' -> 'questions') q
    where (q ? 'selected' or q ? 'correct_option' or q ? 'explanation' or q ? 'item_id')
      and not exists (select 1 from public.quiz_attempt_answers a where a.attempt_id = (p_view -> 'attempt' ->> 'id')::uuid
        and a.question_id = (q ->> 'question_id')::uuid) $$;
-- Run 10 (student 2) was closed by a topic switch in section 6 with 3 of its 10 questions picked.
set local role service_role;
insert into outcome values ('closed-read', public.practice_attempt(pg_temp.s(2), pg_temp.a(10)));
insert into outcome values ('closed-replay', pg_temp.tstart(2, 10, '08', 'The Sounds of English'));
insert into outcome values ('closed-late-pick', public.practice_pick(pg_temp.s(2), pg_temp.a(10), pg_temp.q(10, 7), 0));
insert into outcome values ('closed-state', public.practice_state(pg_temp.s(2), pg_temp.c('08')));
reset role;
select is(jsonb_build_object('state', pg_temp.o('closed-read') ->> 'state', 'keyed', pg_temp.keyed(pg_temp.o('closed-read')),
    'unanswered', pg_temp.unanswered_keyed(pg_temp.o('closed-read')),
    'questions', jsonb_array_length(pg_temp.o('closed-read') -> 'attempt' -> 'questions')),
  '{"state":"graded","keyed":3,"unanswered":0,"questions":10}'::jsonb,
  'a closed topic run shows the answer of its 3 picked questions and nothing of the 7 it was never asked');
select is((select jsonb_agg(distinct (select jsonb_agg(k order by k) from jsonb_object_keys(q) k)) from
    jsonb_array_elements(pg_temp.o('closed-read') -> 'attempt' -> 'questions') q where not (q ? 'selected')),
  '[["options","prompt","question_id","section"]]'::jsonb, 'an unanswered question is the question and nothing else');
select is(jsonb_build_array(pg_temp.o('closed-replay') ->> 'state', pg_temp.keyed(pg_temp.o('closed-replay')),
    pg_temp.unanswered_keyed(pg_temp.o('closed-replay'))), '["graded", 3, 0]'::jsonb,
  'a replayed start of the closed run shows the same');
select is(jsonb_build_array(pg_temp.o('closed-late-pick') ->> 'state', pg_temp.keyed(pg_temp.o('closed-late-pick')),
    pg_temp.unanswered_keyed(pg_temp.o('closed-late-pick')),
    (select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(10))),
  '["graded", 3, 0, 3]'::jsonb, 'a late pick on an unanswered question records nothing and reveals nothing');
select ok(pg_temp.o('closed-state')::text !~ 'correct_option|explanation', 'the course''s practice state carries no key');

-- A topic run whose time runs out closes the same way (student 30, course 08: free).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
  'topic-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array[30, 31]) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.s(n), pg_temp.u(n), now(), now() from unnest(array[30, 31]) n;
set local role service_role;
select pg_temp.tstart(30, 30, '08', 'Listening Skills');
select pg_temp.pick(30, 30, 0, false);
reset role;
update public.quiz_attempts set deadline_at = clock_timestamp() + interval '50 milliseconds' where id = pg_temp.a(30);
select pg_sleep(0.1);
set local role service_role;
insert into outcome values ('timed-out-read', public.practice_attempt(pg_temp.s(30), pg_temp.a(30)));
reset role;
select is(jsonb_build_array(pg_temp.o('timed-out-read') -> 'attempt' ->> 'status', pg_temp.keyed(pg_temp.o('timed-out-read')),
    pg_temp.unanswered_keyed(pg_temp.o('timed-out-read'))), '["timed_out", 1, 0]'::jsonb,
  'a timed-out topic run shows its one picked answer only');

-- An exam's review after submission is unchanged: every question with its key (student 3's exam from section 7).
set local role service_role;
insert into outcome values ('exam-review', public.practice_submit(pg_temp.s(3), pg_temp.a(6),
  'f7000000-0000-4000-8000-000000000001', 1, 0, '{}'));
reset role;
select is(jsonb_build_array(pg_temp.o('exam-review') ->> 'state', pg_temp.keyed(pg_temp.o('exam-review')),
    (pg_temp.o('exam-review') -> 'attempt' ->> 'question_count')::integer),
  '["graded", 50, 50]'::jsonb, 'a submitted exam reviews all 50 questions, answered or not');

-- 10. Exam mode over an open topic run (student 31, course 08) ----------------------------------------------------------
create function pg_temp.estart(p_user integer, p_attempt integer, p_expected integer default 50) returns jsonb
  language sql as $$ select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c('08'), 'new', null,
    50, 1800, '[]', p_expected, 1800, false) $$;
set local role service_role;
select pg_temp.tstart(31, 31, '08', 'Listening Skills');
select pg_temp.pick(31, 31, 0, true);
select pg_temp.pick(31, 31, 1, false);
insert into outcome values ('exam-refused', pg_temp.estart(31, 32, 49));
reset role;
insert into outcome values ('topic-after-refused', (select to_jsonb(status) from public.quiz_attempts where id = pg_temp.a(31)));
set local role service_role;
insert into outcome values ('exam-over-topic', pg_temp.estart(31, 33));
reset role;
insert into outcome values ('topic-closed', (select jsonb_build_object('status', status, 'score', score,
  'finished_at', finished_at, 'picks', (select count(*) from public.quiz_attempt_answers where attempt_id = a.id))
  from public.quiz_attempts a where id = pg_temp.a(31)));
set local role service_role;
insert into outcome values ('exam-replay', pg_temp.estart(31, 33));
insert into outcome values ('exam-second-tab', pg_temp.estart(31, 34));
insert into outcome values ('topic-during-exam', pg_temp.tstart(31, 35, '08', 'The Sounds of English'));
reset role;
select is(jsonb_build_array(pg_temp.o('exam-refused') ->> 'state', pg_temp.o('topic-after-refused')),
  '["policy-changed", "in_progress"]'::jsonb, 'a refused exam start leaves the topic run open');
select is(jsonb_build_object('state', pg_temp.o('exam-over-topic') ->> 'state',
    'mode', pg_temp.o('exam-over-topic') -> 'attempt' ->> 'mode',
    'timed', (pg_temp.o('exam-over-topic') -> 'attempt' ->> 'duration_seconds')::integer),
  '{"state":"ready","mode":"exam","timed":1800}'::jsonb, 'an exam starts over an open topic run');
select is(pg_temp.o('topic-closed') - 'finished_at', '{"status":"submitted","score":1,"picks":2}'::jsonb,
  'which closes, keeping its 2 picks and their score, as a topic switch does');
select is(jsonb_build_object('replay', pg_temp.o('exam-replay') ->> 'state',
    'replay_id', pg_temp.o('exam-replay') -> 'attempt' ->> 'id', 'tab', pg_temp.o('exam-second-tab') ->> 'state',
    'tab_id', pg_temp.o('exam-second-tab') -> 'attempt' ->> 'id',
    'topic_finished_once', (select finished_at from public.quiz_attempts where id = pg_temp.a(31))
      = (pg_temp.o('topic-closed') ->> 'finished_at')::timestamptz),
  jsonb_build_object('replay', 'ready', 'replay_id', pg_temp.a(33), 'tab', 'in-progress', 'tab_id', pg_temp.a(33),
    'topic_finished_once', true),
  'a replayed start returns the exam; a second tab is handed the same exam; the topic run closed once');
select is((select string_agg(mode || ':' || status, ',' order by created_at, id) from public.quiz_attempts
    where user_id = pg_temp.u(31)), 'instant:submitted,exam:in_progress', 'one open attempt: the exam');
select is(pg_temp.o('topic-during-exam') ->> 'state', 'exam-open', 'the open exam still blocks topic runs');

select * from finish();
rollback;
