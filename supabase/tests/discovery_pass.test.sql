-- supabase/tests/discovery_pass.test.sql — The Discovery Pass that replaced the seven-day trial
-- (20261021100000_discovery_pass.sql): 72 hours on the database clock, one timed 50-question CBT exam and one complete
-- study-guide topic pinned and served by the server only, answers withheld until grading, one AI upload with one set of
-- five questions, no theory preview and no replenishment.
-- Time is simulated by moving grant and deadline timestamps: now() is fixed for the whole transaction.
begin;
select no_plan();

-- Structure, privileges and policy ----------------------------------------------------------------------------------
select has_table('private', 'discovery_previews', 'previews table exists');
select ok((select relrowsecurity from pg_class where oid = 'private.discovery_previews'::regclass), 'RLS is enabled');
select is((select count(*)::integer from unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, 'private.discovery_previews', privilege)), 0,
  'no API role can read or write previews directly, so the pinned answer key never leaves through PostgREST');
select is((select count(*)::integer from unnest(array['public.discovery_preview(uuid,uuid,text,boolean,uuid,integer)',
    'public.submit_discovery_cbt(uuid,uuid,jsonb)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0, 'preview functions are service-role only');
select is((select count(*)::integer from unnest(array['private.discovery_preview_content(uuid,text,uuid)',
    'private.discovery_topic_titles(uuid)', 'private.discovery_preview_view(private.discovery_previews)',
    'private.close_overdue_discovery_exam(uuid)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'preview helpers are not callable by any API role');
-- No entitlement function accepts a timestamp from its caller: the database clock decides every start and end.
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('prepare_trial_otp', 'verify_trial_otp', 'discovery_preview',
    'submit_discovery_cbt', 'begin_ai_practice_generation', 'create_ai_practice_document', 'get_my_entitlement')
    and exists (select 1 from unnest(p.proargtypes::oid[]) t
      where t in ('timestamptz'::regtype, 'timestamp'::regtype, 'interval'::regtype, 'date'::regtype))), 0,
  'no entitlement function takes a timestamp or interval');
select is((select jsonb_build_object('hours', discovery_hours, 'cbt', discovery_cbt_questions,
    'grace', discovery_cbt_grace_seconds, 'ai_sets', discovery_ai_generations, 'ai_attempts', discovery_ai_attempts,
    'ai_uploads', discovery_ai_uploads, 'ai_chars', discovery_ai_source_chars) from private.entitlement_policy),
  '{"hours":72,"cbt":50,"grace":120,"ai_sets":1,"ai_attempts":3,"ai_uploads":1,"ai_chars":20000}'::jsonb,
  'approved Discovery Pass limits');
select hasnt_column('private', 'entitlement_policy', 'discovery_theory_questions', 'there is no theory preview');
select is((select count(*)::integer from public.entitlement_grants where source = 'trial'
  and ends_at - starts_at > interval '72 hours'), 0, 'no trial grant outlasts 72 hours');

-- Fixtures ----------------------------------------------------------------------------------------------------------
-- P: activates a pass. Q: same phone, other account. F: full plan. N: no pass. R: account deleted and recreated.
-- S: a pass close to its end.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('71000000-0000-4000-8000-000000000001', 'disc-p@example.test'),
  ('71000000-0000-4000-8000-000000000002', 'disc-q@example.test'),
  ('71000000-0000-4000-8000-000000000003', 'disc-f@example.test'),
  ('71000000-0000-4000-8000-000000000004', 'disc-n@example.test'),
  ('71000000-0000-4000-8000-000000000005', 'disc-r@example.test'),
  ('71000000-0000-4000-8000-000000000008', 'disc-s@example.test')) fixture_users(id, email);
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select ('72000000-0000-4000-8000-00000000000' || n)::uuid, ('71000000-0000-4000-8000-00000000000' || n)::uuid,
  now(), now(), null from unnest(array[1, 2, 3, 4, 5, 8]) n;
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by) values
  ('71000000-0000-4000-8000-000000000003', 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test');
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by) values
  ('71000000-0000-4000-8000-000000000008', 'trial', now() - interval '71 hours 50 minutes', now() + interval '10 minutes',
    'capped', 1, 'test');

create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.h(p_value text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(p_value, 'UTF8')), 'hex') $$;
grant execute on function pg_temp.h(text) to authenticated, service_role;
-- Course fixtures: 02 has 390 CBT questions and notes, 07 also has theory, 11 has CBT only, 08 is a free GST course.
create function pg_temp.c(p_n text) returns uuid language sql immutable as
  $$ select ('40000000-0000-4000-8000-0000000000' || p_n)::uuid $$;
grant execute on function pg_temp.c(text) to authenticated, service_role;
-- A thirty-minute exam, the duration the server's quiz configuration gives course 02.
create function pg_temp.open_exam(p_session uuid, p_course uuid) returns jsonb language sql as
  $$ select public.discovery_preview(p_session, p_course, 'cbt', true, null, 1800) $$;
grant execute on function pg_temp.open_exam(uuid, uuid) to service_role;

-- 1. Activation is explicit: only a verified phone code starts the pass, 72 hours from that transaction's clock ------
-- Signing in and reading the plan (dashboard, course pages, Plan & Access) never start one.
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'available', 'a signed-in student is offered a pass');
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'available', 'reading the plan again starts nothing');
reset role;
select is((select count(*)::integer from public.entitlement_grants where user_id = '71000000-0000-4000-8000-000000000001'),
  0, 'no grant exists from sign-in or plan reads');
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false),
  '{"state":"no-pass"}'::jsonb, 'opening a course page before activation offers nothing and starts nothing');
select is(public.prepare_trial_otp('72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001',
  pg_temp.h('phone-p'), '101', pg_temp.h('code-p'))->>'state', 'ready', 'P requests a code');
select is(public.verify_trial_otp('72000000-0000-4000-8000-000000000001', '73000000-0000-4000-8000-000000000001',
  pg_temp.h('wrong-code'))->>'state', 'incorrect', 'a wrong code starts nothing');
reset role;
select is((select count(*)::integer from public.entitlement_grants where user_id = '71000000-0000-4000-8000-000000000001'),
  0, 'sending a code, or entering a wrong one, does not start the pass');
set local role service_role;
insert into outcome values ('p-verify', public.verify_trial_otp('72000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001', pg_temp.h('code-p')));
reset role;
select is((select result->>'state' from outcome where step = 'p-verify'), 'activated', 'the right code starts the pass');
select is((select jsonb_build_object('starts', starts_at = now(), 'ends', ends_at = now() + interval '72 hours',
    'units', ai_units) from public.entitlement_grants where user_id = '71000000-0000-4000-8000-000000000001'),
  '{"starts":true,"ends":true,"units":1}'::jsonb, 'starts now and ends exactly 72 hours later, with one AI set');
select is(private.has_full_access('71000000-0000-4000-8000-000000000001'), false, 'a pass is never full access');

-- 2. No course is ever readable whole with a pass --------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select throws_ok($$ select * from public.read_published_managed_content(pg_temp.c('02')) $$, 'CI403', null,
  'the full published bank and notes of a department course are refused');
select throws_ok($$ select * from public.read_published_managed_content(pg_temp.c('07')) $$, 'CI403', null,
  'including theory and model answers');
select ok((select count(*) from public.read_published_managed_content(pg_temp.c('08'))) > 0,
  'a free GST course stays fully readable');
select throws_ok($$ select public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false) $$,
  '42501', null, 'a student cannot call previews with their own JWT');
select is((select (e->'discovery') - 'previews' from public.get_my_entitlement() e),
  '{"ai_sets":1,"cbt_questions":50}'::jsonb, 'the summary reports the pass limits, and no theory preview');
select is((select (e->>'trial_hours')::integer from public.get_my_entitlement() e), 72, 'and its length in hours');
reset role;
set local role service_role;
select is(public.write_quiz_attempt('72000000-0000-4000-8000-000000000001', '74000000-0000-4000-8000-000000000001',
  pg_temp.c('02'), 1, 'start', null, 'in_progress',
  '[{"question_id":"3d04c5a2-4363-4112-b397-e0191402f275","ordinal":0,"content_revision":1}]'),
  '{"status":"locked"}'::jsonb, 'a regular CBT attempt cannot start, so no bank question is pinned by that path');
select throws_ok($$ select public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('07'), 'theory', true) $$,
  '22023', null, 'there is no theory preview to open');

-- 3. The exam: 50 server-chosen questions, a database deadline, no answer key ------------------------------------------
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false) - 'ends_at' - 'now',
  '{"state":"available","topics":null}'::jsonb, 'reading without opening spends nothing');
reset role;
select is((select count(*)::integer from private.discovery_previews), 0, 'and creates no preview');
set local role service_role;
select throws_ok($$ select public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', true) $$,
  '22023', null, 'an exam cannot open without the server''s course duration');
select throws_ok($$ select public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', true,
  null, 999999) $$, '22023', null, 'nor with an unbounded one');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000001', pg_temp.c('08')),
  '{"state":"free-course"}'::jsonb, 'a free course never consumes the exam');
insert into outcome values ('p-cbt', pg_temp.open_exam('72000000-0000-4000-8000-000000000001', pg_temp.c('02')));
select is((select result->>'state' from outcome where step = 'p-cbt'), 'ready', 'the exam opens');
select is((select jsonb_array_length(result->'preview'->'questions') from outcome where step = 'p-cbt'), 50,
  'it is a complete 50-question exam from the 390-question bank');
select is((select (result->'preview'->>'deadline_at')::timestamptz from outcome where step = 'p-cbt'),
  now() + interval '30 minutes', 'the deadline is set by the database: thirty minutes from opening');
select is((select (result->>'now')::timestamptz from outcome where step = 'p-cbt'), now(),
  'the server clock is sent for the countdown display');
select is((select (result->'preview'->>'result') from outcome where step = 'p-cbt'), null, 'with no result yet');
select ok((select result::text !~ '(correct_option|correctOption|explanation)' from outcome where step = 'p-cbt'),
  'no answer key or explanation is sent before grading');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000001', pg_temp.c('02')),
  (select result from outcome where step = 'p-cbt'), 'a retry or refresh returns the identical exam and deadline');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false),
  (select result from outcome where step = 'p-cbt'), 'as does a plain read, from any device or session');
reset role;
-- Twenty-five minutes later (simulated), reopening from a brand-new session must not restart the clock.
update private.discovery_previews set deadline_at = now() + interval '5 minutes'
  where user_id = '71000000-0000-4000-8000-000000000001' and kind = 'cbt';
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000021', '71000000-0000-4000-8000-000000000001', now(), now());
set local role service_role;
select is((pg_temp.open_exam('72000000-0000-4000-8000-000000000021', pg_temp.c('02'))->'preview'->>'deadline_at')::timestamptz,
  now() + interval '5 minutes', 'reopening, refreshing or signing in again keeps the original deadline');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000001', pg_temp.c('07')) - 'ends_at' - 'now',
  '{"state":"used-elsewhere","content_key":"principles-business-administration"}'::jsonb,
  'the exam cannot be taken again on another course');
reset role;
select is((select count(*)::integer from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000001'),
  1, 'exactly one exam exists');
select ok(exists (select 1 from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000001'
  and event = 'discovery.preview-opened'), 'opening it is audited');

-- 4. Grading happens on the server, once ------------------------------------------------------------------------------
create function pg_temp.answers(p_user uuid, p_correct integer) returns jsonb language sql as $$
  -- Answers the first p_correct pinned questions correctly and the rest incorrectly.
  select jsonb_object_agg(q->>'item_id', case when position <= p_correct then (q->>'correct_option')::integer
    else ((q->>'correct_option')::integer + 1) % jsonb_array_length(q->'options') end)
  from private.discovery_previews p, jsonb_array_elements(p.content) with ordinality as t(q, position)
  where p.user_id = p_user and p.kind = 'cbt' $$;
insert into outcome values ('answers-37', pg_temp.answers('71000000-0000-4000-8000-000000000001', 37)),
  ('answers-50', pg_temp.answers('71000000-0000-4000-8000-000000000001', 50));
set local role service_role;
select throws_ok($$ select public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'),
  jsonb_build_object(gen_random_uuid()::text, 0)) $$, '22023', null, 'an answer to a question outside the exam is refused');
select throws_ok($$ select public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'),
  (select jsonb_build_object(key, 99) from outcome, jsonb_each(result) where step = 'answers-37' limit 1)) $$, '22023',
  null, 'an option that does not exist is refused');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('07'), '{}'),
  '{"state":"not-opened"}'::jsonb, 'a course with no opened exam cannot be graded');
insert into outcome values ('p-submit', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001',
  pg_temp.c('02'), (select result from outcome where step = 'answers-37')));
select is((select result->'preview'->'result'->>'score' || '/' || (result->'preview'->'result'->>'total')
  from outcome where step = 'p-submit'), '37/50', 'the server grades from the pinned key');
select is((select (result->'preview'->'result'->>'timed_out')::boolean from outcome where step = 'p-submit'), false,
  'submitted in time');
select ok((select bool_and(a ? 'correct_option' and a ? 'selected') from outcome,
  jsonb_array_elements(result->'preview'->'result'->'answers') a where step = 'p-submit'),
  'the answer key is revealed only with the result');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'),
  (select result from outcome where step = 'answers-50'))->'preview'->'result'->>'score', '37',
  'resubmitting better answers cannot change the score: the first grading stands');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false)->'preview'->'result',
  (select result->'preview'->'result' from outcome where step = 'p-submit'), 'a reload shows the same result');
reset role;

-- 4b. The exam clock: capped at the pass end, a bounded network grace, and closure when the sheet never arrives -------
set local role service_role;
insert into outcome values ('s-cbt', pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02')));
select is((select (result->'preview'->>'deadline_at')::timestamptz from outcome where step = 's-cbt'),
  now() + interval '10 minutes', 'an exam opened ten minutes before the pass ends gets ten minutes, not thirty');
reset role;
-- Deadline passed 60 seconds ago (inside the 120-second grace): a sheet still in flight is graded.
update private.discovery_previews set deadline_at = now() - interval '60 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
update public.entitlement_grants set ends_at = now() - interval '60 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
insert into outcome values ('answers-s', pg_temp.answers('71000000-0000-4000-8000-000000000008', 10));
set local role service_role;
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s'))->'preview'->'result'->>'score', '10',
  'a sheet arriving inside the network grace is graded, even just after the pass ended');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}'),
  '{"state":"expired"}'::jsonb, 'once the pass has ended nothing more is served, not even a replay');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false),
  '{"state":"expired"}'::jsonb, 'and the exam page fails closed');
reset role;
-- Q never sent a sheet: an exam whose deadline and grace have passed closes with no answers and cannot be graded later.
update public.entitlement_grants set starts_at = now() - interval '1 hour', ends_at = now() + interval '71 hours'
  where user_id = '71000000-0000-4000-8000-000000000008';
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02'))->>'state', 'ready',
  'a fresh exam opens');
reset role;
update private.discovery_previews set deadline_at = now() - interval '121 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
insert into outcome values ('answers-late', pg_temp.answers('71000000-0000-4000-8000-000000000008', 50));
set local role service_role;
insert into outcome values ('s-late', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008',
  pg_temp.c('02'), (select result from outcome where step = 'answers-late')));
select is((select jsonb_build_object('score', (result->'preview'->'result'->>'score')::integer,
    'timed_out', (result->'preview'->'result'->>'timed_out')::boolean) from outcome where step = 's-late'),
  '{"score":0,"timed_out":true}'::jsonb, 'a sheet after the grace is not graded: the exam closed with no answers');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false)
  ->'preview'->'result'->>'timed_out', 'true', 'the closed exam shows its review');
reset role;

-- 5. Study guide: the student picks one complete topic; titles only before that -----------------------------------------
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('11'), 'study_guide', false)
  - 'ends_at' - 'now', '{"state":"available","topics":[]}'::jsonb, 'a course with no topics offers none');
insert into outcome values ('p-topics', public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'),
  'study_guide', false));
select is((select jsonb_array_length(result->'topics') from outcome where step = 'p-topics'), 10,
  'every published topic title of the course is offered');
select ok((select bool_and((t - 'item_id' - 'title') = '{}'::jsonb) from outcome, jsonb_array_elements(result->'topics') t
  where step = 'p-topics'), 'as titles only: no topic body is sent before the student chooses');
select throws_ok($$ select public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'),
  'study_guide', true) $$, '22023', null, 'opening needs a chosen topic');
reset role;
insert into outcome values ('foreign-note', to_jsonb((select id from public.managed_content_items
  where course_id = pg_temp.c('07') and kind = 'note' limit 1)));
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'study_guide', true,
  (select (result #>> '{}')::uuid from outcome where step = 'foreign-note')),
  '{"state":"nothing-to-preview"}'::jsonb, 'a topic from another course is not this course''s topic, and spends nothing');
insert into outcome values ('p-guide', public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'),
  'study_guide', true, (select (result->'topics'->3->>'item_id')::uuid from outcome where step = 'p-topics')));
select is((select result->'preview'->'items'->0->>'item_id' from outcome where step = 'p-guide'),
  (select result->'topics'->3->>'item_id' from outcome where step = 'p-topics'), 'the chosen topic opens');
reset role;
select is((select result->'preview'->'items'->0->'note' from outcome where step = 'p-guide'),
  (select r.payload from outcome, public.managed_content_items i join public.managed_content_revisions r
    on r.item_id = i.id and r.revision = i.published_revision
    where step = 'p-guide' and i.id = (result->'preview'->'items'->0->>'item_id')::uuid),
  'complete, exactly as published');
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'study_guide', true,
  (select (result->'topics'->0->>'item_id')::uuid from outcome where step = 'p-topics')),
  (select result from outcome where step = 'p-guide'), 'asking for a second topic returns the first: every other topic stays locked');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('03'), 'study_guide', false)
  - 'ends_at' - 'now', '{"state":"used-elsewhere","content_key":"principles-business-administration"}'::jsonb,
  'and no topic of another course can be opened');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select is((select e->'discovery'->'previews' from public.get_my_entitlement() e),
  '[{"kind":"cbt","submitted":true,"content_key":"principles-business-administration"},{"kind":"study_guide","submitted":false,"content_key":"principles-business-administration"}]'::jsonb,
  'the summary lists each used preview and its course, without any content');
select throws_ok($$ select * from public.read_published_managed_content(pg_temp.c('02')) $$, 'CI403', null,
  'previews never unlock the course itself');
reset role;

-- 6. Expiry on the database clock, to the microsecond ------------------------------------------------------------------
update public.entitlement_grants set starts_at = now() - interval '72 hours' + interval '1 microsecond',
  ends_at = now() + interval '1 microsecond' where user_id = '71000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'study_guide', false)->>'state',
  'ready', 'one microsecond before the end the pass still serves');
reset role;
update public.entitlement_grants set starts_at = now() - interval '72 hours', ends_at = now()
  where user_id = '71000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'study_guide', false),
  '{"state":"expired"}'::jsonb, 'at the end instant every preview fails closed, including one already opened');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), '{}'),
  '{"state":"expired"}'::jsonb, 'and a graded exam is no longer shown');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000001"}';
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'ended', 'the summary shows the pass ended');
reset role;
-- A revoked pass is closed at once, whatever its end.
update public.entitlement_grants set starts_at = now() - interval '1 hour', ends_at = now() + interval '71 hours',
  revoked_at = now(), revoked_by = 'operator:test', revoke_reason = 'abuse review'
  where user_id = '71000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false),
  '{"state":"expired"}'::jsonb, 'a revoked pass serves nothing');
reset role;
-- A new session (sign out and back in, another device) is the same account and the same pass.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000011', '71000000-0000-4000-8000-000000000001', now(), now());
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000011', pg_temp.c('02'), 'cbt', false),
  '{"state":"expired"}'::jsonb, 'a fresh session does not revive it');
select is(public.prepare_trial_otp('72000000-0000-4000-8000-000000000011', '73000000-0000-4000-8000-000000000011',
  pg_temp.h('phone-p2'), '102', pg_temp.h('code-p2'))->>'state', 'already-activated',
  'nor can the account start a second pass with another SIM');
select is(public.prepare_trial_otp('72000000-0000-4000-8000-000000000002', '73000000-0000-4000-8000-000000000002',
  pg_temp.h('phone-p'), '101', pg_temp.h('code-q'))->>'state', 'phone-already-used', 'one phone, one pass');

-- 7. Who never gets a preview ---------------------------------------------------------------------------------------
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000003', pg_temp.c('02')),
  '{"state":"full-access"}'::jsonb, 'a full plan reads the course itself; nothing is spent');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000004', pg_temp.c('02')),
  '{"state":"no-pass"}'::jsonb, 'without a pass nothing is served');
select is(pg_temp.open_exam(gen_random_uuid(), pg_temp.c('02')),
  '{"state":"signed-out"}'::jsonb, 'an unknown session is signed out');
select throws_ok($$ select public.discovery_preview('72000000-0000-4000-8000-000000000004', pg_temp.c('02'), 'all', true) $$,
  '22023', null, 'an unknown preview kind is refused');
reset role;

-- 8. Account deletion: the previews go, the phone claim stays ---------------------------------------------------------
set local role service_role;
select is(public.prepare_trial_otp('72000000-0000-4000-8000-000000000005', '73000000-0000-4000-8000-000000000005',
  pg_temp.h('phone-r'), '105', pg_temp.h('code-r'))->>'state', 'ready', 'R requests a code');
select is(public.verify_trial_otp('72000000-0000-4000-8000-000000000005', '73000000-0000-4000-8000-000000000005',
  pg_temp.h('code-r'))->>'state', 'activated', 'R starts a pass');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000005', pg_temp.c('02'), 'cbt', true, null, 1800)
  ->>'state', 'ready', 'R opens an exam');
reset role;
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values ('71000000-0000-4000-8000-000000000005', now(), now() + interval '720 hours', now());
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000005', pg_temp.c('02'), 'cbt', false),
  '{"state":"signed-out"}'::jsonb, 'once deletion is scheduled, previews stop');
reset role;
delete from auth.users where id = '71000000-0000-4000-8000-000000000005';
select is((select count(*)::integer from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000005'),
  0, 'deleting the account removes its previews');
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000',
  '71000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'disc-r@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000006', '71000000-0000-4000-8000-000000000006', now(), now());
set local role service_role;
select is(public.prepare_trial_otp('72000000-0000-4000-8000-000000000006', '73000000-0000-4000-8000-000000000006',
  pg_temp.h('phone-r'), '105', pg_temp.h('code-r2'))->>'state', 'phone-already-used',
  're-registering with the same email and phone cannot buy a second pass');
reset role;

-- 9. AI on a pass: one accepted upload, one delivered set of five, bounded attempts and text -------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000',
  '71000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'disc-ai@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000007', '71000000-0000-4000-8000-000000000007', now(), now());
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by)
  select '71000000-0000-4000-8000-000000000007', 'trial', now(), now() + make_interval(hours => discovery_hours), 'capped',
    discovery_ai_generations, 'test' from private.entitlement_policy;
insert into outcome values ('acc101', to_jsonb((select id from public.institutional_courses where course_code = 'ACC101')));
-- Reserve, claim and settle one upload with the given text, returning the settle answer and the stored status.
create function pg_temp.upload(p_text text) returns jsonb language plpgsql security definer as $$
declare v_doc uuid; v_claim uuid; v_settled boolean;
begin
  v_doc := (public.create_ai_practice_document('72000000-0000-4000-8000-000000000007',
    (select (result #>> '{}')::uuid from outcome where step = 'acc101'), 'n.txt', 'text/plain', 100, array['trial'])
    ->> 'document_id')::uuid;
  if v_doc is null then return jsonb_build_object('reserved', false); end if;
  v_claim := (public.claim_ai_practice_extraction('72000000-0000-4000-8000-000000000007', v_doc) ->> 'claim_id')::uuid;
  v_settled := public.settle_ai_practice_document('72000000-0000-4000-8000-000000000007', v_doc, v_claim, null,
    p_text, encode(sha256(convert_to(p_text, 'UTF8')), 'hex'), 200);
  return jsonb_build_object('reserved', true, 'settled', v_settled, 'document', v_doc, 'status',
    (select status || coalesce(':' || rejection_reason, '') from public.ai_practice_documents where id = v_doc));
end $$;
grant execute on function pg_temp.upload(text) to service_role;
set local role service_role;
insert into outcome values ('too-long', pg_temp.upload(repeat('word ', 4001)));
select is((select result - 'document' from outcome where step = 'too-long'),
  '{"reserved":true,"settled":false,"status":"rejected:too-much-text"}'::jsonb,
  'text over 20,000 characters is rejected by the database, and the caller is told to re-read the outcome');
insert into outcome values ('upload-1', pg_temp.upload(repeat('word ', 300)));
select is((select result->>'status' from outcome where step = 'upload-1'), 'ready', 'a first upload is accepted');
select is(public.create_ai_practice_document('72000000-0000-4000-8000-000000000007',
  (select (result #>> '{}')::uuid from outcome where step = 'acc101'), 'n.txt', 'text/plain', 100, array['trial']),
  '{"status":"pass-upload-limit"}'::jsonb,
  'a second accepted upload is refused as a pass limit, not a daily one: the rejected file did not count');
reset role;
select is((select count(*)::integer from public.ai_practice_documents
  where user_id = '71000000-0000-4000-8000-000000000007' and discovery_grant_id is not null), 2,
  'every Discovery upload records the pass it counts against');
create function pg_temp.begin_and_finish(p_status text) returns text language plpgsql as $$
declare v_state jsonb;
begin
  v_state := public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000007', gen_random_uuid(),
    (select (result->>'document')::uuid from outcome where step = 'upload-1'), array['trial']);
  if v_state->>'state' <> 'started' then return v_state->>'state'; end if;
  perform public.finish_ai_practice_generation('71000000-0000-4000-8000-000000000007', (v_state->>'generation_id')::uuid,
    p_status, case when p_status = 'failed' then 'timeout' end, case when p_status = 'generated' then jsonb_build_object(
      'formatVersion', 1, 'origin', 'ai-generated', 'visibility', 'personal', 'verification', 'unverified',
      'questions', jsonb_build_array(jsonb_build_object('id', 'q1'))) end, null);
  return 'started';
end $$;
grant execute on function pg_temp.begin_and_finish(text) to service_role;
set local role service_role;
select is(pg_temp.begin_and_finish('failed'), 'started', 'a first attempt fails at the provider');
select is(pg_temp.begin_and_finish('failed'), 'started', 'so does a second');
select is(pg_temp.begin_and_finish('generated'), 'started', 'the third delivers a set: the failures cost nothing');
select is(public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000007', gen_random_uuid(),
  (select (result->>'document')::uuid from outcome where step = 'upload-1'), array['trial'])->>'state',
  'allowance-exhausted', 'the one set is used and nothing replenishes');
reset role;
select is((select count(*)::integer from public.ai_usage_events where user_id = '71000000-0000-4000-8000-000000000007'
  and state = 'consumed'), 1, 'exactly one set was charged');
-- A different student whose provider keeps failing is stopped after three attempts, with the set still unspent.
update public.ai_usage_events set state = 'released', settled_at = now()
  where user_id = '71000000-0000-4000-8000-000000000007' and state = 'consumed';
set local role service_role;
select is(pg_temp.begin_and_finish('failed'), 'allowance-exhausted',
  'after three attempts no further provider call is admitted, even with the set unspent');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000007"}';
select is((select (a->>'source_char_limit')::integer from public.get_my_ai_allowance() a), 20000,
  'the page is told the Discovery text limit');
reset role;

select * from finish();
rollback;
