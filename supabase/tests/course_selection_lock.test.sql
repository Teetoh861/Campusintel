-- supabase/tests/course_selection_lock.test.sql — A student's courses are set for the semester once any plan has
-- started (20261026100000_course_selection_lock.sql): the rule holds for every writer, saves never unlock, the
-- semester end lifts it, operators change a selection only with an audited name and reason, and a bound pass
-- activation sets exactly the courses the student saw.
-- now() is fixed for the transaction; the lock decides on clock_timestamp(). Past confirmations are written with the
-- guard paused (pg_temp.backdate), which is how a selection made weeks ago is simulated.
begin;
select no_plan();

-- Calendar fixture, independent of whatever dates the team has entered: the previous semester ended about a month ago
-- and the current one resumed 30 days ago.
delete from private.academic_term_extensions;
delete from private.academic_terms;
create temporary table cal on commit drop as
  select (now() at time zone 'Africa/Lagos')::date as today;
insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  select '2025/2026', '30000000-0000-4000-8000-000000000002'::uuid, (today - 30 - interval '5 months')::date, 'test', 'test' from cal
  union all
  select '2026/2027', '30000000-0000-4000-8000-000000000001'::uuid, today - 30, 'test', 'test' from cal;
create temporary table ends on commit drop as
  select private.academic_day_end(min(last_day)) as previous_end, max(last_day) as current_last_day,
    private.academic_day_end(max(last_day)) as current_end
  from private.academic_terms;
grant select on cal, ends to authenticated, service_role;

create function pg_temp.backdate(p_user uuid, p_at timestamptz) returns void language plpgsql as $$
begin
  alter table public.profiles disable trigger profiles_guard_course_selection;
  update public.profiles set selection_confirmed_at = p_at where id = p_user;
  alter table public.profiles enable trigger profiles_guard_course_selection;
end $$;
create function pg_temp.pick(p_user uuid, p_department uuid, p_level uuid, p_period uuid) returns void
language sql as $$
  update public.profiles set first_name = coalesce(first_name, 'Ada'), department_id = p_department,
    academic_level_id = p_level, academic_period_id = p_period where id = p_user;
$$;
create function pg_temp.state(p_user uuid) returns text language sql as
  $$ select private.course_selection_state(p_user)->>'state' $$;
create function pg_temp.grant(p_user uuid, p_source text, p_policy text, p_starts timestamptz, p_ends timestamptz)
returns uuid language sql as $$
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
    values (p_user, p_source, p_policy, p_starts, p_ends,
      case p_source when 'trial' then 'capped' when 'early_access' then 'uncapped' else 'none' end,
      case when p_source = 'trial' then 1 end, 'test')
    returning id;
$$;
create function pg_temp.h(p_value text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(p_value, 'UTF8')), 'hex') $$;
create function pg_temp.claim(p_email text) returns jsonb language sql immutable as
  $$ select jsonb_build_array(jsonb_build_object('version', 1, 'hash', pg_temp.h('claim-v1:' || p_email),
       'check', pg_temp.h('claim-key-check-v1'))) $$;
delete from private.discovery_pass_claims;
delete from private.discovery_claim_keys;

-- Students: A pass active; B no plan; C Early Access, no selection yet; D revoked grant; E previous semester, nothing
-- active; F previous semester, Early Access still running; G pass ended this semester; H seven-day trial; I manual;
-- J paid; K operator subject; L scheduled for deletion; M bound activation; N revoked by an operator.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('c1000000-0000-4000-8000-0000000000' || n)::uuid, 'authenticated',
    'authenticated', 'lock-' || n || '@example.test', now(), now(), now()
  from unnest(array['01','02','03','04','05','06','07','08','09','10','11','12','13','14']) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
  select ('c2000000-0000-4000-8000-0000000000' || n)::uuid, ('c1000000-0000-4000-8000-0000000000' || n)::uuid, now(), now()
  from unnest(array['01','02','03','04','06','07','13','14']) n;
-- Business Administration 200L First Semester for everyone with a selection.
select pg_temp.pick(('c1000000-0000-4000-8000-0000000000' || n)::uuid, '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001')
  from unnest(array['01','02','04','05','06','07','08','09','10','11','12','13','14']) n;

-- Structure and privileges -----------------------------------------------------------------------------------
select has_column('public', 'profiles', 'selection_confirmed_at', 'profiles record when the selection was confirmed');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'selection_confirmed_at', 'UPDATE'),
  'no student can write the confirmation');
select is((select count(*)::integer from unnest(array['private.academic_terms', 'private.academic_term_extensions',
    'private.course_selection_events']) tbl, unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, tbl, privilege)), 0, 'no API role can touch the calendar or the trail');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.academic_terms'::regclass,
  'private.academic_term_extensions'::regclass, 'private.course_selection_events'::regclass)), 'RLS is enabled');
select is((select count(*)::integer from unnest(array['public.admin_set_academic_term(text,text,date,text,text)',
    'public.admin_set_department_end(text,text,text,date,text,text)', 'public.admin_academic_calendar()',
    'public.admin_course_selection_status(uuid)',
    'public.admin_change_course_selection(uuid,text,text,text,bigint,boolean,text,text)',
    'public.activate_discovery_pass(uuid,jsonb,bigint)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0, 'operator functions are service-role only');
select ok(has_function_privilege('authenticated', 'public.get_my_course_selection()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_my_course_selection()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_my_course_selection()', 'EXECUTE'),
  'only a signed-in student reads their own state');
select is((select count(*)::integer from unnest(array['private.course_selection_state(uuid,timestamptz)',
    'private.course_selection_state_for(uuid,uuid,timestamptz,timestamptz)', 'private.guard_course_selection()',
    'private.log_course_selection_event(uuid,uuid,uuid,text,text,jsonb)', 'private.academic_term_ends(uuid)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'the lock helpers are not callable by any API role');
select is((select count(*)::integer from pg_proc p where p.oid in ('public.get_my_course_selection()'::regprocedure,
    'public.admin_change_course_selection(uuid,text,text,text,bigint,boolean,text,text)'::regprocedure,
    'private.guard_course_selection()'::regprocedure)
    and p.prosecdef and p.proconfig @> array['search_path=""']), 3, 'definer functions pin an empty search path');

-- Grants: a pass, Early Access, plans, a revoked one ------------------------------------------------------------
select pg_temp.grant('c1000000-0000-4000-8000-000000000001', 'trial', 'discovery', now(), now() + interval '72 hours');
select pg_temp.grant('c1000000-0000-4000-8000-000000000003', 'early_access', null, now(), now() + interval '1 month');
select pg_temp.grant('c1000000-0000-4000-8000-000000000004', 'manual', null, now(), now() + interval '30 days');
update public.entitlement_grants set revoked_at = now(), revoked_by = 'test', revoke_reason = 'mistake'
  where user_id = 'c1000000-0000-4000-8000-000000000004';
select pg_temp.grant('c1000000-0000-4000-8000-000000000008', 'trial', 'seven-day', now(), now() + interval '7 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000009', 'manual', null, now(), now() + interval '30 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000010', 'paid', null, now(), now() + interval '120 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000011', 'trial', 'discovery', now(), now() + interval '72 hours');
select pg_temp.grant('c1000000-0000-4000-8000-000000000014', 'trial', 'discovery', now(), now() + interval '72 hours');
-- G: a pass this semester that has ended.
select pg_temp.backdate('c1000000-0000-4000-8000-000000000007', now() - interval '10 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000007', 'trial', 'discovery', now() - interval '9 days',
  now() - interval '6 days');
-- E and F: confirmed last semester, with a grant then.
select pg_temp.backdate('c1000000-0000-4000-8000-000000000005', (select previous_end from ends) - interval '20 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000005', 'manual', null,
  (select previous_end from ends) - interval '19 days', (select previous_end from ends) - interval '16 days');
select pg_temp.backdate('c1000000-0000-4000-8000-000000000006', (select previous_end from ends) - interval '20 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000006', 'early_access', null,
  (select previous_end from ends) - interval '19 days', now() + interval '20 days');

-- D1 and D14: which grants lock -----------------------------------------------------------------------------------
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000001')->>'reason', 'discovery-pass',
  'a Discovery Pass locks the selection');
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000008')->>'reason', 'trial',
  'a legacy seven-day trial locks it');
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000009')->>'reason', 'manual',
  'a manual operator grant locks it');
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000010')->>'reason', 'paid',
  'a paid plan locks it');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000002'), 'open', 'no plan: open');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000004'), 'open', 'a revoked grant does not lock (D14)');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000007'), 'locked',
  'a pass that ended this semester still locks: the rule is until the semester ends');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000003'), 'incomplete', 'Early Access without a pick: incomplete');
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000001')->>'last_day',
  (select current_last_day::text from ends), 'the state carries the current semester''s last day');

-- A locked student's direct calls are refused, whatever field --------------------------------------------------------
create temporary table a_before on commit drop as
  select selection_confirmed_at, revision from public.profiles where id = 'c1000000-0000-4000-8000-000000000001';
grant select on a_before to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000001"}';
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, 'CI423', 'Course selection is set for this semester',
  'a locked student cannot change department by a direct call');
select throws_ok($$update public.profiles set academic_level_id = '20000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, 'CI423', null, 'nor level');
select throws_ok($$update public.profiles set academic_period_id = '30000000-0000-4000-8000-000000000002'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, 'CI423', null, 'nor semester');
select throws_ok($$update public.profiles set selection_confirmed_at = now() where id = 'c1000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'nor write the confirmation');
select lives_ok($$update public.profiles set first_name = 'Adaeze' where id = 'c1000000-0000-4000-8000-000000000001'$$,
  'a locked student can still save their name');
select lives_ok($$update public.profiles set first_name = 'Ada', department_id = '10000000-0000-4000-8000-000000000002',
    academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, 'and save the form with the same courses');
select is((select selection_confirmed_at from public.profiles where id = 'c1000000-0000-4000-8000-000000000001'),
  (select selection_confirmed_at from a_before), 'neither save moves the confirmation');
select is(public.get_my_course_selection(), jsonb_build_object('state', 'locked', 'locked', true,
  'reason', 'discovery-pass', 'last_day', (select current_last_day from ends)), 'the app read: locked, why, until when');
reset role;

-- G: the pass has ended; a name save must not slip the student out of the lock.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000007"}';
update public.profiles set first_name = 'Grace', department_id = '10000000-0000-4000-8000-000000000002',
  academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000007';
reset role;
select ok((select selection_confirmed_at < now() - interval '9 days' from public.profiles
  where id = 'c1000000-0000-4000-8000-000000000007'), 'saving after the pass ended keeps the old confirmation');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000007"}';
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000007'$$, 'CI423', null, 'so a change is still refused after any number of saves');
reset role;

-- Every writer, not only students. The service role has no profile write privilege at all; the owner is refused by
-- the lock itself.
set local role service_role;
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, '42501', null, 'the service role cannot write a selection directly');
reset role;
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, 'CI423', null, 'and the table owner');
update public.profiles set selection_confirmed_at = now() + interval '1 year' where id = 'c1000000-0000-4000-8000-000000000001';
select is((select selection_confirmed_at from public.profiles where id = 'c1000000-0000-4000-8000-000000000001'),
  (select selection_confirmed_at from a_before), 'a privileged write of the confirmation is ignored');
-- An audit row from another transaction, or for other courses, is not an operator change.
insert into private.course_selection_events (txid, user_id, event, actor, detail)
  values (1, 'c1000000-0000-4000-8000-000000000001', 'operator.selection-changed', 'operator:forged',
    jsonb_build_object('to', jsonb_build_object('department_id', '10000000-0000-4000-8000-000000000001',
      'academic_level_id', '20000000-0000-4000-8000-000000000002', 'academic_period_id', '30000000-0000-4000-8000-000000000001')));
insert into private.course_selection_events (user_id, event, actor, detail)
  values ('c1000000-0000-4000-8000-000000000001', 'operator.selection-changed', 'operator:forged',
    jsonb_build_object('to', jsonb_build_object('department_id', '10000000-0000-4000-8000-000000000003',
      'academic_level_id', '20000000-0000-4000-8000-000000000002', 'academic_period_id', '30000000-0000-4000-8000-000000000001')));
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000001'$$, 'CI423', null,
  'an audit row from another transaction or for other courses does not open the lock');

-- Open and first pick ------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000002"}';
select lives_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000002'$$, 'a student without a plan changes courses freely');
select is(public.get_my_course_selection(), '{"state":"open","locked":false,"reason":null,"last_day":null}'::jsonb,
  'an unlocked student is shown no semester date (D9)');
reset role;
select is((select actor || ' ' || event from private.course_selection_events
  where user_id = 'c1000000-0000-4000-8000-000000000002' order by id desc limit 1), 'student selection.changed',
  'the student''s change is recorded');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000004"}';
select lives_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000004'$$, 'a student whose only grant was revoked changes courses');
-- C: Early Access started before any pick. The first pick is allowed and sets the courses at once.
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000003"}';
select lives_ok($$update public.profiles set first_name = 'Chi', department_id = '10000000-0000-4000-8000-000000000002',
    academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000003'$$, 'a first pick under Early Access is allowed');
select is((public.get_my_course_selection())->>'state', 'locked', 'and locks immediately');
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000003'$$, 'CI423', null, 'so a second change is refused');
-- N: an operator revokes the grant (D14) and the lock lifts.
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000014","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000014"}';
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000014'$$, 'CI423', null, 'N is locked by a pass');
reset role;
create temporary table n_grant on commit drop as
  select id from public.entitlement_grants where user_id = 'c1000000-0000-4000-8000-000000000014';
grant select on n_grant to service_role;
set local role service_role;
select is(public.admin_change_grant((select id from n_grant),
  'revoke', null, null, 'Ops', 'activated by mistake')->>'state', 'changed', 'an operator revokes the pass');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000014","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000014"}';
select lives_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000014'$$, 'after the revocation the student changes courses');
reset role;

-- The semester end ---------------------------------------------------------------------------------------------------
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000005',
    (select previous_end - interval '1 microsecond' from ends))->>'state', 'locked',
  'a selection is locked up to the last instant of its semester');
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000005', (select previous_end from ends))->>'state',
  'reselect', 'and released exactly at the semester end');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000005'), 'reselect', 'E is released now');
update public.profiles set department_id = '10000000-0000-4000-8000-000000000001' where id = 'c1000000-0000-4000-8000-000000000005';
select is(pg_temp.state('c1000000-0000-4000-8000-000000000005'), 'open',
  'E re-picks; with nothing active the new selection is open');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000006'), 'reselect', 'F is released although Early Access runs on');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000006"}';
select lives_ok($$update public.profiles set first_name = 'Femi', department_id = '10000000-0000-4000-8000-000000000002',
    academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000006'$$, 'F confirms the same courses for the new semester');
select is((public.get_my_course_selection())->>'state', 'locked', 'and, with Early Access active, is locked again at once');
reset role;
select is((select event from private.course_selection_events where user_id = 'c1000000-0000-4000-8000-000000000006'
  order by id desc limit 1), 'selection.confirmed-again', 'the re-confirmation is recorded');
-- With no semester after now, locks stay on.
delete from private.academic_terms where session_label = '2026/2027';
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000001', now() + interval '10 years')->>'state',
  'locked', 'with no later semester entered, the lock holds');
select is(private.course_selection_state('c1000000-0000-4000-8000-000000000001')->'last_day', 'null'::jsonb,
  'and no date is given');
insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  select '2026/2027', '30000000-0000-4000-8000-000000000001', today - 30, 'test', 'test' from cal;

-- Operator change ----------------------------------------------------------------------------------------------------
create temporary table k_before on commit drop as
  select p.selection_confirmed_at, p.revision,
    (select jsonb_agg(to_jsonb(g) order by g.id) from public.entitlement_grants g where g.user_id = p.id) as grants
  from public.profiles p where p.id = 'c1000000-0000-4000-8000-000000000011';
insert into public.quiz_attempts (id, user_id, course_id, question_count)
  select 'c3000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000011', id, 10
  from public.courses order by id limit 1;
insert into private.discovery_previews (grant_id, user_id, kind, course_id, content)
  select g.id, g.user_id, 'study_guide', (select id from public.courses order by id limit 1), '[{"topic":"t"}]'
  from public.entitlement_grants g where g.user_id = 'c1000000-0000-4000-8000-000000000011';
create temporary table k_work on commit drop as
  select (select to_jsonb(a) from public.quiz_attempts a where a.id = 'c3000000-0000-4000-8000-000000000001') as attempt,
    (select to_jsonb(p) from private.discovery_previews p where p.user_id = 'c1000000-0000-4000-8000-000000000011') as preview;
grant select on k_before to service_role;
set local role service_role;
select throws_ok($$select public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting',
  '200-level', 'first-semester', 1, false, '', 'asked on WhatsApp')$$, '22023', null, 'an operator change needs a name');
select throws_ok($$select public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting',
  '200-level', 'first-semester', 1, false, 'Ops', '')$$, '22023', null, 'and a reason');
select throws_ok($$select public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'nowhere',
  '200-level', 'first-semester', 1, false, 'Ops', 'asked on WhatsApp')$$, '22023', null, 'an unknown department is refused');
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting', '200-level',
    'first-semester', (select revision - 1 from k_before), false, 'Ops', 'asked on WhatsApp')->>'state', 'conflict',
  'a stale revision is refused');
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'business-administration',
    '200-level', 'first-semester', (select revision from k_before), false, 'Ops', 'asked on WhatsApp')->>'state',
  'unchanged', 'the same courses change nothing');
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting', '300-level',
    'first-semester', (select revision from k_before), false, 'Ops', 'asked on WhatsApp')->>'state', 'empty-selection',
  'a combination with no courses is refused (D12)');
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting', '200-level',
    'first-semester', (select revision from k_before), false, 'Ops', 'asked on WhatsApp, wrong department')->>'state',
  'changed', 'an operator changes a locked student''s courses');
reset role;
select is((select department_id from public.profiles where id = 'c1000000-0000-4000-8000-000000000011'),
  '10000000-0000-4000-8000-000000000001'::uuid, 'the new courses are saved');
select is((select selection_confirmed_at from public.profiles where id = 'c1000000-0000-4000-8000-000000000011'),
  (select selection_confirmed_at from k_before), 'the confirmation is kept');
select is(pg_temp.state('c1000000-0000-4000-8000-000000000011'), 'locked', 'so the student stays locked');
select is((select jsonb_build_object('actor', actor, 'reason', detail->>'reason', 'before', detail->>'state_before',
    'from', detail->'from'->>'department_id', 'to', detail->'to'->>'department_id')
  from private.course_selection_events where user_id = 'c1000000-0000-4000-8000-000000000011'
    and event = 'operator.selection-changed'),
  jsonb_build_object('actor', 'operator:Ops', 'reason', 'asked on WhatsApp, wrong department', 'before', 'locked',
    'from', '10000000-0000-4000-8000-000000000002', 'to', '10000000-0000-4000-8000-000000000001'),
  'the change is recorded with name, reason, from and to');
select is((select jsonb_agg(to_jsonb(g) order by g.id) from public.entitlement_grants g
  where g.user_id = 'c1000000-0000-4000-8000-000000000011'), (select grants from k_before), 'the pass is untouched');
select is((select to_jsonb(p) from private.discovery_previews p where p.user_id = 'c1000000-0000-4000-8000-000000000011'),
  (select preview from k_work), 'its pinned preview is untouched');
select is((select to_jsonb(a) from public.quiz_attempts a where a.id = 'c3000000-0000-4000-8000-000000000001'),
  (select attempt from k_work), 'the open practice attempt is untouched');
set local role service_role;
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting', '300-level',
    'first-semester', (select revision + 1 from k_before), true, 'Ops', 'student is in 300L, courses come later')->>'state',
  'changed', 'with --allow-empty the operator may set a combination with no courses yet');
select is((public.admin_course_selection_status('c1000000-0000-4000-8000-000000000011'))->'selection',
  '{"department":"accounting","level":"300-level","semester":"first-semester"}'::jsonb, 'status shows the selection');
select is((select count(*)::integer from jsonb_array_elements(
    (public.admin_course_selection_status('c1000000-0000-4000-8000-000000000011'))->'events') e
  where e->>'event' = 'operator.selection-changed'), 2, 'and both operator changes');
reset role;
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values ('c1000000-0000-4000-8000-000000000012', now(), now() + interval '720 hours', now() + interval '720 hours');
set local role service_role;
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-000000000012', 'accounting', '200-level',
    'first-semester', 1, false, 'Ops', 'asked on WhatsApp')->>'state', 'account-restricted',
  'an account scheduled for deletion is not changed');
select is(public.admin_change_course_selection('c1000000-0000-4000-8000-0000000000ff', 'accounting', '200-level',
    'first-semester', 0, false, 'Ops', 'asked on WhatsApp')->>'state', 'not-found', 'an unknown student is reported');
reset role;
update public.academic_levels set is_active = false where key = '100-level';
set local role service_role;
select throws_ok($$select public.admin_change_course_selection('c1000000-0000-4000-8000-000000000011', 'accounting',
  '100-level', 'first-semester', 3, false, 'Ops', 'asked on WhatsApp')$$, '22023', null, 'an inactive level is refused');
reset role;
update public.academic_levels set is_active = true where key = '100-level';

-- D7: a bound pass sets the courses the student saw ------------------------------------------------------------------
create temporary table m_seen on commit drop as
  select revision, department_id from public.profiles where id = 'c1000000-0000-4000-8000-000000000013';
grant select on m_seen to service_role;
set local role service_role;
select is(public.activate_discovery_pass('c2000000-0000-4000-8000-000000000013', pg_temp.claim('lock-13@example.test'),
    (select revision - 1 from m_seen))->>'state', 'selection-changed',
  'a pass offered against an older selection is refused');
reset role;
select is((select count(*)::integer from public.entitlement_grants where user_id = 'c1000000-0000-4000-8000-000000000013'),
  0, 'and starts nothing');
set local role service_role;
select is(public.activate_discovery_pass('c2000000-0000-4000-8000-000000000013', pg_temp.claim('lock-13@example.test'),
    (select revision from m_seen))->>'state', 'activated', 'the pass for the selection on screen starts');
reset role;
select is((select jsonb_build_object('state', pg_temp.state(p.id), 'department', p.department_id, 'revision', p.revision)
    from public.profiles p where p.id = 'c1000000-0000-4000-8000-000000000013'),
  (select jsonb_build_object('state', 'locked', 'department', department_id, 'revision', revision) from m_seen),
  'and locks exactly those courses');
select is((select detail->>'profile_revision' from private.entitlement_events
    where user_id = 'c1000000-0000-4000-8000-000000000013' and event = 'discovery.activated'),
  (select revision::text from m_seen), 'the activation records the revision it was bound to');

-- The app read is the caller's own only, and needs a live session.
set local role anon;
select throws_ok($$select public.get_my_course_selection()$$, '42501', null, 'anon cannot read a selection state');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000001"}';
select throws_ok($$select public.get_my_course_selection()$$, '42501', null, 'a session of another account is refused');
reset role;

-- An operator correction cannot release a locked student across department calendar boundaries.
-- Only the previous term is needed here: Business Administration is extended, Accounting has ended.
reset role;
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label = '2026/2027';
insert into private.academic_term_extensions (term_id, department_id, last_day, set_by, reason)
  select id, '10000000-0000-4000-8000-000000000002', (select today + 5 from cal), 'test', 'source still running'
  from private.academic_terms;
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', ('c1000000-0000-4000-8000-0000000000' || n)::uuid,
    'authenticated', 'authenticated', 'lock-' || n || '@example.test', now(), now(), now()
  from unnest(array['15','16']) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
  select ('c2000000-0000-4000-8000-0000000000' || n)::uuid, ('c1000000-0000-4000-8000-0000000000' || n)::uuid, now(), now()
  from unnest(array['15','16']) n;
select pg_temp.pick(('c1000000-0000-4000-8000-0000000000' || n)::uuid, '10000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001')
  from unnest(array['15','16']) n;
select pg_temp.backdate(('c1000000-0000-4000-8000-0000000000' || n)::uuid,
    (select previous_end from ends) - interval '20 days') from unnest(array['15','16']) n;
select pg_temp.grant('c1000000-0000-4000-8000-000000000015', 'trial', 'discovery',
  (select previous_end from ends) - interval '19 days', now() + interval '20 days');
select pg_temp.grant('c1000000-0000-4000-8000-000000000016', 'trial', 'discovery',
  (select previous_end from ends) - interval '19 days', now() - interval '1 day');
create temporary table correction_before on commit drop as
  select p.id, p.revision, to_jsonb(p) as profile, case when p.id::text like '%15' then 'active' else 'expired' end as label,
    (select count(*) from private.course_selection_events e where e.user_id = p.id) as events
  from public.profiles p where p.id in ('c1000000-0000-4000-8000-000000000015', 'c1000000-0000-4000-8000-000000000016');
grant select on correction_before to service_role;
select is(pg_temp.state(id), 'locked', label || ' grant: source department is locked') from correction_before;
select is(private.course_selection_state_for(id, '10000000-0000-4000-8000-000000000001',
    (profile->>'selection_confirmed_at')::timestamptz, clock_timestamp())->>'state', 'reselect',
    label || ' grant: target boundary would release the lock') from correction_before;
set local role service_role;
select throws_ok(format($sql$select public.admin_change_course_selection(%L::uuid, 'accounting', '200-level',
    'first-semester', %s, false, 'Ops', 'correct department')$sql$, id, revision), 'CI423',
    'Course correction would unlock this student', label || ' grant: unlocking correction is refused')
  from correction_before;
reset role;
select is(to_jsonb(p), b.profile, b.label || ' grant: refusal leaves the full profile and revision untouched')
  from correction_before b join public.profiles p using (id);
select is((select count(*) from private.course_selection_events e where e.user_id = b.id), b.events,
    b.label || ' grant: refusal rolls back the operator audit too') from correction_before b;
select is(pg_temp.state(id), 'locked', label || ' grant: refusal keeps the student locked') from correction_before;
set local role authenticated;
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000015","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000015"}';
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000015'$$, 'CI423', null, 'active grant: direct student change is still refused');
set local request.jwt.claims = '{"sub":"c1000000-0000-4000-8000-000000000016","role":"authenticated","session_id":"c2000000-0000-4000-8000-000000000016"}';
select throws_ok($$update public.profiles set department_id = '10000000-0000-4000-8000-000000000001'
  where id = 'c1000000-0000-4000-8000-000000000016'$$, 'CI423', null, 'expired grant: direct student change is still refused');
reset role;

select * from finish();
rollback;
