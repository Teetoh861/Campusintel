-- supabase/migrations/20261105120000_payment_amount_received.sql — The wrong-amount return page shows what the student
-- actually paid. get_my_payment_order adds received_kobo and received_currency, from the order's verified payment, only
-- when that payment did not match the plan price (outcome amount-mismatch); otherwise both are null. Nothing else changes.
create or replace function public.get_my_payment_order(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); o private.payment_orders; g1 public.entitlement_grants; g2 public.entitlement_grants;
  f private.payment_fulfilments;
begin
  if v_user is null or not private.has_live_account_session() then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  select * into o from private.payment_orders where id = p_order_id and user_id = v_user;
  -- Another student's order and an unknown id look the same.
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  select * into g1 from public.entitlement_grants where order_id = o.id and plan_part = 1 and revoked_at is null;
  select * into g2 from public.entitlement_grants where order_id = o.id and plan_part = 2 and revoked_at is null;
  select * into f from private.payment_fulfilments where order_id = o.id and outcome = 'amount-mismatch';
  return jsonb_build_object('state', case
      when o.status in ('created', 'pending', 'unfulfilled') then 'confirming'
      when o.status in ('cancelled', 'expired') then 'cancelled'
      when o.status in ('refund-pending', 'refund-failed') then 'refund-pending'
      else o.status end,
    'order_id', o.id, 'plan', o.plan_key, 'tier', o.tier, 'period', o.period, 'amount_kobo', o.amount_kobo, 'currency', o.currency,
    'return_path', o.return_path, 'created_at', o.created_at, 'expires_at', o.expires_at, 'paid_at', o.paid_at,
    'ends_at', case when g1.id is not null then private.grant_effective_end(g1) end,
    'second_starts_at', g2.starts_at,
    'second_ends_at', case when g2.id is not null then private.grant_effective_end(g2) end,
    'received_kobo', f.amount_kobo, 'received_currency', f.currency);
end;
$$;
