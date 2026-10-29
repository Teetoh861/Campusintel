-- supabase/tests/practice_by_topic.test.sql — Practice by topic (20261029150000_practice_by_topic.sql): a course's topics
-- are the distinct section labels of its pool in configured order, then first appearance, without unlabelled questions
-- or catch-all labels; the count read sits behind the content boundary; an instant start names one of the course's
-- topics and draws only from it, never-seen first across runs; a topic outside the course starts nothing; progress per
-- topic matches the student's own rows.
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
insert into outcome values ('elsewhere-while-open', pg_temp.tstart(1, 3, '08', 'The Sounds of English'));
select pg_temp.pick(1, 2, n, true) from generate_series(0, 2) n;
insert into outcome values ('progress-open', public.practice_topic_progress(pg_temp.s(1), pg_temp.c('08')));
reset role;
select is(pg_temp.o('run2') ->> 'state', 'ready', 'Practise again starts the next run');
select is((select count(*)::integer from unnest(pg_temp.pinned(2)) q where q = any(pg_temp.pinned(1))), 0,
  'never-seen first: the second run shares no question with the first');
select is(jsonb_build_object('state', pg_temp.o('elsewhere-while-open') ->> 'state',
    'id', pg_temp.o('elsewhere-while-open') -> 'attempt' ->> 'id'),
  jsonb_build_object('state', 'in-progress', 'id', pg_temp.a(2)),
  'one open attempt per course, whatever its topic: the open one is returned');
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

-- 6. Exams are unchanged: no topic, the whole pool -------------------------------------------------------------------
set local role service_role;
insert into outcome values ('exam', public.practice_start(pg_temp.s(2), pg_temp.a(6), pg_temp.c('08'), 'new', null, 50,
  1800, '[]', 50, 1800, false));
reset role;
select is(jsonb_build_object('state', pg_temp.o('exam') ->> 'state', 'topic', pg_temp.o('exam') -> 'attempt' -> 'topic',
    'topics', jsonb_array_length(to_jsonb(pg_temp.pinned_topics(6))) > 1),
  '{"state":"ready","topic":null,"topics":true}'::jsonb, 'an exam names no topic and draws from every topic');
select throws_ok($$ update public.quiz_attempts set topic = 'Listening Skills' where id = pg_temp.a(6) $$, '23514', null,
  'only an instant attempt has a topic');

select * from finish();
rollback;
