-- Trusted server RPC inputs simulate canonical metadata; the Node boundary
-- tests prove how that metadata is derived. No browser role can call this RPC.
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
select ok(not exists (select 1 from pg_proc cross join lateral aclexplode(proacl) acl
  where oid = 'public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)'::regprocedure
    and acl.grantee = 0), 'PUBLIC has no write RPC privilege');

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

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')$$, '42501', null, 'signed-out browser cannot call the RPC');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')$$, '42501', null, 'student cannot bypass canonical server checks via RPC');
reset role;
set local role service_role;

select is(public.write_quiz_attempt(null, 'a2000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000007', 3, 'start', null, 'in_progress', '[]'),
  '{"status":"signed-out"}'::jsonb, 'server capability alone supplies no student identity');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000003',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')->>'status', 'signed-out', 'expired session cannot start');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]'),
  '{"status":"saved","attempt":{"id":"a2000000-0000-4000-8000-000000000001","revision":0,"status":"in_progress","questionCount":3}}'::jsonb,
  'start returns only the logical attempt and its initial revision/state/count');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')->'attempt'->>'revision', '0', 'start retry keeps revision zero');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]'), '{"status":"not-found"}'::jsonb,
  'another account cannot create or inspect the existing logical attempt');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 0, 'submitted', '[]'), '{"status":"not-found"}'::jsonb,
  'another account cannot finalize or inspect the attempt');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 0, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000001","ordinal":0,"option_index":0,"is_correct":true,"section_label":"Accounting"}]'),
  '{"status":"not-found"}'::jsonb, 'another account cannot record answers');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  4, 'start', null, 'in_progress', '[]')->>'status', 'conflict', 'retry cannot change established question count');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003',
  3, 'start', null, 'in_progress', '[]')->>'status', 'conflict', 'retry cannot change established course');
reset role;
select is((select count(*)::int from public.quiz_attempts), 1, 'start retries create one attempt');
select is((select user_id from public.quiz_attempts), '11111111-1111-4111-8111-111111111111'::uuid,
  'ownership is resolved from the actual session');
select is((select count(*)::int from public.quiz_attempt_answers), 0, 'start creates no unanswered rows');
set local role service_role;

select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 0, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000001","ordinal":0,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '1', 'accepted answer advances the revision');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 0, 'in_progress',
  '[{"section_label":"Accounting","is_correct":true,"option_index":0,"ordinal":0,"question_id":"a3000000-0000-4000-8000-000000000001"}]')->'attempt'->>'revision',
  '1', 'equivalent retry ignores JSON key order and does not advance revision');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 1, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000001","ordinal":0,"option_index":1,"is_correct":false,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '2', 'a later valid selection replaces an in-progress answer');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 0, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000001","ordinal":0,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')->>'status',
  'conflict', 'stale revision cannot restore the old selection');
reset role;
select is((select count(*)::int from public.quiz_attempt_answers), 1, 'retries and replacements create one answer row');
select ok((select option_index = 1 and not is_correct and section_label = 'Accounting'
  and answered_at >= (select created_at from public.quiz_attempts where id = attempt_id)
  from public.quiz_attempt_answers), 'latest answer and server timestamp are durable');
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 2, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000002","ordinal":1,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '3', 'patch adds another answer without replacing the earlier answer');

select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', 3, 'record', 3, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000001","ordinal":2,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')$$,
  '22023', null, 'established question position cannot change');
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', 3, 'record', 3, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000003","ordinal":1,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')$$,
  '22023', null, 'another question cannot claim an occupied ordinal');
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', 3, 'record', 3, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000003","ordinal":3,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')$$,
  '22023', null, 'ordinal must fit the established attempt size');
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', 3, 'record', 3, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000003","ordinal":2,"option_index":-1,"is_correct":true,"section_label":"Accounting"}]')$$,
  '22023', null, 'negative option is rejected');
select throws_ok($$select public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007', 3, 'record', 3, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000003","ordinal":2,"option_index":0,"is_correct":true,"section_label":"Accounting","answered_at":"2000-01-01"}]')$$,
  '22023', null, 'RPC rejects timestamps and other extra answer fields');
reset role;
select is((select revision from public.quiz_attempts), 3, 'invalid batches do not advance the attempt');
select is((select count(*)::int from public.quiz_attempt_answers), 2, 'invalid batches create no rows and retain unanswered gaps');
set local role service_role;

select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 3, 'submitted',
  '[{"question_id":"a3000000-0000-4000-8000-000000000002","ordinal":1,"option_index":1,"is_correct":false,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '4', 'submission atomically flushes a last answer patch and finalizes');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 3, 'submitted',
  '[{"question_id":"a3000000-0000-4000-8000-000000000002","ordinal":1,"option_index":1,"is_correct":false,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '4', 'submission retry acknowledges completion without new history');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 4, 'timed_out', '[]')->>'status', 'finalized', 'terminal status cannot be replaced');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'record', 4, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000001","ordinal":0,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')->>'status',
  'finalized', 'finalized attempt cannot be edited');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')->'attempt'->>'status', 'submitted', 'late start retry does not reopen a terminal attempt');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')->>'status', 'saved', 'a new logical UUID establishes a separate attempt');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 0, 'timed_out', '[]')->'attempt'->>'status', 'timed_out', 'timer completion works with no answered questions');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 0, 'timed_out', '[]')->'attempt'->>'revision', '1', 'timer completion retry is idempotent');
reset role;
select ok((select bool_and(status in ('submitted', 'timed_out') and finished_at >= created_at)
  from public.quiz_attempts), 'both completion kinds retain database-owned valid finish timestamps');
select is((select count(*)::int from public.quiz_attempt_answers
  where attempt_id = 'a2000000-0000-4000-8000-000000000002'), 0, 'timer completion does not manufacture unanswered history');

set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')->>'status', 'saved', 'session-loss fixture starts in progress');
reset role;
delete from auth.sessions where id = 'a1000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000007',
  3, 'finish', 0, 'submitted', '[]')->>'status', 'signed-out', 'session deletion prevents a further write even after server preflight');
select throws_ok($$select * from public.quiz_attempts$$, '42501', null, 'server capability has no direct parent read');
select throws_ok($$update public.quiz_attempt_answers set is_correct = true$$, '42501', null, 'server capability has no direct answer mutation');
reset role;
select is((select revision from public.quiz_attempts where id = 'a2000000-0000-4000-8000-000000000003'),
  0, 'session loss leaves the attempt unchanged');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.quiz_attempts), 1, 'B still reads only B''s attempt');
select is((select count(*)::int from public.quiz_attempt_answers), 0, 'B cannot inspect A''s answers after the new write capability');
select throws_ok($$insert into public.quiz_attempts (id, user_id, course_id, question_count)
  values ('a2000000-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', '40000000-0000-4000-8000-000000000007', 3)$$,
  '42501', null, 'direct student INSERT remains denied');
select throws_ok($$update public.quiz_attempts set revision = revision + 1$$,
  '42501', null, 'direct student UPDATE remains denied');
select throws_ok($$delete from public.quiz_attempt_answers$$,
  '42501', null, 'direct student DELETE remains denied');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.quiz_attempts), 2, 'A still reads only A''s attempts');
select is((select count(*)::int from public.quiz_attempt_answers), 2, 'A can read its own recorded answer history');
reset role;

-- A fresh selection and a changed selection in one accepted patch share the
-- clock captured after the attempt lock. Read-only retries keep durable times.
create temporary table quiz_answer_clock_probe (
  label text primary key, at timestamptz not null
) on commit drop;
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000007',
  3, 'start', null, 'in_progress', '[]')->>'status', 'saved', 'timestamp fixture starts');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000007',
  3, 'record', 0, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000004","ordinal":0,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '1', 'first selection is accepted');
reset role;
insert into quiz_answer_clock_probe
select 'first', answered_at from public.quiz_attempt_answers
where attempt_id = 'a2000000-0000-4000-8000-000000000005';
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000007',
  3, 'record', 0, 'in_progress',
  '[{"section_label":"Accounting","is_correct":true,"option_index":0,"ordinal":0,"question_id":"a3000000-0000-4000-8000-000000000004"}]')->'attempt'->>'revision',
  '1', 'equivalent first-selection retry is read-only');
reset role;
select ok((select a.answered_at = p.at from public.quiz_attempt_answers a
  cross join quiz_answer_clock_probe p where p.label = 'first'
    and a.attempt_id = 'a2000000-0000-4000-8000-000000000005'),
  'equivalent retry preserves the first selection timestamp');
insert into quiz_answer_clock_probe values ('before-mixed', clock_timestamp());
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000007',
  3, 'record', 1, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000004","ordinal":0,"option_index":1,"is_correct":false,"section_label":"Accounting"},{"question_id":"a3000000-0000-4000-8000-000000000005","ordinal":1,"option_index":0,"is_correct":true,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '2', 'one patch changes an answer and inserts another');
reset role;
select ok((select changed.answered_at = fresh.answered_at
    and changed.answered_at >= (select at from quiz_answer_clock_probe where label = 'before-mixed')
    and changed.answered_at > (select at from quiz_answer_clock_probe where label = 'first')
  from public.quiz_attempt_answers changed
  join public.quiz_attempt_answers fresh on fresh.attempt_id = changed.attempt_id
    and fresh.question_id = 'a3000000-0000-4000-8000-000000000005'
  where changed.attempt_id = 'a2000000-0000-4000-8000-000000000005'
    and changed.question_id = 'a3000000-0000-4000-8000-000000000004'),
  'new and changed selections share the server acceptance timestamp');
insert into quiz_answer_clock_probe
select case when ordinal = 0 then 'changed' else 'new' end, answered_at
from public.quiz_attempt_answers
where attempt_id = 'a2000000-0000-4000-8000-000000000005';
set local role service_role;
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000007',
  3, 'record', 2, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000004","ordinal":0,"option_index":1,"is_correct":false,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '3', 'unchanged selection can be part of a later accepted patch');
select is(public.write_quiz_attempt('a1000000-0000-4000-8000-000000000002',
  'a2000000-0000-4000-8000-000000000005', '40000000-0000-4000-8000-000000000007',
  3, 'record', 2, 'in_progress',
  '[{"question_id":"a3000000-0000-4000-8000-000000000004","ordinal":0,"option_index":1,"is_correct":false,"section_label":"Accounting"}]')->'attempt'->>'revision',
  '3', 'equivalent later retry is read-only');
reset role;
select ok((select bool_and(a.answered_at = p.at)
  from public.quiz_attempt_answers a
  join quiz_answer_clock_probe p on p.label = case when a.ordinal = 0 then 'changed' else 'new' end
  where a.attempt_id = 'a2000000-0000-4000-8000-000000000005'),
  'unchanged patch and equivalent retry preserve both answer timestamps');
select * from finish();
rollback;
