-- supabase/migrations/20261116120000_early_access_claim.sql — Early Access is claimed on the site (owner decisions of
-- 16 November 2026, replacing PRD 4.9's pre-launch list). Students know it as their free month.
-- 1. There is no list any more. A signed-in student with a confirmed email claims the month themselves, once, while the
--    claim is open. Nothing is granted at sign-up, at confirmation or by a page read.
-- 2. The claim is open from the actual launch until whichever comes first: early_access_enrollment_days (now 10) after
--    it, or early_access_claim_cutoff (the end of 30 November 2026, Africa/Lagos). A month that starts before that cutoff
--    ends within 2026.
-- 3. The grant is the existing one: source 'early_access', one month from the claim, 'uncapped', Standard Campus Bot
--    limits (20261103160000), bound to the student's semester by the existing insert trigger, and it sets the student's
--    courses through the existing derived lock (20261029100000). One per account, ever (the existing unique index).
-- 4. One claim per confirmed address: private.early_access_claims holds the same keyed hash the free pass ledger holds
--    (lib/entitlements/claim-hash.ts), under the same keys and the same retention. It is a second table because the
--    pass ledger has one row per address, and a student who used a free pass must still be able to claim a month.
-- 5. The free pass is not offered while the claim is open, and never to an account that has had Early Access or to an
--    address whose month a since-deleted account claimed.
-- Every time decision below reads the database clock inside the deciding transaction (clock_timestamp() after the
-- locks are held). No function here accepts a time, a duration or a date from a caller.
--
-- Lock order of claim_early_access(), a subset of the Early Access hierarchy (20261017100000) followed by the claim
-- locks in the order activate_discovery_pass() takes them:
--   1. policy row (share; launch activation and policy changes hold it for update and take nothing after it);
--   2. the account prefix of every course-access write (private.lock_course_access_scope): Auth row (share), the
--      per-account advisory lock, the profile row (share), the calendar lock (shared);
--   3. the claim-keys lock, then the lock of this address's claim hash;
--   4. grant and claim rows (inserts).
-- It never takes an import identity, regroup or group lock, and no path that holds a claim lock goes on to take the
-- policy row or an account lock.

-- ---------------------------------------------------------------------------
-- Policy: 10 days, and the last instant a claim is accepted.
-- ---------------------------------------------------------------------------
alter table private.entitlement_policy
  add column early_access_claim_cutoff timestamptz not null default '2026-12-01 00:00:00+01';
comment on column private.entitlement_policy.early_access_claim_cutoff is
  'A free month can be claimed only before this instant (the end of 30 November 2026, Africa/Lagos), whatever the launch date, so that every month ends within 2026. Owner decision, 16 November 2026.';
comment on column private.entitlement_policy.early_access_enrollment_days is
  'Days after the actual launch during which a student can claim their free month. 10 since 20261116120000 (owner decision, 16 November 2026). The claim also closes at early_access_claim_cutoff, whichever comes first.';
update private.entitlement_policy set early_access_enrollment_days = 10;
do $$
begin
  if (select count(*) from private.entitlement_policy) <> 1
      or (select count(*) from private.entitlement_policy where early_access_enrollment_days = 10
        and early_access_claim_cutoff = timestamptz '2026-12-01 00:00:00+01'
        -- A month started at the last accepted instant still ends within 2026 (Lagos calendar).
        and (early_access_claim_cutoff at time zone 'Africa/Lagos') + early_access_duration
          <= timestamp '2027-01-01 00:00:00') <> 1 then
    raise exception 'Early Access claim: expected the one policy row at 10 days, closing at the end of 30 November 2026 (Lagos), with every month ending within 2026';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The claim ledger. Same shape and meaning as private.discovery_pass_claims: only a keyed hash of the confirmed address,
-- never the address; the row outlives the account with its link cleared; it expires with discovery_claim_retention.
-- ---------------------------------------------------------------------------
create table private.early_access_claims (
  claim_hash text primary key check (claim_hash ~ '^[0-9a-f]{64}$'),
  key_version integer not null check (key_version between 1 and 1000),
  user_id uuid unique references auth.users (id) on delete set null,
  grant_id uuid,
  claimed_at timestamptz not null,
  expires_at timestamptz not null,
  constraint early_access_claims_expiry_check check (expires_at > claimed_at)
);
create index early_access_claims_expiry_idx on private.early_access_claims (expires_at);
alter table private.early_access_claims enable row level security;
revoke all on table private.early_access_claims from public, anon, authenticated, service_role;
comment on table private.early_access_claims is
  'One row per confirmed address that claimed its free month (Early Access): a keyed hash under ENTITLEMENT_CLAIM_HASH_KEYS, never the address. Kept after account deletion, for discovery_claim_retention.';

-- ---------------------------------------------------------------------------
-- Shared rules. Reads only: no lock, no write. Each takes the instant to decide at from its caller, which reads the
-- database clock; none is callable by an API role.
-- ---------------------------------------------------------------------------
-- Open from the actual launch until the earlier of N days after it and the cutoff. Never before a launch is recorded.
create function private.early_access_claim_open(p_at timestamptz) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.actual_launch_at <= p_at
    and p_at < least(p.actual_launch_at + make_interval(days => p.early_access_enrollment_days),
      p.early_access_claim_cutoff), false)
  from private.entitlement_policy p;
$$;

-- When the claim closes; null until a launch is recorded (least() would otherwise ignore the missing launch).
create function private.early_access_claim_closes_at() returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.actual_launch_at is not null then
    least(p.actual_launch_at + make_interval(days => p.early_access_enrollment_days), p.early_access_claim_cutoff) end
  from private.entitlement_policy p;
$$;

-- The end of a month that starts at p_start: one calendar month later on the Lagos calendar, whatever the session's
-- time zone. The claim and the page that offers it both use this, so the date a student is shown is the date they get.
create function private.early_access_month_end(p_start timestamptz) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select ((p_start at time zone 'Africa/Lagos') + p.early_access_duration) at time zone 'Africa/Lagos'
  from private.entitlement_policy p;
$$;

-- A paid plan that is not revoked and has not ended (a refunded plan is revoked, so it does not count; the second half
-- of a Session plan and a plan waiting for its semester both count).
create function private.has_current_paid_plan(p_user uuid, p_at timestamptz) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entitlement_grants g
    where g.user_id = p_user and g.source = 'paid' and g.revoked_at is null
      and coalesce(private.grant_effective_end(g), g.ends_at) > p_at);
$$;

-- Whether one of the presented hashes of this address already claimed a month (any key version the server holds).
create function private.early_access_claim_matches(p_hashes jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.early_access_claims c
    join jsonb_array_elements(p_hashes) h on c.claim_hash = h ->> 'hash' and c.key_version = (h ->> 'version')::integer
    where c.expires_at > clock_timestamp());
$$;

-- ---------------------------------------------------------------------------
-- Whether this student can claim now, for the pages that offer it. The same rules as the claim, read without a lock, a
-- write or key registration, and failing closed. ends_at is the end the month would have if it started at this read.
-- ---------------------------------------------------------------------------
create function public.early_access_claim_eligibility(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_session_id is null or not private.discovery_claim_hashes_valid(p_claim_hashes) then
    return jsonb_build_object('eligible', false);
  end if;
  -- A live session of a confirmed account that is not banned or scheduled for deletion; no row lock.
  v_user := private.course_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('eligible', false); end if;
  if not (private.early_access_claim_open(v_now)
      and not exists (select 1 from public.entitlement_grants where user_id = v_user and source = 'early_access')
      and not private.has_current_paid_plan(v_user, v_now)
      and private.discovery_email_allowed(v_user)
      and private.current_course_scope(v_user, v_now)->>'state' = 'ready'
      and private.discovery_claim_keys_sound(p_claim_hashes)
      and not private.early_access_claim_matches(p_claim_hashes)) then
    return jsonb_build_object('eligible', false);
  end if;
  return jsonb_build_object('eligible', true, 'ends_at', private.early_access_month_end(v_now));
end;
$$;

-- ---------------------------------------------------------------------------
-- The claim. Service role only; the student is the verified session, as for every other entitlement write. A replay (a
-- double tap, a second tab, a lost response) answers with the month already started, so it never costs anything.
-- ---------------------------------------------------------------------------
create function public.claim_early_access(p_session_id uuid, p_claim_hashes jsonb, p_expected_profile_revision bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_policy private.entitlement_policy;
  v_now timestamptz;
  v_existing public.entitlement_grants;
  v_grant public.entitlement_grants;
  v_key_state text;
  v_revision bigint;
begin
  if p_expected_profile_revision is null or not private.discovery_claim_hashes_valid(p_claim_hashes) then
    raise exception 'Invalid claim request' using errcode = '22023';
  end if;
  -- 1. A launch or a window change in flight commits first; then this reads what it committed.
  select * into strict v_policy from private.entitlement_policy for share;
  -- 2. The account prefix. Null for a session that has ended or an account that is unconfirmed, banned or scheduled for
  --    deletion.
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  -- 3. Claim keys, then this address.
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim-keys', 0));
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || (p_claim_hashes -> 0 ->> 'hash'), 0));
  -- Every lock is held: everything below is decided on the wall clock now, and nothing below waits.
  v_now := clock_timestamp();
  if private.course_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;

  select * into v_existing from public.entitlement_grants where user_id = v_user and source = 'early_access';
  if v_existing.id is not null then
    return jsonb_build_object('state', 'already-claimed', 'ends_at', v_existing.ends_at,
      'active', v_existing.revoked_at is null and v_existing.ends_at > v_now);
  end if;
  if not private.early_access_claim_open(v_now) then return jsonb_build_object('state', 'closed'); end if;
  -- Nothing is decided on a key configuration that cannot verify every unexpired claim: fail closed, audited.
  v_key_state := private.discovery_claim_keys_check(p_claim_hashes);
  if v_key_state is not null then return jsonb_build_object('state', v_key_state); end if;
  if private.has_current_paid_plan(v_user, v_now) or not private.discovery_email_allowed(v_user) then
    return jsonb_build_object('state', 'not-available');
  end if;
  if private.early_access_claim_matches(p_claim_hashes) then
    perform private.log_entitlement_event(v_user, null, 'early-access.claim-refused', 'student', '{}'::jsonb);
    return jsonb_build_object('state', 'not-available');
  end if;
  if private.current_course_scope(v_user, v_now)->>'state' <> 'ready' then
    return jsonb_build_object('state', 'needs-selection');
  end if;
  -- The courses the student saw. The profile row is share-locked until commit, so they are the courses this month sets.
  select revision into v_revision from public.profiles where id = v_user;
  if v_revision is distinct from p_expected_profile_revision then
    return jsonb_build_object('state', 'selection-changed');
  end if;

  -- Start and end both come from this transaction's clock: one calendar month from the claim.
  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, reference, created_by)
    values (v_user, 'early_access', v_now, private.early_access_month_end(v_now), 'uncapped',
      jsonb_build_object('claim', 'site', 'profile_revision', p_expected_profile_revision), 'student')
    returning * into v_grant;
  insert into private.early_access_claims (claim_hash, key_version, user_id, grant_id, claimed_at, expires_at)
    values (p_claim_hashes -> 0 ->> 'hash', (p_claim_hashes -> 0 ->> 'version')::integer, v_user, v_grant.id, v_now,
      v_now + v_policy.discovery_claim_retention);
  perform private.log_entitlement_event(v_user, v_grant.id, 'early-access.claimed', 'student',
    jsonb_build_object('starts_at', v_grant.starts_at, 'ends_at', v_grant.ends_at,
      'profile_revision', p_expected_profile_revision));
  return jsonb_build_object('state', 'claimed', 'starts_at', v_grant.starts_at, 'ends_at', v_grant.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- No automatic enrolment. The status is the account's own grant and nothing else, so every reader that used to enrol an
-- eligible list member (the plan read 20261104120000, the course read 20261101120000) now finds nobody to enrol and
-- keeps its text. 'not-listed' is kept as the name of "no grant": builds from before this migration parse it.
-- ---------------------------------------------------------------------------
create or replace function private.early_access_status(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.entitlement_grants;
begin
  select * into v_grant from public.entitlement_grants where user_id = p_user_id and source = 'early_access';
  if v_grant.id is null then return jsonb_build_object('status', 'not-listed'); end if;
  return jsonb_build_object('status', case when v_grant.revoked_at is not null or v_grant.ends_at <= now() then 'ended'
    else 'active' end, 'grant_id', v_grant.id, 'starts_at', v_grant.starts_at, 'ends_at', v_grant.ends_at);
end;
$$;

-- The old enrolment entry point issues nothing: it reports the status. It stays only because the two readers above still
-- name it in a branch they can no longer reach; a later clean-up removes both.
create or replace function private.reconcile_early_access(p_user_id uuid, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.early_access_status(p_user_id);
end;
$$;

-- Confirming an email no longer starts anything.
drop trigger early_access_reconcile_on_confirmation on auth.users;
drop function private.reconcile_early_access_on_confirmation();

-- The list's operator commands, sweeps and their helpers. private.early_access_members is left as it is, unread;
-- private.lock_early_access_accounts(uuid[]) and private.lock_early_access_groups() stay for admin_change_grant().
drop function public.admin_add_early_access_member(text, text, text, timestamptz, text, text, text);
drop function public.admin_change_early_access_member(text, text, text, text, text);
drop function public.admin_reconcile_early_access(text, text, integer);
drop function private.reconcile_all_early_access(text, integer);
drop function private.early_access_sweep_candidates();
drop function private.resolve_early_access_duplicates(uuid, text, text);
drop function private.lock_early_access_accounts(text);
comment on table private.early_access_members is
  'The retired pre-launch Early Access list (PRD 4.9). Nothing reads or writes it since 20261116120000: students claim their free month on the site.';

-- ---------------------------------------------------------------------------
-- The founder's one-time switch records the actual launch and opens the claim. It enrols nobody. Because it cannot be
-- undone, it refuses a claim window shorter than the configured days (a launch too close to the cutoff) unless told to
-- proceed, and always answers with the instant the claim closes.
-- ---------------------------------------------------------------------------
drop function public.admin_activate_public_launch(text, text, integer);
create function public.admin_activate_public_launch(p_actor text, p_reason text,
  p_allow_short_window boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
  v_now timestamptz;
  v_full timestamptz;
  v_closes timestamptz;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into strict v_policy from private.entitlement_policy for update;
  if v_policy.actual_launch_at is not null then
    return jsonb_build_object('state', 'already-launched', 'actual_launch_at', v_policy.actual_launch_at,
      'claim_closes_at', private.early_access_claim_closes_at());
  end if;
  -- The policy row is held: the launch time and the window are decided on the wall clock now.
  v_now := clock_timestamp();
  v_full := v_now + make_interval(days => v_policy.early_access_enrollment_days);
  v_closes := least(v_full, v_policy.early_access_claim_cutoff);
  if v_closes < v_full and not coalesce(p_allow_short_window, false) then
    return jsonb_build_object('state', 'short-claim-window', 'claim_would_close_at', v_closes,
      'claim_days', v_policy.early_access_enrollment_days,
      'full_window_needs_launch_by',
        v_policy.early_access_claim_cutoff - make_interval(days => v_policy.early_access_enrollment_days));
  end if;
  update private.entitlement_policy set actual_launch_at = v_now;
  perform private.log_entitlement_event(null, null, 'operator.public-launch', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'actual_launch_at', v_now, 'planned_launch_at', v_policy.planned_launch_at,
      'claim_closes_at', v_closes, 'short_window', v_closes < v_full));
  return jsonb_build_object('state', 'launched', 'actual_launch_at', v_now, 'claim_closes_at', v_closes,
    'claim_days', v_policy.early_access_enrollment_days, 'short_window', v_closes < v_full);
end;
$$;

-- The operator's view of the claim: the window and the months, counts only.
create or replace function public.admin_early_access_report() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'now', clock_timestamp(),
    'planned_launch_at', p.planned_launch_at,
    'actual_launch_at', p.actual_launch_at,
    'claim_days', p.early_access_enrollment_days,
    'claim_cutoff', p.early_access_claim_cutoff,
    'claim_closes_at', private.early_access_claim_closes_at(),
    'claim_open', private.early_access_claim_open(clock_timestamp()),
    -- What activate-launch would decide if it ran now; null once a launch is recorded.
    'if_launched_now', case when p.actual_launch_at is null then jsonb_build_object(
      'claim_would_close_at', least(clock_timestamp() + make_interval(days => p.early_access_enrollment_days),
        p.early_access_claim_cutoff),
      'full_window', clock_timestamp() + make_interval(days => p.early_access_enrollment_days)
        <= p.early_access_claim_cutoff) end,
    'months', (select jsonb_build_object('claimed', count(*),
        'running', count(*) filter (where g.revoked_at is null and g.ends_at > clock_timestamp()),
        'ended', count(*) filter (where g.revoked_at is null and g.ends_at <= clock_timestamp()),
        'revoked', count(*) filter (where g.revoked_at is not null))
      from public.entitlement_grants g where g.source = 'early_access'),
    'address_records', (select count(*) from private.early_access_claims where expires_at > clock_timestamp()),
    'retired_list_rows', (select count(*) from private.early_access_members))
  from private.entitlement_policy p;
$$;

-- ---------------------------------------------------------------------------
-- The free pass. Not offered while the claim is open, and never to an account that has had Early Access (one grant per
-- account, in any state). The plan read, the eligibility read and activation all ask this one function
-- (20261104120000, 20261103100000), so none of them changes. The retired list no longer bars anyone.
-- ---------------------------------------------------------------------------
create or replace function private.discovery_early_access_bars(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entitlement_grants where user_id = p_user_id and source = 'early_access')
    or private.early_access_claim_open(clock_timestamp());
$$;

-- A used month blocks a later free pass for the same address on a new account, as a used pass does. Activation asks
-- this under the same claim-hash lock claim_early_access() takes, so a claim and an activation for one address
-- cannot both succeed.
create or replace function private.discovery_claim_matches(p_user uuid, p_hashes jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(select 1 from private.discovery_pass_claims c where c.expires_at>clock_timestamp() and (
    exists(select 1 from jsonb_array_elements(p_hashes) h where c.claim_hash=h->>'hash'
      and c.key_version=(h->>'version')::integer)
    or exists(select 1 from auth.users old_user join auth.users cu on cu.id=p_user
      where old_user.id=c.user_id and private.canonical_claim_email(old_user.email)=
        private.canonical_claim_email(cu.email))))
    or private.early_access_claim_matches(p_hashes);
$$;

-- ---------------------------------------------------------------------------
-- The key checks, the key report and the purge count both ledgers: a key version an unexpired month claim was written
-- under is still needed, and an expired month claim is removed with the expired pass claims.
-- ---------------------------------------------------------------------------
create or replace function private.discovery_claim_keys_check(p_hashes jsonb) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versions integer[];
begin
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim-keys', 0));
  -- (b) A registered version presented with another check value: the secret under it was replaced.
  select array_agg(k.key_version order by k.key_version) into v_versions
    from private.discovery_claim_keys k
    join jsonb_array_elements(p_hashes) h on k.key_version = (h ->> 'version')::integer
    where k.key_check <> h ->> 'check';
  if v_versions is not null then
    perform private.log_entitlement_event(null, null, 'discovery.claim-key-rejected', 'system:claim-keys',
      jsonb_build_object('reason', 'replaced', 'versions', to_jsonb(v_versions)));
    return 'claim-key-replaced';
  end if;
  -- (a) A version unexpired claims were written under that the configuration no longer carries.
  select array_agg(distinct c.key_version order by c.key_version) into v_versions
    from (select key_version, expires_at from private.discovery_pass_claims
      union all select key_version, expires_at from private.early_access_claims) c
    where c.expires_at > now()
      and not exists (select 1 from jsonb_array_elements(p_hashes) h where (h ->> 'version')::integer = c.key_version);
  if v_versions is not null then
    perform private.log_entitlement_event(null, null, 'discovery.claim-key-rejected', 'system:claim-keys',
      jsonb_build_object('reason', 'missing', 'versions', to_jsonb(v_versions)));
    return 'claim-key-missing';
  end if;
  insert into private.discovery_claim_keys (key_version, key_check)
    select distinct (h ->> 'version')::integer, h ->> 'check' from jsonb_array_elements(p_hashes) h
    on conflict (key_version) do update set last_seen_at = now();
  return null;
end;
$$;

create or replace function private.discovery_claim_keys_sound(p_hashes jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from private.discovery_claim_keys k
      join jsonb_array_elements(p_hashes) h on k.key_version = (h ->> 'version')::integer
      where k.key_check <> h ->> 'check')
    and not exists (select 1 from (select key_version, expires_at from private.discovery_pass_claims
        union all select key_version, expires_at from private.early_access_claims) c
      where c.expires_at > now()
        and not exists (select 1 from jsonb_array_elements(p_hashes) h where (h ->> 'version')::integer = c.key_version));
$$;

create or replace function public.admin_discovery_claim_keys() returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'live', coalesce((select jsonb_agg(jsonb_build_object('key_version', key_version, 'claims', claims,
        'last_expires_at', last_expires_at) order by key_version)
      from (select key_version, count(*) as claims, max(expires_at) as last_expires_at
        from (select key_version, expires_at from private.discovery_pass_claims
          union all select key_version, expires_at from private.early_access_claims) c
        where expires_at > now() group by key_version) versions), '[]'::jsonb),
    'registered', coalesce((select jsonb_agg(jsonb_build_object('key_version', key_version, 'first_seen_at', first_seen_at,
        'last_seen_at', last_seen_at) order by key_version) from private.discovery_claim_keys), '[]'::jsonb));
$$;

create or replace function public.purge_discovery_pass_claims() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_passes integer;
  v_months integer;
begin
  delete from private.discovery_pass_claims where expires_at <= now();
  get diagnostics v_passes = row_count;
  delete from private.early_access_claims where expires_at <= now();
  get diagnostics v_months = row_count;
  return v_passes + v_months;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Students call nothing here: the claim and its eligibility read are service-role functions given the
-- verified session id. CREATE OR REPLACE keeps the privileges of the functions it replaces.
-- ---------------------------------------------------------------------------
revoke all on function private.early_access_claim_open(timestamptz), private.early_access_claim_closes_at(),
  private.early_access_month_end(timestamptz), private.has_current_paid_plan(uuid, timestamptz),
  private.early_access_claim_matches(jsonb),
  public.early_access_claim_eligibility(uuid, jsonb), public.claim_early_access(uuid, jsonb, bigint),
  public.admin_activate_public_launch(text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.early_access_claim_eligibility(uuid, jsonb),
  public.claim_early_access(uuid, jsonb, bigint), public.admin_activate_public_launch(text, text, boolean)
  to service_role;
