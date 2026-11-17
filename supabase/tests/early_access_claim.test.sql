-- supabase/tests/early_access_claim.test.sql — The free month (Early Access) is claimed by the student on the site
-- (20261116120000_early_access_claim.sql): who can claim, the one grant per account and per address, the claim window
-- with its 30 November cutoff, the courses it sets, the free pass it replaces while the claim is open, and the launch
-- switch that opens it. Nothing is granted automatically any more.
-- Time: now() is fixed for the whole transaction; the functions decide on clock_timestamp(), a moment later. The window
-- is moved by changing the policy row, never by passing a time: no function under test accepts one.
begin;
select no_plan();

-- What the migration set, before the fixtures move anything -------------------------------------------------------
select is((select jsonb_build_object('days', early_access_enrollment_days, 'cutoff', early_access_claim_cutoff,
    'month', early_access_duration::text, 'launch', actual_launch_at) from private.entitlement_policy),
  jsonb_build_object('days', 10, 'cutoff', timestamptz '2026-12-01 00:00:00+01', 'month', '1 mon', 'launch', null),
  'the claim is open for 10 days after launch and never after the end of 30 November 2026 (Lagos); no launch is recorded');
select ok(private.early_access_month_end(timestamptz '2026-11-30 23:59:59.999999+01') < timestamptz '2027-01-01 00:00:00+01',
  'a month claimed in the last instant before the cutoff ends within 2026');
select is(private.early_access_month_end(timestamptz '2026-12-01 00:00:00+01'), timestamptz '2027-01-01 00:00:00+01',
  'the first instant the cutoff refuses is the first whose month would reach 2027');
select is(private.early_access_month_end(timestamptz '2026-11-16 14:30:00+01'), timestamptz '2026-12-16 14:30:00+01',
  'a month is one calendar month on the Lagos calendar, to the minute');

-- Structure and deny-by-default access ---------------------------------------------------------------------------
select has_table('private', 'early_access_claims', 'the address ledger of claimed months exists');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private'
  and table_name = 'early_access_claims' and column_name not in ('claim_hash', 'key_version', 'user_id', 'grant_id',
    'claimed_at', 'expires_at')), 'it holds a keyed hash and dates, never an address');
select ok((select relrowsecurity from pg_class where oid = 'private.early_access_claims'::regclass), 'RLS is enabled on it');
select is((select count(*)::integer from unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, 'private.early_access_claims', privilege)), 0, 'no API role can touch it directly');
select is((select confdeltype::text from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass
  and conrelid = 'private.early_access_claims'::regclass), 'n', 'the record outlives its account, with the link cleared');
select has_function('public', 'claim_early_access', array['uuid', 'jsonb', 'bigint'], 'the claim exists');
select has_function('public', 'early_access_claim_eligibility', array['uuid', 'jsonb'], 'and its read for the pages');
select is((select array_agg(pg_get_function_identity_arguments(oid) order by proname) from pg_proc
    where oid in ('public.claim_early_access(uuid,jsonb,bigint)'::regprocedure,
      'public.early_access_claim_eligibility(uuid,jsonb)'::regprocedure)),
  array['p_session_id uuid, p_claim_hashes jsonb, p_expected_profile_revision bigint', 'p_session_id uuid, p_claim_hashes jsonb'],
  'neither takes a time, a date or a duration: a caller cannot move the window or the end of the month');
select is((select count(*)::integer from unnest(array['public.claim_early_access(uuid,jsonb,bigint)',
    'public.early_access_claim_eligibility(uuid,jsonb)', 'public.admin_activate_public_launch(text,text,boolean)',
    'public.admin_early_access_report()', 'public.admin_configure_early_access(timestamptz,integer,boolean,text,text)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0, 'the claim, its read and the launch are service-role only');
select is((select count(*)::integer from unnest(array['private.early_access_claim_open(timestamptz)',
    'private.early_access_claim_closes_at()', 'private.early_access_month_end(timestamptz)',
    'private.has_current_paid_plan(uuid,timestamptz)', 'private.early_access_claim_matches(jsonb)',
    'private.early_access_status(uuid)', 'private.reconcile_early_access(uuid,text)',
    'private.discovery_early_access_bars(uuid)']) fn, unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'the rules behind them are not callable by any API role');
-- The pre-launch list is retired: its operator commands, sweeps and the confirmation trigger are gone.
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'public' and p.proname in ('admin_add_early_access_member', 'admin_change_early_access_member',
      'admin_reconcile_early_access'))
    or (n.nspname = 'private' and p.proname in ('reconcile_all_early_access', 'early_access_sweep_candidates',
      'resolve_early_access_duplicates', 'reconcile_early_access_on_confirmation'))), 0,
  'no function imports, changes, sweeps or auto-enrols a list any more');
select hasnt_function('private', 'lock_early_access_accounts', array['text'], 'nor locks accounts by a list email');
select hasnt_function('public', 'admin_activate_public_launch', array['text', 'text', 'integer'],
  'the launch no longer takes a sweep batch size');
select ok(not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
  and tgname = 'early_access_reconcile_on_confirmation'), 'confirming an email starts nothing');

-- Fixtures ---------------------------------------------------------------------------------------------------------
-- The ledgers and the key registry are global: this transaction starts from empty ones (rolled back at the end).
delete from private.discovery_pass_claims;
delete from private.early_access_claims;
delete from private.discovery_claim_keys;
-- The running First Semester resumed 30 days ago, whatever dates the team has entered.
delete from private.student_course_additions;
update public.entitlement_grants set course_term_id = null, course_department_id = null;
delete from private.academic_term_extensions;
delete from private.academic_terms where not (session_label = '2026/2027'
  and academic_period_id = '30000000-0000-4000-8000-000000000001');
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 30;
-- The claim's dates are relative to this run, so the file passes on any day: the cutoff is two months away.
update private.entitlement_policy set early_access_claim_cutoff = now() + interval '60 days';
update private.payment_policy set sales_open = true;

create function pg_temp.u(n integer) returns uuid language sql immutable as
  $$ select ('e7100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable as
  $$ select ('e7200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.h(p_value text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(p_value, 'UTF8')), 'hex') $$;
-- The keyed hashes and key checks the application sends for an address (lib/entitlements/claim-hash.ts), current
-- version first; plain digests stand in for the HMACs. p_wrong lists versions presented under another secret.
create function pg_temp.hashes(p_email text, p_versions integer[] default array[1], p_wrong integer[] default '{}')
returns jsonb language sql immutable as
  $$ select jsonb_agg(jsonb_build_object('version', v, 'hash', pg_temp.h('claim-v' || v || ':' || lower(btrim(p_email))),
       'check', pg_temp.h(case when v = any (p_wrong) then 'another-secret-v' else 'claim-key-check-v' end || v))
       order by ordinality)
     from unnest(p_versions) with ordinality as t(v, ordinality) $$;
-- A student with a session and, unless told otherwise, Business Administration 200L First Semester.
create function pg_temp.student(n integer, p_email text default null, p_confirmed boolean default true,
  p_selection boolean default true) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', pg_temp.u(n),
    'authenticated', 'authenticated', coalesce(p_email, 'month-' || n || '@example.test'), 'fixture-only',
    case when p_confirmed then now() end, '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.s(n), pg_temp.u(n), now(), now());
  update public.profiles set first_name = 'Ada' where id = pg_temp.u(n);
  if p_selection then
    update public.profiles set department_id = '10000000-0000-4000-8000-000000000002',
      academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
      where id = pg_temp.u(n);
  end if;
end $$;
create function pg_temp.rev(n integer) returns bigint language sql stable security definer as
  $$ select revision from public.profiles where id = pg_temp.u(n) $$;
create function pg_temp.email(n integer) returns text language sql stable security definer as
  $$ select email::text from auth.users where id = pg_temp.u(n) $$;
-- The two calls as the server makes them: the session, the hashes of the session's address, the revision on the page.
-- An account without a profile (an unconfirmed one) has no revision to show; the request still names one, as every
-- claim must, so it is sent as 0 and the database answers for the session.
create function pg_temp.can_claim(n integer) returns jsonb language sql as
  $$ select public.early_access_claim_eligibility(pg_temp.s(n), pg_temp.hashes(pg_temp.email(n))) $$;
create function pg_temp.claim(n integer) returns jsonb language sql as
  $$ select public.claim_early_access(pg_temp.s(n), pg_temp.hashes(pg_temp.email(n)), coalesce(pg_temp.rev(n), 0)) $$;
create function pg_temp.months(n integer) returns integer language sql stable security definer as
  $$ select count(*)::integer from public.entitlement_grants where user_id = pg_temp.u(n) and source = 'early_access' $$;
create function pg_temp.month_end(p_start timestamptz) returns timestamptz language sql immutable as
  $$ select ((p_start at time zone 'Africa/Lagos') + interval '1 month') at time zone 'Africa/Lagos' $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
grant execute on function pg_temp.u(integer), pg_temp.s(integer), pg_temp.h(text), pg_temp.hashes(text, integer[], integer[]),
  pg_temp.rev(integer), pg_temp.email(integer), pg_temp.can_claim(integer), pg_temp.claim(integer),
  pg_temp.months(integer), pg_temp.month_end(timestamptz) to authenticated, service_role;

-- 1 claims; 2 unconfirmed; 3 scheduled for deletion; 4 has not set courses; 5 picked a semester that is not running;
-- 6 has a paid plan; 7 a throwaway address; 8 an alias of 1's address; 9 on the retired list; 10 and 11 never anything;
-- 13 a second claimer.
select pg_temp.student(1);
select pg_temp.student(2, null, false);
select pg_temp.student(3);
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values (pg_temp.u(3), now(), now() + interval '720 hours', now() + interval '720 hours');
select pg_temp.student(4, null, true, false);
select pg_temp.student(5);
update public.profiles set academic_period_id = '30000000-0000-4000-8000-000000000002' where id = pg_temp.u(5);
select pg_temp.student(6);
select pg_temp.student(7, 'month-7@mailinator.com');
select pg_temp.student(8, 'month-1+second@example.test');
select pg_temp.student(9, null, false);
select pg_temp.student(10);
select pg_temp.student(11);
select pg_temp.student(13);
-- A second session of student 1 (another tab or device).
insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.s(101), pg_temp.u(1), now(), now());
-- Rows of the retired list for 1 and 9: they must change nothing, at launch or afterwards.
insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
  values ('month-1@example.test', 'One', now() - interval '40 days', 'import', 'retired', 'test'),
    ('month-9@example.test', 'Nine', now() - interval '40 days', 'import', 'retired', 'test');

-- 1. Before launch nothing can be claimed, and the free pass is offered as before --------------------------------
set local role service_role;
select is(pg_temp.can_claim(1), '{"eligible":false}'::jsonb, 'before launch no student can claim');
select is(pg_temp.claim(1), '{"state":"closed"}'::jsonb, 'and a claim sent anyway starts nothing');
select is(public.discovery_pass_eligibility(pg_temp.s(11), pg_temp.hashes(pg_temp.email(11)))->>'eligible', 'true',
  'the free pass is still offered before launch');
reset role;
select is(pg_temp.months(1), 0, 'no month exists');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(1), 'role', 'authenticated',
  'session_id', pg_temp.s(1))::text, true);
select is((select jsonb_build_object('early', e->'early_access'->>'status', 'trial', e->'trial'->>'status', 'tier', e->>'tier')
  from public.get_my_entitlement() e), '{"early":"not-listed","trial":"available","tier":"free"}'::jsonb,
  'a student on the retired list reads an ordinary free plan: the list no longer means anything');
select throws_ok($$ select public.claim_early_access(pg_temp.s(1), pg_temp.hashes('month-1@example.test'), 1) $$,
  '42501', null, 'a student cannot call the claim with their own JWT');
select throws_ok($$ select public.early_access_claim_eligibility(pg_temp.s(1), pg_temp.hashes('month-1@example.test')) $$,
  '42501', null, 'nor its read');
select throws_ok($$ select public.admin_activate_public_launch('me', 'launch it myself') $$,
  '42501', null, 'nor activate the public launch');
reset role;

-- 2. The launch opens the claim and enrols nobody -------------------------------------------------------------------
-- A launch too close to the cutoff is refused with the dates, and records nothing.
update private.entitlement_policy set early_access_claim_cutoff = now() + interval '9 days';
set local role service_role;
insert into outcome values ('short', public.admin_activate_public_launch('founder', 'public launch'));
reset role;
select is((select jsonb_build_object('state', result->>'state', 'days', (result->>'claim_days')::integer,
    'closes', (result->>'claim_would_close_at')::timestamptz, 'by', (result->>'full_window_needs_launch_by')::timestamptz)
  from outcome where step = 'short'), jsonb_build_object('state', 'short-claim-window', 'days', 10,
    'closes', now() + interval '9 days', 'by', now() - interval '1 day'),
  'a launch that would leave fewer than 10 days is refused, saying when the claim would close and when a full window needed launch');
select is((select actual_launch_at from private.entitlement_policy), null, 'and nothing was recorded');
select ok(not exists (select 1 from private.entitlement_events where event = 'operator.public-launch'), 'or audited');
update private.entitlement_policy set early_access_claim_cutoff = now() + interval '60 days';
set local role service_role;
select throws_ok($$ select public.admin_activate_public_launch('founder', '') $$, '22023', null, 'the launch needs a reason');
insert into outcome values ('launch', public.admin_activate_public_launch('founder', 'public launch'));
insert into outcome values ('launch-again', public.admin_activate_public_launch('founder', 'again', true));
reset role;
select is((select jsonb_build_object('state', result->>'state', 'short', result->'short_window', 'days', result->'claim_days',
    'ten_days', (result->>'claim_closes_at')::timestamptz = (result->>'actual_launch_at')::timestamptz + interval '10 days',
    'recorded', (result->>'actual_launch_at')::timestamptz = (select actual_launch_at from private.entitlement_policy),
    'on_this_clock', (result->>'actual_launch_at')::timestamptz between now() and clock_timestamp())
  from outcome where step = 'launch'),
  '{"state":"launched","short":false,"days":10,"ten_days":true,"recorded":true,"on_this_clock":true}'::jsonb,
  'the launch is recorded on the database clock and answers with the instant the claim closes, 10 days later');
select is((select jsonb_build_object('state', result->>'state',
    'same', (result->>'actual_launch_at')::timestamptz = (select actual_launch_at from private.entitlement_policy),
    'closes', (result->>'claim_closes_at')::timestamptz = (select (result->>'claim_closes_at')::timestamptz from outcome where step = 'launch'))
  from outcome where step = 'launch-again'), '{"state":"already-launched","same":true,"closes":true}'::jsonb,
  'the launch is recorded once: a second run changes nothing and still says when the claim closes');
select is((select count(*)::integer from public.entitlement_grants where source = 'early_access'), 0,
  'the launch grants nothing, to a student on the retired list or anyone else');
select is((select count(*)::integer from private.entitlement_events where event = 'operator.public-launch'
  and actor = 'operator:founder'), 1, 'and is audited once, with the founder as actor');

-- 3. Nothing is automatic: not a plan read, a course read or a confirmation -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(1), 'role', 'authenticated',
  'session_id', pg_temp.s(1))::text, true);
select is((select jsonb_build_object('early', e->'early_access'->>'status', 'trial', e->'trial'->>'status', 'tier', e->>'tier')
  from public.get_my_entitlement() e), '{"early":"not-listed","trial":"not-offered","tier":"free"}'::jsonb,
  'after launch a plan read starts no month; the free pass is not offered while the claim is open');
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', null, 'a course read starts no month either: the department course stays locked');
reset role;
update auth.users set email_confirmed_at = now() where id = pg_temp.u(9);
select is(pg_temp.months(1) + pg_temp.months(9), 0,
  'no month for the student who read their plan and a course, nor for the listed student who just confirmed their email');
select is(private.reconcile_early_access(pg_temp.u(1), 'test'), '{"status":"not-listed"}'::jsonb,
  'the old enrolment entry point only reports: it issues nothing');

-- 4. The read for the pages -----------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('read', pg_temp.can_claim(1));
reset role;
select is((select result->'eligible' from outcome where step = 'read'), 'true'::jsonb, 'student 1 can claim now');
select ok((select (result->>'ends_at')::timestamptz between pg_temp.month_end(now()) and pg_temp.month_end(clock_timestamp())
  from outcome where step = 'read'), 'and is told the day a month started now would end, from the database clock');
select ok(not exists (select 1 from private.discovery_claim_keys) and not exists (select 1 from private.early_access_claims)
  and not exists (select 1 from private.entitlement_events where user_id = pg_temp.u(1)),
  'the read registers no key, records no address and writes no audit row');

-- 5. The claim -------------------------------------------------------------------------------------------------------
set local role service_role;
select is(public.claim_early_access(pg_temp.s(1), pg_temp.hashes(pg_temp.email(1)), pg_temp.rev(1) + 1),
  '{"state":"selection-changed"}'::jsonb, 'a claim from a page showing other courses starts nothing');
select throws_ok($$ select public.claim_early_access(pg_temp.s(1), pg_temp.hashes(pg_temp.email(1)), null) $$,
  '22023', null, 'a claim must name the courses the student saw');
select throws_ok($$ select public.claim_early_access(pg_temp.s(1), '[]'::jsonb, 1) $$, '22023', null,
  'and carry at least one hash of the address');
select throws_ok($$ select public.claim_early_access(pg_temp.s(1),
  jsonb_build_array(jsonb_build_object('version', 1, 'hash', pg_temp.h('x'), 'check', pg_temp.h('y'), 'email', 'month-1@example.test')), 1) $$,
  '22023', null, 'an address itself is never accepted');
insert into outcome values ('claim', pg_temp.claim(1));
insert into outcome values ('replay', pg_temp.claim(1));
insert into outcome values ('second-tab', public.claim_early_access(pg_temp.s(101), pg_temp.hashes(pg_temp.email(1)), pg_temp.rev(1)));
reset role;
select is((select result->>'state' from outcome where step = 'claim'), 'claimed', 'one tap claims the month');
select is((select jsonb_build_object('source', source, 'ai', ai_terms, 'by', created_by, 'site', reference->>'claim',
    'starts_now', starts_at between now() and clock_timestamp(), 'one_month', ends_at = pg_temp.month_end(starts_at),
    'answered', (starts_at, ends_at) = (select (result->>'starts_at')::timestamptz, (result->>'ends_at')::timestamptz
      from outcome where step = 'claim'))
  from public.entitlement_grants where user_id = pg_temp.u(1)),
  '{"source":"early_access","ai":"uncapped","by":"student","site":"site","starts_now":true,"one_month":true,"answered":true}'::jsonb,
  'it is the existing Early Access grant: it starts at the claim, on the database clock, and ends one calendar month later');
select is((select jsonb_build_object('term', course_term_id = (select id from private.academic_terms),
    'department', course_department_id) from public.entitlement_grants where user_id = pg_temp.u(1)),
  '{"term":true,"department":"10000000-0000-4000-8000-000000000002"}'::jsonb,
  'bound to the running semester and the student''s department');
select is((select jsonb_build_object('user', user_id = pg_temp.u(1), 'version', key_version,
    'hash', claim_hash = pg_temp.hashes('month-1@example.test') -> 0 ->> 'hash',
    'grant', grant_id = (select id from public.entitlement_grants where user_id = pg_temp.u(1)),
    'five_years', expires_at = claimed_at + interval '5 years') from private.early_access_claims),
  '{"user":true,"version":1,"hash":true,"grant":true,"five_years":true}'::jsonb,
  'the address is recorded as a keyed hash under its key version, for five years, like a free pass claim');
select is((select array_agg(key_version) from private.discovery_claim_keys), array[1], 'the claim registered the key version it used');
select is((select count(*)::integer from private.entitlement_events where user_id = pg_temp.u(1)
  and event = 'early-access.claimed' and actor = 'student'), 1, 'the claim is audited once');
select ok(not exists (select 1 from private.entitlement_events where detail::text ~ 'month-1@|example\.test'),
  'and the audit trail carries no email address');
-- Replays: a double tap, a second tab.
select is((select result from outcome where step = 'replay'), (select jsonb_build_object('state', 'already-claimed',
    'ends_at', result->'ends_at', 'active', true) from outcome where step = 'claim'),
  'a second tap is a replay: the same month and the same end, never a second one');
select is((select result from outcome where step = 'second-tab'), (select result from outcome where step = 'replay'),
  'a second tab of the same account gets the same answer');
select is(pg_temp.months(1), 1, 'one grant, however many taps and tabs');
select is((select count(*)::integer from private.early_access_claims), 1, 'one address record');
select throws_ok($$ insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  values (pg_temp.u(1), 'early_access', now(), now() + interval '1 month', 'uncapped', 'x') $$,
  '23505', null, 'an account has at most one Early Access grant, ever, even for direct writes');
select throws_ok($$ insert into private.early_access_claims (claim_hash, key_version, user_id, claimed_at, expires_at)
  values (pg_temp.hashes('month-1@example.test') -> 0 ->> 'hash', 1, pg_temp.u(10), now(), now() + interval '5 years') $$,
  '23505', null, 'an address is recorded once, even for direct writes');
set local role service_role;
select is(pg_temp.can_claim(1), '{"eligible":false}'::jsonb, 'the student is no longer offered what they have');
reset role;

-- 6. What the month gives: the student's courses, set for the semester, and Standard Campus Bot ----------------------
select is((select jsonb_build_object('state', s->>'state', 'reason', s->>'reason')
  from private.course_selection_state(pg_temp.u(1)) s), '{"state":"locked","reason":"early-access"}'::jsonb,
  'the claim sets the student''s courses for the semester');
select is((select jsonb_build_object('source', p.source, 'tier', p.tier)
  from private.campus_bot_plan(pg_temp.u(1), clock_timestamp(), array['paid', 'early_access']) p),
  '{"source":"early_access","tier":"standard"}'::jsonb, 'Campus Bot runs on the Standard limits during the month');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(1), 'role', 'authenticated',
  'session_id', pg_temp.s(1))::text, true);
select ok((select count(*) from public.read_published_managed_content('40000000-0000-4000-8000-000000000002')) > 0,
  'the student''s own department course opens in the same session');
select is((select jsonb_build_object('tier', e->>'tier', 'source', e->'access'->>'source', 'early', e->'early_access'->>'status',
    'trial', e->'trial'->>'status', 'ends', (e->'access'->>'ends_at')::timestamptz = (select (result->>'ends_at')::timestamptz
      from outcome where step = 'claim')) from public.get_my_entitlement() e),
  '{"tier":"full","source":"early_access","early":"active","trial":"not-offered","ends":true}'::jsonb,
  'the plan shows full access from the month until its end, and no free pass');
select throws_ok($$ update public.profiles set department_id = '10000000-0000-4000-8000-000000000001' where id = pg_temp.u(1) $$,
  'CI423', null, 'the department cannot be changed until the semester ends');
reset role;

-- 7. Who cannot claim: the read says no, the claim starts nothing, and no reason leaves the database -----------------
update private.payment_policy set sales_open = true;
insert into outcome values ('order', public.create_payment_order(pg_temp.s(6), 'standard_semester', pg_temp.rev(6),
  gen_random_uuid(), '/access', 'fake'));
select public.fulfil_payment((select (result->'order'->>'id')::uuid from outcome where step = 'order'), 'fake', 'ch_month_six',
  'succeeded', 400000, 'NGN', 'card', clock_timestamp(), 'webhook', 'test');
select ok(private.has_current_paid_plan(pg_temp.u(6), clock_timestamp()), 'student 6 holds a paid plan');
set local role service_role;
insert into outcome select 'no-' || label, jsonb_build_object('read', pg_temp.can_claim(n)->'eligible', 'claim', pg_temp.claim(n)->'state')
  from (values ('unconfirmed', 2), ('deletion-scheduled', 3), ('courses-not-set', 4), ('semester-not-running', 5),
    ('paid-plan', 6), ('throwaway-address', 7)) refused(label, n);
insert into outcome values ('no-unknown-session', jsonb_build_object(
  'read', public.early_access_claim_eligibility(gen_random_uuid(), pg_temp.hashes('nobody@example.test'))->'eligible',
  'claim', public.claim_early_access(gen_random_uuid(), pg_temp.hashes('nobody@example.test'), 1)->'state'));
-- Student 8's address is another spelling of student 1's: the application sends the same hashes for both.
insert into outcome values ('no-address-used', jsonb_build_object(
  'read', public.early_access_claim_eligibility(pg_temp.s(8), pg_temp.hashes('month-1@example.test'))->'eligible',
  'claim', public.claim_early_access(pg_temp.s(8), pg_temp.hashes('month-1@example.test'), pg_temp.rev(8))->'state'));
select is(public.early_access_claim_eligibility(null, pg_temp.hashes('month-10@example.test')), '{"eligible":false}'::jsonb,
  'no session is not eligible');
select is(public.early_access_claim_eligibility(pg_temp.s(10), '[]'::jsonb), '{"eligible":false}'::jsonb,
  'malformed hashes are not eligible, without an error');
-- A claim always names the profile revision the page showed: without one it is an invalid request, and nothing starts.
select throws_ok($$ select public.claim_early_access(pg_temp.s(10), pg_temp.hashes('month-10@example.test'), null) $$,
  '22023', 'Invalid claim request', 'a claim without a profile revision is refused as invalid');
select is(pg_temp.months(10), 0, 'and starts no month');
reset role;
select is((select jsonb_object_agg(step, result) from outcome where step like 'no-%'), '{
  "no-unconfirmed":{"read":false,"claim":"signed-out"},
  "no-deletion-scheduled":{"read":false,"claim":"signed-out"},
  "no-unknown-session":{"read":false,"claim":"signed-out"},
  "no-courses-not-set":{"read":false,"claim":"needs-selection"},
  "no-semester-not-running":{"read":false,"claim":"needs-selection"},
  "no-paid-plan":{"read":false,"claim":"not-available"},
  "no-throwaway-address":{"read":false,"claim":"not-available"},
  "no-address-used":{"read":false,"claim":"not-available"}}'::jsonb,
  'an unconfirmed or deleting account, unset courses, a paid plan, a throwaway address and a used address all claim nothing');
select is((select count(*)::integer from public.entitlement_grants where source = 'early_access' and user_id <> pg_temp.u(1)), 0,
  'none of them holds a month');
select is((select count(*)::integer from private.early_access_claims), 1, 'and no address was recorded for them');
select ok(exists (select 1 from private.entitlement_events where user_id = pg_temp.u(8) and event = 'early-access.claim-refused'),
  'a claim for an address that already had its month is audited');
-- A refunded plan is revoked, as the refund does it, and no longer counts.
update public.entitlement_grants set revoked_at = now(), revoked_by = 'refund:test', revoke_reason = 'refunded'
  where user_id = pg_temp.u(6) and source = 'paid';
set local role service_role;
select is(pg_temp.can_claim(6)->>'eligible', 'true', 'a student whose plan was refunded can claim');
select is(pg_temp.claim(6)->>'state', 'claimed', 'and does');
-- Key faults fail closed, as for the free pass: a version a recorded month needs must still be presented.
select is(public.early_access_claim_eligibility(pg_temp.s(10), pg_temp.hashes('month-10@example.test', array[2]))->>'eligible',
  'false', 'a key configuration missing a version a recorded month needs is not eligible');
select is(public.claim_early_access(pg_temp.s(10), pg_temp.hashes('month-10@example.test', array[2]), pg_temp.rev(10))->>'state',
  'claim-key-missing', 'and the claim refuses instead of re-opening recorded addresses');
select is(public.early_access_claim_eligibility(pg_temp.s(10), pg_temp.hashes('month-10@example.test', array[2, 1], array[1]))->>'eligible',
  'false', 'nor one presenting a registered version under another secret');
select is(public.claim_early_access(pg_temp.s(10), pg_temp.hashes('month-10@example.test', array[2, 1], array[1]), pg_temp.rev(10))->>'state',
  'claim-key-replaced', 'which the claim refuses too');
reset role;
select is(pg_temp.months(10), 0, 'student 10 still has no month');
select ok(exists (select 1 from private.entitlement_events where event = 'discovery.claim-key-rejected'),
  'the key faults are audited for the operator');

-- 8. The free pass while the claim is open, and after ----------------------------------------------------------------
set local role service_role;
insert into outcome values ('pass-open', jsonb_build_object(
  'read', public.discovery_pass_eligibility(pg_temp.s(11), pg_temp.hashes(pg_temp.email(11)))->'eligible',
  'activate', public.activate_discovery_pass(pg_temp.s(11), pg_temp.hashes(pg_temp.email(11)))->'state'));
reset role;
select is((select result from outcome where step = 'pass-open'), '{"read":false,"activate":"trial-not-offered"}'::jsonb,
  'while the claim is open no student is offered a free pass, and one sent anyway starts nothing');
select ok(not exists (select 1 from public.entitlement_grants where user_id = pg_temp.u(11)), 'nothing was granted');

-- 9. The window: 10 days after launch, or the cutoff, whichever comes first, on the database clock -------------------
update private.entitlement_policy set actual_launch_at = now() - interval '10 days' + interval '1 minute';
set local role service_role;
select is(pg_temp.can_claim(10)->>'eligible', 'true', 'a minute before 10 days are up the claim is still open');
reset role;
update private.entitlement_policy set actual_launch_at = now() - interval '10 days' - interval '1 second';
set local role service_role;
insert into outcome values ('after-10-days', jsonb_build_object('read', pg_temp.can_claim(10)->'eligible',
  'claim', pg_temp.claim(10)->'state', 'replay', pg_temp.claim(1)->'state'));
insert into outcome values ('pass-after', jsonb_build_object(
  'never', public.discovery_pass_eligibility(pg_temp.s(11), pg_temp.hashes(pg_temp.email(11)))->'eligible',
  'had-month', public.discovery_pass_eligibility(pg_temp.s(1), pg_temp.hashes(pg_temp.email(1)))->'eligible',
  'had-month-activate', public.activate_discovery_pass(pg_temp.s(1), pg_temp.hashes(pg_temp.email(1)))->'state'));
reset role;
select is((select result from outcome where step = 'after-10-days'),
  '{"read":false,"claim":"closed","replay":"already-claimed"}'::jsonb,
  'after 10 days the claim is closed to a new student; a student who claimed in time still gets their own month back');
select is(pg_temp.months(10), 0, 'the late claim started nothing');
select is((select result from outcome where step = 'pass-after'),
  '{"never":true,"had-month":false,"had-month-activate":"early-access-active"}'::jsonb,
  'once the claim closes the free pass returns for a student who never had a month, and never for one who has');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(11), 'role', 'authenticated',
  'session_id', pg_temp.s(11))::text, true);
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'available', 'and their plan offers it again');
reset role;
-- The cutoff closes the claim however recent the launch is.
update private.entitlement_policy set actual_launch_at = now() - interval '1 day', early_access_claim_cutoff = now() - interval '1 second';
set local role service_role;
insert into outcome values ('after-cutoff', jsonb_build_object('read', pg_temp.can_claim(10)->'eligible', 'claim', pg_temp.claim(10)->'state'));
reset role;
select is((select result from outcome where step = 'after-cutoff'), '{"read":false,"claim":"closed"}'::jsonb,
  'past the cutoff nothing can be claimed, one day after launch or not');
select is(private.early_access_claim_closes_at(), (select early_access_claim_cutoff from private.entitlement_policy),
  'the claim closes at the cutoff when that comes before the 10 days');
-- The real dates: a launch on 20 November has its full 10 days; one on 25 November closes at the end of 30 November.
update private.entitlement_policy set actual_launch_at = timestamptz '2026-11-20 09:00:00+01',
  early_access_claim_cutoff = timestamptz '2026-12-01 00:00:00+01';
select is(private.early_access_claim_closes_at(), timestamptz '2026-11-30 09:00:00+01',
  'launched on 20 November at 09:00, the claim closes on 30 November at 09:00');
select is((select array_agg(private.early_access_claim_open(at) order by at) from unnest(array[
    timestamptz '2026-11-20 08:59:59+01', timestamptz '2026-11-20 09:00:00+01', timestamptz '2026-11-30 08:59:59+01',
    timestamptz '2026-11-30 09:00:00+01']) at), array[false, true, true, false],
  'open from the launch instant until, and not including, the closing instant');
update private.entitlement_policy set actual_launch_at = timestamptz '2026-11-25 09:00:00+01';
select is(private.early_access_claim_closes_at(), timestamptz '2026-12-01 00:00:00+01',
  'launched on 25 November, the claim closes at the end of 30 November (Lagos), not 10 days later');
select is((select array_agg(private.early_access_claim_open(at) order by at) from unnest(array[
    timestamptz '2026-11-30 23:59:59+01', timestamptz '2026-12-01 00:00:00+01', timestamptz '2026-12-04 12:00:00+01']) at),
  array[true, false, false], 'so no month can start on or after 1 December');
update private.entitlement_policy set actual_launch_at = null;
select is(private.early_access_claim_closes_at(), null, 'without a launch there is no closing time');
select is(private.early_access_claim_open(timestamptz '2026-11-25 09:00:00+01'), false, 'and the claim is not open');
-- The session's own time zone changes nothing: the month is a Lagos calendar month.
set local timezone = 'Pacific/Kiritimati';
select is(private.early_access_month_end(timestamptz '2026-11-30 23:30:00+01'), timestamptz '2026-12-30 23:30:00+01',
  'a session in another time zone gets the same end');
set local timezone = 'UTC';

-- 10. One month per address: deleting the account and registering again buys nothing -------------------------------
update private.entitlement_policy set actual_launch_at = now() - interval '1 day', early_access_claim_cutoff = now() + interval '60 days';
delete from auth.users where id = pg_temp.u(1);
select is((select jsonb_build_object('grants', (select count(*) from public.entitlement_grants where user_id = pg_temp.u(1)),
    'record_kept', count(*), 'without_account', bool_and(user_id is null)) from private.early_access_claims
  where claim_hash = pg_temp.hashes('month-1@example.test') -> 0 ->> 'hash'),
  '{"grants":0,"record_kept":1,"without_account":true}'::jsonb,
  'deleting the account removes its month and keeps the address record, without the account');
select pg_temp.student(12, 'Month-1@Example.test');
set local role service_role;
insert into outcome values ('again', jsonb_build_object(
  'month-read', public.early_access_claim_eligibility(pg_temp.s(12), pg_temp.hashes('month-1@example.test'))->'eligible',
  'month-claim', public.claim_early_access(pg_temp.s(12), pg_temp.hashes('month-1@example.test'), pg_temp.rev(12))->'state'));
reset role;
update private.entitlement_policy set actual_launch_at = now() - interval '11 days';
set local role service_role;
insert into outcome values ('again-pass', jsonb_build_object(
  'pass-read', public.discovery_pass_eligibility(pg_temp.s(12), pg_temp.hashes('month-1@example.test'))->'eligible',
  'pass-activate', public.activate_discovery_pass(pg_temp.s(12), pg_temp.hashes('month-1@example.test'))->'state'));
reset role;
select is((select result from outcome where step = 'again'), '{"month-read":false,"month-claim":"not-available"}'::jsonb,
  'the same address on a new account cannot claim a second month');
select is((select result from outcome where step = 'again-pass'), '{"pass-read":false,"pass-activate":"already-claimed"}'::jsonb,
  'and, once the claim has closed, is not offered a free pass either: a used month blocks it for that address');
select ok(not exists (select 1 from public.entitlement_grants where user_id = pg_temp.u(12)), 'nothing was granted');

-- 11. Retention, keys and the operator's view -----------------------------------------------------------------------
set local role service_role;
insert into outcome values ('keys', public.admin_discovery_claim_keys());
insert into outcome values ('report', public.admin_early_access_report());
reset role;
select is((select jsonb_agg(jsonb_build_object('v', e->'key_version', 'claims', e->'claims') order by e->'key_version')
  from outcome, jsonb_array_elements(result->'live') e where step = 'keys'), '[{"v":1,"claims":2}]'::jsonb,
  'the key report counts the recorded months: version 1 is still needed by two of them');
select is((select jsonb_build_object('days', result->'claim_days', 'open', result->'claim_open', 'months', result->'months',
    'records', result->'address_records', 'list', result->'retired_list_rows', 'if_launched_now', result->'if_launched_now')
  from outcome where step = 'report'),
  '{"days":10,"open":false,"months":{"claimed":1,"running":1,"ended":0,"revoked":0},"records":2,"list":2,"if_launched_now":null}'::jsonb,
  'the report shows the window and counts: one month left (student 6''s), two address records, the unread list rows');
update private.early_access_claims set claimed_at = now() - interval '61 months', expires_at = now() - interval '1 month'
  where user_id is null;
set local role service_role;
select is(public.purge_discovery_pass_claims(), 1, 'the daily purge removes an expired month record with the expired pass claims');
select is(public.purge_discovery_pass_claims(), 0, 'and nothing else');
reset role;
select is((select count(*)::integer from private.early_access_claims), 1, 'the live record stays');

-- 12. A launch that the operator knowingly allows with a short window ------------------------------------------------
update private.entitlement_policy set actual_launch_at = null, early_access_claim_cutoff = now() + interval '3 days';
delete from private.entitlement_events where event = 'operator.public-launch';
set local role service_role;
insert into outcome values ('report-before', public.admin_early_access_report());
insert into outcome values ('short-refused', public.admin_activate_public_launch('founder', 'late launch', false));
insert into outcome values ('short-allowed', public.admin_activate_public_launch('founder', 'late launch', true));
reset role;
select is((select jsonb_build_object('full', result->'if_launched_now'->'full_window',
    'closes', (result->'if_launched_now'->>'claim_would_close_at')::timestamptz) from outcome where step = 'report-before'),
  jsonb_build_object('full', false, 'closes', now() + interval '3 days'),
  'before launching, the report says what the window would be');
select is((select result->>'state' from outcome where step = 'short-refused'), 'short-claim-window', 'the short window is refused first');
select is((select jsonb_build_object('state', result->>'state', 'short', result->'short_window',
    'closes', (result->>'claim_closes_at')::timestamptz) from outcome where step = 'short-allowed'),
  jsonb_build_object('state', 'launched', 'short', true, 'closes', now() + interval '3 days'),
  'told to proceed, the launch is recorded and the claim closes at the cutoff');
select is((select count(*)::integer from private.entitlement_events where event = 'operator.public-launch'
  and (detail->>'short_window')::boolean), 1, 'the short window is on the audit trail');

select * from finish();
rollback;
