-- supabase/tests/discovery_pass.test.sql — The Discovery Pass that replaced the seven-day trial
-- (20261021100000_discovery_pass.sql): 72 hours on the database clock, one timed 50-question CBT exam and one complete
-- study-guide topic from actively offered courses, pinned and served by the server only, answers withheld until grading
-- and refused after the deadline, one AI upload with one complete set of five questions, no theory preview and no
-- replenishment. Seven-day trials issued before the migration keep their full access and allowance.
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
    'public.save_discovery_cbt(uuid,uuid,jsonb,integer)', 'public.submit_discovery_cbt(uuid,uuid,jsonb)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0, 'preview functions are service-role only');
select is((select count(*)::integer from unnest(array['private.discovery_preview_content(uuid,text,uuid)',
    'private.discovery_topic_titles(uuid)', 'private.discovery_preview_view(private.discovery_previews)',
    'private.close_overdue_discovery_exam(uuid)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'preview helpers are not callable by any API role');
-- No entitlement function accepts a timestamp from its caller: the database clock decides every start and end.
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('activate_discovery_pass', 'discovery_preview',
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
select ok(to_regprocedure('public.save_discovery_cbt(uuid,uuid,jsonb)') is null,
  'every exam save names its revision: there is no save without one');
select is((select count(*)::integer from public.entitlement_grants where trial_policy = 'discovery'
  and ends_at - starts_at > interval '72 hours'), 0, 'no Discovery Pass outlasts 72 hours');

-- Fixtures ----------------------------------------------------------------------------------------------------------
-- P: activates a pass. Q: another account. F: full plan. N: no pass. R: account deleted and recreated.
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
insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
  values ('71000000-0000-4000-8000-000000000008', 'trial', 'discovery', now() - interval '71 hours 50 minutes',
    now() + interval '10 minutes', 'capped', 1, 'test');
select throws_ok($$ insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units,
    created_by) values ('71000000-0000-4000-8000-000000000004', 'trial', now(), now() + interval '1 hour', 'capped', 1,
    'test') $$, '23514', null, 'a trial grant must name the policy it is issued under');
select throws_ok($$ insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms,
    created_by) values ('71000000-0000-4000-8000-000000000004', 'manual', 'discovery', now(), now() + interval '1 hour',
    'none', 'test') $$, '23514', null, 'and only a trial grant has one');

create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.h(p_value text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(p_value, 'UTF8')), 'hex') $$;
grant execute on function pg_temp.h(text) to authenticated, service_role;
create function pg_temp.claim(p_email text) returns jsonb language sql immutable as
  $$ select jsonb_build_array(jsonb_build_object('version', 1, 'hash', pg_temp.h('claim-v1:' || p_email))) $$;
grant execute on function pg_temp.claim(text) to authenticated, service_role;
-- Course fixtures: 02 has 390 CBT questions and notes, 03 is another offered course, 11 has CBT only, 08 is a free GST
-- course, and 07 (notes, theory, 150 questions) is repository-only, so it is offered in no active catalogue.
create function pg_temp.c(p_n text) returns uuid language sql immutable as
  $$ select ('40000000-0000-4000-8000-0000000000' || p_n)::uuid $$;
grant execute on function pg_temp.c(text) to authenticated, service_role;
-- A thirty-minute exam, the duration the server's quiz configuration gives course 02.
create function pg_temp.open_exam(p_session uuid, p_course uuid) returns jsonb language sql as
  $$ select public.discovery_preview(p_session, p_course, 'cbt', true, null, 1800) $$;
grant execute on function pg_temp.open_exam(uuid, uuid) to service_role;

-- 1. Activation is explicit: only the student's own activation starts the pass, 72 hours from that transaction's clock
-- Signing in and reading the plan (dashboard, course pages, Plan & Access) never start one. No phone, no code.
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
select is(public.activate_discovery_pass(gen_random_uuid(), pg_temp.claim('x@example.test'))->>'state', 'signed-out', 'an unknown session starts nothing');
reset role;
select is((select count(*)::integer from public.entitlement_grants where user_id = '71000000-0000-4000-8000-000000000001'),
  0, 'no pass exists before the student activates one');
set local role service_role;
insert into outcome values ('p-activate', public.activate_discovery_pass('72000000-0000-4000-8000-000000000001', pg_temp.claim('disc-p@example.test')));
reset role;
select is((select result->>'state' from outcome where step = 'p-activate'), 'activated', 'one tap starts the pass');
select is((select jsonb_build_object('starts', starts_at = now(), 'ends', ends_at = now() + interval '72 hours',
    'units', ai_units, 'policy', trial_policy) from public.entitlement_grants
    where user_id = '71000000-0000-4000-8000-000000000001'),
  '{"starts":true,"ends":true,"units":1,"policy":"discovery"}'::jsonb,
  'starts now and ends exactly 72 hours later, with one AI set, explicitly as a Discovery Pass');
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
select is((select jsonb_build_object('hours', e->'trial_hours', 'days', e->'trial_days', 'policy', e->'trial'->'policy',
    'tier', e->'tier', 'access', e->'access') from public.get_my_entitlement() e),
  '{"hours":72,"days":3,"policy":"discovery","tier":"free","access":null}'::jsonb,
  'and its length in hours, with the pre-Discovery trial_days field still present for older application instances');
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
select is((select count(*)::integer from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000001'),
  0, 'and creates no preview');
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
select is((select result->'preview'->'saved' from outcome where step = 'p-cbt'), '{"revision":0,"answers":{}}'::jsonb,
  'and no sheet saved yet, at revision zero');
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
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000001', pg_temp.c('03')) - 'ends_at' - 'now',
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
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('03'), '{}'),
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

-- 4b. The exam clock: the whole duration or nothing, answers saved until the deadline, nothing accepted after it ------
-- S has ten minutes of pass left.
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02')) - 'now' - 'ends_at',
  '{"state":"not-enough-time"}'::jsonb,
  'a 30-minute exam does not open with ten minutes of pass left: it is never shortened to fit');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false, null, 1800)
  ->>'state', 'not-enough-time', 'and the exam page says so before anything is spent');
reset role;
select is((select count(*)::integer from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'),
  0, 'nothing is claimed when the exam does not fit');
set local role service_role;
insert into outcome values ('s-cbt', public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  'cbt', true, null, 600));
select is((select (result->'preview'->>'deadline_at')::timestamptz from outcome where step = 's-cbt'),
  now() + interval '10 minutes', 'a ten-minute exam that exactly fits opens with its whole duration');
reset role;
insert into outcome values ('answers-s-saved', pg_temp.answers('71000000-0000-4000-8000-000000000008', 10)),
  ('answers-s-20', pg_temp.answers('71000000-0000-4000-8000-000000000008', 20)),
  ('answers-s-30', pg_temp.answers('71000000-0000-4000-8000-000000000008', 30)),
  ('answers-s-all', pg_temp.answers('71000000-0000-4000-8000-000000000008', 50));
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-saved'), 1) - 'now', '{"state":"saved","revision":1}'::jsonb,
  'choices are saved while the exam is open, and the answer names the revision now saved');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  jsonb_build_object(gen_random_uuid()::text, 0), 2) $$, '22023', null, 'a saved answer outside the exam is refused');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}', 0) $$,
  '22023', null, 'revision zero is not a save');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}', null) $$,
  '22023', null, 'nor is a save without a revision');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}',
  1000001) $$, '22023', null, 'nor one beyond the bound');
-- Saves arrive out of order: revision 3 lands first, then the delayed revision 2 with better answers.
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-20'), 3) - 'now', '{"state":"saved","revision":3}'::jsonb,
  'the third revision is saved');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-all'), 2) - 'now',
  (select jsonb_build_object('state', 'stale', 'revision', 3, 'answers', result) from outcome where step = 'answers-s-20'),
  'an older revision arriving later is answered as stale with the newer sheet that stands, not applied');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-20'), 3) - 'now', '{"state":"saved","revision":3}'::jsonb,
  'a duplicate retry of the saved sheet is acknowledged as saved');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-saved'), 3)->>'state', 'stale',
  'the same revision with other answers (another tab) is stale, never applied');
-- Regression (Codex finding 1): answer 0, then answer 1, with the older request completing last. 1 must remain.
insert into outcome select 'q-first', to_jsonb(result->'preview'->'questions'->0->>'item_id') from outcome where step = 's-cbt';
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select jsonb_build_object(result #>> '{}', 1) from outcome where step = 'q-first'), 5)->>'state', 'saved',
  'the newer save (answer 1, revision 5) lands first');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select jsonb_build_object(result #>> '{}', 0) from outcome where step = 'q-first'), 4)->>'state', 'stale',
  'the older save (answer 0, revision 4) completes last and is refused');
reset role;
select is((select saved_answers -> (select result #>> '{}' from outcome where step = 'q-first') from private.discovery_previews
    where user_id = '71000000-0000-4000-8000-000000000008'), '1'::jsonb, 'the final saved answer remains 1');
set local role service_role;
reset role;
select is((select jsonb_build_object('revision', saved_revision, 'sheet', saved_answers) from private.discovery_previews
    where user_id = '71000000-0000-4000-8000-000000000008'),
  (select jsonb_build_object('revision', 5, 'sheet', jsonb_build_object(result #>> '{}', 1)) from outcome where step = 'q-first'),
  'the newest accepted sheet stands: an older save never overwrites it');
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false)
    ->'preview'->'saved', (select jsonb_build_object('revision', 5, 'answers', jsonb_build_object(result #>> '{}', 1))
    from outcome where step = 'q-first'),
  'a reload or another device is given the saved sheet and its revision to continue from');
reset role;
-- A change half a second before the deadline is saved: the deadline is the only cut-off.
update private.discovery_previews set deadline_at = now() + interval '500 milliseconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-30'), 6) - 'now', '{"state":"saved","revision":6}'::jsonb,
  'a sheet saved 500 milliseconds before the deadline is accepted');
reset role;
update private.discovery_previews set deadline_at = now() + interval '300 milliseconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-30'), 7) - 'now', '{"state":"saved","revision":7}'::jsonb,
  'and 300 milliseconds before it');
reset role;
-- Deadline plus 60 seconds: the deadline passed a minute ago, and with it the pass.
update private.discovery_previews set deadline_at = now() - interval '60 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
update public.entitlement_grants set ends_at = now() - interval '60 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  (select result from outcome where step = 'answers-s-all'), 8)->'preview'->'result'->>'score', '30',
  'a save 60 seconds after the deadline changes nothing: the exam was marked from the sheet saved in time');
insert into outcome values ('s-late', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008',
  pg_temp.c('02'), (select result from outcome where step = 'answers-s-all')));
select is((select jsonb_build_object('score', (result->'preview'->'result'->>'score')::integer,
    'timed_out', (result->'preview'->'result'->>'timed_out')::boolean) from outcome where step = 's-late'),
  '{"score":30,"timed_out":true}'::jsonb,
  'a perfect sheet submitted 60 seconds after the deadline is not marked: only the answers saved before it count');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}')
    ->'preview'->>'saved', null, 'a graded exam carries its result, not an open sheet');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}'),
  (select result from outcome where step = 's-late'),
  'inside the network grace a lost response replays the committed result, even just after the pass ended');
reset role;
select ok(exists (select 1 from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000008'
  and event = 'discovery.exam-timed-out'), 'closing at the deadline is audited');
update private.discovery_previews set deadline_at = now() - interval '121 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), '{}'),
  '{"state":"expired"}'::jsonb, 'after the grace, with the pass over, nothing more is served, not even a replay');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false),
  '{"state":"expired"}'::jsonb, 'and the exam page fails closed');
reset role;
-- The deadline is exact: a sheet before it is marked in full, one second after it nothing is accepted.
update public.entitlement_grants set starts_at = now() - interval '1 hour', ends_at = now() + interval '71 hours'
  where user_id = '71000000-0000-4000-8000-000000000008';
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02'))->>'state', 'ready',
  'a fresh exam opens');
reset role;
update private.discovery_previews set deadline_at = now() + interval '1 microsecond'
  where user_id = '71000000-0000-4000-8000-000000000008';
insert into outcome values ('answers-s-in-time', pg_temp.answers('71000000-0000-4000-8000-000000000008', 50));
set local role service_role;
select is((select jsonb_build_object('score', (r->'preview'->'result'->>'score')::integer,
    'timed_out', (r->'preview'->'result'->>'timed_out')::boolean)
  from public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
    (select result from outcome where step = 'answers-s-in-time')) r),
  '{"score":50,"timed_out":false}'::jsonb, 'a sheet that arrives before the deadline is marked in full');
reset role;
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02'))->>'state', 'ready',
  'another fresh exam opens');
reset role;
update private.discovery_previews set deadline_at = now() - interval '1 second'
  where user_id = '71000000-0000-4000-8000-000000000008';
insert into outcome values ('answers-s-unsaved', pg_temp.answers('71000000-0000-4000-8000-000000000008', 50));
set local role service_role;
select is((select jsonb_build_object('score', (r->'preview'->'result'->>'score')::integer,
    'timed_out', (r->'preview'->'result'->>'timed_out')::boolean)
  from public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
    (select result from outcome where step = 'answers-s-unsaved')) r),
  '{"score":0,"timed_out":true}'::jsonb,
  'one second after the deadline nothing is accepted: with nothing saved, the exam closes unanswered');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false)
  ->'preview'->'result'->>'timed_out', 'true', 'the closed exam shows its review');
reset role;

-- 4c. An exam is exactly 50 valid questions, or it does not open -------------------------------------------------------
-- Course 01 publishes exactly 50 questions. One malformed revision leaves 49 valid ones.
create temporary table discovery_q_fixture on commit drop as
  select r.item_id, r.revision, r.payload from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  where i.course_id = pg_temp.c('01') and i.kind = 'cbt_question' order by i.id limit 1;
update public.managed_content_revisions r set payload = r.payload - 'correctOption'
  from discovery_q_fixture f where r.item_id = f.item_id and r.revision = f.revision;
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('01'), 'cbt', false, null, 1800),
  '{"state":"nothing-to-preview"}'::jsonb, 'a course with 49 valid questions offers no exam');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('01')),
  '{"state":"nothing-to-preview"}'::jsonb, 'and opening one fails');
reset role;
select is((select count(*)::integer from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'),
  0, 'without consuming the lifetime exam');
update public.managed_content_revisions r set payload = f.payload
  from discovery_q_fixture f where r.item_id = f.item_id and r.revision = f.revision;
set local role service_role;
insert into outcome values ('s-fifty', pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('01')));
select is((select jsonb_array_length(result->'preview'->'questions') from outcome where step = 's-fifty'), 50,
  'with all 50 valid, the exam opens with exactly 50');
reset role;
select is((select count(distinct q->>'item_id')::integer from private.discovery_previews p,
    jsonb_array_elements(p.content) q where p.user_id = '71000000-0000-4000-8000-000000000008'), 50,
  'fifty distinct questions, each with a markable key');
select ok((select bool_and(private.discovery_cbt_question_valid(jsonb_build_object('prompt', q->'prompt',
    'options', q->'options', 'correctOption', q->'correct_option'))) from private.discovery_previews p,
    jsonb_array_elements(p.content) q where p.user_id = '71000000-0000-4000-8000-000000000008'),
  'every pinned question is valid');

-- 4d. Previews belong to actively offered courses only -------------------------------------------------------------
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('07'), 'study_guide', false),
  '{"state":"not-offered"}'::jsonb, 'a repository-only course is in no active catalogue and offers no preview');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000004', pg_temp.c('07')),
  '{"state":"no-pass"}'::jsonb, 'without a pass the answer is unchanged');
reset role;
-- BUA201 (course 02) loses every active offering: its identity, content and history stay, the previews close.
create temporary table discovery_offering_fixture on commit drop as
  select a.* from public.course_applicability a join public.institutional_courses c on c.id = a.institutional_course_id
  where c.repository_course_id = pg_temp.c('02');
select ok((select count(*) from discovery_offering_fixture) > 0, 'BUA201 is offered before the change');
update public.academic_periods set is_active = false
  where id in (select academic_period_id from discovery_offering_fixture);
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false),
  '{"state":"not-offered"}'::jsonb, 'an exam already opened on a course no longer offered is not served');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), '{}'),
  '{"state":"not-offered"}'::jsonb, 'nor graded');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), '{}', 1),
  '{"state":"not-offered"}'::jsonb, 'nor saved');
reset role;
select ok(exists (select 1 from public.institutional_courses where repository_course_id = pg_temp.c('02'))
  and exists (select 1 from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000001'),
  'the historical identity and the pinned exam are kept');
update public.academic_periods set is_active = true
  where id in (select academic_period_id from discovery_offering_fixture);
-- Offered in one active tuple is enough: removing every other mapping keeps the course offered.
delete from public.course_applicability a using discovery_offering_fixture f
  where a.institutional_course_id = f.institutional_course_id and (a.department_id, a.academic_level_id,
    a.academic_period_id) <> (select department_id, academic_level_id, academic_period_id from discovery_offering_fixture
      order by department_id, academic_level_id, academic_period_id limit 1);
select ok(private.course_has_active_offering(pg_temp.c('02')), 'one active offering anywhere keeps the course offered');
insert into public.course_applicability select * from discovery_offering_fixture on conflict do nothing;
select is((select count(*) from public.course_applicability a join discovery_offering_fixture f
  using (institutional_course_id, department_id, academic_level_id, academic_period_id)),
  (select count(*) from discovery_offering_fixture), 'the offering is restored for the remaining tests');

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
-- The exam was taken a day earlier, so its replay grace is long over.
update private.discovery_previews set deadline_at = now() - interval '1 day'
  where user_id = '71000000-0000-4000-8000-000000000001' and kind = 'cbt';
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
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000011', pg_temp.claim('disc-p@example.test'))->>'state', 'already-activated',
  'nor can the account start a second pass from a new session: a revoked pass was its one pass');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000002', pg_temp.claim('disc-q@example.test'))->>'state', 'activated',
  'another account is another pass: one per account, which is not one per person');

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

-- 8. Account deletion: the previews go, the email claim stays ---------------------------------------------------------
set local role service_role;
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000005', pg_temp.claim('disc-r@example.test'))->>'state', 'activated', 'R starts a pass');
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
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000006', pg_temp.claim('disc-r@example.test'))->>'state', 'already-claimed',
  're-registering with the same email cannot buy a second pass');
reset role;

-- 9. AI on a pass: one accepted upload, one delivered set of five, bounded attempts and text -------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('71000000-0000-4000-8000-000000000007', 'disc-ai@example.test'),
  ('71000000-0000-4000-8000-000000000009', 'disc-ai2@example.test')) fixture_users(id, email);
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000007', '71000000-0000-4000-8000-000000000007', now(), now()),
  ('72000000-0000-4000-8000-000000000009', '71000000-0000-4000-8000-000000000009', now(), now());
insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
  select user_id::uuid, 'trial', 'discovery', now(), now() + make_interval(hours => discovery_hours), 'capped',
    discovery_ai_generations, 'test' from private.entitlement_policy,
    unnest(array['71000000-0000-4000-8000-000000000007', '71000000-0000-4000-8000-000000000009']) user_id;
insert into outcome values ('acc101', to_jsonb((select id from public.institutional_courses where course_code = 'ACC101')));
-- Reserve one upload slot for the student with the given session, as the upload page does before sending a file.
create function pg_temp.reserve(p_session uuid) returns uuid language sql security definer as $$
  select (public.create_ai_practice_document(p_session,
    (select (result #>> '{}')::uuid from outcome where step = 'acc101'), 'n.txt', 'text/plain', 100, array['trial'])
    ->> 'document_id')::uuid $$;
-- Claim and settle a reserved upload with the given text, returning the settle answer and the stored status.
create function pg_temp.settle(p_session uuid, p_doc uuid, p_text text) returns jsonb language plpgsql security definer as $$
declare v_claim uuid; v_settled boolean;
begin
  v_claim := (public.claim_ai_practice_extraction(p_session, p_doc) ->> 'claim_id')::uuid;
  v_settled := public.settle_ai_practice_document(p_session, p_doc, v_claim, null,
    p_text, encode(sha256(convert_to(p_text, 'UTF8')), 'hex'), 200);
  return jsonb_build_object('reserved', true, 'settled', v_settled, 'document', p_doc, 'status',
    (select status || coalesce(':' || rejection_reason, '') from public.ai_practice_documents where id = p_doc));
end $$;
create function pg_temp.upload(p_text text) returns jsonb language plpgsql security definer as $$
declare v_doc uuid;
begin
  v_doc := pg_temp.reserve('72000000-0000-4000-8000-000000000007');
  if v_doc is null then return jsonb_build_object('reserved', false); end if;
  return pg_temp.settle('72000000-0000-4000-8000-000000000007', v_doc, p_text);
end $$;
grant execute on function pg_temp.reserve(uuid), pg_temp.settle(uuid, uuid, text), pg_temp.upload(text) to service_role;
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

-- Two uploads reserved one after the other before either is read (two tabs, or a quick second try): only the first to
-- become ready is accepted, and the other is rejected for free.
set local role service_role;
insert into outcome values ('pre-a', to_jsonb(pg_temp.reserve('72000000-0000-4000-8000-000000000009'))),
  ('pre-b', to_jsonb(pg_temp.reserve('72000000-0000-4000-8000-000000000009')));
select ok((select bool_and(result <> 'null'::jsonb) from outcome where step in ('pre-a', 'pre-b')),
  'both slots are reserved while nothing has been accepted yet');
select is(pg_temp.settle('72000000-0000-4000-8000-000000000009',
    (select (result #>> '{}')::uuid from outcome where step = 'pre-a'), repeat('alpha ', 300)) - 'document',
  '{"reserved":true,"settled":true,"status":"ready"}'::jsonb, 'the first to be read is accepted');
select is(pg_temp.settle('72000000-0000-4000-8000-000000000009',
    (select (result #>> '{}')::uuid from outcome where step = 'pre-b'), repeat('bravo ', 300)) - 'document',
  '{"reserved":true,"settled":false,"status":"rejected:pass-upload-limit"}'::jsonb,
  'the second reserved upload cannot also become ready: it is rejected as the pass limit');
select is(pg_temp.reserve('72000000-0000-4000-8000-000000000009'), null, 'and no further slot is reserved');
reset role;
select is((select count(*)::integer from private.discovery_ai_uploads u join public.entitlement_grants g on g.id = u.grant_id
  where g.user_id = '71000000-0000-4000-8000-000000000009'), 1, 'exactly one accepted upload is recorded for the pass');
select is((select count(*)::integer from public.ai_practice_documents
  where user_id = '71000000-0000-4000-8000-000000000009' and status = 'ready'), 1, 'and exactly one document is ready');

-- A set the pass delivers: exactly five questions in the stored shape the student view reads back.
create function pg_temp.question(p_n integer, p_doc uuid) returns jsonb language sql as $$
  select jsonb_build_object('id', 'ai_' || lpad(to_hex(p_n), 24, '0'), 'prompt', 'Question ' || p_n || '?',
    'options', jsonb_build_array('A', 'B', 'C', 'D'), 'correctOption', p_n % 4, 'explanation', 'Because.',
    'section', 'General', 'grounding', jsonb_build_object('documentId', p_doc, 'sourceSha256', repeat('a', 64),
      'passageId', 'P1', 'passageStart', 0, 'passageEnd', 10, 'quote', 'a quoted passage')) $$;
create function pg_temp.question_set(p_questions jsonb) returns jsonb language sql as $$
  select jsonb_build_object('formatVersion', 1, 'origin', 'ai-generated', 'visibility', 'personal',
    'verification', 'unverified', 'source', jsonb_build_object('fileName', 'n.txt'), 'questions', p_questions) $$;
create function pg_temp.full_set(p_doc uuid) returns jsonb language sql as $$
  select pg_temp.question_set((select jsonb_agg(pg_temp.question(n, p_doc)) from generate_series(1, 5) n)) $$;
create function pg_temp.begin_and_finish(p_status text, p_set jsonb default null) returns text language plpgsql as $$
declare v_state jsonb; v_doc uuid := (select (result->>'document')::uuid from outcome where step = 'upload-1');
begin
  v_state := public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000007', gen_random_uuid(), v_doc,
    array['trial']);
  if v_state->>'state' <> 'started' then return v_state->>'state'; end if;
  return public.finish_ai_practice_generation('71000000-0000-4000-8000-000000000007', (v_state->>'generation_id')::uuid,
    p_status, case when p_status = 'failed' then 'timeout' end,
    case when p_status = 'generated' then coalesce(p_set, pg_temp.full_set(v_doc)) end, null) ->> 'status';
end $$;
grant execute on function pg_temp.question(integer, uuid), pg_temp.question_set(jsonb), pg_temp.full_set(uuid),
  pg_temp.begin_and_finish(text, jsonb) to service_role;
insert into outcome values ('four-questions', pg_temp.question_set((select jsonb_agg(pg_temp.question(n,
  (select (result->>'document')::uuid from outcome where step = 'upload-1'))) from generate_series(1, 4) n)));
set local role service_role;
select is(pg_temp.begin_and_finish('generated', (select result from outcome where step = 'four-questions')), 'failed',
  'a set of four questions is never delivered on a pass: it is recorded as a failed attempt');
reset role;
select is((select jsonb_build_object('status', status, 'reason', outcome_reason, 'set', question_set is not null)
  from public.ai_practice_generations where user_id = '71000000-0000-4000-8000-000000000007'),
  '{"status":"failed","reason":"incomplete-set","set":false}'::jsonb, 'nothing partial is stored');
select is((select state from public.ai_usage_events where user_id = '71000000-0000-4000-8000-000000000007'), 'released',
  'and the one set is not spent on it');
set local role service_role;
select is(pg_temp.begin_and_finish('failed'), 'failed', 'a second attempt fails at the provider');
select is(pg_temp.begin_and_finish('generated'), 'generated',
  'the third attempt delivers exactly five valid questions: the failures cost nothing');
select is(public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000007', gen_random_uuid(),
  (select (result->>'document')::uuid from outcome where step = 'upload-1'), array['trial'])->>'state',
  'allowance-exhausted', 'the one set is used and nothing replenishes');
reset role;
select is((select count(*)::integer from public.ai_usage_events where user_id = '71000000-0000-4000-8000-000000000007'
  and state = 'consumed'), 1, 'exactly one set was charged');
select is((select jsonb_array_length(question_set->'questions') from public.ai_practice_generations
  where user_id = '71000000-0000-4000-8000-000000000007' and status = 'generated'), 5, 'and it holds five questions');
-- With the set unspent, the partial and failed attempts still count toward the three-attempt ceiling.
update public.ai_usage_events set state = 'released', settled_at = now()
  where user_id = '71000000-0000-4000-8000-000000000007' and state = 'consumed';
set local role service_role;
select is(pg_temp.begin_and_finish('failed'), 'allowance-exhausted',
  'after three attempts, the partial one included, no further provider call is admitted');
reset role;
update public.ai_usage_events set state = 'consumed'
  where id = (select usage_event_id from public.ai_practice_generations
    where user_id = '71000000-0000-4000-8000-000000000007' and status = 'generated');
-- A malformed five-question set (a duplicate id, or a missing quote) is no more deliverable than a short one.
select ok(not private.discovery_ai_set_complete(pg_temp.question_set((select jsonb_agg(pg_temp.question(1, gen_random_uuid()))
  from generate_series(1, 5)))), 'five copies of one question are not a set of five');
select ok(not private.discovery_ai_set_complete(pg_temp.question_set((select jsonb_agg(case when n = 3
    then pg_temp.question(n, gen_random_uuid()) #- '{grounding,quote}' else pg_temp.question(n, gen_random_uuid()) end)
  from generate_series(1, 5) n))), 'a question without its grounding quote cannot be shown, so the set is incomplete');
select ok(private.discovery_ai_set_complete(pg_temp.full_set(gen_random_uuid())), 'five valid questions are complete');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000007"}';
select is((select (a->>'source_char_limit')::integer from public.get_my_ai_allowance() a), 20000,
  'the page is told the Discovery text limit');
reset role;

-- Only an upload this pass accepted, within its limit, can be spent on it. AI2 still has its whole set and attempts.
-- An Early Access upload kept from before the pass (no pass recorded), a pass document that was never accepted, and an
-- accepted one over the text limit are all refused before any provider call.
insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name, media_type,
  declared_bytes, expires_at, status, source_text, source_sha256, word_count, discovery_grant_id)
select doc.id, '71000000-0000-4000-8000-000000000009', (select (result #>> '{}')::uuid from outcome where step = 'acc101'),
  '71000000-0000-4000-8000-000000000009/' || doc.id, 'old.txt', 'text/plain', 10, now() + interval '1 day', 'ready',
  doc.body, pg_temp.h(doc.body), 2, case when doc.in_pass then (select id from public.entitlement_grants
    where user_id = '71000000-0000-4000-8000-000000000009') end
from (values ('74000000-0000-4000-8000-000000000091'::uuid, 'early access notes', false),
  ('74000000-0000-4000-8000-000000000092'::uuid, 'never accepted', true),
  ('74000000-0000-4000-8000-000000000093'::uuid, repeat('x', 20001), true)) doc(id, body, in_pass);
insert into private.discovery_ai_uploads (document_id, grant_id)
  select '74000000-0000-4000-8000-000000000093', id from public.entitlement_grants
  where user_id = '71000000-0000-4000-8000-000000000009';
set local role service_role;
select is((select array_agg(public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000009', gen_random_uuid(),
    doc, array['trial', 'early_access'])->>'state' order by doc)
  from unnest(array['74000000-0000-4000-8000-000000000091', '74000000-0000-4000-8000-000000000092',
    '74000000-0000-4000-8000-000000000093']::uuid[]) doc),
  array['document-unavailable', 'document-unavailable', 'document-unavailable'],
  'a historical Early Access upload, an unaccepted one and an over-limit one cannot use the pass');
select is(public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000009', gen_random_uuid(),
  (select (result #>> '{}')::uuid from outcome where step = 'pre-a'), array['trial'])->>'state', 'started',
  'the accepted upload of this pass can');
reset role;
select is((select count(*)::integer from public.ai_usage_events where user_id = '71000000-0000-4000-8000-000000000009'),
  1, 'and only that one reached admission');

-- 10. A seven-day trial issued before the Discovery Pass keeps exactly what it was issued ---------------------------------
-- L's grant is what the phone activation issued before 20261021100000 (the migration marks it 'seven-day').
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000',
  '71000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'disc-legacy@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000010', '71000000-0000-4000-8000-000000000010', now(), now());
insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
  values ('71000000-0000-4000-8000-000000000010', 'trial', 'seven-day', now() - interval '4 days',
    now() + interval '3 days', 'capped', 10, 'student');
select ok(private.has_full_access('71000000-0000-4000-8000-000000000010'), 'a seven-day trial is still full access');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000010","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000010"}';
select ok((select count(*) from public.read_published_managed_content(pg_temp.c('02'))) > 0,
  'every department course stays readable until its own end, four days in');
select is((select jsonb_build_object('tier', e->'tier', 'access', e->'access'->'source', 'policy', e->'trial'->'policy',
    'status', e->'trial'->'status', 'ends', (e->'trial'->>'ends_at')::timestamptz = now() + interval '3 days')
  from public.get_my_entitlement() e),
  '{"tier":"full","access":"trial","policy":"seven-day","status":"active","ends":true}'::jsonb,
  'the summary reports full access through the trial, with its original end');
select is((select jsonb_build_object('total', a->'total', 'source_char_limit', a->'source_char_limit')
  from public.get_my_ai_allowance() a), '{"total":10,"source_char_limit":null}'::jsonb,
  'with its whole ten-set AI allowance and no Discovery text limit');
reset role;
set local role service_role;
select is(public.write_quiz_attempt('72000000-0000-4000-8000-000000000010', '74000000-0000-4000-8000-000000000010',
  pg_temp.c('02'), 1, 'start', null, 'in_progress',
  '[{"question_id":"3d04c5a2-4363-4112-b397-e0191402f275","ordinal":0,"content_revision":1}]')->>'status', 'saved',
  'a regular CBT attempt still starts');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000010', pg_temp.c('02')), '{"state":"full-access"}'::jsonb,
  'previews do not apply: the course itself is open');
reset role;
-- Its AI keeps the shared rules: no pass upload limit, attempt ceiling or five-question rule.
insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name, media_type,
  declared_bytes, expires_at, status, source_text, source_sha256, word_count)
values ('74000000-0000-4000-8000-000000000101', '71000000-0000-4000-8000-000000000010',
  (select (result #>> '{}')::uuid from outcome where step = 'acc101'),
  '71000000-0000-4000-8000-000000000010/74000000-0000-4000-8000-000000000101', 'n.txt', 'text/plain', 10,
  now() + interval '1 day', 'ready', repeat('y', 30000), pg_temp.h(repeat('y', 30000)), 2);
create function pg_temp.legacy_attempt(p_status text) returns text language plpgsql as $$
declare v_state jsonb;
begin
  v_state := public.begin_ai_practice_generation('72000000-0000-4000-8000-000000000010', gen_random_uuid(),
    '74000000-0000-4000-8000-000000000101', array['trial']);
  if v_state->>'state' <> 'started' then return v_state->>'state'; end if;
  return public.finish_ai_practice_generation('71000000-0000-4000-8000-000000000010', (v_state->>'generation_id')::uuid,
    p_status, case when p_status = 'failed' then 'timeout' end, case when p_status = 'generated' then
      pg_temp.question_set(jsonb_build_array(pg_temp.question(1, '74000000-0000-4000-8000-000000000101'))) end,
    null) ->> 'status';
end $$;
grant execute on function pg_temp.legacy_attempt(text) to service_role;
set local role service_role;
select is((select array_agg(pg_temp.legacy_attempt(status) order by n) from unnest(array['failed', 'failed', 'failed',
    'failed', 'generated']) with ordinality as t(status, n)),
  array['failed', 'failed', 'failed', 'failed', 'generated'],
  'more than three attempts, 30,000 characters of text and a one-question set are all accepted as before');
select ok(public.create_ai_practice_document('72000000-0000-4000-8000-000000000010',
    (select (result #>> '{}')::uuid from outcome where step = 'acc101'), 'n.txt', 'text/plain', 100, array['trial'])
  ->>'status' = 'created', 'and uploads are not capped at one');
reset role;
select is((select count(*)::integer from public.ai_practice_documents
  where user_id = '71000000-0000-4000-8000-000000000010' and discovery_grant_id is not null), 0,
  'no upload of a seven-day trial is bound to the Discovery rules');
-- When it ends it is this account's one trial: it never becomes a pass.
update public.entitlement_grants set starts_at = now() - interval '7 days', ends_at = now()
  where user_id = '71000000-0000-4000-8000-000000000010';
select ok(not private.has_full_access('71000000-0000-4000-8000-000000000010'), 'full access ends at its own end');
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000010', pg_temp.c('02')), '{"state":"expired"}'::jsonb,
  'an ended seven-day trial offers no Discovery Pass previews');
reset role;

select * from finish();
rollback;
