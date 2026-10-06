-- supabase/tests/quiz_attempt_write_boundary.test.sql
-- Attempt selection pins published managed revisions; only the private RPC scores answers.
begin;
select no_plan();

select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc
  where oid = 'public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)'::regprocedure),
  'write RPC is a definer with an empty search path');
select ok(not has_function_privilege('anon',
  'public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated',
  'public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role',
  'public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)', 'EXECUTE'),
  'only the private server capability can execute writes');
select ok((select relrowsecurity from pg_class where oid = 'public.quiz_attempt_questions'::regclass)
  and has_table_privilege('authenticated', 'public.quiz_attempt_questions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.quiz_attempt_questions', 'INSERT')
  and not has_table_privilege('service_role', 'public.quiz_attempt_questions', 'SELECT'),
  'snapshot rows are owner-readable but not directly writable by API roles');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'quiz-write-a@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'quiz-write-b@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('a1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', now(), now(), null),
  ('a1000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', now(), now(), null),
  ('a1000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', now(), now(), now() - interval '1 second');

create temporary table quiz_selected on commit drop as
select i.id item_id, i.question_id, i.published_revision content_revision, r.payload,
  row_number() over (order by i.id) - 1 ordinal
from public.managed_content_items i
join public.courses c on c.id = i.course_id and c.content_key = 'financial-accounting-1'
join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
where i.kind = 'cbt_question' and i.published_revision is not null
order by i.id limit 2;
create temporary table quiz_fixture on commit drop as
select c.id course_id,
  (select jsonb_agg(jsonb_build_object('question_id', question_id, 'ordinal', ordinal,
    'content_revision', content_revision) order by ordinal) from quiz_selected) selection,
  (select question_id from quiz_selected where ordinal = 0) first_question,
  (select (payload->>'correctOption')::integer from quiz_selected where ordinal = 0) first_correct,
  (select jsonb_array_length(payload->'options') from quiz_selected where ordinal = 0) first_option_count
from public.courses c where c.content_key = 'financial-accounting-1';
grant select on quiz_selected, quiz_fixture to service_role;
select is((select count(*)::int from quiz_selected), 2, 'fixture has two published managed CBT questions');
select ok((select bool_and(content_revision > 0 and question_id is not null) from quiz_selected),
  'published revisions and permanent question UUIDs are available');

set local role anon;
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', (select selection from quiz_fixture))$$,
  '42501', null, 'signed-out browser cannot invoke the write RPC');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000001"}';
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', (select selection from quiz_fixture))$$,
  '42501', null, 'student cannot bypass server selection validation');
reset role;
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', (select selection from quiz_fixture))->>'status',
  'signed-out', 'expired session fails closed');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', (select selection from quiz_fixture))->'attempt'->>'revision',
  '0', 'start pins current published revisions');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', (select selection from quiz_fixture))->'attempt'->>'revision',
  '0', 'exact retry is idempotent');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'finish', 0, 'submitted', '[]')->>'status', 'not-found', 'another owner cannot finish');
select throws_ok($$select * from public.quiz_attempt_questions$$, '42501', null,
  'service capability has no direct snapshot table read');
reset role;
select is((select count(*)::int from public.quiz_attempt_questions), 2,
  'one attempt stores each selected question and revision once');
select ok((select bool_and(q.content_revision = s.content_revision and q.ordinal = s.ordinal
  and q.item_id = s.item_id) from public.quiz_attempt_questions q
  join quiz_selected s on s.question_id = q.question_id), 'snapshot pins exact managed item revisions');
select is((select count(*)::int from public.quiz_attempt_answers), 0,
  'starting a quiz does not manufacture answers');

-- Simulate an approved operator publication while the first attempt is active.
insert into public.managed_content_revisions(item_id, revision, payload, authored_by)
select item_id, content_revision + 1,
  jsonb_set(jsonb_set(jsonb_set(payload, '{correctOption}',
    to_jsonb(((payload->>'correctOption')::integer + 1) % jsonb_array_length(payload->'options'))),
    '{section}', '"Updated section"'::jsonb), '{options,0}', '"Operator edited option"'::jsonb),
  '00000000-0000-4000-8000-000000000042'::uuid
from quiz_selected where ordinal = 0;
update public.managed_content_items i
set current_revision = s.content_revision + 1, approved_revision = s.content_revision + 1,
    published_revision = s.content_revision + 1, lock_version = lock_version + 1
from quiz_selected s where i.id = s.item_id and s.ordinal = 0;
select is((select published_revision from public.managed_content_items i
  join quiz_selected s on s.item_id = i.id where s.ordinal = 0),
  (select content_revision + 1 from quiz_selected where ordinal = 0),
  'a new managed revision is published after the attempt starts');

set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'record', 0, 'in_progress', jsonb_build_array(jsonb_build_object(
    'question_id', (select first_question from quiz_fixture), 'ordinal', 0,
    'option_index', (select first_correct from quiz_fixture))))->'attempt'->>'revision',
  '1', 'in-progress attempt records against its pinned revision');
reset role;
select ok((select is_correct and option_index = (select first_correct from quiz_fixture)
  and section_label = coalesce(nullif(s.payload->>'section', ''), 'General')
  from public.quiz_attempt_answers a join quiz_selected s on s.question_id = a.question_id
  where a.attempt_id = 'a2000000-0000-4000-8000-000000000001'),
  'old answer key and section remain canonical after publication changes');

set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', (select selection from quiz_fixture))->>'status',
  'conflict', 'new attempt cannot pin an unpublished old revision');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', jsonb_set((select selection from quiz_fixture),
    '{0,content_revision}', to_jsonb((select content_revision + 1 from quiz_selected where ordinal = 0))))->>'status',
  'saved', 'fresh attempt pins the newer publication');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002', (select course_id from quiz_fixture),
  0, 'record', 0, 'in_progress', jsonb_build_array(jsonb_build_object(
    'question_id', (select first_question from quiz_fixture), 'ordinal', 0,
    'option_index', (select first_correct from quiz_fixture))))->'attempt'->>'revision',
  '1', 'fresh attempt scores from the newer revision');
reset role;
select ok((select not is_correct from public.quiz_attempt_answers
  where attempt_id = 'a2000000-0000-4000-8000-000000000002'),
  'same choice is incorrect under the new answer key');
select is((select section_label from public.quiz_attempt_answers
  where attempt_id = 'a2000000-0000-4000-8000-000000000002'),
  'Updated section', 'fresh attempt uses the new section metadata');

-- Withdrawing a question prevents future starts, but cannot rewrite a pinned
-- in-progress attempt's immutable answer key and options.
update public.managed_content_items i set published_revision = null, lock_version = lock_version + 1
from quiz_selected s where i.id = s.item_id and s.ordinal = 0;
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000003', (select course_id from quiz_fixture),
  2, 'start', null, 'in_progress', jsonb_set((select selection from quiz_fixture),
    '{0,content_revision}', to_jsonb((select content_revision + 1 from quiz_selected where ordinal = 0))))->>'status',
  'conflict', 'withdrawn question cannot enter a fresh attempt');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002', (select course_id from quiz_fixture),
  0, 'record', 1, 'in_progress', jsonb_build_array(jsonb_build_object(
    'question_id', (select first_question from quiz_fixture), 'ordinal', 0,
    'option_index', ((select first_correct from quiz_fixture) + 1) % (select first_option_count from quiz_fixture))))->'attempt'->>'revision',
  '2', 'withdrawal does not invalidate a pinned active attempt');
reset role;
select ok((select is_correct from public.quiz_attempt_answers
  where attempt_id = 'a2000000-0000-4000-8000-000000000002'),
  'the pinned newer revision still scores after withdrawal');

set local role service_role;
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'record', 1, 'in_progress', jsonb_build_array(jsonb_build_object(
    'question_id', (select first_question from quiz_fixture), 'ordinal', 0, 'option_index', 0,
    'is_correct', true)))$$, '22023', null, 'browser-supplied correctness is rejected');
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'record', 1, 'in_progress', '[{"question_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","ordinal":0,"option_index":0}]')$$,
  '22023', null, 'foreign question ID is not in the pinned attempt');
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'record', 1, 'in_progress', jsonb_build_array(jsonb_build_object(
    'question_id', (select first_question from quiz_fixture), 'ordinal', 0,
    'option_index', (select first_option_count from quiz_fixture))))$$,
  '22023', null, 'option outside the pinned revision is rejected');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'finish', 1, 'submitted', '[]')->'attempt'->>'status', 'submitted',
  'manual submit finalizes the original attempt');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', (select course_id from quiz_fixture),
  0, 'finish', 1, 'submitted', '[]')->'attempt'->>'revision', '2',
  'equivalent finish retry is idempotent');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000002', (select course_id from quiz_fixture),
  0, 'finish', 2, 'timed_out', '[]')->'attempt'->>'status', 'timed_out',
  'timeout finalizes a separate attempt');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000002"}';
select is((select count(*)::int from public.quiz_attempt_questions), 0,
  'another student cannot read selected revision history');
select throws_ok($$insert into public.quiz_attempt_questions(attempt_id, question_id, ordinal, item_id, content_revision)
  select 'a2000000-0000-4000-8000-000000000001', question_id, 2, item_id, content_revision
  from quiz_selected limit 1$$, '42501', null, 'student cannot write a snapshot directly');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000001"}';
select is((select count(*)::int from public.quiz_attempt_questions), 4,
  'owner can read selected revision history');
reset role;

select * from finish();
rollback;
