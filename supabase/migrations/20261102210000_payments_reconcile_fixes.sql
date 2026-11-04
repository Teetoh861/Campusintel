-- Payments reconciliation fixes (after 20261102200000_payments_review_fixes.sql, before part 2b):
-- 1. Every catch-up claim keeps a guaranteed share for the checks that have waited longest, so a steady stream of new
--    open orders can no longer starve an overdue check. The rest of the claim keeps the newest-first order.
-- 2. The card-excess support list leaves out payments already refunded in full, like the bank-transfer queue.
-- Only these two functions change; leases, fencing, back-off and every other rule stay as they were.

-- A claim of p_limit orders reserves ceil(p_limit / 5) slots (10 of 50; none for a single-order claim) for the due checks
-- that have waited longest: since their due time, or since their first failed check while they back off. The remaining
-- slots keep the earlier order: open orders newest first, then everything else by due time. A check that has waited
-- longest is therefore claimed within (checks waiting longer than it) / reserved slots claims, whatever else arrives.
create or replace function public.claim_payment_checks(p_limit integer, p_include_late boolean, p_lease_token uuid)
returns table (order_id uuid, action text)
language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $$
declare
  v_reserved integer;
  v_oldest uuid[];
  v_fresh uuid[];
begin
  if p_limit is null or p_limit not between 1 and 50 or p_include_late is null or p_lease_token is null then
    raise exception 'Invalid payment check claim' using errcode = '22023';
  end if;
  v_reserved := least(ceil(p_limit / 5.0)::integer, p_limit - 1);
  -- Each selection locks as it scans, skipping rows another run holds, so a concurrent run takes the next order instead.
  -- The reserved share: the due checks that have waited longest.
  select coalesce(array_agg(x.id), '{}') into v_oldest from (
    select o.id from private.payment_orders o
    where private.payment_check_due(o, clock_timestamp())
      and (p_include_late or o.status in ('created', 'pending'))
      and (o.check_lease_until is null or o.check_lease_until <= clock_timestamp())
    order by least(coalesce(o.check_failing_since, 'infinity'::timestamptz),
        coalesce(o.next_check_at, o.created_at + interval '2 minutes')), o.id
    limit v_reserved for update of o skip locked) x;
  -- The rest, as before: open orders newest first (the most likely to have just been paid), then everything else by
  -- due time. Slots the reserved share could not fill come here too.
  select coalesce(array_agg(x.id), '{}') into v_fresh from (
    select o.id from private.payment_orders o
    where private.payment_check_due(o, clock_timestamp())
      and (p_include_late or o.status in ('created', 'pending'))
      and (o.check_lease_until is null or o.check_lease_until <= clock_timestamp())
      and o.id <> all (v_oldest)
    order by (o.status in ('created', 'pending')
        and o.created_at > clock_timestamp() - make_interval(hours => (select reconcile_hours from private.payment_policy))) desc,
      case when o.status in ('created', 'pending') then o.created_at end desc nulls last,
      coalesce(o.next_check_at, o.created_at + interval '2 minutes'), o.id
    limit p_limit - cardinality(v_oldest) for update of o skip locked) x;
  return query
    with claimed as (
      update private.payment_orders o set check_lease_token = p_lease_token,
          check_lease_until = clock_timestamp() + interval '60 seconds'
        where o.id = any (v_oldest || v_fresh) returning o.*
    )
    select c.id, case when c.status in ('created', 'pending')
          and c.created_at > clock_timestamp() - make_interval(hours => p.reconcile_hours) then 'check'
        when c.status in ('created', 'pending') then 'expire' else 'late-check' end
      from claimed c cross join private.payment_policy p;
end;
$$;

create or replace function public.admin_payments_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending_over_30_min', (select count(*) from private.payment_orders where status in ('created', 'pending')
      and created_at < clock_timestamp() - interval '30 minutes'),
    'needs_support', coalesce((select jsonb_agg(jsonb_build_object('order_id', id, 'status', status, 'flags', flags)
      order by created_at) from private.payment_orders where status in ('amount-mismatch', 'paid-duplicate',
        'unfulfilled', 'refund-failed') or cardinality(array_remove(flags, 'overpaid')) > 0), '[]'::jsonb),
    -- Paid more than the price: listed until the excess (or the whole payment) has been refunded.
    'overpaid_excess_due', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'payment_id', f.id,
        'excess_kobo', f.amount_kobo - o.amount_kobo, 'currency', f.currency, 'method', f.method) order by o.created_at)
      from private.payment_orders o join private.payment_fulfilments f on f.order_id = o.id
      where f.outcome = 'fulfilled' and f.currency = o.currency and f.amount_kobo > o.amount_kobo and f.method <> 'card'
        and not exists (select 1 from private.payment_refunds r where r.payment_id = f.id and r.status = 'refunded'
          and (r.refund_class = 'excess' or r.amount_kobo = f.amount_kobo))), '[]'::jsonb),
    -- Card excess is never refunded here: it goes through Bachs support.
    'card_excess_contact_bachs_support', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'payment_id', f.id,
        'excess_kobo', f.amount_kobo - o.amount_kobo, 'currency', f.currency, 'action', 'contact Bachs support')
        order by o.created_at)
      from private.payment_orders o join private.payment_fulfilments f on f.order_id = o.id
      where f.outcome = 'fulfilled' and f.currency = o.currency and f.amount_kobo > o.amount_kobo and f.method = 'card'
        -- The bank-transfer queue's settlement filter: a payment refunded in full has no excess left to recover.
        and not exists (select 1 from private.payment_refunds r where r.payment_id = f.id and r.status = 'refunded'
          and (r.refund_class = 'excess' or r.amount_kobo = f.amount_kobo))),
      '[]'::jsonb),
    'checks_overdue_6h', (select count(*) from private.payment_orders o
      where private.payment_check_overdue(o, clock_timestamp() - interval '6 hours')),
    'checks_stopped_for_review', coalesce((select jsonb_agg(jsonb_build_object('order_id', id, 'status', status,
        'stopped_at', checks_stopped_at) order by checks_stopped_at)
      from private.payment_orders where checks_stopped_at is not null and status in ('created', 'pending', 'failed',
        'cancelled', 'expired')), '[]'::jsonb),
    'refunds_pending', (select count(*) from private.payment_refunds where status = 'pending'),
    'paid_grants_unbound', coalesce((select jsonb_agg(jsonb_build_object('order_id', order_id, 'grant_id', id,
      'part', plan_part, 'starts_at', starts_at)) from public.entitlement_grants where order_id is not null
      and revoked_at is null and course_term_id is null and starts_at < clock_timestamp() - interval '7 days'), '[]'::jsonb));
$$;
