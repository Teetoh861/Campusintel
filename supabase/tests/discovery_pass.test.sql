-- supabase/tests/discovery_pass.test.sql — The Discovery Pass that replaced the seven-day trial
-- (20261021100000_discovery_pass.sql): 72 hours on the database clock, one timed 50-question CBT exam and one complete
-- study-guide topic from actively offered courses, pinned and served by the server only, answers withheld until grading
-- and refused after the deadline, one AI upload with one complete set of five questions, no theory preview and no
-- replenishment. Seven-day trials issued before the migration keep their full access and allowance.
-- Time is simulated by moving grant and deadline timestamps: now() is fixed for the whole transaction, but the exam
-- functions decide on clock_timestamp() (the wall clock at the statement), so a deadline that must still be open is set
-- from clock_timestamp() with seconds to spare, and values the functions take from their clock are compared with a
-- tolerance (pg_temp.near).
begin;
select no_plan();
-- Claims and the claim-key registry are global: this transaction starts from an empty ledger (rolled back at the end),
-- so what other sessions of this database have activated with their own keys cannot change these outcomes.
delete from private.discovery_pass_claims;
delete from private.discovery_claim_keys;

-- Structure, privileges and policy ----------------------------------------------------------------------------------
select has_table('private', 'discovery_previews', 'previews table exists');
select ok((select relrowsecurity from pg_class where oid = 'private.discovery_previews'::regclass), 'RLS is enabled');
select is((select count(*)::integer from unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, 'private.discovery_previews', privilege)), 0,
  'no API role can read or write previews directly, so the pinned answer key never leaves through PostgREST');
select is((select count(*)::integer from unnest(array['public.discovery_preview(uuid,uuid,text,boolean,uuid,integer)',
    'public.save_discovery_cbt(uuid,uuid,uuid,integer,integer,jsonb)',
    'public.submit_discovery_cbt(uuid,uuid,uuid,integer,integer,jsonb)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0, 'preview functions are service-role only');
select is((select count(*)::integer from unnest(array['private.discovery_preview_content(uuid,text,uuid)',
    'private.discovery_topic_titles(uuid)', 'private.discovery_preview_view(private.discovery_previews)',
    'private.close_overdue_discovery_exam(uuid)', 'private.discovery_apply_changes(jsonb,jsonb)',
    'private.discovery_reconcile_sheet(private.discovery_previews,uuid,integer,integer,jsonb)']) fn,
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
select ok(to_regprocedure('public.save_discovery_cbt(uuid,uuid,jsonb)') is null
  and to_regprocedure('public.save_discovery_cbt(uuid,uuid,jsonb,integer)') is null
  and to_regprocedure('public.submit_discovery_cbt(uuid,uuid,jsonb)') is null,
  'no save or submission takes a whole sheet: each names its tab, sequence, base revision and changed questions only');
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
-- The keyed claim hashes and key checks the application sends (lib/entitlements/claim-hash.ts), current version first;
-- plain digests stand in for the HMACs. p_replaced lists versions presented under another secret (a different check).
create function pg_temp.claim(p_email text, p_versions integer[] default array[1],
  p_replaced integer[] default array[]::integer[]) returns jsonb language sql immutable as
  $$ select jsonb_agg(jsonb_build_object('version', v, 'hash', pg_temp.h('claim-v' || v || ':' || p_email),
       'check', pg_temp.h('claim-key-check-v' || v || case when v = any(p_replaced) then ':replaced' else '' end))
       order by ordinality) from unnest(p_versions) with ordinality as t(v, ordinality) $$;
grant execute on function pg_temp.claim(text, integer[], integer[]) to authenticated, service_role;
-- A time the functions took from their own clock: at most the suite's running time before now, never after.
create function pg_temp.near(p_actual timestamptz, p_offset interval) returns boolean language sql as
  $$ select p_actual between clock_timestamp() + p_offset - interval '10 minutes'
       and clock_timestamp() + p_offset + interval '1 second' $$;
-- Course fixtures: 02 has 390 CBT questions and notes, 03 is another offered course, 11 has CBT only, 08 is a free GST
-- course, 07 is now linked Financial Accounting I, and 10 remains an unlinked repository course.
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
select ok(pg_temp.near((select (result->'preview'->>'deadline_at')::timestamptz from outcome where step = 'p-cbt'),
  interval '30 minutes'), 'the deadline is set by the database: thirty minutes from opening, on its wall clock');
select ok(pg_temp.near((select (result->>'now')::timestamptz from outcome where step = 'p-cbt'), interval '0')
  and (select (result->>'now')::timestamptz > now() from outcome where step = 'p-cbt'),
  'the server clock sent for the countdown display is the wall clock, not the transaction start');
select is((select (result->'preview'->>'result') from outcome where step = 'p-cbt'), null, 'with no result yet');
select is((select result->'preview'->'saved' from outcome where step = 'p-cbt'), '{"revision":0,"answers":{}}'::jsonb,
  'and no sheet saved yet, at revision zero');
select ok((select result::text !~ '(correct_option|correctOption|explanation)' from outcome where step = 'p-cbt'),
  'no answer key or explanation is sent before grading');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000001', pg_temp.c('02')) - 'now',
  (select result - 'now' from outcome where step = 'p-cbt'), 'a retry or refresh returns the identical exam and deadline');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false) - 'now',
  (select result - 'now' from outcome where step = 'p-cbt'), 'as does a plain read, from any device or session');
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
create function pg_temp.answers(p_user uuid, p_correct integer) returns jsonb language sql security definer as $$
  -- Answers the first p_correct pinned questions correctly and the rest incorrectly.
  select jsonb_object_agg(q->>'item_id', case when position <= p_correct then (q->>'correct_option')::integer
    else ((q->>'correct_option')::integer + 1) % jsonb_array_length(q->'options') end)
  from private.discovery_previews p, jsonb_array_elements(p.content) with ordinality as t(q, position)
  where p.user_id = p_user and p.kind = 'cbt' $$;
-- The pinned question at one position, its correct option and a wrong one, for a student's open exam.
create function pg_temp.q(p_user uuid, p_position integer, out item text, out correct integer, out wrong integer)
  language sql security definer as $$
  select q->>'item_id', (q->>'correct_option')::integer, ((q->>'correct_option')::integer + 1) % jsonb_array_length(q->'options')
  from private.discovery_previews p, jsonb_array_elements(p.content) with ordinality as t(q, position)
  where p.user_id = p_user and p.kind = 'cbt' and position = p_position $$;
-- Browser tabs: each names itself, so the database applies its requests in sequence order.
create function pg_temp.t(p_n integer) returns uuid language sql immutable as
  $$ select ('a0000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
grant execute on function pg_temp.t(integer), pg_temp.answers(uuid, integer), pg_temp.q(uuid, integer)
  to authenticated, service_role;
insert into outcome values ('answers-37', pg_temp.answers('71000000-0000-4000-8000-000000000001', 37)),
  ('answers-50', pg_temp.answers('71000000-0000-4000-8000-000000000001', 50));
set local role service_role;
select throws_ok($$ select public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 1, 0,
  jsonb_build_object(gen_random_uuid()::text, 0)) $$, '22023', null, 'an answer to a question outside the exam is refused');
select throws_ok($$ select public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 1, 0,
  (select jsonb_build_object(key, 99) from outcome, jsonb_each(result) where step = 'answers-37' limit 1)) $$, '22023',
  null, 'an option that does not exist is refused');
select throws_ok($$ select public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 1, 7, '{}') $$, '22023',
  null, 'a tab cannot claim a revision the database never issued');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('03'), pg_temp.t(1), 0, 0, '{}'),
  '{"state":"not-opened"}'::jsonb, 'a course with no opened exam cannot be graded');
-- P answered in one tab that never managed to save: its submission carries the whole sheet as that tab's pending
-- changes over revision 0, and those are laid over the (empty) saved sheet and graded.
insert into outcome values ('p-submit', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001',
  pg_temp.c('02'), pg_temp.t(1), 1, 0, (select result from outcome where step = 'answers-37')));
select is((select result->'preview'->'result'->>'score' || '/' || (result->'preview'->'result'->>'total')
  from outcome where step = 'p-submit'), '37/50', 'the server grades from the pinned key');
select is((select (result->'preview'->'result'->>'timed_out')::boolean from outcome where step = 'p-submit'), false,
  'submitted in time');
select ok((select bool_and(a ? 'correct_option' and a ? 'selected') from outcome,
  jsonb_array_elements(result->'preview'->'result'->'answers') a where step = 'p-submit'),
  'the answer key is revealed only with the result');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 2, 0,
  (select result from outcome where step = 'answers-50'))->'preview'->'result'->>'score', '37',
  'resubmitting better answers cannot change the score: the first grading stands');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(2), 0, 0, '{}') - 'now',
  (select result - 'now' from outcome where step = 'p-submit'), 'a replay from any tab returns the first grading unchanged');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'cbt', false)->'preview'->'result',
  (select result->'preview'->'result' from outcome where step = 'p-submit'), 'a reload shows the same result');
reset role;
select is((select jsonb_build_object('graded_is_saved', answers = saved_answers, 'revision', saved_revision,
    'tab_sequence', (saved_sources -> pg_temp.t(1)::text ->> 'seq')::integer)
  from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000001'),
  '{"graded_is_saved":true,"revision":1,"tab_sequence":1}'::jsonb,
  'the submission laid the pending changes over the saved sheet in the same write (revision 1) and graded that sheet');
select is((select detail->'pending_applied' from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000001'
    and event = 'discovery.exam-submitted'), 'true'::jsonb, 'and the audit says the pending changes were applied');

-- 4b. The exam clock: the whole duration or nothing, answers saved until the deadline, nothing accepted after it ------
-- S has ten minutes (and a little, for the time this suite takes) of pass left on the wall clock.
update public.entitlement_grants set ends_at = clock_timestamp() + interval '10 minutes 30 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
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
select ok(pg_temp.near((select (result->'preview'->>'deadline_at')::timestamptz from outcome where step = 's-cbt'),
  interval '10 minutes'), 'a ten-minute exam that fits opens with its whole duration');
reset role;
insert into outcome values ('answers-s-saved', pg_temp.answers('71000000-0000-4000-8000-000000000008', 10)),
  ('answers-s-20', pg_temp.answers('71000000-0000-4000-8000-000000000008', 20)),
  ('answers-s-30', pg_temp.answers('71000000-0000-4000-8000-000000000008', 30)),
  ('answers-s-all', pg_temp.answers('71000000-0000-4000-8000-000000000008', 50));
set local role service_role;
-- Tab A saves its first ten answers: its changes over revision 0, at its own sequence 1.
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1, 0,
  (select result from outcome where step = 'answers-s-saved')) - 'now' - 'deadline_at',
  (select jsonb_build_object('state', 'saved', 'revision', 1, 'answers', result) from outcome where step = 'answers-s-saved'),
  'changes are saved while the exam is open, and the answer carries the revision and the whole sheet that now stands');
select ok(pg_temp.near((public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 0, 0, '{}')
  ->>'deadline_at')::timestamptz, interval '10 minutes'), 'a sync (no changes) answers with the deadline too, for the countdown');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(3), 0, 0, '{}') - 'now' - 'deadline_at',
  (select jsonb_build_object('state', 'saved', 'revision', 1, 'answers', result) from outcome where step = 'answers-s-saved'),
  'and changes nothing: the sheet and its revision stand');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 2, 1,
  jsonb_build_object(gen_random_uuid()::text, 0)) $$, '22023', null, 'a change to a question outside the exam is refused');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 2, 1,
  (select jsonb_build_object(key, 'x') from outcome, jsonb_each(result) where step = 'answers-s-saved' limit 1)) $$, '22023',
  null, 'a change that is not an option is refused');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), null, 1, '{}') $$,
  '22023', null, 'a save without a sequence is refused');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1000001, 1, '{}') $$,
  '22023', null, 'nor one beyond the bound');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 2, 5, '{}') $$,
  '22023', null, 'nor one based on a revision the database never issued');
select throws_ok($$ select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), null, 2, 1, '{}') $$,
  '22023', null, 'nor one from no tab');
-- Requests of one tab arrive out of order: sequence 3 (twenty correct) lands first, then the delayed sequence 2 with
-- better answers.
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 3, 1,
  (select result from outcome where step = 'answers-s-20')) - 'now' - 'deadline_at',
  (select jsonb_build_object('state', 'saved', 'revision', 2, 'answers', result) from outcome where step = 'answers-s-20'),
  'the third change is applied over revision 1: revision 2');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 2, 1,
  (select result from outcome where step = 'answers-s-all')) - 'now' - 'deadline_at',
  (select jsonb_build_object('state', 'stale', 'revision', 2, 'answers', result) from outcome where step = 'answers-s-20'),
  'an older request of the same tab arriving later is answered as stale with the sheet that stands, not applied');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 3, 1,
  (select result from outcome where step = 'answers-s-20')) - 'now' - 'deadline_at',
  (select jsonb_build_object('state', 'saved', 'revision', 2, 'answers', result) from outcome where step = 'answers-s-20'),
  'a retry of the applied request is acknowledged as saved without another write');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 3, 2,
  (select result from outcome where step = 'answers-s-saved'))->>'state', 'saved',
  'a request at the applied sequence is a replay: acknowledged');
reset role;
select is((select jsonb_build_object('revision', saved_revision, 'sheet', saved_answers = result)
    from private.discovery_previews, outcome where user_id = '71000000-0000-4000-8000-000000000008' and step = 'answers-s-20'),
  '{"revision":2,"sheet":true}'::jsonb, 'and never applied: the sheet and its revision are unchanged');
-- Regression (Codex review, unresolved at 2cc9300): tab A changes Q1 and saves. Tab B, still holding the sheet at
-- revision 2 with the old Q1, changes Q2 twice before it saves: one request naming Q2 only. Q1 must not revert.
insert into outcome select 'q1', to_jsonb(item) from pg_temp.q('71000000-0000-4000-8000-000000000008', 1);
insert into outcome select 'q2', to_jsonb(item) from pg_temp.q('71000000-0000-4000-8000-000000000008', 2);
insert into outcome select 'q3', to_jsonb(item) from pg_temp.q('71000000-0000-4000-8000-000000000008', 3);
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 4, 2,
    (select jsonb_build_object(result #>> '{}', 1) from outcome where step = 'q1'))->'answers'
    -> (select result #>> '{}' from outcome where step = 'q1'), '1'::jsonb,
  'tab A changes Q1 to option B: revision 3');
insert into outcome values ('b-save', public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 2, 2,
  (select jsonb_build_object(result #>> '{}', 1) from outcome where step = 'q2')));
select is((select jsonb_build_object('state', b.result->>'state', 'revision', b.result->'revision',
    'q1', b.result->'answers'->(q1.result #>> '{}'), 'q2', b.result->'answers'->(q2.result #>> '{}'))
  from outcome b, outcome q1, outcome q2 where b.step = 'b-save' and q1.step = 'q1' and q2.step = 'q2'),
  '{"state":"saved","revision":4,"q1":1,"q2":1}'::jsonb,
  'tab B''s save (revision 4) keeps tab A''s Q1 and adds its own Q2: a question a tab never touched is never overwritten');
reset role;
select is((select jsonb_build_object('q1', p.saved_answers->(q1.result #>> '{}'), 'q2', p.saved_answers->(q2.result #>> '{}'),
    'revision', p.saved_revision, 'tabs', (select count(*) from jsonb_object_keys(p.saved_sources)))
  from private.discovery_previews p, outcome q1, outcome q2 where p.user_id = '71000000-0000-4000-8000-000000000008'
    and q1.step = 'q1' and q2.step = 'q2'),
  '{"q1":1,"q2":1,"revision":4,"tabs":2}'::jsonb, 'the database holds both tabs'' answers and each tab''s sequence');
-- Policy: a question changed on two tabs takes the change that reaches the database last; every tab is answered
-- with the sheet that stands.
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 5, 3,
    (select jsonb_build_object(result #>> '{}', 1) from outcome where step = 'q3'))->'answers'
    -> (select result #>> '{}' from outcome where step = 'q3'), '1'::jsonb, 'tab A chooses B for Q3 (revision 5)');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 3, 4,
    (select jsonb_build_object(result #>> '{}', 2) from outcome where step = 'q3'))->'answers'
    -> (select result #>> '{}' from outcome where step = 'q3'), '2'::jsonb,
  'tab B then chooses C for Q3 (revision 6): the change that reaches the database last stands');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 6, 5,
    (select jsonb_build_object(result #>> '{}', 1) from outcome where step = 'q1'))->'answers'
    -> (select result #>> '{}' from outcome where step = 'q3'), '2'::jsonb,
  'and tab A''s next save (revision 7) is answered with that sheet, so it shows C too');
-- Regression (Codex finding 1): answer 0, then answer 1, with the older request completing last. 1 must remain.
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 8, 7,
  (select jsonb_build_object(result #>> '{}', 1) from outcome where step = 'q1'))->>'state', 'saved',
  'the newer change (answer 1, sequence 8) lands first: revision 8');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 7, 7,
  (select jsonb_build_object(result #>> '{}', 0) from outcome where step = 'q1'))->>'state', 'stale',
  'the older change (answer 0, sequence 7) completes last and is refused');
reset role;
select is((select saved_answers -> (select result #>> '{}' from outcome where step = 'q1') from private.discovery_previews
    where user_id = '71000000-0000-4000-8000-000000000008'), '1'::jsonb, 'the final saved answer remains 1');
select is((select jsonb_build_object('revision', saved_revision, 'applied', (saved_sources -> pg_temp.t(1)::text ->> 'seq')::integer)
    from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'),
  '{"revision":8,"applied":8}'::jsonb, 'the newest accepted change stands: an older request never overwrites it');
insert into outcome select 's-sheet-8', jsonb_build_object('revision', 8, 'answers', saved_answers)
  from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false)->'preview'->'saved',
  (select result from outcome where step = 's-sheet-8'),
  'a reload or another device is given the saved sheet and its revision to continue from');
reset role;
-- A change seconds before the deadline is saved: the deadline is the only cut-off.
update private.discovery_previews set deadline_at = clock_timestamp() + interval '10 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 9, 8,
  (select result from outcome where step = 'answers-s-30')) - 'now' - 'deadline_at',
  (select jsonb_build_object('state', 'saved', 'revision', 9, 'answers', result) from outcome where step = 'answers-s-30'),
  'changes saved seconds before the deadline are accepted');
reset role;
-- Regression (Codex F6): the cutoff is the wall clock at the write, never the transaction's start time. This
-- transaction began long before the deadline set here, as a request that queued behind a lock across the deadline
-- does; once the deadline has passed, the save must not be applied, and the exam closes from the sheet saved in time.
update private.discovery_previews set deadline_at = clock_timestamp() + interval '1 second'
  where user_id = '71000000-0000-4000-8000-000000000008';
select pg_sleep(1.5);
select ok((select deadline_at > now() from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'),
  'on the transaction-start clock the deadline has not passed');
set local role service_role;
insert into outcome values ('s-after-lock', public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 10, 9,
  (select result from outcome where step = 'answers-s-all')));
select is((select jsonb_build_object('state', result->>'state', 'score', (result->'preview'->'result'->>'score')::integer,
    'timed_out', (result->'preview'->'result'->>'timed_out')::boolean) from outcome where step = 's-after-lock'),
  '{"state":"ready","score":30,"timed_out":true}'::jsonb,
  'a perfect sheet whose request began before the deadline but reached the row after it is not saved: the exam closed on the wall clock from the sheet saved in time');
reset role;
select is((select saved_revision from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'), 9,
  'the late changes were not written');
-- Deadline plus 60 seconds: the deadline passed a minute ago, and with it the pass.
update private.discovery_previews set deadline_at = now() - interval '60 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
update public.entitlement_grants set ends_at = now() - interval '60 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 11, 9,
  (select result from outcome where step = 'answers-s-all'))->'preview'->'result'->>'score', '30',
  'a save 60 seconds after the deadline changes nothing: the exam was marked from the sheet saved in time');
insert into outcome values ('s-late', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008',
  pg_temp.c('02'), pg_temp.t(1), 11, 9, (select result from outcome where step = 'answers-s-all')));
select is((select jsonb_build_object('score', (result->'preview'->'result'->>'score')::integer,
    'timed_out', (result->'preview'->'result'->>'timed_out')::boolean) from outcome where step = 's-late'),
  '{"score":30,"timed_out":true}'::jsonb,
  'a perfect sheet submitted 60 seconds after the deadline is not marked: only the answers saved before it count');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 0, 0, '{}')
    ->'preview'->>'saved', null, 'a graded exam carries its result, not an open sheet');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 0, 0, '{}') - 'now',
  (select result - 'now' from outcome where step = 's-late'),
  'inside the network grace a lost response replays the committed result, even just after the pass ended');
reset role;
select ok(exists (select 1 from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000008'
  and event = 'discovery.exam-timed-out'), 'closing at the deadline is audited');
update private.discovery_previews set deadline_at = now() - interval '121 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 0, 0, '{}'),
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
update private.discovery_previews set deadline_at = clock_timestamp() + interval '10 seconds'
  where user_id = '71000000-0000-4000-8000-000000000008';
insert into outcome values ('answers-s-in-time', pg_temp.answers('71000000-0000-4000-8000-000000000008', 50));
set local role service_role;
select is((select jsonb_build_object('score', (r->'preview'->'result'->>'score')::integer,
    'timed_out', (r->'preview'->'result'->>'timed_out')::boolean)
  from public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1, 0,
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
  from public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1, 0,
    (select result from outcome where step = 'answers-s-unsaved')) r),
  '{"score":0,"timed_out":true}'::jsonb,
  'one second after the deadline nothing is accepted: with nothing saved, the exam closes unanswered');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), 'cbt', false)
  ->'preview'->'result'->>'timed_out', 'true', 'the closed exam shows its review');
reset role;

-- 4e. A submission reconciles pending changes exactly as a save does (Codex review, unresolved at 2cc9300) ------------
-- Tab A saves an older sheet; tab B saves a newer answer; tab A submits without another edit. The grading must
-- include tab B's answer: the database grades the sheet it holds, never the stale copy a tab happens to have.
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02'))->>'state', 'ready', 'a fresh exam opens for the submission cases');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1, 0,
  pg_temp.answers('71000000-0000-4000-8000-000000000008', 10))->>'revision', '1', 'tab A saves ten correct answers (revision 1)');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 1, 1,
  (select jsonb_build_object(item, correct) from pg_temp.q('71000000-0000-4000-8000-000000000008', 11)))->>'revision', '2',
  'tab B, holding revision 1, saves the correct answer to Q11 (revision 2)');
insert into outcome values ('a-stale-submit', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  pg_temp.t(1), 1, 1, '{}'));
select is((select jsonb_build_object('score', (result->'preview'->'result'->>'score')::integer,
    'timed_out', (result->'preview'->'result'->>'timed_out')::boolean) from outcome where step = 'a-stale-submit'),
  '{"score":11,"timed_out":false}'::jsonb,
  'tab A, still holding revision 1 with nothing pending, submits: the sheet graded includes tab B''s Q11 (11, not 10)');
select is((select a->'selected' from outcome, jsonb_array_elements(result->'preview'->'result'->'answers') a
    where step = 'a-stale-submit' and a->>'item_id' = (select item from pg_temp.q('71000000-0000-4000-8000-000000000008', 11))),
  (select to_jsonb(correct) from pg_temp.q('71000000-0000-4000-8000-000000000008', 11)), 'and names tab B''s answer as the one marked');
reset role;
select is((select jsonb_build_object('graded_is_saved', answers = saved_answers, 'revision', saved_revision)
    from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'), '{"graded_is_saved":true,"revision":2}'::jsonb,
  'nothing was applied: the sheet graded is the saved sheet at revision 2');
select is((select detail->'pending_applied' from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000008'
    and event = 'discovery.exam-submitted' order by id desc limit 1), 'false'::jsonb, 'audited as graded without pending changes');
-- A submission with valid pending changes, one of them to a question another tab changed since: the new change
-- counts, the conflicting one stands over the other tab's (the change that reaches the database last), and the
-- other tab's untouched answer is kept. Score: ten from tab A, Q12 from tab B, Q13 from tab A; Q11 wrong again.
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02'))->>'state', 'ready', 'another fresh exam opens');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1, 0,
  pg_temp.answers('71000000-0000-4000-8000-000000000008', 10))->>'revision', '1', 'tab A saves ten correct answers');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 1, 1,
  (select jsonb_build_object(q11.item, q11.correct, q12.item, q12.correct)
    from pg_temp.q('71000000-0000-4000-8000-000000000008', 11) q11, pg_temp.q('71000000-0000-4000-8000-000000000008', 12) q12))->>'revision', '2',
  'tab B saves correct answers to Q11 and Q12 (revision 2)');
insert into outcome values ('a-dirty-submit', public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'),
  pg_temp.t(1), 2, 1, (select jsonb_build_object(q13.item, q13.correct, q11.item, q11.wrong)
    from pg_temp.q('71000000-0000-4000-8000-000000000008', 11) q11, pg_temp.q('71000000-0000-4000-8000-000000000008', 13) q13)));
select is((select jsonb_build_object('score', (result->'preview'->'result'->>'score')::integer,
    'timed_out', (result->'preview'->'result'->>'timed_out')::boolean) from outcome where step = 'a-dirty-submit'),
  '{"score":12,"timed_out":false}'::jsonb,
  'tab A''s pending Q13 counts, its later Q11 stands over tab B''s, and tab B''s Q12 is kept: 12');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 2, 2,
  (select jsonb_build_object(item, correct) from pg_temp.q('71000000-0000-4000-8000-000000000008', 11)))->'preview'->'result'->>'score', '12',
  'a later submission with better pending changes cannot change the first grading');
reset role;
select is((select jsonb_build_object('graded_is_saved', answers = saved_answers, 'revision', saved_revision,
    'applied', (saved_sources -> pg_temp.t(1)::text ->> 'seq')::integer)
    from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008'), '{"graded_is_saved":true,"revision":3,"applied":2}'::jsonb,
  'the pending changes were written with the grading (revision 3, tab A at sequence 2), so the saved and graded sheets agree');
select is((select detail->'pending_applied' from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000008'
    and event = 'discovery.exam-submitted' order by id desc limit 1), 'true'::jsonb, 'audited as graded with pending changes');
-- 4f. The tab ledger never forgets a watermark (review of 1620315, finding 4): after 64 identities, a tab's delayed
-- older request is still refused, a 65th identity with changes is refused explicitly, existing identities keep
-- saving, and submissions are unaffected. Capacity stays 64.
select is((select discovery_exam_tabs from private.entitlement_policy), 64, 'an exam accepts changes from 64 tab identities');
delete from private.discovery_previews where user_id = '71000000-0000-4000-8000-000000000008';
set local role service_role;
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000008', pg_temp.c('02'))->>'state', 'ready', 'a fresh exam opens for the ledger cases');
-- Tab A applies sequence 2 (answer B for Q1): its sequence 1 (answer A) is still somewhere on the network.
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 2, 0,
  (select jsonb_build_object(item, 1) from pg_temp.q('71000000-0000-4000-8000-000000000008', 1)))->>'revision', '1',
  'tab A saves Q1 = B at its sequence 2');
-- 63 other tab identities each save once: the ledger reaches capacity.
select is((select count(*)::integer from generate_series(2, 64) n,
    lateral (select public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(n), 1, 1,
      (select jsonb_build_object(item, 2) from pg_temp.q('71000000-0000-4000-8000-000000000008', 2))) r) s
    where s.r->>'state' = 'saved'), 63, '63 more tab identities save (64 in the ledger)');
reset role;
select is((select jsonb_build_object('tabs', (select count(*) from jsonb_object_keys(saved_sources)),
    'a_seq', (saved_sources -> pg_temp.t(1)::text ->> 'seq')::integer) from private.discovery_previews
    where user_id = '71000000-0000-4000-8000-000000000008'), '{"tabs":64,"a_seq":2}'::jsonb,
  'the ledger holds all 64 identities, tab A''s watermark (sequence 2) among them');
set local role service_role;
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 1, 1,
  (select jsonb_build_object(item, 0) from pg_temp.q('71000000-0000-4000-8000-000000000008', 1)))->>'state', 'stale',
  'tab A''s delayed sequence 1 is refused as stale after 63 other identities saved');
reset role;
select is((select saved_answers -> (select item from pg_temp.q('71000000-0000-4000-8000-000000000008', 1)) from private.discovery_previews
    where user_id = '71000000-0000-4000-8000-000000000008'), '1'::jsonb, 'Q1 is still B: the older request did not overwrite the newer answer');
set local role service_role;
select is((select jsonb_build_object('state', r->>'state', 'revision', r->'revision',
      'sheet_q3', r->'answers'->(select item from pg_temp.q('71000000-0000-4000-8000-000000000008', 3)))
    from public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(65), 1, 64,
      (select jsonb_build_object(item, 3) from pg_temp.q('71000000-0000-4000-8000-000000000008', 3))) r),
  '{"state":"too-many-tabs","revision":64,"sheet_q3":null}'::jsonb,
  'a 65th identity with changes is refused explicitly, and is told the sheet that stands');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(65), 0, 64, '{}')->>'state', 'saved',
  'a 65th identity with no changes (a sync) is not refused: it reads the sheet');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(2), 2, 64,
  (select jsonb_build_object(item, 3) from pg_temp.q('71000000-0000-4000-8000-000000000008', 3)))->>'revision', '65',
  'an existing identity keeps saving at capacity');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(1), 3, 65,
  (select jsonb_build_object(item, 2) from pg_temp.q('71000000-0000-4000-8000-000000000008', 1)))->>'revision', '66', 'so does tab A');
select is((select jsonb_build_object('state', r->>'state', 'score', r->'preview'->'result'->'score')
    from public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(66), 1, 66,
      (select jsonb_build_object(item, correct) from pg_temp.q('71000000-0000-4000-8000-000000000008', 4))) r),
  '{"state":"too-many-tabs","score":null}'::jsonb, 'a 66th identity submitting WITH pending changes is refused, and the exam stays open');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000008', pg_temp.c('02'), pg_temp.t(66), 0, 66, '{}')
    ->'preview'->'result'->>'total', '50', 'a new identity submitting with nothing pending grades the sheet the database holds');
reset role;
select is((select count(*)::integer from jsonb_object_keys((select saved_sources from private.discovery_previews
    where user_id = '71000000-0000-4000-8000-000000000008'))), 64, 'the ledger never grew past capacity and never evicted');

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
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('10'), 'study_guide', false),
  '{"state":"not-offered"}'::jsonb, 'a repository-only course is in no active catalogue and offers no preview');
select is(pg_temp.open_exam('72000000-0000-4000-8000-000000000004', pg_temp.c('07')),
  '{"state":"no-pass"}'::jsonb, 'without a pass the answer is unchanged');
reset role;
-- The newly confirmed links are choices under the same pass-wide limits; reads spend nothing.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000099',
  'authenticated', 'authenticated', 'linked-course-pass@example.test', 'x', now(), '{}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000099', '71000000-0000-4000-8000-000000000099', now(), now());
set local role service_role;
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000099',
  pg_temp.claim('linked-course-pass@example.test'))->>'state', 'activated', 'a fresh pass can choose linked courses');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000099', pg_temp.c('07'),
  'cbt', false, null, 1800)->>'state', 'available',
  'ACC-CM201 offers cbt under the current Discovery rules');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000099', pg_temp.c('07'),
  'study_guide', false, null, null)->>'state', 'available',
  'ACC-CM201 offers study_guide under the current Discovery rules');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000099', pg_temp.c('05'),
  'cbt', false, null, 1800)->>'state', 'available',
  'LAG-BUA210 offers cbt under the current Discovery rules');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000099', pg_temp.c('05'),
  'study_guide', false, null, null)->>'state', 'available',
  'LAG-BUA210 offers study_guide under the current Discovery rules');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000099', pg_temp.c('06'),
  'cbt', false, null, 1800)->>'state', 'available',
  'LAG-BUA221 offers cbt under the current Discovery rules');
select is(public.discovery_preview('72000000-0000-4000-8000-000000000099', pg_temp.c('06'),
  'study_guide', false, null, null)->>'state', 'available',
  'LAG-BUA221 offers study_guide under the current Discovery rules');
reset role;
select is((select count(*)::integer from private.discovery_previews
  where user_id = '71000000-0000-4000-8000-000000000099'), 0, 'listing choices consumes no preview');

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
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 0, 0, '{}'),
  '{"state":"not-offered"}'::jsonb, 'nor graded');
select is(public.save_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 1, 0, '{}'),
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
  (select (result->'topics'->0->>'item_id')::uuid from outcome where step = 'p-topics')) - 'now',
  (select result - 'now' from outcome where step = 'p-guide'), 'asking for a second topic returns the first: every other topic stays locked');
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

-- 6. Expiry on the database wall clock -------------------------------------------------------------------------------
update public.entitlement_grants set starts_at = clock_timestamp() - interval '72 hours' + interval '10 seconds',
  ends_at = clock_timestamp() + interval '10 seconds' where user_id = '71000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'study_guide', false)->>'state',
  'ready', 'seconds before the end the pass still serves');
reset role;
-- At the end instant (this transaction's start, already behind every wall-clock reading) nothing is served.
update public.entitlement_grants set starts_at = now() - interval '72 hours', ends_at = now()
  where user_id = '71000000-0000-4000-8000-000000000001';
-- The exam was taken a day earlier, so its replay grace is long over.
update private.discovery_previews set deadline_at = now() - interval '1 day'
  where user_id = '71000000-0000-4000-8000-000000000001' and kind = 'cbt';
set local role service_role;
select is(public.discovery_preview('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), 'study_guide', false),
  '{"state":"expired"}'::jsonb, 'at the end instant every preview fails closed, including one already opened');
select is(public.submit_discovery_cbt('72000000-0000-4000-8000-000000000001', pg_temp.c('02'), pg_temp.t(1), 0, 0, '{}'),
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

-- 8b. Key rotation (Codex F5): the ledger remembers the secret each version was written with, and activation fails
-- closed, audited, whenever the configuration cannot verify every unexpired claim. Nothing is granted or claimed then,
-- and no claim is reset: a dropped or replaced key never quietly re-opens the addresses claimed under it.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('71000000-0000-4000-8000-000000000012', 'disc-t@example.test'),
  ('71000000-0000-4000-8000-000000000013', 'disc-u@example.test')) fixture_users(id, email);
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('72000000-0000-4000-8000-000000000012', '71000000-0000-4000-8000-000000000012', now(), now()),
  ('72000000-0000-4000-8000-000000000013', '71000000-0000-4000-8000-000000000013', now(), now());
set local role service_role;
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000012', pg_temp.claim('disc-t@example.test', array[2, 1]))->>'state',
  'activated', 'a rotation puts version 2 in front of version 1: new claims are written under 2, which is now registered');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000013', pg_temp.claim('disc-u@example.test', array[2]))->>'state',
  'claim-key-missing', 'dropping version 1 while unexpired claims were written under it fails closed');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000013', pg_temp.claim('disc-u@example.test', array[2, 1], array[1]))->>'state',
  'claim-key-replaced', 'presenting version 1 under another secret fails closed');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000013', pg_temp.claim('disc-u@example.test', array[3, 2, 1], array[2]))->>'state',
  'claim-key-replaced', 'so does a replaced current key, even behind a newer version');
select throws_ok($$ select public.activate_discovery_pass('72000000-0000-4000-8000-000000000013',
  jsonb_build_array(jsonb_build_object('version', 1, 'hash', repeat('a', 64)))) $$, '22023', null,
  'a claim without its key check is malformed');
reset role;
select ok(not exists (select 1 from public.entitlement_grants where user_id = '71000000-0000-4000-8000-000000000013')
  and not exists (select 1 from private.discovery_pass_claims where user_id = '71000000-0000-4000-8000-000000000013'),
  'a refused activation grants and claims nothing');
select is((select count(*)::integer from (values ('missing', '[1]'::jsonb), ('replaced', '[1]'::jsonb), ('replaced', '[2]'::jsonb)) r(reason, versions)
  where exists (select 1 from private.entitlement_events e where e.event = 'discovery.claim-key-rejected'
    and e.actor = 'system:claim-keys' and e.detail->>'reason' = r.reason and e.detail->'versions' = r.versions)), 3,
  'each refusal is audited with the versions at fault, and no hash, check or address');
select is((select jsonb_agg(key_version order by key_version) from private.discovery_claim_keys), '[1, 2]'::jsonb,
  'the ledger registered versions 1 and 2 on first use; version 3 was never accepted, so it is not registered');
set local role service_role;
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000013', pg_temp.claim('disc-u@example.test', array[2, 1]))->>'state',
  'activated', 'with version 1 retained beside version 2 the activation proceeds');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000006', pg_temp.claim('disc-r@example.test', array[2, 1]))->>'state',
  'already-claimed', 'a claim written under version 1 is still verified, and still blocks its address, while version 2 leads');
select is((select jsonb_agg(r->'key_version' order by r->'key_version') from jsonb_array_elements(public.admin_discovery_claim_keys()->'registered') r),
  '[1, 2]'::jsonb, 'the operator sees which versions are registered');
select ok((select bool_and(r ? 'key_version' and r ? 'claims' and r ? 'last_expires_at' and not r ? 'hash' and not r ? 'check')
  from jsonb_array_elements(public.admin_discovery_claim_keys()->'live') r), 'and which versions live claims need, with counts only');
reset role;

-- 8c. Eligibility before render, Early Access history and five-year retention (owner decisions, 23 Oct 2026) ---------
-- Keys 2 and 1 are live from 8b, so the configuration that verifies every claim is array[2, 1].
select is((select jsonb_build_object('retention', discovery_claim_retention::text, 'trial_after_early_access',
    trial_after_early_access) from private.entitlement_policy), '{"retention":"5 years","trial_after_early_access":false}'::jsonb,
  'claims are kept five years and the post-Early-Access pass is retired');
select ok(exists (select 1 from cron.job where jobname = 'campusintell-discovery-claim-purge' and active
  and schedule = '17 3 * * *' and command = 'select public.purge_discovery_pass_claims()'),
  'expired claims are purged daily, independently of traffic');
select is((select count(*)::integer from unnest(array['anon', 'authenticated']) api_role
  where has_function_privilege(api_role, 'public.discovery_pass_eligibility(uuid,jsonb)', 'EXECUTE'))
  + (select count(*)::integer from unnest(array['private.discovery_early_access_bars(uuid)',
      'private.discovery_claim_keys_sound(jsonb)']) fn, unnest(array['anon', 'authenticated', 'service_role']) api_role
    where has_function_privilege(api_role, fn, 'EXECUTE')), 0,
  'eligibility is service-role only and its helpers are callable by no API role');
select ok(has_function_privilege('service_role', 'public.discovery_pass_eligibility(uuid,jsonb)', 'EXECUTE'),
  'the server can read eligibility');
select is((select provolatile::text from pg_proc where oid = 'public.discovery_pass_eligibility(uuid,jsonb)'::regprocedure), 's',
  'eligibility is STABLE, so it cannot write');
select ok((select every(c.expires_at = c.claimed_at + interval '5 years') from private.discovery_pass_claims c),
  'every claim expires five years after its activation');

-- Fixtures. V: eligible. W: Early Access active. X: Early Access ended. Y: Early Access revoked. Z: registered with an
-- address whose list place a since-deleted account claimed. K: scheduled for deletion. L1: listed, unclaimed, joined
-- before launch. L2: listed, unclaimed, joined after launch. LX: listed but excluded. LC: claimed, then excluded.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('71000000-0000-4000-8000-000000000041', 'disc-v@example.test'),
  ('71000000-0000-4000-8000-000000000042', 'disc-w@example.test'),
  ('71000000-0000-4000-8000-000000000043', 'disc-x@example.test'),
  ('71000000-0000-4000-8000-000000000044', 'disc-y@example.test'),
  ('71000000-0000-4000-8000-000000000045', ' Disc-Z@Example.test'),
  ('71000000-0000-4000-8000-000000000046', 'disc-k@example.test'),
  ('71000000-0000-4000-8000-000000000047', 'disc-l1@example.test'),
  ('71000000-0000-4000-8000-000000000048', 'Disc-L2@example.test'),
  ('71000000-0000-4000-8000-000000000049', 'disc-lx@example.test'),
  ('71000000-0000-4000-8000-000000000050', 'disc-lc@example.test')) fixture_users(id, email);
insert into auth.sessions (id, user_id, created_at, updated_at)
select ('72000000-0000-4000-8000-0000000000' || n)::uuid, ('71000000-0000-4000-8000-0000000000' || n)::uuid, now(), now()
from unnest(array[41, 42, 43, 44, 45, 46, 47, 48, 49, 50]) n;
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by, revoked_at, revoked_by,
  revoke_reason) values
  ('71000000-0000-4000-8000-000000000042', 'early_access', now() - interval '3 days', now() + interval '27 days', 'uncapped',
    'test', null, null, null),
  ('71000000-0000-4000-8000-000000000043', 'early_access', now() - interval '40 days', now() - interval '10 days',
    'uncapped', 'test', null, null, null),
  ('71000000-0000-4000-8000-000000000044', 'early_access', now() - interval '3 days', now() + interval '27 days', 'uncapped',
    'test', now() - interval '1 day', 'ops', 'duplicate person');
insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by, claimed_at)
  values ('disc-z@example.test', 'Z Member', now() - interval '60 days', 'import', 'google-form', 'test',
    now() - interval '20 days');
-- List places that were never claimed. With no actual launch recorded, L1 is awaiting launch; L2 joined after the
-- planned launch (the database checks the actual one, so either way it is listed and not excluded).
insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by, excluded_at,
    excluded_reason, claimed_at) values
  ('disc-l1@example.test', 'L1 Member', now() - interval '10 days', 'import', 'google-form', 'test', null, null, null),
  ('disc-l2@example.test', 'L2 Member', now() + interval '30 days', 'manual', 'whatsapp', 'test', null, null, null),
  ('disc-lx@example.test', 'LX Member', now() - interval '10 days', 'import', 'google-form', 'test', now(), 'duplicate person', null),
  ('disc-lc@example.test', 'LC Member', now() - interval '60 days', 'import', 'google-form', 'test', now(), 'misuse',
    now() - interval '20 days');
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values ('71000000-0000-4000-8000-000000000046', now(), now() + interval '720 hours', now());

set local role service_role;
-- The positive case: an eligible student is offered a pass, and reading that changes nothing.
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000041', pg_temp.claim('disc-v@example.test', array[2, 1])),
  '{"eligible":true}'::jsonb, 'V, who has never had a pass or Early Access, is eligible');
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000041', pg_temp.claim('disc-v@example.test', array[4, 2, 1])),
  '{"eligible":true}'::jsonb, 'a version not yet registered is accepted by the read');
reset role;
select ok(not exists (select 1 from private.discovery_claim_keys where key_version = 4)
  and not exists (select 1 from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000041')
  and not exists (select 1 from private.discovery_pass_claims where user_id = '71000000-0000-4000-8000-000000000041'),
  'but the read registers no key, writes no audit row and claims nothing');
set local role service_role;
-- Fail closed on every fault the activation would refuse, and on anything it cannot verify.
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000041', pg_temp.claim('disc-v@example.test', array[2])),
  '{"eligible":false}'::jsonb, 'a configuration missing a version live claims need is not eligible (claim-key-missing)');
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000041', pg_temp.claim('disc-v@example.test', array[2, 1], array[1])),
  '{"eligible":false}'::jsonb, 'nor one presenting a registered version under another secret (claim-key-replaced)');
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000041', '[]'::jsonb), '{"eligible":false}'::jsonb,
  'malformed hashes are not eligible, without an error');
select is(public.discovery_pass_eligibility(null, pg_temp.claim('disc-v@example.test', array[2, 1])), '{"eligible":false}'::jsonb,
  'no session is not eligible');
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000099', pg_temp.claim('disc-v@example.test', array[2, 1])),
  '{"eligible":false}'::jsonb, 'an unknown session is not eligible');
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000046', pg_temp.claim('disc-k@example.test', array[2, 1])),
  '{"eligible":false}'::jsonb, 'an account scheduled for deletion is not eligible');
-- One pass per account, and per address for five years.
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000001', pg_temp.claim('disc-p@example.test', array[2, 1])),
  '{"eligible":false}'::jsonb, 'P, who has had a pass, is not eligible');
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000006', pg_temp.claim('disc-r@example.test', array[2, 1])),
  '{"eligible":false}'::jsonb, 'R, deleted and registered again with a claimed address, is not eligible');
insert into outcome values ('r-refused', public.activate_discovery_pass('72000000-0000-4000-8000-000000000006',
  pg_temp.claim('disc-r@example.test', array[2, 1])));
reset role;
select is((select result from outcome where step = 'r-refused'), '{"state":"already-claimed","retention_months":60}'::jsonb,
  'activating there anyway is refused (retention_months is kept for builds from before this change; no page shows it)');
select ok(exists (select 1 from private.entitlement_events where user_id = '71000000-0000-4000-8000-000000000006'
    and event = 'discovery.claim-refused')
  and not exists (select 1 from public.entitlement_grants where user_id = '71000000-0000-4000-8000-000000000006'),
  'the refusal is audited and nothing is granted');
-- Any Early Access ever: active, ended, revoked, or a list place claimed for this address by a deleted account.
set local role service_role;
insert into outcome select 'ea-' || label, jsonb_build_object(
    'eligible', public.discovery_pass_eligibility(session_id, pg_temp.claim(email, array[2, 1]))->'eligible',
    'activation', public.activate_discovery_pass(session_id, pg_temp.claim(email, array[2, 1]))->'state')
  from (values ('active', '72000000-0000-4000-8000-000000000042'::uuid, 'disc-w@example.test'),
    ('ended', '72000000-0000-4000-8000-000000000043'::uuid, 'disc-x@example.test'),
    ('revoked', '72000000-0000-4000-8000-000000000044'::uuid, 'disc-y@example.test'),
    ('claimed-list-place', '72000000-0000-4000-8000-000000000045'::uuid, 'disc-z@example.test'),
    ('listed-unclaimed', '72000000-0000-4000-8000-000000000047'::uuid, 'disc-l1@example.test'),
    ('listed-after-launch', '72000000-0000-4000-8000-000000000048'::uuid, 'disc-l2@example.test'),
    ('claimed-then-excluded', '72000000-0000-4000-8000-000000000050'::uuid, 'disc-lc@example.test')) cases(label, session_id, email);
reset role;
select is((select jsonb_object_agg(step, result) from outcome where step like 'ea-%'),
  '{"ea-active":{"eligible":false,"activation":"early-access-active"},"ea-ended":{"eligible":false,"activation":"trial-not-offered"},"ea-revoked":{"eligible":false,"activation":"trial-not-offered"},"ea-claimed-list-place":{"eligible":false,"activation":"trial-not-offered"},"ea-listed-unclaimed":{"eligible":false,"activation":"trial-not-offered"},"ea-listed-after-launch":{"eligible":false,"activation":"trial-not-offered"},"ea-claimed-then-excluded":{"eligible":false,"activation":"trial-not-offered"}}'::jsonb,
  'no account that has had Early Access, or holds a list place that is not excluded, is eligible or can activate');
select is((select jsonb_build_object('l1', private.early_access_status('71000000-0000-4000-8000-000000000047')->>'status',
    'l2', private.early_access_status('71000000-0000-4000-8000-000000000048')->>'status')),
  '{"l1":"awaiting-launch","l2":"awaiting-launch"}'::jsonb, 'L1 and L2 are list members who have claimed nothing');
-- An excluded list place does not bar the pass.
set local role service_role;
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000049', pg_temp.claim('disc-lx@example.test', array[2, 1])),
  '{"eligible":true}'::jsonb, 'LX, whose list place is excluded, is eligible');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000049', pg_temp.claim('disc-lx@example.test', array[2, 1]))->>'state',
  'activated', 'and can start a pass');
reset role;
select ok(not exists (select 1 from public.entitlement_grants where source = 'trial' and user_id in
    ('71000000-0000-4000-8000-000000000042', '71000000-0000-4000-8000-000000000043', '71000000-0000-4000-8000-000000000044',
     '71000000-0000-4000-8000-000000000045', '71000000-0000-4000-8000-000000000047', '71000000-0000-4000-8000-000000000048',
     '71000000-0000-4000-8000-000000000050'))
  and not exists (select 1 from private.discovery_pass_claims where user_id in
    ('71000000-0000-4000-8000-000000000042', '71000000-0000-4000-8000-000000000043', '71000000-0000-4000-8000-000000000044',
     '71000000-0000-4000-8000-000000000045', '71000000-0000-4000-8000-000000000047', '71000000-0000-4000-8000-000000000048',
     '71000000-0000-4000-8000-000000000050')), 'nothing is granted or claimed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000044","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000044"}';
select is((select (e->'trial'->>'status') || '/' || coalesce(e->'trial'->>'available_from', 'none') from public.get_my_entitlement() e),
  'not-offered/none', 'the summary of a revoked Early Access account offers no pass and promises no date');
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000045","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000045"}';
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'not-offered',
  'nor does the summary of an account whose address claimed Early Access before');
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000047","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000047"}';
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'not-offered',
  'nor that of an unclaimed list member');
set local request.jwt.claims = '{"sub":"71000000-0000-4000-8000-000000000041","role":"authenticated","session_id":"72000000-0000-4000-8000-000000000041"}';
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'available', 'while V''s summary offers one');
reset role;

-- Retention: five years from activation. Once R's claim expires the address is eligible again and may start a pass,
-- and the purge removes exactly the expired claims.
update private.discovery_pass_claims set claimed_at = now() - interval '61 months', expires_at = now() - interval '1 month'
  where claim_hash = pg_temp.claim('disc-r@example.test') -> 0 ->> 'hash';
set local role service_role;
select is(public.discovery_pass_eligibility('72000000-0000-4000-8000-000000000006', pg_temp.claim('disc-r@example.test', array[2, 1])),
  '{"eligible":true}'::jsonb, 'an expired claim no longer blocks the address');
select is(public.activate_discovery_pass('72000000-0000-4000-8000-000000000006', pg_temp.claim('disc-r@example.test', array[2, 1]))->>'state',
  'activated', 'so the re-registered account may start a pass, even before the purge');
reset role;
select is((select jsonb_build_object('user', user_id, 'version', key_version, 'fresh', expires_at = now() + interval '5 years')
    from private.discovery_pass_claims where claim_hash = pg_temp.claim('disc-r@example.test', array[2, 1]) -> 0 ->> 'hash'),
  '{"user":"71000000-0000-4000-8000-000000000006","version":2,"fresh":true}'::jsonb,
  'its new claim runs five years from this activation');
insert into private.discovery_pass_claims (claim_hash, key_version, claimed_at, expires_at)
  values (pg_temp.claim('disc-old@example.test') -> 0 ->> 'hash', 1, now() - interval '61 months', now() - interval '1 month'),
    (pg_temp.claim('disc-live@example.test') -> 0 ->> 'hash', 1, now() - interval '59 months', now() + interval '1 month');
insert into outcome select 'live-before-purge', to_jsonb(count(*)) from private.discovery_pass_claims where expires_at > now();
insert into outcome select 'expired-before-purge', to_jsonb(count(*)) from private.discovery_pass_claims where expires_at <= now();
set local role service_role;
insert into outcome values ('purged', to_jsonb(public.purge_discovery_pass_claims()));
reset role;
select is((select result from outcome where step = 'purged'), (select result from outcome where step = 'expired-before-purge'),
  'the purge removes exactly the expired claims');
select ok(not exists (select 1 from private.discovery_pass_claims where expires_at <= now()
    or claim_hash = pg_temp.claim('disc-old@example.test') -> 0 ->> 'hash'), 'including one five years and a month old');
select is((select count(*)::integer from private.discovery_pass_claims),
  (select (result #>> '{}')::integer from outcome where step = 'live-before-purge'), 'and every live claim stays');
select ok(exists (select 1 from private.discovery_pass_claims where claim_hash = pg_temp.claim('disc-live@example.test') -> 0 ->> 'hash'),
  'including one a month short of five years');

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
