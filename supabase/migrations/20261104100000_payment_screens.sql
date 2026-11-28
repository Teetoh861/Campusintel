-- supabase/migrations/20261104100000_payment_screens.sql — Payments part 3: what the plan and payment screens read.
-- get_my_entitlement (A2, 20261101120000) gains the copy switch (plans_on_sale), the plans on sale with their prices, the
-- student's semester, their paid plan with its effective dates, and their receipts; a paid grant counts only within
-- its semester (never in the stored slack). plans_on_sale() is the same switch for pages that read nothing else.
-- Read-only: no lock, no write.

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
    'tier', case when v_access.id is null then 'free' else 'full' end,
    'access', case when v_access.id is null then null
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
      'enrollment_closes_at', case when v_policy.actual_launch_at is null then null
        else v_policy.actual_launch_at + make_interval(days => v_policy.early_access_enrollment_days) end),
    -- Rollout compatibility only: builds from before this migration require the key. There is no code any more.
    'otp', null,
    -- Part 3: the copy switch (payment_policy.sales_open), the plans on sale with their catalogue prices, the semester
    -- they are for, the student's paid plan and their receipts. Plans and prices are offered only while sales are open;
    -- a Session plan only during a First Semester.
    'plans_on_sale', coalesce(v_sales_open, false),
    'term', case when v_term.session_label is null then null else jsonb_build_object('session_label', v_term.session_label,
      'period_key', v_term.period_key, 'period_name', v_term.period_name, 'ends_at', v_term.ends_at) end,
    'plans', case when coalesce(v_sales_open, false) then coalesce((select jsonb_agg(jsonb_build_object('plan', c.plan_key,
        'tier', c.tier, 'period', c.period, 'price_kobo', c.price_kobo) order by c.tier desc, c.period desc)
      from private.plan_catalogue c where c.active
        and (c.period = 'semester' or v_term.period_key is null or v_term.period_key = 'first-semester')), '[]'::jsonb)
      else '[]'::jsonb end,
    'paid', (select jsonb_build_object('plan', o.plan_key, 'tier', o.tier, 'period', o.period, 'order_id', o.id,
        'amount_kobo', o.amount_kobo, 'paid_at', o.paid_at, 'first_ends_at', private.grant_effective_end(g1),
        'second_starts_at', g2.starts_at, 'second_ends_at', private.grant_effective_end(g2),
        'term_session_label', o.term_session_label)
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

-- The copy switch alone (the course lock notices, results and the AI page read nothing else from the plan).
create function public.plans_on_sale() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select sales_open from private.payment_policy), false);
$$;
revoke all on function public.plans_on_sale() from public, anon, authenticated, service_role;
grant execute on function public.plans_on_sale() to authenticated, service_role;
