-- Seeded after a local reset stopped at the last migration before 20261126100000_free_until_30_december.sql: a database
-- that recorded its launch, and had free months claimed, under the old rule, as the test site has. Fixed instants only,
-- so the scenario is the same on any run date; free_access_upgrade.test.sql compares every planted row with literals
-- after the migration.

-- Four confirmed students with a session and Business Administration 200L First Semester, created as
-- supabase/tests/early_access_claim.test.sql creates them. The selection comes before the grants, so the grant insert
-- trigger binds each free month to the student's department and the running semester, as a claim did.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000',
   'fa100000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'free-access-1@example.test', 'fixture-only',
   timestamptz '2026-11-01 10:05:00+01', '{"provider":"email","providers":["email"]}', '{}',
   timestamptz '2026-11-01 10:00:00+01', timestamptz '2026-11-01 10:05:00+01'),
  ('00000000-0000-0000-0000-000000000000',
   'fa100000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'free-access-2@example.test', 'fixture-only',
   timestamptz '2026-11-01 10:05:00+01', '{"provider":"email","providers":["email"]}', '{}',
   timestamptz '2026-11-01 10:00:00+01', timestamptz '2026-11-01 10:05:00+01'),
  ('00000000-0000-0000-0000-000000000000',
   'fa100000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'free-access-3@example.test', 'fixture-only',
   timestamptz '2026-11-01 10:05:00+01', '{"provider":"email","providers":["email"]}', '{}',
   timestamptz '2026-11-01 10:00:00+01', timestamptz '2026-11-01 10:05:00+01'),
  ('00000000-0000-0000-0000-000000000000',
   'fa100000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'free-access-4@example.test', 'fixture-only',
   timestamptz '2026-11-01 10:05:00+01', '{"provider":"email","providers":["email"]}', '{}',
   timestamptz '2026-11-01 10:00:00+01', timestamptz '2026-11-01 10:05:00+01');

insert into auth.sessions (id, user_id, created_at, updated_at)
values
  ('fa300000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001',
   timestamptz '2026-11-13 08:30:00+01', timestamptz '2026-11-13 08:30:00+01'),
  ('fa300000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002',
   timestamptz '2026-11-13 08:30:00+01', timestamptz '2026-11-13 08:30:00+01'),
  ('fa300000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000003',
   timestamptz '2026-11-13 08:30:00+01', timestamptz '2026-11-13 08:30:00+01'),
  ('fa300000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000004',
   timestamptz '2026-11-13 08:30:00+01', timestamptz '2026-11-13 08:30:00+01');

-- The confirmation instant belongs to the course-selection trigger (it takes the run's clock); nothing reads it here.
update public.profiles
   set first_name = 'Ada',
       department_id = '10000000-0000-4000-8000-000000000002',
       academic_level_id = '20000000-0000-4000-8000-000000000002',
       academic_period_id = '30000000-0000-4000-8000-000000000001'
 where id in ('fa100000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000002',
   'fa100000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000004');

-- The launch, on 13 November at 09:00 Lagos. A plain update, because admin_activate_public_launch takes the wall clock;
-- the old trigger then stores the old close, least(launch + 10 days, 1 December 00:00) = 23 November at 09:00 Lagos,
-- which has passed on any run date: the claim is closed and the free pass offered again. Audited as the launch was.
update private.entitlement_policy
   set actual_launch_at = timestamptz '2026-11-13 09:00:00+01'
 where singleton = true;
insert into private.entitlement_events (occurred_at, user_id, grant_id, event, actor, detail)
values
  (timestamptz '2026-11-13 09:00:00+01', null, null, 'operator.public-launch', 'operator:founder',
   '{"reason": "public launch", "actual_launch_at": "2026-11-13T08:00:00+00:00", "planned_launch_at": "2026-10-24T23:00:00+00:00", "claim_closes_at": "2026-11-23T08:00:00+00:00", "short_window": false}');

-- Free months claimed on the site under the old rule, each one calendar month from its claim (Lagos):
--   1 claimed at the launch and running to 13 December at 09:00, with its address record and its audit row;
--   2 claimed the next day and revoked by the operator;
--   3 claimed in the last minute before the old cutoff (possible on a database launched after 20 November with the
--     short-window flag), so it ends one minute before the new end; it must keep its own end.
insert into public.entitlement_grants (
  id, user_id, source, trial_policy, starts_at, ends_at, created_at, created_by,
  ai_terms, ai_units, reference, revoked_at, revoked_by, revoke_reason
)
values
  ('fa200000-0000-4000-8000-000000000001', 'fa100000-0000-4000-8000-000000000001', 'early_access', null,
   timestamptz '2026-11-13 09:00:00+01', timestamptz '2026-12-13 09:00:00+01', timestamptz '2026-11-13 09:00:00+01',
   'student', 'uncapped', null, '{"claim": "site", "profile_revision": 1}', null, null, null),
  ('fa200000-0000-4000-8000-000000000002', 'fa100000-0000-4000-8000-000000000002', 'early_access', null,
   timestamptz '2026-11-14 10:00:00+01', timestamptz '2026-12-14 10:00:00+01', timestamptz '2026-11-14 10:00:00+01',
   'student', 'uncapped', null, '{"claim": "site", "profile_revision": 1}',
   timestamptz '2026-11-15 12:00:00+01', 'operator:founder', 'Revoked before the change'),
  ('fa200000-0000-4000-8000-000000000003', 'fa100000-0000-4000-8000-000000000003', 'early_access', null,
   timestamptz '2026-11-30 23:59:00+01', timestamptz '2026-12-30 23:59:00+01', timestamptz '2026-11-30 23:59:00+01',
   'student', 'uncapped', null, '{"claim": "site", "profile_revision": 1}', null, null, null);
insert into private.early_access_claims (claim_hash, key_version, user_id, grant_id, claimed_at, expires_at)
values
  ('71bc56bbaf3037c960e23e5a49b01fdb23880ffd415579b9f4acc053b9276a29', 1, 'fa100000-0000-4000-8000-000000000001',
   'fa200000-0000-4000-8000-000000000001', timestamptz '2026-11-13 09:00:00+01', timestamptz '2031-11-13 09:00:00+01');
insert into private.entitlement_events (occurred_at, user_id, grant_id, event, actor, detail)
values
  (timestamptz '2026-11-13 09:00:00+01', 'fa100000-0000-4000-8000-000000000001', 'fa200000-0000-4000-8000-000000000001',
   'early-access.claimed', 'student',
   '{"starts_at": "2026-11-13T08:00:00+00:00", "ends_at": "2026-12-13T08:00:00+00:00", "profile_revision": 1}');

-- 4 started a free pass after the old window closed (72 hours, one Campus Bot set), with its address record.
insert into public.entitlement_grants (
  id, user_id, source, trial_policy, starts_at, ends_at, created_at, created_by, ai_terms, ai_units
)
values
  ('fa200000-0000-4000-8000-000000000004', 'fa100000-0000-4000-8000-000000000004', 'trial', 'discovery',
   timestamptz '2026-11-24 12:00:00+01', timestamptz '2026-11-27 12:00:00+01', timestamptz '2026-11-24 12:00:00+01',
   'student', 'capped', 1);
insert into private.discovery_pass_claims (claim_hash, key_version, user_id, grant_id, claimed_at, expires_at)
values
  ('0c1f8489fc7cdaa360b417ce4435f5891074046054ebf33490eb9829f3c5d0d2', 1, 'fa100000-0000-4000-8000-000000000004',
   'fa200000-0000-4000-8000-000000000004', timestamptz '2026-11-24 12:00:00+01', timestamptz '2031-11-24 12:00:00+01');

-- The scenario is the one intended only if the reset stopped before the free access migration: the old rule stored
-- the 10-day close, and the policy still has the 30 November cutoff, the 10 days and the one-month length.
do $$
begin
  if (select count(*) from private.entitlement_policy
      where actual_launch_at = timestamptz '2026-11-13 09:00:00+01'
        and early_access_claim_closes_at = timestamptz '2026-11-23 09:00:00+01'
        and early_access_claim_cutoff = timestamptz '2026-12-01 00:00:00+01'
        and early_access_enrollment_days = 10
        and early_access_duration = interval '1 mon') <> 1 then
    raise exception 'free_access_launched.sql: expected a launch on 13 November 09:00 (Lagos) with the old 10-day close, 23 November 09:00, stored by the old rule';
  end if;
end;
$$;
