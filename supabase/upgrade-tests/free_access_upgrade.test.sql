-- Run only through run.sh, after seeding free_access_launched.sql at the last migration before
-- 20261126100000_free_until_30_december.sql and applying the real migration: a database whose launch was recorded
-- under the old rule (13 November at 09:00 Lagos, with a stored close of 23 November at 09:00 that has passed). Every
-- expectation is a fixed instant or a literal, so the file passes on any run date.
begin;

select plan(16);

-- The policy row ------------------------------------------------------------------------------------------------------
select is(
  (select jsonb_build_object('cutoff', early_access_claim_cutoff, 'closes', early_access_claim_closes_at)
    from private.entitlement_policy),
  jsonb_build_object('cutoff', timestamptz '2026-12-31 00:00:00+01', 'closes', timestamptz '2026-12-31 00:00:00+01'),
  'free access can be claimed until, and ends at, the end of 30 December (Lagos): the close moved with the cutoff'
);

select is(
  (select jsonb_build_object('launch', actual_launch_at, 'days', early_access_enrollment_days,
      'duration', early_access_duration)
    from private.entitlement_policy),
  jsonb_build_object('launch', timestamptz '2026-11-13 09:00:00+01', 'days', 10, 'duration', interval '1 mon'),
  'the recorded launch, the retired claim days and the retired month length are unchanged'
);

-- The window, at explicit instants ------------------------------------------------------------------------------------
select ok(
  private.early_access_claim_open(timestamptz '2026-12-30 23:59:59+01'),
  'free access can still be claimed in the last second of 30 December (Lagos)'
);

select ok(
  not private.early_access_claim_open(timestamptz '2026-12-31 00:00:00+01'),
  'and not from midnight, the end of 30 December (Lagos)'
);

select is(
  (select array_agg(private.early_access_claim_open(instant) order by instant)
    from unnest(array[timestamptz '2026-11-13 08:59:59.999999+01', timestamptz '2026-11-13 09:00:00+01',
      timestamptz '2026-11-23 09:00:00+01']) as t(instant)),
  array[false, true, true],
  'the claim is open from the recorded launch and past the old close, 23 November 09:00: a closed window reopens (D5)'
);

select is(
  (select array_agg(distinct private.early_access_month_end(instant))
    from unnest(array[timestamptz '2026-11-13 09:00:00+01', timestamptz '2026-11-23 09:00:00+01',
      timestamptz '2026-12-16 14:30:00+01', timestamptz '2026-12-30 23:59:59+01', timestamptz '2026-12-31 00:00:00+01',
      timestamptz '2027-06-01 12:00:00+01']) as t(instant)),
  array[timestamptz '2026-12-31 00:00:00+01'],
  'free access claimed at any instant ends at the stored close, the end of 30 December (Lagos)'
);

-- What the operator reads back after applying it (early-access-report) ------------------------------------------------
select is(
  (select jsonb_build_object('cutoff', (r->>'claim_cutoff')::timestamptz,
      'closes', (r->>'claim_closes_at')::timestamptz, 'if_launched_now', r->'if_launched_now',
      'claim_days', r ? 'claim_days', 'claimed', r->'months'->'claimed', 'revoked', r->'months'->'revoked')
    from public.admin_early_access_report() r),
  jsonb_build_object('cutoff', timestamptz '2026-12-31 00:00:00+01', 'closes', timestamptz '2026-12-31 00:00:00+01',
    'if_launched_now', null, 'claim_days', false, 'claimed', 3, 'revoked', 1),
  'the report names the new end as the cutoff and the close, has no claim days, and counts the same three claims'
);

-- Every planted row, compared with what the seed wrote ----------------------------------------------------------------
-- A grant's columns as the seed wrote them, and the semester the insert trigger bound it to.
create function pg_temp.grant_row(p_id uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('user', g.user_id, 'source', g.source, 'policy', g.trial_policy, 'starts', g.starts_at,
    'ends', g.ends_at, 'created', g.created_at, 'by', g.created_by, 'ai', g.ai_terms, 'units', g.ai_units,
    'reference', g.reference, 'revoked', g.revoked_at, 'revoked_by', g.revoked_by, 'reason', g.revoke_reason,
    'department', g.course_department_id,
    'first_semester_2026', g.course_term_id = (select t.id from private.academic_terms t
      where t.session_label = '2026/2027' and t.academic_period_id = '30000000-0000-4000-8000-000000000001'))
  from public.entitlement_grants g where g.id = p_id
$$;

select is(
  pg_temp.grant_row('fa200000-0000-4000-8000-000000000001'),
  jsonb_build_object('user', 'fa100000-0000-4000-8000-000000000001', 'source', 'early_access', 'policy', null,
    'starts', timestamptz '2026-11-13 09:00:00+01', 'ends', timestamptz '2026-12-13 09:00:00+01',
    'created', timestamptz '2026-11-13 09:00:00+01', 'by', 'student', 'ai', 'uncapped', 'units', null,
    'reference', '{"claim": "site", "profile_revision": 1}'::jsonb, 'revoked', null, 'revoked_by', null, 'reason', null,
    'department', '10000000-0000-4000-8000-000000000002', 'first_semester_2026', true),
  'a running claim made under the old rule keeps its one-month end, 13 December at 09:00 (D2)'
);

select is(
  pg_temp.grant_row('fa200000-0000-4000-8000-000000000002'),
  jsonb_build_object('user', 'fa100000-0000-4000-8000-000000000002', 'source', 'early_access', 'policy', null,
    'starts', timestamptz '2026-11-14 10:00:00+01', 'ends', timestamptz '2026-12-14 10:00:00+01',
    'created', timestamptz '2026-11-14 10:00:00+01', 'by', 'student', 'ai', 'uncapped', 'units', null,
    'reference', '{"claim": "site", "profile_revision": 1}'::jsonb, 'revoked', timestamptz '2026-11-15 12:00:00+01',
    'revoked_by', 'operator:founder', 'reason', 'Revoked before the change',
    'department', '10000000-0000-4000-8000-000000000002', 'first_semester_2026', true),
  'a revoked claim stays revoked, with its own dates'
);

select is(
  pg_temp.grant_row('fa200000-0000-4000-8000-000000000003'),
  jsonb_build_object('user', 'fa100000-0000-4000-8000-000000000003', 'source', 'early_access', 'policy', null,
    'starts', timestamptz '2026-11-30 23:59:00+01', 'ends', timestamptz '2026-12-30 23:59:00+01',
    'created', timestamptz '2026-11-30 23:59:00+01', 'by', 'student', 'ai', 'uncapped', 'units', null,
    'reference', '{"claim": "site", "profile_revision": 1}'::jsonb, 'revoked', null, 'revoked_by', null, 'reason', null,
    'department', '10000000-0000-4000-8000-000000000002', 'first_semester_2026', true),
  'a claim ending one minute before the new end keeps its own end: the migration moves no grant'
);

select is(
  pg_temp.grant_row('fa200000-0000-4000-8000-000000000004'),
  jsonb_build_object('user', 'fa100000-0000-4000-8000-000000000004', 'source', 'trial', 'policy', 'discovery',
    'starts', timestamptz '2026-11-24 12:00:00+01', 'ends', timestamptz '2026-11-27 12:00:00+01',
    'created', timestamptz '2026-11-24 12:00:00+01', 'by', 'student', 'ai', 'capped', 'units', 1,
    'reference', '{}'::jsonb, 'revoked', null, 'revoked_by', null, 'reason', null,
    'department', null, 'first_semester_2026', null),
  'the running free pass keeps its window and its Campus Bot set'
);

select is(
  (select jsonb_build_object('all', count(*), 'early_access', count(*) filter (where source = 'early_access'))
    from public.entitlement_grants),
  '{"all": 4, "early_access": 3}'::jsonb,
  'the migration writes no grant'
);

select is(
  (select jsonb_agg(jsonb_build_object('hash', claim_hash, 'version', key_version, 'user', user_id,
      'grant', grant_id, 'claimed', claimed_at, 'expires', expires_at))
    from private.early_access_claims),
  jsonb_build_array(jsonb_build_object(
    'hash', '71bc56bbaf3037c960e23e5a49b01fdb23880ffd415579b9f4acc053b9276a29', 'version', 1,
    'user', 'fa100000-0000-4000-8000-000000000001', 'grant', 'fa200000-0000-4000-8000-000000000001',
    'claimed', timestamptz '2026-11-13 09:00:00+01', 'expires', timestamptz '2031-11-13 09:00:00+01')),
  'the address record of the claim is unchanged, and none was added'
);

select is(
  (select jsonb_agg(jsonb_build_object('hash', claim_hash, 'version', key_version, 'user', user_id,
      'grant', grant_id, 'claimed', claimed_at, 'expires', expires_at))
    from private.discovery_pass_claims),
  jsonb_build_array(jsonb_build_object(
    'hash', '0c1f8489fc7cdaa360b417ce4435f5891074046054ebf33490eb9829f3c5d0d2', 'version', 1,
    'user', 'fa100000-0000-4000-8000-000000000004', 'grant', 'fa200000-0000-4000-8000-000000000004',
    'claimed', timestamptz '2026-11-24 12:00:00+01', 'expires', timestamptz '2031-11-24 12:00:00+01')),
  'and so is the free pass''s address record'
);

select is(
  (select jsonb_agg(jsonb_build_object('at', occurred_at, 'user', user_id, 'grant', grant_id, 'event', event,
      'actor', actor, 'detail', detail) order by id)
    from private.entitlement_events where event in ('operator.public-launch', 'early-access.claimed')),
  jsonb_build_array(
    jsonb_build_object('at', timestamptz '2026-11-13 09:00:00+01', 'user', null, 'grant', null,
      'event', 'operator.public-launch', 'actor', 'operator:founder',
      'detail', '{"reason": "public launch", "actual_launch_at": "2026-11-13T08:00:00+00:00", "planned_launch_at": "2026-10-24T23:00:00+00:00", "claim_closes_at": "2026-11-23T08:00:00+00:00", "short_window": false}'::jsonb),
    jsonb_build_object('at', timestamptz '2026-11-13 09:00:00+01', 'user', 'fa100000-0000-4000-8000-000000000001',
      'grant', 'fa200000-0000-4000-8000-000000000001', 'event', 'early-access.claimed', 'actor', 'student',
      'detail', '{"starts_at": "2026-11-13T08:00:00+00:00", "ends_at": "2026-12-13T08:00:00+00:00", "profile_revision": 1}'::jsonb)),
  'the launch and claim audit rows keep their old instants and details, and no launch or claim row was added'
);

-- The plan read the pages ask first (the migration's get_my_entitlement step) -----------------------------------------
-- With launch + 10 days it would still say 23 November, and no page would offer the reopened claim. Student 4 holds a
-- free pass and never had free access: the reopened claim is for students like them.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'fa100000-0000-4000-8000-000000000004',
  'role', 'authenticated', 'session_id', 'fa300000-0000-4000-8000-000000000004')::text, true);
select is(
  (select (e->'early_access'->>'enrollment_closes_at')::timestamptz from public.get_my_entitlement() e),
  timestamptz '2026-12-31 00:00:00+01',
  'the plan read says the claim closes at the end of 30 December, not 10 days after the recorded launch'
);
reset role;

select * from finish();
rollback;
