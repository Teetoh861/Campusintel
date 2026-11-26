-- supabase/migrations/20261126100000_free_until_30_december.sql — The free month becomes free access until the end of
-- 30 December 2026, Africa/Lagos (owner decision, 25 November 2026). Students see it as "Free until 30 December".
-- 1. Free access is claimed from the actual launch until the end of 30 December (2026-12-31 00:00:00+01), and every
--    claim ends at that instant, so an earlier claim gets more days. It still starts at the claim.
-- 2. The 10-day claim window and the end-of-30-November cutoff go. early_access_claim_cutoff is now the one end: the
--    claim closes there and every grant ends there. early_access_enrollment_days and early_access_duration stay as
--    retired columns: no claim, launch, report or plan-read rule reads them.
-- 3. The close stored when the launch is recorded (20261116130000) now follows the cutoff. On a database whose launch is
--    already recorded this moves the stored close to the end of 30 December, and reopens a claim whose old window had
--    passed (owner decision D5). No command can move it afterwards: configure never touches the cutoff and the days are
--    unread; only a migration or direct SQL on the cutoff can.
-- 4. Everything else stays: one claim per account and per confirmed address, Standard Campus Bot limits, the free pass
--    hidden while the claim is open, the claim's lock order. claim_early_access, early_access_claim_eligibility,
--    early_access_claim_open and discovery_early_access_bars are unchanged: they read the stored close and
--    early_access_month_end.
-- Grants claimed under the old rule keep their one-calendar-month ends (owner decision D2). Nothing here writes a grant.
-- Superseded: the 10 days and the 30 November cutoff (20261116120000:30-50), one calendar month from the claim
-- (20261116120000:100-110, :232), and "the closing instant is recorded with the launch, once; nothing later moves it"
-- (20261116130000:1-42, 20261118100000:64).

-- ---------------------------------------------------------------------------
-- The stored close follows the cutoff. This must come before the cutoff changes below: the old body kept the old close
-- whenever actual_launch_at did not change, so the update would have left a launched database closed.
-- ---------------------------------------------------------------------------
create or replace function private.early_access_fix_claim_close() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Once a launch is recorded the claim closes, and every claim ends, at the policy end; before it there is no close.
  new.early_access_claim_closes_at := case when new.actual_launch_at is not null then new.early_access_claim_cutoff end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Every claim ends at the stored close, whenever it was made. The name is historical: claim_early_access (the grant end)
-- and early_access_claim_eligibility (the end a page offers) call it, and neither changes. Reading the stored close, the
-- value the claim gate compares with, keeps ends_at > starts_at for every claim the gate lets through.
-- ---------------------------------------------------------------------------
create or replace function private.early_access_month_end(p_start timestamptz) returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select p.early_access_claim_closes_at from private.entitlement_policy p;
$$;
comment on function private.early_access_month_end(timestamptz) is
  'The end of free access claimed at p_start: since 20261126100000 the stored claim close (the end of 30 December 2026, Lagos) for every claim, whatever p_start; null before a launch is recorded. The name is historical: claim_early_access and early_access_claim_eligibility call it.';

-- ---------------------------------------------------------------------------
-- The launch: the claim closes at the policy end, whatever the launch time. A launch at or after the end would open
-- nothing, so it is refused unless the operator asks for it (the operator tool never does). Same signature, parameter
-- names and attributes as 20261118100000; the integer wrapper (20261116130000) reaches this body.
-- ---------------------------------------------------------------------------
create or replace function public.admin_activate_public_launch(p_actor text, p_reason text, p_allow_short_window boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
  v_now timestamptz;
  v_closes timestamptz;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into strict v_policy from private.entitlement_policy for update;
  if v_policy.actual_launch_at is not null then
    return jsonb_build_object('state', 'already-launched', 'actual_launch_at', v_policy.actual_launch_at,
      'claim_closes_at', v_policy.early_access_claim_closes_at);
  end if;
  -- The policy row is held: the launch time is decided on the wall clock now.
  v_now := clock_timestamp();
  -- Free access is claimed from now until the policy end, when every claim ends.
  v_closes := v_policy.early_access_claim_cutoff;
  if v_closes <= v_now and not coalesce(p_allow_short_window, false) then
    return jsonb_build_object('state', 'short-claim-window', 'claim_would_close_at', v_closes);
  end if;
  -- Recorded once; the trigger stores the same close (the cutoff). API callers run under pg-safeupdate: keep the WHERE.
  update private.entitlement_policy set actual_launch_at = v_now, early_access_claim_closes_at = v_closes
    where singleton = true;
  perform private.log_entitlement_event(null, null, 'operator.public-launch', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'actual_launch_at', v_now, 'planned_launch_at', v_policy.planned_launch_at,
      'claim_closes_at', v_closes, 'short_window', v_closes <= v_now));
  return jsonb_build_object('state', 'launched', 'actual_launch_at', v_now, 'claim_closes_at', v_closes,
    'short_window', v_closes <= v_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- The operator's view of the claim: the end, the window and the claims, counts only. claim_days is gone (no rule reads
-- the days any more); if_launched_now says when the claim would close and whether it would open at all.
-- ---------------------------------------------------------------------------
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
    'claim_cutoff', p.early_access_claim_cutoff,
    'claim_closes_at', private.early_access_claim_closes_at(),
    'claim_open', private.early_access_claim_open(clock_timestamp()),
    -- What activate-launch would decide if it ran now; null once a launch is recorded.
    'if_launched_now', case when p.actual_launch_at is null then jsonb_build_object(
      'claim_would_close_at', p.early_access_claim_cutoff,
      'claim_would_open', clock_timestamp() < p.early_access_claim_cutoff) end,
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
-- The plan read: early_access.enrollment_closes_at is the stored close, the instant the claim closes, so the pages ask
-- about free access until then and not for 10 days after the launch. Same key and type, so builds from before this
-- migration parse it.
-- Copied byte for byte from 20261125200000_owner_tester_access.sql, the newest definition on develop; only
-- enrollment_closes_at differs.
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
  v_access_ends timestamptz;
  v_sales_open boolean;
  v_term record;
  v_trial public.entitlement_grants;
  v_early_grant public.entitlement_grants;
  v_early jsonb;
  v_trial_status text;
  v_tester_ends timestamptz;
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
  -- Part 3: a paid plan's grant counts within its effective end (its semester), never in the stored slack.
  select g.* into v_access from public.entitlement_grants g
    where g.user_id = v_user_id and (g.source <> 'trial' or g.trial_policy = 'seven-day') and g.revoked_at is null
      and g.starts_at <= clock_timestamp() and g.ends_at > clock_timestamp()
      and (g.order_id is null or private.grant_effective_end(g) > clock_timestamp())
    order by coalesce(private.grant_effective_end(g), g.ends_at) desc limit 1;
  v_access_ends := case when v_access.order_id is not null then private.grant_effective_end(v_access) else v_access.ends_at end;
  -- Owner tester access (20261125200000): full access until it ends, and no plans on offer.
  v_tester_ends := private.tester_access_ends(v_user_id, clock_timestamp());
  select sales_open into v_sales_open from private.payment_policy;
  -- The semester the student is in now, by their department's calendar (whether or not their courses are confirmed).
  select at.session_label, ap.key as period_key, ap.display_name as period_name, t.ends_at into v_term
    from public.profiles p cross join lateral private.access_term_at(p.department_id, clock_timestamp()) t
    join private.academic_terms at on at.id = t.term_id join public.academic_periods ap on ap.id = t.academic_period_id
    where p.id = v_user_id and p.department_id is not null;
  select * into v_trial from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  select * into v_early_grant from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;

  v_trial_status := case
    when v_trial.id is not null then
      case when v_trial.revoked_at is null and v_trial.starts_at <= clock_timestamp() and v_trial.ends_at > clock_timestamp()
        then 'active' else 'ended' end
    when private.discovery_early_access_bars(v_user_id) then 'not-offered'
    else 'available' end;

  return jsonb_build_object(
    'now', clock_timestamp(),
    'planned_launch_at', v_policy.planned_launch_at,
    'actual_launch_at', v_policy.actual_launch_at,
    'trial_hours', v_policy.discovery_hours,
    'trial_days', ceil(v_policy.discovery_hours / 24.0)::integer,
    'expiry_notice_hours', v_policy.expiry_notice_hours,
    'tier', case when v_access.id is null and v_tester_ends is null then 'free' else 'full' end,
    'access', case when v_tester_ends is not null then jsonb_build_object('source', 'tester', 'ends_at', v_tester_ends)
      when v_access.id is null then null
      else jsonb_build_object('source', v_access.source, 'ends_at', v_access_ends) end,
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
      'enrollment_closes_at', v_policy.early_access_claim_closes_at),
    -- Rollout compatibility only: builds from before this migration require the key. There is no code any more.
    'otp', null,
    -- Part 3: the copy switch (payment_policy.sales_open), the plans on sale with their catalogue prices, the semester
    -- they are for, the student's paid plan and their receipts. Plans and prices are offered only while sales are open;
    -- a Session plan only during a First Semester.
    'plans_on_sale', coalesce(v_sales_open, false),
    'term', case when v_term.session_label is null then null else jsonb_build_object('session_label', v_term.session_label,
      'period_key', v_term.period_key, 'period_name', v_term.period_name, 'ends_at', v_term.ends_at) end,
    'plans', case when coalesce(v_sales_open, false) and v_tester_ends is null then coalesce((select jsonb_agg(jsonb_build_object('plan', c.plan_key,
        'tier', c.tier, 'period', c.period, 'price_kobo', c.price_kobo) order by c.tier desc, c.period desc)
      from private.plan_catalogue c where c.active
        and (c.period = 'semester' or v_term.period_key is null or v_term.period_key = 'first-semester')), '[]'::jsonb)
      else '[]'::jsonb end,
    'paid', (select jsonb_build_object('plan', o.plan_key, 'tier', o.tier, 'period', o.period, 'order_id', o.id,
        'amount_kobo', o.amount_kobo, 'paid_at', o.paid_at, 'first_ends_at', private.grant_effective_end(g1),
        'second_starts_at', g2.starts_at, 'second_ends_at', private.grant_effective_end(g2),
        'term_session_label', o.term_session_label,
        -- The semester this plan was bought for (a Semester plan can be for the First or the Second Semester).
        'period_key', (select ap.key from public.academic_periods ap where ap.id = o.term_period_id),
        'period_name', (select ap.display_name from public.academic_periods ap where ap.id = o.term_period_id))
      from private.payment_orders o
      join public.entitlement_grants g1 on g1.order_id = o.id and g1.plan_part = 1 and g1.revoked_at is null
      left join public.entitlement_grants g2 on g2.order_id = o.id and g2.plan_part = 2 and g2.revoked_at is null
      where o.user_id = v_user_id and o.status = 'paid'
        and coalesce(private.grant_effective_end(g2), g2.ends_at, private.grant_effective_end(g1)) > clock_timestamp()
      order by o.paid_at desc limit 1),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'plan', o.plan_key, 'amount_kobo', o.amount_kobo,
        'paid_at', o.paid_at, 'status', case when o.status = 'refund-failed' then 'refund-pending' else o.status end)
        order by o.paid_at desc)
      from (select * from private.payment_orders where user_id = v_user_id
        and status in ('paid', 'paid-duplicate', 'refund-pending', 'refund-failed', 'refunded')
        order by paid_at desc limit 20) o), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- The one end. The trigger above moves the stored close with it on a launched database and leaves it null otherwise.
-- ---------------------------------------------------------------------------
update private.entitlement_policy set early_access_claim_cutoff = timestamptz '2026-12-31 00:00:00+01'
  where singleton = true;

comment on column private.entitlement_policy.early_access_claim_cutoff is
  'The end of 30 December 2026, Africa/Lagos: free access can be claimed from the actual launch until this instant, and every claim ends at it (owner decision, 25 November 2026; 20261126100000).';
comment on column private.entitlement_policy.early_access_claim_closes_at is
  'When free access can no longer be claimed and when every claim ends: early_access_claim_cutoff once a launch is recorded, null before (trigger entitlement_policy_fix_claim_close, 20261126100000).';
comment on column private.entitlement_policy.early_access_enrollment_days is
  'Retired by 20261126100000: no claim, launch, report or plan-read rule uses it; admin_configure_early_access still stores it and refuses a change after launch. Claims close at early_access_claim_cutoff.';
comment on column private.entitlement_policy.early_access_duration is
  'Retired by 20261126100000: every claim ends at early_access_claim_closes_at, whatever its start.';

-- ---------------------------------------------------------------------------
-- The whole change, or none of it: on a launched database the close must have moved with the cutoff.
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from private.entitlement_policy) <> 1
      or (select count(*) from private.entitlement_policy
        where early_access_claim_cutoff = timestamptz '2026-12-31 00:00:00+01'
          and early_access_claim_closes_at is not distinct from
            case when actual_launch_at is not null then early_access_claim_cutoff end
          -- The last Lagos day of free access is 30 December.
          and ((early_access_claim_cutoff - interval '1 microsecond') at time zone 'Africa/Lagos')::date
            = date '2026-12-30') <> 1 then
    raise exception 'Free access: expected the one policy row to close claims and end free access at the end of 30 December 2026 (Lagos)';
  end if;
end;
$$;
