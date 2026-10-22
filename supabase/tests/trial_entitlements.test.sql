-- supabase/tests/trial_entitlements.test.sql — Free GST access, one-click Discovery Pass activation (one per account and
-- per confirmed email, no phone number), the shared AI allowance, Early Access, Account deletion and operator recovery,
-- enforced inside the database (PRD v1.4 §4.5, §4.9).
-- Time is simulated by moving grant timestamps: now() is fixed for the whole transaction.
begin;
select no_plan();
-- Claims and the claim-key registry are global: this transaction starts from an empty ledger (rolled back at the end),
-- so what other sessions of this database have activated with their own keys cannot change these outcomes.
delete from private.discovery_pass_claims;
delete from private.discovery_claim_keys;

-- Structure and deny-by-default access ------------------------------------------------------------------------
select has_table('public', 'entitlement_grants', 'grants table exists');
select has_table('private', 'trial_phone_claims', 'the historical phone claims of seven-day trials remain');
select has_table('private', 'discovery_pass_claims', 'pass claims by confirmed email exist');
select has_table('private', 'discovery_claim_keys', 'the claim signing-key registry exists');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private'
  and table_name = 'discovery_claim_keys' and column_name not in ('key_version', 'key_check', 'first_seen_at', 'last_seen_at')),
  'the registry holds a check value per version, never a secret');
select has_function('public', 'consume_discovery_activation_limit', array['text', 'text', 'integer', 'integer', 'integer', 'integer'],
  'activation requests have their own limiter');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private'
  and table_name = 'discovery_pass_claims' and column_name = 'email_hash')
  and exists (select 1 from information_schema.columns where table_schema = 'private'
    and table_name = 'discovery_pass_claims' and column_name = 'key_version'), 'claims are keyed and versioned hashes');
select is((select jsonb_build_object('guard', discovery_activations_per_day, 'retention', discovery_claim_retention::text)
  from private.entitlement_policy), '{"guard":null,"retention":"2 years"}'::jsonb,
  'the daily activation guard is off until the owner sets it; claims are kept 24 months (proposed)');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'discovery_email_hash'), 'the unkeyed email hash is gone');
select hasnt_table('private', 'trial_otp_challenges', 'the phone-code challenges are gone');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'private'
  and table_name = 'entitlement_policy' and column_name like 'otp%'), 'no phone-code policy remains');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  and p.proname in ('prepare_trial_otp', 'record_trial_otp_delivery', 'verify_trial_otp', 'purge_trial_otp_challenges',
    'admin_release_trial_phone')), 0, 'no phone-code function remains');
select has_table('private', 'early_access_members', 'trusted Early Access list exists');
select has_table('private', 'entitlement_events', 'audit trail exists');
select hasnt_function('public', 'claim_early_access', 'there is no manual Early Access claim: enrollment is automatic');
select is((select actual_launch_at from private.entitlement_policy), null,
  'the actual public launch starts unset; the planned date is never used in its place');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.entitlement_grants'::regclass,
  'private.trial_phone_claims'::regclass, 'private.discovery_pass_claims'::regclass,
  'private.early_access_members'::regclass, 'private.entitlement_events'::regclass)), 'RLS is enabled everywhere');
select is((select count(*)::integer from unnest(array['public.entitlement_grants', 'private.trial_phone_claims',
    'private.discovery_pass_claims', 'private.early_access_members', 'private.entitlement_events',
    'private.entitlement_policy']) tbl, unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, tbl, privilege)), 0, 'no API role can touch an entitlement table directly');
select is((select count(*)::integer from unnest(array[
    'public.activate_discovery_pass(uuid,jsonb)', 'public.purge_discovery_pass_claims()',
    'public.admin_discovery_claim_keys()',
    'public.admin_entitlement_status(uuid)', 'public.admin_grant_access(uuid,integer,text,text)',
    'public.admin_change_grant(uuid,text,timestamptz,integer,text,text)',
    'public.admin_add_early_access_member(text,text,text,timestamptz,text,text,text)',
    'public.admin_change_early_access_member(text,text,text,text,text)', 'public.admin_early_access_report()',
    'public.admin_configure_early_access(timestamptz,integer,boolean,text,text)',
    'public.admin_activate_public_launch(text,text,integer)', 'public.admin_reconcile_early_access(text,text,integer)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0,
  'activation, claims and every recovery function are service-role only');
select ok(has_function_privilege('authenticated', 'public.get_my_entitlement()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_my_entitlement()', 'EXECUTE'), 'only signed-in students read their plan');
select is((select count(*)::integer from unnest(array['private.can_read_course_content(uuid,uuid)',
    'private.has_full_access(uuid)', 'private.effective_ai_window(uuid,text[])', 'private.ai_units_used(uuid,uuid,timestamptz)',
    'private.log_entitlement_event(uuid,uuid,text,text,jsonb)', 'private.early_access_status(uuid)',
    'private.reconcile_early_access(uuid,text)', 'private.reconcile_all_early_access(text,integer)',
    'private.early_access_sweep_candidates()', 'private.retire_legacy_ai_windows(text)', 'private.lock_early_access_accounts(text)',
    'private.lock_early_access_groups(text[],uuid[],boolean)',
    'private.resolve_early_access_duplicates(uuid,text,text)', 'private.discovery_claim_hashes_valid(jsonb)',
    'private.discovery_claim_keys_check(jsonb)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'access helpers are not callable by any API role');
select ok(has_function_privilege('service_role', 'public.consume_discovery_activation_limit(text,text,integer,integer,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_discovery_activation_limit(text,text,integer,integer,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_discovery_activation_limit(text,text,integer,integer,integer,integer)', 'EXECUTE'),
  'the activation request limiter is service-role only');
select is((select count(*)::integer from unnest(array['private.discovery_claim_keys']) tbl,
    unnest(array['anon', 'authenticated', 'service_role']) api_role, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, tbl, privilege)), 0, 'no API role can touch the key registry directly');
select is((select string_agg(conrelid::regclass::text || '=' || confdeltype::text, ',' order by conrelid::regclass::text)
  from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass and conrelid in (
    'public.entitlement_grants'::regclass, 'private.trial_phone_claims'::regclass, 'private.discovery_pass_claims'::regclass,
    'private.early_access_members'::regclass, 'private.entitlement_events'::regclass)),
  'entitlement_grants=c,private.discovery_pass_claims=n,private.early_access_members=n,private.entitlement_events=n,private.trial_phone_claims=n',
  'Account purge removes grants, but keeps pass claims, historical phone claims, list claims and audit rows without the account');

-- Fixtures --------------------------------------------------------------------------------------------------------
-- A, B, F, G, H: ordinary students. C: deletion scheduled later. D, E: Early Access list (E duplicates D by phone).
-- O: operator. U: unconfirmed email, confirmed after launch.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x',
  case when email like 'unconfirmed%' then null else now() end, '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('61000000-0000-4000-8000-000000000001', 'ent-a@example.test'),
  ('61000000-0000-4000-8000-000000000002', 'ent-b@example.test'),
  ('61000000-0000-4000-8000-000000000003', 'ent-c@example.test'),
  ('61000000-0000-4000-8000-000000000004', 'early-d@example.test'),
  ('61000000-0000-4000-8000-000000000005', 'Early-E@Example.test'),
  ('61000000-0000-4000-8000-000000000006', 'ent-operator@example.test'),
  ('61000000-0000-4000-8000-000000000007', 'ent-f@example.test'),
  ('61000000-0000-4000-8000-000000000008', 'ent-g@example.test'),
  ('61000000-0000-4000-8000-000000000009', 'unconfirmed-u@example.test'),
  ('61000000-0000-4000-8000-000000000011', 'ent-h@example.test')) fixture_users(id, email);
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select ('62000000-0000-4000-8000-00000000000' || n)::uuid, ('61000000-0000-4000-8000-00000000000' || n)::uuid,
  now(), now(), null from generate_series(1, 9) n;
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('62000000-0000-4000-8000-000000000011', '61000000-0000-4000-8000-000000000011', now(), now(), null);
update public.profiles set role = 'operator' where id = '61000000-0000-4000-8000-000000000006';

create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
insert into outcome values ('course-acc101', jsonb_build_object('id',
  (select id from public.institutional_courses where course_code = 'ACC101')));
insert into outcome select 'gst-selection', jsonb_build_array(jsonb_build_object('question_id', question_id, 'ordinal', 0,
  'content_revision', published_revision)) from public.managed_content_items
  where course_id = '40000000-0000-4000-8000-000000000008' and kind = 'cbt_question' and published_revision is not null
  order by created_at limit 1;
-- Keyed Early Access phone hashes are computed by the operator tool; any 64-hex value stands in for one here.
create function pg_temp.h(p_value text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(p_value, 'UTF8')), 'hex') $$;
grant execute on function pg_temp.h(text) to authenticated, service_role;
-- The keyed claim hashes the application sends for an address (lib/entitlements/claim-hash.ts); the current key is
-- listed first. Any 64-hex value stands in for the HMAC here.
-- The keyed claim hashes and key checks the application sends (lib/entitlements/claim-hash.ts), current version first;
-- plain digests stand in for the HMACs.
create function pg_temp.claim(p_email text, p_versions integer[] default array[1]) returns jsonb language sql immutable as
  $$ select jsonb_agg(jsonb_build_object('version', v, 'hash', pg_temp.h('claim-v' || v || ':' || lower(btrim(p_email))),
       'check', pg_temp.h('claim-key-check-v' || v)) order by ordinality)
     from unnest(p_versions) with ordinality as t(v, ordinality) $$;
grant execute on function pg_temp.claim(text, integer[]) to authenticated, service_role;

-- 1. Permanent free GST access, no activation or payment --------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000001"}';
select ok((select count(*) from public.read_published_managed_content('40000000-0000-4000-8000-000000000008')) > 0,
  'a new account reads free GST content with no trial, phone or payment');
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', 'Course access requires an active plan', 'a department course is locked on the free tier');
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000001') $$,
  'CI403', null, 'a shared course is not a free course: shared ENT211 stays locked');
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000005') $$,
  'CI403', null, 'a repository-only course has no free flag and stays locked');
select is((select jsonb_build_object('tier', e->>'tier', 'trial', e->'trial'->>'status', 'early', e->'early_access'->>'status')
  from public.get_my_entitlement() e), '{"tier":"free","trial":"available","early":"not-listed"}'::jsonb,
  'the summary shows the free tier with a trial available');
select throws_ok($$ insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  values ('61000000-0000-4000-8000-000000000001', 'manual', now(), now() + interval '1 year', 'none', 'me') $$,
  '42501', null, 'a student cannot grant themselves access');
select throws_ok($$ select public.activate_discovery_pass('62000000-0000-4000-8000-000000000001', pg_temp.claim('ent-a@example.test')) $$,
  '42501', null, 'a student cannot call activation with their own JWT');
select throws_ok($$ select public.admin_activate_public_launch('me', 'launch it myself') $$,
  '42501', null, 'a student cannot activate the public launch');
reset role;
set local role anon;
select throws_ok($$ select public.get_my_entitlement() $$, '42501', null, 'anonymous callers have no plan to read');
reset role;

-- 2. Activation is explicit, one click, and the account's own: no phone number, no code -----------------------------
set local role service_role;
select is(public.activate_discovery_pass(gen_random_uuid(), pg_temp.claim('nobody@example.test'))->>'state', 'signed-out', 'an unknown session starts nothing');
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000009', pg_temp.claim('unconfirmed-u@example.test'))->>'state', 'signed-out',
  'an unconfirmed email cannot start a pass');
insert into outcome values ('a-activate', public.activate_discovery_pass('62000000-0000-4000-8000-000000000001', pg_temp.claim('ent-a@example.test')));
select is((select result->>'state' from outcome where step = 'a-activate'), 'activated', 'one tap activates the pass');
select is((select (result->>'ends_at')::timestamptz from outcome where step = 'a-activate'), now() + interval '72 hours',
  'the Discovery Pass lasts exactly 72 hours from database time (20261021100000_discovery_pass.sql)');
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000001', pg_temp.claim('ent-a@example.test')),
  jsonb_build_object('state', 'already-activated', 'ends_at', now() + interval '72 hours'),
  'a second tap on the same account is a replay: nothing changes and the same end is reported');
reset role;
select is((select count(*)::integer from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000001'), 1,
  'one grant, however many taps');
select is((select jsonb_build_object('source', source, 'policy', trial_policy, 'ai_terms', ai_terms, 'ai_units', ai_units,
    'created_by', created_by) from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000001'),
  '{"source":"trial","policy":"discovery","ai_terms":"capped","ai_units":1,"created_by":"student"}'::jsonb,
  'the pass carries the one-set Discovery AI allowance from policy');
select is((select jsonb_build_object('user', user_id, 'version', key_version, 'expires', expires_at = now() + interval '24 months')
    from private.discovery_pass_claims where claim_hash = pg_temp.claim('ent-a@example.test') -> 0 ->> 'hash'),
  '{"user":"61000000-0000-4000-8000-000000000001","version":1,"expires":true}'::jsonb,
  'the keyed claim of the confirmed email is recorded under its key version, for the retention period');
select throws_ok($$ select public.activate_discovery_pass('62000000-0000-4000-8000-000000000002', '[]'::jsonb) $$,
  '22023', null, 'activation needs at least one claim hash');
select throws_ok($$ select public.activate_discovery_pass('62000000-0000-4000-8000-000000000002',
  '[{"version":1,"hash":"not-hex"}]'::jsonb) $$, '22023', null, 'and every hash must be 64 hex characters');
select throws_ok($$ select public.activate_discovery_pass('62000000-0000-4000-8000-000000000002',
  pg_temp.claim('ent-b@example.test', array[1, 1])) $$, '22023', null, 'and key versions must be distinct');
select throws_ok($$ select public.activate_discovery_pass('62000000-0000-4000-8000-000000000002',
  jsonb_build_array(jsonb_build_object('version', 1, 'hash', pg_temp.h('x'), 'email', 'ent-b@example.test'))) $$,
  '22023', null, 'an address itself is never accepted');
select ok(not exists (select 1 from private.trial_phone_claims where user_id = '61000000-0000-4000-8000-000000000001'),
  'no phone claim is written: nothing about a phone exists in this flow');
select is((select count(*)::integer from private.entitlement_events where user_id = '61000000-0000-4000-8000-000000000001'
  and event = 'discovery.activated'), 1, 'activation is audited once, never a replay');
select ok(not exists (select 1 from private.entitlement_events where detail::text ~ 'ent-a@|example\.test'),
  'the audit trail carries no email address');

-- Mid-session: the same JWT and session see the new plan immediately, without logging out.
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000001"}';
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', null, 'a Discovery Pass never opens the whole department course: only pinned previews are served');
select is((select e->>'tier' || '/' || (e->'trial'->>'status') || '/' || coalesce(e->'access'->>'source', 'none')
  from public.get_my_entitlement() e), 'free/active/none', 'the summary shows an active pass on the free tier');
select is((select e->'otp' from public.get_my_entitlement() e), 'null'::jsonb,
  'the summary keeps the pre-Discovery otp key for rollout compatibility, always null');
select is((select jsonb_build_object('state', a->>'state', 'source', a->>'source', 'total', (a->>'total')::integer)
  from public.get_my_ai_allowance() a), '{"state":"active","source":"trial","total":1}'::jsonb,
  'the Discovery AI allowance is visible to the student');
reset role;

-- 3. One pass per account, enforced by the database itself ----------------------------------------------------------
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000007', pg_temp.claim('ent-f@example.test'))->>'state', 'activated', 'F activates a pass');
reset role;
select throws_ok($$ insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
  values ('61000000-0000-4000-8000-000000000007', 'trial', 'discovery', now(), now() + interval '7 days', 'capped', 10, 'x') $$,
  '23505', null, 'an account has at most one trial grant, ever, even for direct writes');
select throws_ok($$ insert into private.discovery_pass_claims (claim_hash, key_version, user_id, expires_at) values
  (pg_temp.claim('ent-f@example.test') -> 0 ->> 'hash', 1, '61000000-0000-4000-8000-000000000002', now() + interval '1 year') $$,
  '23505', null, 'a confirmed email is claimed once, even for direct writes');
-- Key rotation: a claim recorded under key 1 is still found when the application now sends key 2 first, and dropping
-- key 1 while its claims live fails closed instead of re-opening the address (Codex F5; the full set of rotation cases
-- is in discovery_pass.test.sql).
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000002', pg_temp.claim('ent-f@example.test', array[2, 1]))
  ->>'state', 'already-claimed', 'a claim under a retired key version still blocks the address after rotation');
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000002', pg_temp.claim('ent-f@example.test', array[2]))
  ->>'state', 'claim-key-missing', 'without the retired key the old claims cannot be verified: activation fails closed, and nothing is re-opened');
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000002', pg_temp.claim('ent-b@example.test', array[2, 1]))
  ->>'state', 'activated', 'with both keys present B activates under version 2');
insert into outcome values ('claim-keys', public.admin_discovery_claim_keys());
reset role;
-- Counted against the table itself, so claims other sessions of this database hold do not change the outcome.
select is((select result->'live' from outcome where step = 'claim-keys'), (select jsonb_agg(jsonb_build_object('key_version', key_version,
    'claims', claims, 'last_expires_at', last_expires_at) order by key_version) from (select key_version, count(*) as claims,
    max(expires_at) as last_expires_at from private.discovery_pass_claims where expires_at > now() group by key_version) v),
  'the operator sees which key versions live claims still reference');
select ok((select (e->>'claims')::integer >= 2 from outcome, jsonb_array_elements(result->'live') e
    where step = 'claim-keys' and (e->>'key_version')::integer = 1)
  and (select (e->>'claims')::integer from outcome, jsonb_array_elements(result->'live') e
    where step = 'claim-keys' and (e->>'key_version')::integer = 2) = 1, 'version 1 holds A and F, version 2 holds B');
select is((select jsonb_agg(e->'key_version' order by e->'key_version') from outcome, jsonb_array_elements(result->'registered') e
    where step = 'claim-keys'), '[1, 2]'::jsonb, 'and which versions the ledger has been written with');
-- B's pass is not part of the later sections: it is revoked and its claim removed so B stays the account without a pass.
delete from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000002';
delete from private.discovery_pass_claims where user_id = '61000000-0000-4000-8000-000000000002';
select ok(not exists (select 1 from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000002'),
  'B holds no grant');

-- 4. Abuse guards: the optional platform-wide daily activation guard and the request limit policy -------------------
update private.entitlement_policy set discovery_activations_per_day = (select count(*) from public.entitlement_grants
  where trial_policy = 'discovery' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc');
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000008', pg_temp.claim('ent-g@example.test')), '{"state":"capacity"}'::jsonb,
  'the platform-wide daily activation guard holds');
reset role;
select ok(not exists (select 1 from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000008')
  and not exists (select 1 from private.discovery_pass_claims where user_id = '61000000-0000-4000-8000-000000000008'),
  'a refused activation consumes nothing');
update private.entitlement_policy set discovery_activations_per_day = null;
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000008', pg_temp.claim('ent-g@example.test'))->>'state', 'activated',
  'G activates once the guard is off again');
-- The activation request limit (Codex F7): five per account per 15 minutes is a hard limit; the shared requester
-- address is monitored, never a barrier, and a noisy account charges the address only for the requests it was admitted.
select throws_ok($$ select public.consume_auth_rate_limit('DISCOVERY_ACTIVATION', repeat('7', 64), repeat('8', 64), 5, 900, 60, 900) $$,
  '22023', null, 'the shared auth limiter no longer carries a per-address activation ceiling');
-- A noisy account taps seven times from one campus address.
insert into outcome select 'limit-' || n, public.consume_discovery_activation_limit(repeat('7', 64), repeat('8', 64), 5, 900, 60, 900)
  from generate_series(1, 7) n;
select is((select jsonb_agg(result->'allowed' order by step) from outcome where step like 'limit-%'),
  '[true, true, true, true, true, false, false]'::jsonb, 'five requests per account in fifteen minutes, then refused');
select is((select (result->>'origin_requests')::integer from outcome where step = 'limit-7'), 5,
  'the address is charged only for the requests the account was admitted: a noisy account cannot run up the address');
-- Seventy other students behind the same address each tap once.
insert into outcome select 'hall-' || lpad(n::text, 3, '0'),
  public.consume_discovery_activation_limit(pg_temp.h('hall-account-' || n), repeat('8', 64), 5, 900, 60, 900)
  from generate_series(1, 70) n;
select is((select count(*)::integer from outcome where step like 'hall-%' and (result->>'allowed')::boolean), 70,
  'every one of them is admitted: a shared campus address is never a barrier, well past the old ceiling of sixty');
select is((select (result->>'origin_requests')::integer from outcome where step = 'hall-070'), 75,
  'the address count is still kept, for monitoring');
select throws_ok($$ select public.consume_discovery_activation_limit(repeat('7', 64), repeat('8', 64), 500, 900, 60, 900) $$,
  '22023', null, 'the caller cannot weaken the account limit or the notice threshold');
select throws_ok($$ select public.consume_discovery_activation_limit('raw@example.test', repeat('8', 64), 5, 900, 60, 900) $$,
  '22023', null, 'raw identifiers are refused: only keyed buckets enter the database');
reset role;
select is((select count(*)::integer from private.entitlement_events where event = 'discovery.origin-notice'
    and actor = 'system:rate-limit' and detail->>'origin' = left(repeat('8', 64), 12)), 1,
  'crossing sixty admitted requests from one address writes exactly one notice for the operator');
select ok((select detail - 'origin' - 'requests' - 'window_seconds' = '{}'::jsonb and (detail->>'requests')::integer = 60
    and user_id is null from private.entitlement_events where event = 'discovery.origin-notice'
    and detail->>'origin' = left(repeat('8', 64), 12)), 'the notice carries a bucket prefix and counts only: no address, no account');

-- 5. The Discovery AI allowance is one fixed total; exhausting it restricts AI only --------------------------------
update public.entitlement_grants set starts_at = now() - interval '30 hours', ends_at = now() + interval '42 hours'
  where user_id = '61000000-0000-4000-8000-000000000001';
insert into public.ai_usage_events (user_id, feature, state, reserved_at, settled_at, funding_source, funding_grant_id)
  select '61000000-0000-4000-8000-000000000001', 'upload_practice', 'consumed', now() - interval '29 hours',
    now() - interval '29 hours', 'trial',
    (select id from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000001' and source = 'trial');
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000001', array['trial', 'early_access'])
  - 'ends_at', '{"state":"allowance-exhausted","total":1,"used":1}'::jsonb,
  'a set delivered on the first day still counts on the second: nothing replenishes');
set local role service_role;
select is(public.create_ai_practice_document('62000000-0000-4000-8000-000000000001',
  (select (result->>'id')::uuid from outcome where step = 'course-acc101'), 'notes.txt', 'text/plain', 100,
  array['trial', 'early_access']), '{"status":"allowance-exhausted"}'::jsonb, 'no further AI upload is admitted');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000001"}';
select is((select e->>'tier' || '/' || (e->'trial'->>'status') from public.get_my_entitlement() e), 'free/active',
  'with AI used up, the pass itself stays active until it ends');
reset role;

-- A Discovery Pass cannot start a full CBT attempt, so no question of the bank is pinned or revealed ---------------
set local role service_role;
select is(public.write_quiz_attempt('62000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000002', 1, 'start', null, 'in_progress',
  '[{"question_id":"3d04c5a2-4363-4112-b397-e0191402f275","ordinal":0,"content_revision":1}]'),
  '{"status":"locked"}'::jsonb, 'a full attempt on a department course is refused during the pass');
reset role;

-- 6. Pass expiry: back to the free tier, not a lockout ----------------------------------------------------------------
update public.entitlement_grants set starts_at = now() - interval '72 hours', ends_at = now() - interval '1 second'
  where user_id = '61000000-0000-4000-8000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000001"}';
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', null, 'department content stays locked after the pass');
select ok((select count(*) from public.read_published_managed_content('40000000-0000-4000-8000-000000000013')) > 0,
  'GST stays free after the pass');
select is((select e->>'tier' || '/' || (e->'trial'->>'status') from public.get_my_entitlement() e), 'free/ended',
  'the summary shows the ended pass and the free tier');
reset role;
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000001', array['trial', 'early_access'])->>'state',
  'allowance-expired', 'AI ends with the pass');
set local role service_role;
select is(public.write_quiz_attempt('62000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000008', 1, 'start', null, 'in_progress',
  (select result from outcome where step = 'gst-selection'))->>'status', 'saved', 'GST practice still starts on the free tier');
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000001', pg_temp.claim('ent-a@example.test'))->>'state', 'already-activated',
  'an ended pass cannot restart');
reset role;

-- 6b. AI follows the entitlement: legacy windows cannot bypass a revoked or expired grant ------------------------------
select throws_ok($$ insert into public.ai_allowance_windows (user_id, source, starts_at, ends_at, total_units)
  values ('61000000-0000-4000-8000-000000000007', 'trial', now(), now() + interval '7 days', 10) $$, '23514', null,
  'no production allowance window can exist beside the grants any more');
select throws_ok($$ select public.issue_ai_allowance_grant('61000000-0000-4000-8000-000000000007', 'trial') $$, '22023', null,
  'trial AI cannot be issued directly, bypassing activation');
select throws_ok($$ select public.issue_ai_allowance_grant('61000000-0000-4000-8000-000000000007', 'early_access', 5, 30) $$, '22023', null,
  'nor can Early Access AI');
-- A window issued before this migration: ignored by admission, then retired and audited by the migration step.
alter table public.ai_allowance_windows drop constraint ai_allowance_windows_source_check;
insert into public.ai_allowance_windows (user_id, source, starts_at, ends_at, total_units)
  values ('61000000-0000-4000-8000-000000000002', 'trial', now() - interval '1 day', now() + interval '6 days', 10);
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000002', array['trial', 'early_access'])->>'state', 'not-entitled',
  'a legacy trial window with no grant behind it admits nothing');
select is(private.retire_legacy_ai_windows('test'), 1, 'the migration step retires legacy production windows');
select ok(not exists (select 1 from public.ai_allowance_windows where source <> 'test') and exists (
  select 1 from private.entitlement_events where event = 'legacy.ai-window-retired' and user_id = '61000000-0000-4000-8000-000000000002'),
  'each retired window is audited');
alter table public.ai_allowance_windows add constraint ai_allowance_windows_source_check check (source = 'test');
-- Revocation takes AI away immediately, on every path. F holds an active trial from section 3.
insert into outcome select 'f-revoke', jsonb_build_object('id', id) from public.entitlement_grants
  where user_id = '61000000-0000-4000-8000-000000000007' and source = 'trial';
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000007', array['trial', 'early_access'])->>'state', 'active', 'F''s trial admits AI');
set local role service_role;
select is(public.admin_change_grant((select (result->>'id')::uuid from outcome where step = 'f-revoke'), 'revoke', null, null,
  'ops', 'fraud review')->>'state', 'changed', 'an operator revokes F''s trial');
select is(public.create_ai_practice_document('62000000-0000-4000-8000-000000000007',
  (select (result->>'id')::uuid from outcome where step = 'course-acc101'), 'notes.txt', 'text/plain', 100, array['trial', 'early_access']),
  '{"status":"not-entitled"}'::jsonb, 'a direct service call cannot start AI work on a revoked trial');
reset role;
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000007', array['trial', 'early_access'])->>'state', 'not-entitled', 'a revoked trial admits no AI at once');
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000007"}';
select is((select a->>'state' from public.get_my_ai_allowance() a), 'not-entitled', 'and the student sees no AI allowance');
reset role;
set local role service_role;
select is(public.admin_change_grant((select (result->>'id')::uuid from outcome where step = 'f-revoke'), 'restore', null, null,
  'ops', 'review cleared')->>'state', 'changed', 'restoring the grant');
reset role;
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000007', array['trial', 'early_access'])->>'state', 'active', 'restores its AI with it');
-- Loopback test grants stay a separate mechanism that production never honours.
select is(public.issue_ai_allowance_grant('61000000-0000-4000-8000-000000000003', 'test', 3, 1)->>'state', 'issued', 'a controlled test grant is still issued');
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000003', array['trial', 'early_access'])->>'state', 'not-entitled', 'production sources never honour it');
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000003', array['trial', 'early_access', 'test'])->>'state', 'active',
  'a verified local test run still can');

-- 7. Early Access: automatic, from the actual public launch only ------------------------------------------------------
-- The trusted list is imported before launch. Nothing starts, whatever the planned date says.
update private.entitlement_policy set planned_launch_at = now() - interval '3 days';
set local role service_role;
select is(public.admin_add_early_access_member('Early-D@Example.TEST ', 'Dami Ade', pg_temp.h('phone-d'),
  now() - interval '30 days', 'import', 'google-form', 'ops')->>'state', 'added', 'an imported member is added, email normalized');
select is(public.admin_add_early_access_member('early-e@example.test', 'D. Ade', pg_temp.h('phone-d'),
  now() - interval '20 days', 'import', 'google-form', 'ops')->>'state', 'added-duplicate',
  'the same phone under another email joins the first member''s group');
select is(public.admin_add_early_access_member('early-d@example.test', 'Someone else', null,
  now() - interval '1 day', 'manual', 'whatsapp', 'ops')->>'state', 'existing', 'an existing email is never overwritten');
select is(public.admin_add_early_access_member('late@example.test', 'Late Joiner', null,
  now() + interval '1 day', 'manual', 'whatsapp', 'ops')->>'state', 'joined-after-launch', 'a future join date is refused');
select throws_ok($$ select public.admin_add_early_access_member('x@example.test', 'X', null, now() - interval '1 day',
  'manual', 'b', 'ops') $$, '22023', null, 'an import needs a batch label');
reset role;
select ok(not exists (select 1 from public.entitlement_grants where source = 'early_access'),
  'the planned launch passing three days ago starts nothing');
select is(private.early_access_status('61000000-0000-4000-8000-000000000004')->>'status', 'awaiting-launch', 'listed members wait for the actual launch');
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000004"}';
select is((select jsonb_build_object('status', e->'early_access'->>'status', 'starts', e->'early_access'->'starts_at',
  'launch', e->'actual_launch_at') from public.get_my_entitlement() e),
  '{"status":"awaiting-launch","starts":null,"launch":null}'::jsonb,
  'the student sees Early Access waiting for the real launch, with no start date invented');
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', null, 'no department access before the actual launch');
reset role;
-- The founder activates the actual launch: every eligible confirmed account is enrolled in the same transaction.
set local role service_role;
insert into outcome values ('launch', public.admin_activate_public_launch('founder', 'public launch'));
select is((select result->>'state' || '/' || (result->>'granted') from outcome where step = 'launch'), 'launched/1',
  'activation enrolls the one eligible confirmed account; the duplicate identity gets nothing');
select is(public.admin_activate_public_launch('founder', 'again')->>'state', 'already-launched',
  'the actual launch is recorded once');
reset role;
select is((select actual_launch_at from private.entitlement_policy), now(), 'the actual launch is the activation time');
select is((select jsonb_build_object('starts', starts_at = now(), 'ends', ends_at = now() + interval '1 month', 'ai', ai_terms,
  'by', created_by) from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000004' and source = 'early_access'),
  '{"starts":true,"ends":true,"ai":"uncapped","by":"operator:founder"}'::jsonb,
  'the calendar month starts at the actual launch, not the planned date: a delayed launch costs no days');
select is(private.early_access_status('61000000-0000-4000-8000-000000000005')->>'status', 'unavailable', 'D''s duplicate identity cannot get a second month');
select ok(not exists (select 1 from public.entitlement_grants where source = 'early_access' and user_id <> '61000000-0000-4000-8000-000000000004'),
  'unlisted accounts get nothing');
select ok(exists (select 1 from private.entitlement_events where user_id = '61000000-0000-4000-8000-000000000004' and event = 'early-access.granted'
  and actor = 'operator:founder'), 'the enrollment is audited with the founder as actor');
-- Repeated reconciliation, plan reads, sweeps and re-imports never reset or extend a grant.
insert into outcome select 'd-grant', to_jsonb(g) from public.entitlement_grants g where user_id = '61000000-0000-4000-8000-000000000004' and source = 'early_access';
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000004"}';
select is((select e->>'tier' || '/' || (e->'early_access'->>'status') from public.get_my_entitlement() e), 'full/active',
  'D has full access with no click and no phone code');
select ok((select count(*) from public.read_published_managed_content('40000000-0000-4000-8000-000000000002')) > 0,
  'every course is open during the month');
reset role;
set local role service_role;
select is(public.admin_reconcile_early_access('ops', 'recovery sweep')->>'granted', '0', 'a repeated sweep grants nothing new');
reset role;
select is((select to_jsonb(g) from public.entitlement_grants g where user_id = '61000000-0000-4000-8000-000000000004' and source = 'early_access'),
  (select result from outcome where step = 'd-grant'), 'D''s grant is untouched by plan reads, sweeps and re-imports');
-- No per-student AI cap during the month; the global guards still apply.
insert into public.ai_usage_events (user_id, feature, state, reserved_at, settled_at, funding_source, funding_grant_id)
  select '61000000-0000-4000-8000-000000000004', 'upload_practice', 'consumed', now(), now(), 'early_access',
    (select id from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000004' and source = 'early_access') from generate_series(1, 40);
select is((select jsonb_build_object('state', a->>'state', 'total', a->'total')
  from private.ai_allowance_admission('61000000-0000-4000-8000-000000000004', array['trial', 'early_access']) a),
  '{"state":"active","total":null}'::jsonb, 'forty generations later Early Access AI is still admitted: no per-student cap');
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000004"}';
select is((select (a->>'total') is null and a->>'state' = 'active' from public.get_my_ai_allowance() a), true,
  'the student sees an uncapped allowance');
reset role;
update private.ai_practice_policy set global_daily_generations = 0;
set local role service_role;
insert into outcome values ('d-doc', public.create_ai_practice_document('62000000-0000-4000-8000-000000000004',
  (select (result->>'id')::uuid from outcome where step = 'course-acc101'), 'notes.txt', 'text/plain', 100, array['trial', 'early_access']));
reset role;
update public.ai_practice_documents set status = 'ready', source_text = 'x', source_sha256 = pg_temp.h('x'), word_count = 1
  where id = (select (result->>'document_id')::uuid from outcome where step = 'd-doc');
set local role service_role;
select is(public.begin_ai_practice_generation('62000000-0000-4000-8000-000000000004', gen_random_uuid(),
  (select (result->>'document_id')::uuid from outcome where step = 'd-doc'), array['trial', 'early_access'])->>'state',
  'capacity', 'the platform-wide daily AI guard still applies to Early Access');
reset role;
update private.ai_practice_policy set global_daily_generations = 500;
-- An account verified after launch gets its own full month from that verification.
update private.entitlement_policy set actual_launch_at = now() - interval '5 days';
set local role service_role;
select is(public.admin_add_early_access_member('unconfirmed-u@example.test', 'U Member', null, now() - interval '20 days',
  'import', 'google-form', 'ops')->>'enrollment', null, 'an unconfirmed account is listed but not enrolled');
reset role;
select ok(not exists (select 1 from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000009'), 'an unconfirmed email is never enrolled');
update auth.users set email_confirmed_at = now() where id = '61000000-0000-4000-8000-000000000009';
select is((select (starts_at, ends_at)::text from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000009' and source = 'early_access'),
  (now(), now() + interval '1 month')::text,
  'confirming the email five days after launch enrolls U with a full month from that moment');
-- A trusted import after launch enrolls an existing confirmed account at once; a post-launch signup does not count.
set local role service_role;
select is(public.admin_add_early_access_member('ent-h@example.test', 'H Member', null, now() - interval '25 days',
  'manual', 'whatsapp-late', 'ops')->>'enrollment', 'granted', 'a later import of a pre-launch signup enrolls at once');
select is(public.admin_add_early_access_member('post@example.test', 'Post Launch', null, now() - interval '1 day',
  'manual', 'whatsapp', 'ops')->>'state', 'joined-after-launch', 'a signup after the actual launch is not eligible');
reset role;
-- The enrollment window is configurable; 28 days is provisional.
update private.entitlement_policy set actual_launch_at = now() - interval '29 days';
set local role service_role;
select is(public.admin_add_early_access_member('ent-a@example.test', 'A Member', null, now() - interval '40 days',
  'import', 'google-form', 'ops')->>'enrollment', 'enrollment-closed', 'after the enrollment window nobody new is enrolled');
select throws_ok($$ select public.admin_configure_early_access(null, 30, null, 'ops', '') $$, '22023', null,
  'a policy change needs a reason');
select is(public.admin_configure_early_access(null, 30, null, 'ops', 'owner extended enrollment')->>'state', 'changed',
  'the window is configurable');
select is(public.admin_reconcile_early_access('ops', 'apply extended window')->>'granted', '1', 'a sweep then enrolls A');
select is(public.admin_change_early_access_member('early-d@example.test', 'mark-duplicate', 'early-e@example.test', 'ops',
  'circular grouping')->>'state', 'already-grouped',
  'marking a member as a duplicate of its own duplicate is refused cleanly, not a constraint error');
select is(public.admin_change_early_access_member('early-e@example.test', 'exclude', null, 'ops', 'duplicate person')->>'state',
  'changed', 'an operator can exclude a member');
reset role;
select ok((select excluded_at is not null from private.early_access_members where email = 'early-e@example.test'),
  'the exclusion is recorded');
-- Expiry: the month ends on its own date and is never renewed.
update public.entitlement_grants set starts_at = now() - interval '1 month' - interval '1 day', ends_at = now() - interval '1 day'
  where user_id = '61000000-0000-4000-8000-000000000004' and source = 'early_access';
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000004"}';
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', null, 'the month ends after one calendar month');
select is((select e->'early_access'->>'status' from public.get_my_entitlement() e), 'ended',
  'and a later plan read does not renew it');
reset role;
select is((select count(*)::integer from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000004' and source = 'early_access'), 1,
  'still exactly one Early Access grant');
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000004', array['trial', 'early_access'])->>'state', 'allowance-expired', 'Early Access AI ends with the month');

-- 7b. No trial during active Early Access -----------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('h-activate', public.activate_discovery_pass('62000000-0000-4000-8000-000000000011', pg_temp.claim('ent-h@example.test')));
reset role;
select is((select (result->>'state') || '/' || ((result->>'available_from')::timestamptz = (select ends_at
    from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000011' and source = 'early_access'))::text
  from outcome where step = 'h-activate'), 'early-access-active/true',
  'H, on active Early Access, cannot start a pass, and is told when it opens');
select ok(not exists (select 1 from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000011' and source = 'trial')
  and not exists (select 1 from private.discovery_pass_claims where user_id = '61000000-0000-4000-8000-000000000011'),
  'nothing is consumed: no pass and no claim');
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000011","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000011"}';
select is((select (e->'trial'->>'status') || '/' || ((e->'trial'->>'available_from') is not null)::text
  from public.get_my_entitlement() e), 'after-early-access/true', 'the summary says when the trial becomes available');
reset role;
-- Early Access ends: the pass is available (provisional policy) with its full 72 hours.
update public.entitlement_grants set starts_at = now() - interval '1 month' - interval '1 day', ends_at = now() - interval '1 day'
  where user_id = '61000000-0000-4000-8000-000000000011' and source = 'early_access';
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000011', pg_temp.claim('ent-h@example.test'))->>'state', 'activated',
  'after Early Access ends the pass activates');
reset role;
select is((select ends_at from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000011' and source = 'trial'), now() + interval '72 hours',
  'with its full 72 hours');
-- The owner may decide Early Access members never get a trial afterwards.
update private.entitlement_policy set trial_after_early_access = false;
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000004', pg_temp.claim('early-d@example.test')), '{"state":"trial-not-offered"}'::jsonb,
  'the post-Early-Access pass can be switched off');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000004"}';
select is((select e->'trial'->>'status' from public.get_my_entitlement() e), 'not-offered', 'and the summary says so');
reset role;
update private.entitlement_policy set trial_after_early_access = true;
-- Use made during Early Access never draws down a trial's fixed allowance. G started a trial, then got Early Access.
set local role service_role;
select is(public.admin_add_early_access_member('ent-g@example.test', 'G Member', null, now() - interval '40 days',
  'manual', 'whatsapp', 'ops')->>'enrollment', 'granted', 'G, mid-trial, is enrolled in Early Access');
reset role;
update public.entitlement_grants set starts_at = now() - interval '3 days', ends_at = now() + interval '4 days'
  where user_id = '61000000-0000-4000-8000-000000000008' and source = 'trial';
update public.entitlement_grants set starts_at = now() - interval '2 days', ends_at = now() - interval '1 hour'
  where user_id = '61000000-0000-4000-8000-000000000008' and source = 'early_access';
insert into public.ai_usage_events (user_id, feature, state, reserved_at, settled_at, funding_source, funding_grant_id)
  select '61000000-0000-4000-8000-000000000008', 'upload_practice', 'consumed', now() - interval '1 day', now() - interval '1 day', 'early_access',
    (select id from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000008' and source = 'early_access') from generate_series(1, 8);
select is((select jsonb_build_object('state', a->>'state', 'total', (a->>'total')::integer, 'used', (a->>'used')::integer)
  from private.ai_allowance_admission('61000000-0000-4000-8000-000000000008', array['trial', 'early_access']) a), '{"state":"active","total":1,"used":0}'::jsonb,
  'eight generations during Early Access leave the Discovery allowance untouched');

-- 7c. Each AI use stays charged to the grant that funded it (M1) -----------------------------------------------------------
-- J starts a trial, receives Early Access during it, and generates through the real admission and settlement path.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000012', 'authenticated',
  'authenticated', 'ent-j@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('62000000-0000-4000-8000-000000000012', '61000000-0000-4000-8000-000000000012', now(), now());
-- A seven-day trial issued before 20261021100000_discovery_pass.sql, which keeps its ten-set allowance.
insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by) values
  ('61000000-0000-4000-8000-000000000012', 'trial', 'seven-day', now() - interval '2 days', now() + interval '5 days', 'capped', 10, 'test');
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by) values
  ('61000000-0000-4000-8000-000000000012', 'early_access', now() - interval '1 day', now() + interval '29 days', 'uncapped', 'test');
insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name, media_type,
  declared_bytes, expires_at, status, source_text, source_sha256, word_count)
  values ('64000000-0000-4000-8000-000000000012', '61000000-0000-4000-8000-000000000012', (select (result->>'id')::uuid from outcome where step = 'course-acc101'),
    '61000000-0000-4000-8000-000000000012/64000000-0000-4000-8000-000000000012', 'n.txt', 'text/plain', 10,
    now() + interval '1 day', 'ready', 'ready text', pg_temp.h('ready text'), 2);
-- Generate n sets, each admitted and then settled with the given outcome, through the service-role functions.
create function pg_temp.generate(p_count integer, p_status text default 'generated') returns void language plpgsql as $$
declare v_state jsonb;
begin
  for i in 1..p_count loop
    v_state := public.begin_ai_practice_generation('62000000-0000-4000-8000-000000000012', gen_random_uuid(),
      '64000000-0000-4000-8000-000000000012', array['trial', 'early_access']);
    if v_state->>'state' <> 'started' then raise exception 'not admitted: %', v_state; end if;
    perform public.finish_ai_practice_generation('61000000-0000-4000-8000-000000000012', (v_state->>'generation_id')::uuid,
      p_status, case when p_status = 'failed' then 'timeout' end, case when p_status = 'generated' then jsonb_build_object(
        'formatVersion', 1, 'origin', 'ai-generated', 'visibility', 'personal', 'verification', 'unverified',
        'questions', jsonb_build_array(jsonb_build_object('id', 'q1'))) end, null);
  end loop;
end $$;
grant execute on function pg_temp.generate(integer, text) to service_role;
create function pg_temp.trial_use() returns jsonb language sql as $$
  select jsonb_build_object('state', a->>'state', 'total', (a->>'total')::integer, 'used', (a->>'used')::integer)
  from private.ai_allowance_admission('61000000-0000-4000-8000-000000000012', array['trial', 'early_access']) a $$;
set local role service_role;
select pg_temp.generate(12);
select pg_temp.generate(3, 'failed');
reset role;
select is((select jsonb_object_agg(funding_source, n) from (select funding_source, count(*) as n from public.ai_usage_events
  where user_id = '61000000-0000-4000-8000-000000000012' and state = 'consumed' group by 1) uses), '{"early_access":12}'::jsonb,
  'twelve sets are recorded as funded by Early Access; three failures were never charged');
update public.entitlement_grants set revoked_at = now(), revoked_by = 'operator:test', revoke_reason = 'M1 revocation'
  where user_id = '61000000-0000-4000-8000-000000000012' and source = 'early_access';
select is(pg_temp.trial_use(), '{"state":"active","total":10,"used":0}'::jsonb,
  'revoking Early Access ends it without charging its twelve sets to the trial');
set local role service_role;
select pg_temp.generate(2);
reset role;
select is(pg_temp.trial_use(), '{"state":"active","total":10,"used":2}'::jsonb, 'later sets are funded by the trial and count');
update public.entitlement_grants set revoked_at = null, revoked_by = null, revoke_reason = null
  where user_id = '61000000-0000-4000-8000-000000000012' and source = 'early_access';
set local role service_role;
select pg_temp.generate(1);
reset role;
update public.entitlement_grants set revoked_at = now(), revoked_by = 'operator:test', revoke_reason = 'again'
  where user_id = '61000000-0000-4000-8000-000000000012' and source = 'early_access';
select is(pg_temp.trial_use(), '{"state":"active","total":10,"used":2}'::jsonb,
  'restoring Early Access neither refunds the trial''s two sets nor charges it for the restored period');
-- Exact boundary: at the instant Early Access ends, the trial funds the next set.
update public.entitlement_grants set revoked_at = null, revoked_by = null, revoke_reason = null,
  starts_at = now() - interval '1 day', ends_at = now() where user_id = '61000000-0000-4000-8000-000000000012' and source = 'early_access';
set local role service_role;
select pg_temp.generate(1);
reset role;
select is((select count(*)::integer from public.ai_usage_events where user_id = '61000000-0000-4000-8000-000000000012'
  and funding_source = 'trial'), 3, 'a set reserved exactly at Early Access''s end is funded by the trial');
select is(pg_temp.trial_use(), '{"state":"active","total":10,"used":3}'::jsonb, 'and counts once');
-- Expiry and partial overlap: an expired Early Access keeps its history; uses before it began stay the trial's.
update public.entitlement_grants set starts_at = now() - interval '1 day 12 hours', ends_at = now() - interval '1 hour'
  where user_id = '61000000-0000-4000-8000-000000000012' and source = 'early_access';
select is(pg_temp.trial_use(), '{"state":"active","total":10,"used":3}'::jsonb,
  'moving or expiring the Early Access window re-attributes nothing');
select is((select count(*)::integer from public.ai_usage_events where user_id = '61000000-0000-4000-8000-000000000012' and funding_source is null), 0,
  'every admitted use names its funding grant');
-- Exhaustion still counts only the trial's own uses.
set local role service_role;
select pg_temp.generate(7);
select is((public.begin_ai_practice_generation('62000000-0000-4000-8000-000000000012', gen_random_uuid(),
  '64000000-0000-4000-8000-000000000012', array['trial', 'early_access']))->>'state', 'allowance-exhausted',
  'the trial is exhausted after exactly ten of its own sets');
reset role;
-- Account deletion removes the ledger with the grants.
delete from auth.users where id = '61000000-0000-4000-8000-000000000012';
select is((select count(*)::integer from public.ai_usage_events where user_id = '61000000-0000-4000-8000-000000000012')
  + (select count(*)::integer from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000012'), 0, 'account deletion removes the history');

-- 7d. Merging duplicate identities keeps one Early Access month (M2) ------------------------------------------------------
-- K and L are imported as different people and both enrolled; K enrolled first. They turn out to be one student.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('61000000-0000-4000-8000-000000000013', 'ent-k@example.test'), ('61000000-0000-4000-8000-000000000014', 'ent-l@example.test')) people(id, email);
set local role service_role;
select is(public.admin_add_early_access_member('ent-k@example.test', 'Kemi A', null, now() - interval '40 days', 'import',
  'google-form', 'ops')->>'enrollment', 'granted', 'K is enrolled');
reset role;
update public.entitlement_grants set starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '1 month'
  where user_id = '61000000-0000-4000-8000-000000000013' and source = 'early_access';
set local role service_role;
select is(public.admin_add_early_access_member('ent-l@example.test', 'K. Adebayo', null, now() - interval '35 days', 'import',
  'whatsapp', 'ops')->>'enrollment', 'granted', 'L, not yet known to be K, is enrolled too');
reset role;
insert into public.ai_usage_events (user_id, feature, state, reserved_at, settled_at, funding_source, funding_grant_id)
  select '61000000-0000-4000-8000-000000000014', 'upload_practice', 'consumed', now(), now(), 'early_access', (select id from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000014' and source = 'early_access') from generate_series(1, 2);
insert into outcome select 'l-grant', jsonb_build_object('id', id) from public.entitlement_grants
  where user_id = '61000000-0000-4000-8000-000000000014' and source = 'early_access';
insert into outcome select 'k-grant-before-merge', to_jsonb(g) from public.entitlement_grants g where user_id = '61000000-0000-4000-8000-000000000013' and source = 'early_access';
set local role service_role;
select is(public.admin_change_early_access_member('ent-l@example.test', 'mark-duplicate', 'ent-k@example.test', 'ops',
  'same student, two emails')->>'duplicate_grants_revoked', '1', 'the merge ends exactly one duplicate grant');
reset role;
select is((select count(*)::integer from public.entitlement_grants where source = 'early_access' and revoked_at is null and user_id in ('61000000-0000-4000-8000-000000000013', '61000000-0000-4000-8000-000000000014')), 1, 'one identity group, one active Early Access month');
select is((select revoked_by from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000014' and source = 'early_access'),
  'system:duplicate-merge', 'the later grant is the duplicate; it is revoked, not deleted');
select is((select to_jsonb(g) from public.entitlement_grants g where user_id = '61000000-0000-4000-8000-000000000013' and source = 'early_access'),
  (select result from outcome where step = 'k-grant-before-merge'), 'the canonical (earliest) grant is not restarted or extended');
select ok(exists (select 1 from private.entitlement_events where event = 'early-access.duplicate-revoked' and user_id = '61000000-0000-4000-8000-000000000014'
  and (detail->>'canonical_grant_id')::uuid = (select id from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000013' and source = 'early_access')), 'the revocation is audited with the canonical grant');
select is((select count(*)::integer from public.ai_usage_events where funding_grant_id = (select id from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000014' and source = 'early_access')), 2,
  'AI the duplicate grant funded stays attributed to it');
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000014', array['trial', 'early_access'])->>'state', 'not-entitled',
  'the duplicate grant admits no further AI, and nothing of its history moves to another entitlement');
select is(private.reconcile_early_access('61000000-0000-4000-8000-000000000014', 'test')->>'status', 'ended', 'reconciliation never grants L again');
set local role service_role;
select is(public.admin_change_grant((select (result->>'id')::uuid from outcome where step = 'l-grant'), 'restore', null, null, 'ops', 'disputed')->>'state', 'duplicate-identity',
  'an operator cannot restore a second month while the identities are merged');
select is(public.admin_change_early_access_member('ent-l@example.test', 'clear-duplicate', null, 'ops',
  'different students after all')->>'state', 'changed', 'the operator separates them again');
reset role;
select ok((select revoked_at is not null from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000014' and source = 'early_access'),
  'separating does not silently restore the revoked month');
set local role service_role;
select is(public.admin_change_grant((select (result->>'id')::uuid from outcome where step = 'l-grant'), 'restore', null, null, 'ops', 'confirmed different students')->>'state', 'changed',
  'once separate, an explicit restore is allowed');
reset role;
select is((select count(*)::integer from public.entitlement_grants where source = 'early_access' and revoked_at is null and user_id in ('61000000-0000-4000-8000-000000000013', '61000000-0000-4000-8000-000000000014')), 2, 'two separate people, two months');
set local role service_role;
select is(public.admin_change_early_access_member('ent-l@example.test', 'mark-duplicate', 'ent-k@example.test', 'ops',
  'merged again')->>'duplicate_grants_revoked', '1', 'merging again resolves again');
reset role;
select is((select string_agg(user_id::text || ':' || (revoked_at is null)::text, ',' order by user_id) from public.entitlement_grants
  where source = 'early_access' and user_id in ('61000000-0000-4000-8000-000000000013', '61000000-0000-4000-8000-000000000014')), '61000000-0000-4000-8000-000000000013:true,61000000-0000-4000-8000-000000000014:false',
  'the earliest grant (K) stays canonical');
-- One lifetime month: an ended canonical grant still counts.
update public.entitlement_grants set starts_at = now() - interval '1 month' - interval '1 day', ends_at = now() - interval '1 day'
  where user_id = '61000000-0000-4000-8000-000000000013' and source = 'early_access';
set local role service_role;
select is(public.admin_change_grant((select (result->>'id')::uuid from outcome where step = 'l-grant'), 'restore', null, null, 'ops', 'after K ended')->>'state', 'duplicate-identity',
  'after the identity''s month has ended, a duplicate cannot be restored to start another');
reset role;

-- 8. Account deletion ---------------------------------------------------------------------------------------------------
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values ('61000000-0000-4000-8000-000000000003', now(), now() + interval '720 hours', now() + interval '720 hours');
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000003', pg_temp.claim('ent-c@example.test'))->>'state', 'signed-out',
  'a deletion-scheduled account cannot start a pass');
select is(public.admin_add_early_access_member('ent-c@example.test', 'C Member', null, now() - interval '40 days',
  'import', 'google-form', 'ops')->>'enrollment', 'account-restricted', 'nor be enrolled in Early Access');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000003"}';
select throws_ok($$ select public.get_my_entitlement() $$, '42501', null, 'a scheduled account has no plan to read');
reset role;
-- Purging A and D (as the deletion worker does) keeps the email claim and the Early Access place used.
delete from auth.users where id in ('61000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000004');
select ok(not exists (select 1 from public.entitlement_grants where user_id in ('61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000004')), 'grants go with the account');
select is(private.ai_allowance_admission('61000000-0000-4000-8000-000000000001', array['trial', 'early_access'])->>'state',
  'not-entitled', 'and so does every AI allowance');
select is((select user_id from private.discovery_pass_claims where claim_hash = pg_temp.claim('ent-a@example.test') -> 0 ->> 'hash'),
  null, 'the pass claim survives without the account');
select is((select (claimed_by is null and claimed_at is not null) from private.early_access_members
  where email = 'early-d@example.test'), true, 'the list place stays claimed without the account');
select ok(exists (select 1 from private.entitlement_events where event = 'discovery.activated' and user_id is null),
  'audit rows stay, de-identified');
-- A registers again with the same address (in another case), and D does too.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated',
    'Ent-A@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '61000000-0000-4000-8000-000000000015', 'authenticated', 'authenticated',
    'early-d@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('62000000-0000-4000-8000-000000000010', '61000000-0000-4000-8000-000000000010', now(), now()),
  ('62000000-0000-4000-8000-000000000015', '61000000-0000-4000-8000-000000000015', now(), now());
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000010', pg_temp.claim('ent-a@example.test')),
  '{"state":"already-claimed","retention_months":24}'::jsonb,
  'deleting and re-registering the same address does not buy a second pass, and the student is told for how long');
reset role;
select ok(not exists (select 1 from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000010')
  and exists (select 1 from private.entitlement_events where user_id = '61000000-0000-4000-8000-000000000010'
    and event = 'discovery.claim-refused'), 'the refusal is audited and nothing is granted');
select ok(not exists (select 1 from public.entitlement_grants where user_id = '61000000-0000-4000-8000-000000000015')
  and private.early_access_status('61000000-0000-4000-8000-000000000015')->>'status' = 'unavailable',
  'nor does re-registering free the Early Access month for the same confirmed email');
-- Retention: once the claim expires the address may start a pass again on a new account, and expired rows are purged.
update private.discovery_pass_claims set claimed_at = now() - interval '25 months', expires_at = now() - interval '1 month'
  where claim_hash = pg_temp.claim('ent-a@example.test') -> 0 ->> 'hash';
set local role service_role;
select is(public.activate_discovery_pass('62000000-0000-4000-8000-000000000010', pg_temp.claim('ent-a@example.test'))->>'state',
  'activated', 'an expired claim no longer blocks the address, even before it is purged');
reset role;
select is((select jsonb_build_object('user', user_id, 'fresh', expires_at = now() + interval '24 months')
    from private.discovery_pass_claims where claim_hash = pg_temp.claim('ent-a@example.test') -> 0 ->> 'hash'),
  '{"user":"61000000-0000-4000-8000-000000000010","fresh":true}'::jsonb, 'the new claim replaces the expired one');
update private.discovery_pass_claims set claimed_at = now() - interval '25 months', expires_at = now() - interval '1 day'
  where user_id = '61000000-0000-4000-8000-000000000008';
set local role service_role;
select is((public.admin_entitlement_status('61000000-0000-4000-8000-000000000008')->>'discovery_claimed')::boolean, false,
  'an expired claim is not reported as a live claim');
select is(public.purge_discovery_pass_claims(), 1, 'purging removes exactly the expired claims');
select is(public.purge_discovery_pass_claims(), 0, 'and nothing else');
reset role;
select ok(not exists (select 1 from private.discovery_pass_claims where user_id = '61000000-0000-4000-8000-000000000008')
  and exists (select 1 from private.discovery_pass_claims where user_id = '61000000-0000-4000-8000-000000000010'),
  'live claims stay');
set local role service_role;

-- 9. Operator recovery and preview ----------------------------------------------------------------------------------------
select throws_ok($$ select public.admin_grant_access('61000000-0000-4000-8000-000000000002', 3, 'ops', '') $$, '22023', null,
  'a recovery change needs a reason');
insert into outcome values ('b-grant', public.admin_grant_access('61000000-0000-4000-8000-000000000002', 3, 'ops',
  'activation outage compensation'));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000002"}';
select ok((select count(*) from public.read_published_managed_content('40000000-0000-4000-8000-000000000002')) > 0,
  'an operator grant opens courses immediately');
select is((select a->>'state' from public.get_my_ai_allowance() a), 'not-entitled', 'a manual grant carries no AI');
reset role;
set local role service_role;
select is(public.admin_change_grant((select (result->>'grant_id')::uuid from outcome where step = 'b-grant'), 'revoke', null,
  null, 'ops', 'granted in error')->>'state', 'changed', 'an operator revokes the grant');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000002"}';
select throws_ok($$ select * from public.read_published_managed_content('40000000-0000-4000-8000-000000000002') $$,
  'CI403', null, 'revocation takes effect in the same session');
reset role;
set local role service_role;
select throws_ok($$ select public.admin_change_grant((select (result->>'grant_id')::uuid from outcome where step = 'b-grant'),
  'set-ai-units', null, 50, 'ops', 'more AI') $$, '22023', null, 'only a capped grant has an AI allowance to change');
reset role;
insert into outcome select 'f-trial', jsonb_build_object('id', id) from public.entitlement_grants
  where user_id = '61000000-0000-4000-8000-000000000007';
set local role service_role;
select is(public.admin_change_grant((select (result->>'id')::uuid from outcome where step = 'f-trial'),
  'set-ai-units', null, 15, 'ops', 'failed generations disputed')->>'state', 'changed', 'a disputed trial AI allowance is raised');
select is((select s->>'discovery_claimed' || '/' || (s->>'trial_phone_claimed') || '/' || (s ? 'otp_challenges')::text
  from public.admin_entitlement_status('61000000-0000-4000-8000-000000000007') s), 'true/false/false',
  'the operator view shows the pass claim, no phone claim and no codes');
select ok((select jsonb_array_length(public.admin_entitlement_status('61000000-0000-4000-8000-000000000002')->'events') >= 2),
  'the account history shows the grant and its revocation');
reset role;
select is((select array_agg(actor order by id) from private.entitlement_events where user_id = '61000000-0000-4000-8000-000000000002'
  and event like 'operator.%'), array['operator:ops', 'operator:ops'], 'every operator change names its actor');
set local role authenticated;
set local request.jwt.claims = '{"sub":"61000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"62000000-0000-4000-8000-000000000006"}';
select ok((select count(*) from public.read_published_managed_content('40000000-0000-4000-8000-000000000002')) > 0,
  'operators preview every course without a grant');
reset role;

-- 10. Sweep batches cannot be starved (M3-B) --------------------------------------------------------------------------
-- Three deletion-scheduled listed accounts joined first, so they used to fill a batch of two ahead of the eligible E2;
-- a post-launch joiner and an already-enrolled account used to keep "remaining" above zero forever.
update private.entitlement_policy set actual_launch_at = now() - interval '1 day', early_access_enrollment_days = 30;
set local role service_role;
select is(public.admin_reconcile_early_access('ops', 'baseline before starvation probe', 500)->>'remaining', '0',
  'baseline: nothing enrollable is left from earlier fixtures');
reset role;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email, 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('61000000-0000-4000-8000-0000000000a1', 'starve-x1@example.test'),
  ('61000000-0000-4000-8000-0000000000a2', 'starve-x2@example.test'),
  ('61000000-0000-4000-8000-0000000000a3', 'starve-x3@example.test'),
  ('61000000-0000-4000-8000-0000000000a4', 'starve-late@example.test'),
  ('61000000-0000-4000-8000-0000000000a5', 'starve-e2@example.test')) accounts(id, email);
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  select id::uuid, now(), now() + interval '720 hours', now() + interval '720 hours'
  from unnest(array['61000000-0000-4000-8000-0000000000a1', '61000000-0000-4000-8000-0000000000a2',
    '61000000-0000-4000-8000-0000000000a3']) id;
insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
  values ('starve-x1@example.test', 'X1', now() - interval '50 days', 'import', 'starve', 'test'),
    ('starve-x2@example.test', 'X2', now() - interval '49 days', 'import', 'starve', 'test'),
    ('starve-x3@example.test', 'X3', now() - interval '48 days', 'import', 'starve', 'test'),
    ('starve-late@example.test', 'Late', now(), 'manual', 'starve', 'test'),
    ('starve-e2@example.test', 'E2', now() - interval '10 days', 'import', 'starve', 'test');
select is((select count(*)::integer from private.early_access_sweep_candidates()), 1,
  'only the eligible account is a sweep candidate');
set local role service_role;
select is(public.admin_reconcile_early_access('ops', 'starvation probe', 2) - 'state',
  '{"granted": 1, "remaining": 0, "deferred": 0}'::jsonb,
  'a batch of two enrolls E2 past three deletion-scheduled accounts and reports nothing left');
select is(public.admin_reconcile_early_access('ops', 'starvation probe again', 2) - 'state',
  '{"granted": 0, "remaining": 0, "deferred": 0}'::jsonb, 'the next sweep finds nothing to do');
reset role;
select is((select count(*)::integer from public.entitlement_grants where source = 'early_access'
  and user_id in ('61000000-0000-4000-8000-0000000000a1', '61000000-0000-4000-8000-0000000000a2',
    '61000000-0000-4000-8000-0000000000a3', '61000000-0000-4000-8000-0000000000a4')), 0,
  'deletion-scheduled and post-launch accounts are still never enrolled');
update private.entitlement_policy set actual_launch_at = now() - interval '31 days';
select is((select count(*)::integer from private.early_access_sweep_candidates()), 0,
  'after the window closes nothing counts as remaining');

select * from finish();
rollback;
