-- supabase/migrations/20261117120000_free_month_review_fixes.sql — Review findings on the free month claim
-- (20261116120000_early_access_claim.sql).
-- 1. The claim window cannot reopen. The instant the claim closes is recorded when the actual launch is, and every
--    reader takes that stored instant. Changing the claim days or the cutoff afterwards moves nothing, and the operator's
--    configure command refuses a change to the claim days once the launch is recorded.
-- 2. The launch keeps its old signature. admin_activate_public_launch(text, text, integer), as callers built before the
--    claim know it, is back with its old privileges: it ignores the old batch limit (there is nobody to enrol) and never
--    allows a short window. The boolean form has no default any more, so a two-argument call can only mean the old one.

-- ---------------------------------------------------------------------------
-- 1. The closing instant, stored once with the launch.
-- ---------------------------------------------------------------------------
alter table private.entitlement_policy add column early_access_claim_closes_at timestamptz;
comment on column private.entitlement_policy.early_access_claim_closes_at is
  'When the free month claim closes: the earlier of the actual launch plus early_access_enrollment_days and early_access_claim_cutoff, fixed when the actual launch is recorded (20261117120000). Changing the days or the cutoff afterwards does not move it.';
-- A database that already recorded its launch keeps the window it was given.
update private.entitlement_policy
  set early_access_claim_closes_at = least(actual_launch_at + make_interval(days => early_access_enrollment_days),
    early_access_claim_cutoff)
  where actual_launch_at is not null;

-- The stored instant follows the launch instant and nothing else: it is set when a launch is recorded (or, by an
-- operator with direct SQL, replaced), and cleared with it. A change to the days or the cutoff alone leaves it as it was.
create function private.early_access_fix_claim_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.actual_launch_at is null then
    new.early_access_claim_closes_at := null;
  elsif old.actual_launch_at is distinct from new.actual_launch_at then
    new.early_access_claim_closes_at := least(new.actual_launch_at + make_interval(days => new.early_access_enrollment_days),
      new.early_access_claim_cutoff);
  else
    new.early_access_claim_closes_at := old.early_access_claim_closes_at;
  end if;
  return new;
end;
$$;
revoke all on function private.early_access_fix_claim_close() from public, anon, authenticated, service_role;
create trigger entitlement_policy_fix_claim_close before update on private.entitlement_policy
  for each row execute function private.early_access_fix_claim_close();

-- Open from the actual launch until the stored closing instant. Never before a launch is recorded.
create or replace function private.early_access_claim_open(p_at timestamptz) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.actual_launch_at <= p_at and p_at < p.early_access_claim_closes_at, false)
  from private.entitlement_policy p;
$$;

-- The stored closing instant; null until a launch is recorded.
create or replace function private.early_access_claim_closes_at() returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select p.early_access_claim_closes_at from private.entitlement_policy p;
$$;

-- The eligibility read also says when the claim closes, so an open page can let the offer go at that instant.
create or replace function public.early_access_claim_eligibility(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
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
  return jsonb_build_object('eligible', true, 'ends_at', private.early_access_month_end(v_now),
    'closes_at', private.early_access_claim_closes_at());
end;
$$;

-- The operator's policy command: once the launch is recorded, the claim days are fixed. A call that would change them
-- is refused whole, and nothing is changed or audited. (The cutoff has no command; the stored instant ignores it anyway.)
create or replace function public.admin_configure_early_access(p_planned_launch_at timestamptz, p_enrollment_days integer,
  p_trial_after_early_access boolean, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into strict v_policy from private.entitlement_policy for update;
  if v_policy.actual_launch_at is not null and p_enrollment_days is not null
      and p_enrollment_days is distinct from v_policy.early_access_enrollment_days then
    return jsonb_build_object('state', 'claim-window-fixed', 'actual_launch_at', v_policy.actual_launch_at,
      'claim_closes_at', v_policy.early_access_claim_closes_at);
  end if;
  -- The actual launch is never set here: only admin_activate_public_launch() records it, once.
  update private.entitlement_policy set planned_launch_at = coalesce(p_planned_launch_at, planned_launch_at),
    early_access_enrollment_days = coalesce(p_enrollment_days, early_access_enrollment_days),
    trial_after_early_access = coalesce(p_trial_after_early_access, trial_after_early_access);
  perform private.log_entitlement_event(null, null, 'operator.early-access-policy', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'planned_launch_at', p_planned_launch_at,
      'enrollment_days', p_enrollment_days, 'trial_after_early_access', p_trial_after_early_access,
      'previous_enrollment_days', v_policy.early_access_enrollment_days,
      'previous_trial_after_early_access', v_policy.trial_after_early_access));
  return jsonb_build_object('state', 'changed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The launch: the boolean form takes its third argument explicitly, and records the closing instant.
-- ---------------------------------------------------------------------------
drop function public.admin_activate_public_launch(text, text, boolean);
create function public.admin_activate_public_launch(p_actor text, p_reason text, p_allow_short_window boolean)
returns jsonb
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
      'claim_closes_at', v_policy.early_access_claim_closes_at);
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
  -- The closing instant is recorded with the launch, once; nothing later moves it.
  update private.entitlement_policy set actual_launch_at = v_now, early_access_claim_closes_at = v_closes;
  perform private.log_entitlement_event(null, null, 'operator.public-launch', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'actual_launch_at', v_now, 'planned_launch_at', v_policy.planned_launch_at,
      'claim_closes_at', v_closes, 'short_window', v_closes < v_full));
  return jsonb_build_object('state', 'launched', 'actual_launch_at', v_now, 'claim_closes_at', v_closes,
    'claim_days', v_policy.early_access_enrollment_days, 'short_window', v_closes < v_full);
end;
$$;

-- The signature callers built before the claim know. The batch limit enrolled the old list and means nothing now; a
-- short window is never allowed this way.
create function public.admin_activate_public_launch(p_actor text, p_reason text, p_limit integer default 200)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_activate_public_launch(p_actor, p_reason, false);
$$;

revoke all on function public.admin_activate_public_launch(text, text, boolean),
  public.admin_activate_public_launch(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_activate_public_launch(text, text, boolean),
  public.admin_activate_public_launch(text, text, integer) to service_role;
