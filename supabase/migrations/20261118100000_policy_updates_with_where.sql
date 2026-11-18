-- Policy writes through the API must satisfy pg-safeupdate, just as other operator settings do.
-- The policy has one row, keyed by singleton = true. Name it in both UPDATEs; every other part of the functions is
-- unchanged from 20261116130000_free_month_review_fixes.sql. That migration is already applied and is not edited.
-- CREATE OR REPLACE preserves signatures, ownership and execute grants. The old integer launch wrapper is unchanged.

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
    trial_after_early_access = coalesce(p_trial_after_early_access, trial_after_early_access)
    where singleton = true;
  perform private.log_entitlement_event(null, null, 'operator.early-access-policy', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'planned_launch_at', p_planned_launch_at,
      'enrollment_days', p_enrollment_days, 'trial_after_early_access', p_trial_after_early_access,
      'previous_enrollment_days', v_policy.early_access_enrollment_days,
      'previous_trial_after_early_access', v_policy.trial_after_early_access));
  return jsonb_build_object('state', 'changed');
end;
$$;

create or replace function public.admin_activate_public_launch(p_actor text, p_reason text, p_allow_short_window boolean)
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
  update private.entitlement_policy set actual_launch_at = v_now, early_access_claim_closes_at = v_closes
    where singleton = true;
  perform private.log_entitlement_event(null, null, 'operator.public-launch', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'actual_launch_at', v_now, 'planned_launch_at', v_policy.planned_launch_at,
      'claim_closes_at', v_closes, 'short_window', v_closes < v_full));
  return jsonb_build_object('state', 'launched', 'actual_launch_at', v_now, 'claim_closes_at', v_closes,
    'claim_days', v_policy.early_access_enrollment_days, 'short_window', v_closes < v_full);
end;
$$;
