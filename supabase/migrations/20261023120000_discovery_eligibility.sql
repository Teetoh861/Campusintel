-- Discovery Pass eligibility and five-year claim retention (owner decisions, 23 October 2026).
-- 1. A used email claim blocks the same address for five years from activation, also after the account is deleted.
--    Expired claims are purged daily by pg_cron; the operator command (ops.cjs purge-claims) stays.
-- 2. No Discovery Pass for an account that has ever had, or is listed for, Early Access: any early_access grant
--    (active, ended or revoked), or an Early Access list row for the account's confirmed, normalised email that is not
--    excluded, claimed or not, before or after launch (owner decision, 23 Oct), and any claimed row (which covers an
--    account deleted and registered again). trial_after_early_access is retired: it is set to false and no longer read.
-- 3. Pages decide before render whether to offer a pass at all, through discovery_pass_eligibility(), a read-only
--    service-role function that applies the same rules as activation (and fails closed on the same key faults) without
--    taking a lock or registering a key. Activation stays authoritative and its lock order is unchanged: the new checks
--    are reads inside the locks it already holds.
-- activate_discovery_pass() and get_my_entitlement() are copied from 20261021100000_discovery_pass.sql and changed only
-- where decision 2 requires. Their signatures, privileges and response shapes are kept, including retention_months and
-- the early-access-active state, so instances built before this migration keep parsing them during a rollout.

-- ---------------------------------------------------------------------------
-- Retention: five years from activation (approved; replaces the proposed 24 months).
-- ---------------------------------------------------------------------------
alter table private.entitlement_policy alter column discovery_claim_retention set default interval '5 years';
update private.entitlement_policy set discovery_claim_retention = interval '5 years', trial_after_early_access = false;
-- Live claims are re-dated from their own activation. An expired claim is not revived: it already blocks nothing and
-- the purge removes it.
update private.discovery_pass_claims set expires_at = claimed_at + interval '5 years' where expires_at > now();
comment on column private.entitlement_policy.discovery_claim_retention is
  'How long a used Discovery Pass email claim blocks the same address, counted from activation. Approved by the owner on 23 October 2026: 5 years.';
comment on column private.entitlement_policy.trial_after_early_access is
  'Retired on 23 October 2026 and kept false: no account that has ever had Early Access gets a Discovery Pass, whatever this says. Kept for the 20261017100000 functions that still name it.';

-- Expired claims go once a day, independently of traffic and of the operator.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('campusintell-discovery-claim-purge', '17 3 * * *', 'select public.purge_discovery_pass_claims()');

-- ---------------------------------------------------------------------------
-- Shared rules. Reads only: no lock, no write.
-- ---------------------------------------------------------------------------
-- Whether Early Access bars this account from a pass: an early_access grant in any state (one per account; a revoked or
-- ended one still counts), or a list row for its confirmed email, normalised as early_access_status() does, that is
-- not excluded (claimed or not, joined before or after launch), or that was claimed (so an address whose month a
-- since-deleted account claimed is recognised on a new account, even if the row was excluded later). An excluded,
-- unclaimed row does not bar the pass.
create function private.discovery_early_access_bars(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entitlement_grants where user_id = p_user_id and source = 'early_access')
    or exists (select 1 from auth.users u
      join private.early_access_members m on m.email = lower(btrim(u.email))
      where u.id = p_user_id and u.email_confirmed_at is not null
        and (m.excluded_at is null or m.claimed_at is not null));
$$;

-- discovery_claim_keys_check() without its lock, its audit rows or its registration: true when every version presented
-- matches the secret the ledger registered for it and every version an unexpired claim needs is presented.
create function private.discovery_claim_keys_sound(p_hashes jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from private.discovery_claim_keys k
      join jsonb_array_elements(p_hashes) h on k.key_version = (h ->> 'version')::integer
      where k.key_check <> h ->> 'check')
    and not exists (select 1 from private.discovery_pass_claims c
      where c.expires_at > now()
        and not exists (select 1 from jsonb_array_elements(p_hashes) h where (h ->> 'version')::integer = c.key_version));
$$;

-- ---------------------------------------------------------------------------
-- Activation. As in 20261021100000, except that any Early Access ever, or a list place (decision 2), refuses with
-- trial-not-offered;
-- an Early Access month still running keeps its early-access-active answer.
-- Lock order (unchanged): account row share lock (inside ai_practice_session_user), the per-account advisory lock, the
-- claim-keys lock, the per-claim lock, then the global day lock. No Early Access path takes the last three, and this
-- path takes no group lock.
-- ---------------------------------------------------------------------------
create or replace function public.activate_discovery_pass(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_claim_hash text;
  v_key_version integer;
  v_existing public.entitlement_grants;
  v_early public.entitlement_grants;
  v_grant public.entitlement_grants;
  v_today integer;
  v_key_state text;
begin
  if not private.discovery_claim_hashes_valid(p_claim_hashes) then
    raise exception 'Invalid activation request' using errcode = '22023';
  end if;
  -- Only a live, confirmed account that is not scheduled for deletion.
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.entitlement_policy;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));
  -- Nothing is decided on a key configuration that cannot verify every unexpired claim: fail closed, audited.
  v_key_state := private.discovery_claim_keys_check(p_claim_hashes);
  if v_key_state is not null then return jsonb_build_object('state', v_key_state); end if;

  select * into v_existing from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  if v_existing.id is not null then
    return jsonb_build_object('state', 'already-activated', 'ends_at', v_existing.ends_at);
  end if;
  -- No pass while Early Access is active, so neither is spent during the free month. Not ended is enough: an
  -- enrollment that won the account lock may carry a start a moment after this transaction's now().
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  if v_early.id is not null and v_early.ends_at > now() then
    return jsonb_build_object('state', 'early-access-active', 'available_from', v_early.ends_at);
  end if;
  -- Nor afterwards, nor for a listed address: any Early Access ever on this account, or a list place for this confirmed
  -- email that is not excluded (owner decisions, 23 Oct 2026). Enrollment, imports and member changes take the account
  -- lock held here, so the answer cannot change before this transaction commits.
  if private.discovery_early_access_bars(v_user_id) then
    return jsonb_build_object('state', 'trial-not-offered');
  end if;

  -- The confirmed address claims at most one pass per retention period, even across deleted accounts. Expired claims
  -- no longer count (they are purged by purge_discovery_pass_claims()).
  v_claim_hash := p_claim_hashes -> 0 ->> 'hash';
  v_key_version := (p_claim_hashes -> 0 ->> 'version')::integer;
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || v_claim_hash, 0));
  if exists (select 1 from private.discovery_pass_claims c
      join jsonb_array_elements(p_claim_hashes) h on c.claim_hash = h ->> 'hash'
        and c.key_version = (h ->> 'version')::integer
      where c.expires_at > now()) then
    perform private.log_entitlement_event(v_user_id, null, 'discovery.claim-refused', 'student', '{}'::jsonb);
    return jsonb_build_object('state', 'already-claimed',
      'retention_months', round(extract(epoch from v_policy.discovery_claim_retention) / 2629800)::integer);
  end if;

  if v_policy.discovery_activations_per_day is not null then
    perform pg_advisory_xact_lock(hashtextextended('discovery-activation-global-day', 0));
    select count(*) into v_today from public.entitlement_grants
      where source = 'trial' and trial_policy = 'discovery'
        and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if v_today >= v_policy.discovery_activations_per_day then
      return jsonb_build_object('state', 'capacity');
    end if;
  end if;

  -- Start and end both come from this transaction's clock: exactly discovery_hours from activation. The AI allowance
  -- is fixed here; later policy edits never change a running pass.
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units,
      created_by)
    values (v_user_id, 'trial', 'discovery', now(), now() + make_interval(hours => v_policy.discovery_hours), 'capped',
      v_policy.discovery_ai_generations, 'student')
    returning * into v_grant;
  -- An expired claim of the same address (not yet purged) is replaced by the new one.
  insert into private.discovery_pass_claims (claim_hash, key_version, user_id, grant_id, expires_at)
    values (v_claim_hash, v_key_version, v_user_id, v_grant.id, now() + v_policy.discovery_claim_retention)
    on conflict (claim_hash) do update set key_version = excluded.key_version, user_id = excluded.user_id,
      grant_id = excluded.grant_id, claimed_at = now(), expires_at = excluded.expires_at;
  perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.activated', 'student',
    jsonb_build_object('ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units, 'policy', 'discovery'));
  return jsonb_build_object('state', 'activated', 'ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units);
end;
$$;

-- ---------------------------------------------------------------------------
-- Eligibility before render. Service role only, given the verified session id and the keyed hashes of its confirmed
-- address, exactly as activation is. Answers only {eligible}: never why not, so no page can explain a refusal. False
-- for a session that is not live and confirmed, an account with a trial grant, any Early Access ever or a list place
-- that is not excluded, a configuration
-- activation would refuse (claim-key-missing or claim-key-replaced), or an unexpired claim of the address. The daily
-- guard is not consulted: it is a momentary refusal, not a property of the student. STABLE, so it cannot write.
-- ---------------------------------------------------------------------------
create function public.discovery_pass_eligibility(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_session_id is null or not private.discovery_claim_hashes_valid(p_claim_hashes) then
    return jsonb_build_object('eligible', false);
  end if;
  -- The conditions of ai_practice_session_user(), without its account row lock: a page read never waits on Auth.
  select s.user_id into v_user_id from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session_id and (s.not_after is null or s.not_after > v_now) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= v_now)
      and not exists (select 1 from private.account_deletion_jobs j where j.user_id = s.user_id);
  if v_user_id is null then return jsonb_build_object('eligible', false); end if;
  return jsonb_build_object('eligible',
    not exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'trial')
    and not private.discovery_early_access_bars(v_user_id)
    and private.discovery_claim_keys_sound(p_claim_hashes)
    and not exists (select 1 from private.discovery_pass_claims c
      join jsonb_array_elements(p_claim_hashes) h on c.claim_hash = h ->> 'hash'
        and c.key_version = (h ->> 'version')::integer
      where c.expires_at > now()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Student summary. As in 20261021100000, except that the trial is not offered to an account Early Access bars
-- (decision 2: any Early Access ever, or a list place that is not excluded); after-early-access is no longer answered.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_entitlement() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_policy private.entitlement_policy;
  v_access public.entitlement_grants;
  v_trial public.entitlement_grants;
  v_early_grant public.entitlement_grants;
  v_early jsonb;
  v_trial_status text;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_early := private.early_access_status(v_user_id);
  if v_early->>'status' = 'eligible' then
    perform private.reconcile_early_access(v_user_id, 'system:plan-read');
    v_early := private.early_access_status(v_user_id);
  end if;
  select * into strict v_policy from private.entitlement_policy;
  -- The same grants private.has_full_access() counts: a seven-day trial is full access, a Discovery Pass is not.
  select * into v_access from public.entitlement_grants
    where user_id = v_user_id and (source <> 'trial' or trial_policy = 'seven-day') and revoked_at is null
      and starts_at <= now() and ends_at > now()
    order by ends_at desc limit 1;
  select * into v_trial from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  select * into v_early_grant from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;

  v_trial_status := case
    when v_trial.id is not null then
      case when v_trial.revoked_at is null and v_trial.starts_at <= now() and v_trial.ends_at > now()
        then 'active' else 'ended' end
    when private.discovery_early_access_bars(v_user_id) then 'not-offered'
    else 'available' end;

  return jsonb_build_object(
    'now', now(),
    'planned_launch_at', v_policy.planned_launch_at,
    'actual_launch_at', v_policy.actual_launch_at,
    'trial_hours', v_policy.discovery_hours,
    'trial_days', ceil(v_policy.discovery_hours / 24.0)::integer,
    'expiry_notice_hours', v_policy.expiry_notice_hours,
    'tier', case when v_access.id is null then 'free' else 'full' end,
    'access', case when v_access.id is null then null
      else jsonb_build_object('source', v_access.source, 'ends_at', v_access.ends_at) end,
    'trial', jsonb_build_object('status', v_trial_status, 'policy', v_trial.trial_policy,
      'starts_at', v_trial.starts_at, 'ends_at', v_trial.ends_at,
      'available_from', case when v_trial_status = 'after-early-access' then v_early_grant.ends_at end),
    'discovery', jsonb_build_object(
      'cbt_questions', v_policy.discovery_cbt_questions,
      'ai_sets', coalesce(case when v_trial.trial_policy = 'discovery' then v_trial.ai_units end,
        v_policy.discovery_ai_generations),
      'previews', coalesce((select jsonb_agg(jsonb_build_object('kind', p.kind, 'content_key', c.content_key,
          'submitted', p.submitted_at is not null) order by p.kind)
        from private.discovery_previews p join public.courses c on c.id = p.course_id
        where p.grant_id = v_trial.id), '[]'::jsonb)),
    'early_access', jsonb_build_object(
      'status', case when v_early->>'status' = 'eligible' then 'pending' else v_early->>'status' end,
      'starts_at', v_early->'starts_at', 'ends_at', v_early->'ends_at',
      'enrollment_closes_at', case when v_policy.actual_launch_at is null then null
        else v_policy.actual_launch_at + make_interval(days => v_policy.early_access_enrollment_days) end),
    -- Rollout compatibility only: builds from before this migration require the key. There is no code any more.
    'otp', null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. create or replace keeps those of activate_discovery_pass() and get_my_entitlement().
-- ---------------------------------------------------------------------------
revoke all on function private.discovery_early_access_bars(uuid), private.discovery_claim_keys_sound(jsonb),
  public.discovery_pass_eligibility(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.discovery_pass_eligibility(uuid, jsonb) to service_role;
