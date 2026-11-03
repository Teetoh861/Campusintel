-- Payments re-review (runs after 20261102190000_payments.sql and before part 2b): fenced catch-up leases, a final due
-- late check, failed checks recorded with a short back-off, permanent refusals stopped for review, excess refunds before
-- plan refunds, and card excess left to Bachs support.
-- Existing money and grants are preserved. Claim/completion writers take only the order row; they never acquire
-- the account prefix after it. Fulfil/refund keep the A1 prefix before the order and grant rows.
alter table private.payment_orders
  add column check_lease_token uuid,
  add column check_lease_until timestamptz,
  add column late_check_finished_at timestamptz,
  -- A check that failed (provider unavailable, error): how many in a row, and since when this order has been due without
  -- a completed check (it stays visible as overdue while it backs off 5, 15, then 60 minutes).
  add column check_failures integer not null default 0 check (check_failures >= 0),
  add column check_failing_since timestamptz,
  -- A permanent refusal (a checkout the provider does not know, an answer that does not match): checks stop, for review.
  add column checks_stopped_at timestamptz,
  add constraint payment_check_lease_pair check ((check_lease_token is null) = (check_lease_until is null));

-- A due late check survives the 14-day boundary. Only completing that final check ends late checks.
create function private.payment_check_due(o private.payment_orders, p_at timestamptz) returns boolean
language sql immutable security definer set search_path = '' as $$
  select o.checks_stopped_at is null and (o.status in ('created', 'pending')
      or (o.status in ('failed', 'cancelled', 'expired') and o.late_check_finished_at is null))
    and coalesce(o.next_check_at, o.created_at + interval '2 minutes') <= p_at;
$$;

-- Due with no completed check since a time this far back: late, or failing and backing off since then.
create function private.payment_check_overdue(o private.payment_orders, p_at timestamptz) returns boolean
language sql immutable security definer set search_path = '' as $$
  select private.payment_check_due(o, p_at) or (o.checks_stopped_at is null and o.check_failing_since <= p_at
    and (o.status in ('created', 'pending') or (o.status in ('failed', 'cancelled', 'expired') and o.late_check_finished_at is null)));
$$;

-- The catch-up job claims its orders (claim_payment_checks); the old unleased candidate list is gone.
drop function public.payment_orders_to_check(integer, boolean);

-- The lease is committed before any provider call. Two selectors skip each other's locked rows, and an unfinished
-- check is claimable again after 60 seconds. No check starts after 40 seconds; all I/O is independently bounded.
create function public.claim_payment_checks(p_limit integer, p_include_late boolean, p_lease_token uuid)
returns table (order_id uuid, action text)
language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $$
begin
  if p_limit is null or p_limit not between 1 and 50 or p_include_late is null or p_lease_token is null then
    raise exception 'Invalid payment check claim' using errcode = '22023';
  end if;
  return query
    with picked as (
      select o.id from private.payment_orders o
      where private.payment_check_due(o, clock_timestamp())
        and (p_include_late or o.status in ('created', 'pending'))
        and (o.check_lease_until is null or o.check_lease_until <= clock_timestamp())
      -- Open orders newest first (the most likely to have just been paid), then everything else by due time.
      order by (o.status in ('created', 'pending')
          and o.created_at > clock_timestamp() - make_interval(hours => (select reconcile_hours from private.payment_policy))) desc,
        case when o.status in ('created', 'pending') then o.created_at end desc nulls last,
        coalesce(o.next_check_at, o.created_at + interval '2 minutes'), o.id
      limit p_limit for update of o skip locked
    ), claimed as (
      update private.payment_orders o set check_lease_token = p_lease_token,
          check_lease_until = clock_timestamp() + interval '60 seconds'
        from picked where o.id = picked.id returning o.*
    )
    select c.id, case when c.status in ('created', 'pending')
          and c.created_at > clock_timestamp() - make_interval(hours => p.reconcile_hours) then 'check'
        when c.status in ('created', 'pending') then 'expire' else 'late-check' end
      from claimed c cross join private.payment_policy p;
end;
$$;

drop function public.record_payment_check(uuid, text);
create function public.record_payment_check(p_order_id uuid, p_result text, p_lease_token uuid) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '1s' as $$
declare o private.payment_orders; v_policy private.payment_policy; v_now timestamptz; v_next timestamptz;
begin
  if p_order_id is null or p_lease_token is null or p_result is null or p_result not in ('waiting', 'fulfilled', 'ended',
      'expired', 'settled', 'review', 'no-checkout', 'not-found', 'provider-unavailable', 'error') then
    raise exception 'Invalid payment check' using errcode = '22023';
  end if;
  select * into o from private.payment_orders where id = p_order_id for update;
  v_now := clock_timestamp();
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if o.check_lease_token is distinct from p_lease_token or o.check_lease_until <= v_now then
    return jsonb_build_object('state', 'lease-lost');
  end if;
  if p_result in ('provider-unavailable', 'error') then
    -- Not a completed check: the normal schedule does not advance. Back off 5, 15, then 60 minutes, and keep the order
    -- visible as overdue from when it first became due without a completed check.
    v_next := v_now + make_interval(mins => (array[5, 15, 60])[least(o.check_failures + 1, 3)]);
    update private.payment_orders set last_check_result = p_result, last_checked_at = v_now, next_check_at = v_next,
        check_failures = check_failures + 1,
        check_failing_since = coalesce(check_failing_since, coalesce(next_check_at, created_at + interval '2 minutes')),
        check_lease_token = null, check_lease_until = null
      where id = o.id;
    return jsonb_build_object('state', 'failed', 'next_check_at', v_next);
  end if;
  if p_result = 'review' then
    -- A permanent refusal: checks stop and the order is listed for review (payments-health).
    update private.payment_orders set last_check_result = p_result, last_checked_at = v_now, checks_stopped_at = v_now,
        check_failures = 0, check_failing_since = null, check_lease_token = null, check_lease_until = null
      where id = o.id;
    return jsonb_build_object('state', 'stopped');
  end if;
  select * into strict v_policy from private.payment_policy;
  v_next := case
    when o.status in ('created', 'pending') and o.created_at > v_now - make_interval(hours => v_policy.reconcile_hours)
      then v_now + make_interval(mins => (array[2, 5, 10, 30, 60])[least(o.check_count + 1, 5)])
    when o.status in ('created', 'pending') then v_now + interval '30 minutes'
    when o.status in ('failed', 'cancelled', 'expired')
        and o.created_at > v_now - make_interval(days => v_policy.late_check_days)
      then v_now + make_interval(hours => least(power(2, least(o.check_count, 6))::integer, 48))
    end;
  update private.payment_orders set next_check_at = v_next, check_count = check_count + 1, last_checked_at = v_now,
      last_check_result = p_result, check_lease_token = null, check_lease_until = null, check_failures = 0,
      check_failing_since = null,
      late_check_finished_at = case when o.status in ('failed', 'cancelled', 'expired')
          and o.created_at <= v_now - make_interval(days => v_policy.late_check_days) then v_now
        else late_check_finished_at end
    where id = o.id;
  return jsonb_build_object('state', 'recorded', 'next_check_at', v_next);
end;
$$;

create or replace function public.refund_order(p_order_id uuid, p_class text, p_request_id uuid, p_identity_hashes text[],
  p_actor text, p_reason text, p_requested_at timestamptz default now(), p_payment_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_now timestamptz;
  o private.payment_orders;
  f private.payment_fulfilments;
  r private.payment_refunds;
  v_hash text;
  v_assessment jsonb;
  v_revoked uuid[];
  v_result jsonb;
  v_amount bigint;
  v_excess private.payment_refunds;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_order_id is null or p_class is null or p_class not in ('standard', 'our-fault', 'duplicate', 'excess')
      or p_request_id is null or p_requested_at is null or not private.refund_identity_ok(p_identity_hashes) then
    raise exception 'Invalid refund' using errcode = '22023';
  end if;
  select user_id into v_user from private.payment_orders where id = p_order_id;
  if v_user is not null then perform private.lock_course_access_scope(v_user); end if;
  select * into o from private.payment_orders where id = p_order_id for update;
  select * into f from private.payment_fulfilments where order_id = p_order_id
    and (case when p_payment_id is null then outcome <> 'extra-payment' else id = p_payment_id end) for update;
  perform 1 from public.entitlement_grants where order_id = p_order_id order by id for update;
  for v_hash in select distinct h from unnest(p_identity_hashes) h order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('refund-identity:' || v_hash, 0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('refund-request:' || p_request_id::text, 0));
  -- Every lock is held: decide now, and nothing below waits.
  v_now := clock_timestamp();
  if p_class = 'excess' and f.method = 'card' then
    return jsonb_build_object('state', 'card-excess-support');
  end if;
  select * into r from private.payment_refunds where request_id = p_request_id;
  if r.id is not null then
    if r.order_id is distinct from p_order_id or r.refund_class <> p_class
        or (p_payment_id is not null and r.payment_id <> p_payment_id) then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return r.result || jsonb_build_object('refund_status', r.status);
  end if;
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if f.id is null then return jsonb_build_object('state', 'not-paid', 'order_status', o.status); end if;
  if p_requested_at < f.created_at or p_requested_at > v_now then
    raise exception 'The request time must be between payment and now' using errcode = '22023';
  end if;
  select * into r from private.payment_refunds where payment_id = f.id and status <> 'failed'
    and (refund_class = 'excess') = (p_class = 'excess');
  if r.id is not null then return jsonb_build_object('state', 'already-refunding', 'refund_id', r.id); end if;
  -- A pending or failed excess must be settled before the plan can be refunded. Otherwise a failed excess
  -- could be stranded behind a refund that returned only the price. The settled excess alone is subtracted.
  select * into v_excess from private.payment_refunds where payment_id = f.id
    and (refund_class = 'excess') <> (p_class = 'excess')
    and (p_class <> 'excess' or status <> 'failed') order by created_at desc, id limit 1;
  if v_excess.id is not null then
    if p_class = 'excess' then
      return jsonb_build_object('state', 'already-refunding', 'refund_id', v_excess.id);
    elsif v_excess.status <> 'refunded' then
      return jsonb_build_object('state', 'excess-unsettled', 'refund_id', v_excess.id);
    elsif f.method = 'card' then
      -- Protect any historical card excess record; new card excess requests are refused above.
      return jsonb_build_object('state', 'provider-refund-used', 'refund_id', v_excess.id);
    end if;
  end if;
  v_assessment := private.refund_assessment(o, f, p_identity_hashes, p_requested_at);
  if not (v_assessment->'classes_allowed') ? p_class then
    return jsonb_build_object('state', 'class-not-allowed', 'assessment', v_assessment);
  end if;
  if p_class = 'standard' and not (v_assessment->>'standard_allowed')::boolean then
    return jsonb_build_object('state', 'refused', 'assessment', v_assessment);
  end if;
  v_amount := case when p_class = 'excess' then (v_assessment->>'excess_kobo')::bigint
    else f.amount_kobo - coalesce(v_excess.amount_kobo, 0) end;

  if f.outcome = 'fulfilled' and p_class <> 'excess' then
    with revoked as (
      update public.entitlement_grants set revoked_at = v_now, revoked_by = left('refund:' || btrim(p_actor), 120),
          revoke_reason = btrim(p_reason)
        where order_id = o.id and revoked_at is null returning id)
    select coalesce(array_agg(id order by id), '{}') into v_revoked from revoked;
  else
    v_revoked := '{}';
  end if;
  insert into private.payment_refunds (payment_id, order_id, user_id, identity_hashes, refund_class, amount_kobo,
      currency, request_id, requested_at, actor, reason, result, created_at)
    values (f.id, o.id, o.user_id, p_identity_hashes, p_class, v_amount, f.currency, p_request_id,
      p_requested_at, btrim(p_actor), btrim(p_reason), '{}'::jsonb, v_now)
    returning * into r;
  v_result := jsonb_build_object('state', 'refund-pending', 'refund_id', r.id, 'order_id', o.id, 'payment_id', f.id,
    'refund_class', p_class, 'amount_kobo', v_amount, 'currency', f.currency, 'method', f.method,
    'provider', f.provider, 'provider_payment_id', f.provider_payment_id, 'idempotency_key', p_request_id,
    'payment_amount_kobo', f.amount_kobo, 'revoked_grant_ids', to_jsonb(v_revoked));
  update private.payment_refunds set result = v_result where id = r.id;
  perform private.log_entitlement_event(o.user_id, revoked_id, 'payment.refund-revoked',
      left('refund:' || btrim(p_actor), 120), jsonb_build_object('order_id', o.id, 'refund_id', r.id))
    from unnest(v_revoked) revoked_id;
  if f.outcome <> 'extra-payment' and p_class <> 'excess' then
    update private.payment_orders set status = 'refund-pending', updated_at = v_now where id = o.id;
  end if;
  perform private.log_payment_event(o.id, 'refund.requested', left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('from', o.status, 'to', case when f.outcome = 'extra-payment' or p_class = 'excess' then o.status
        else 'refund-pending' end,
      'refund_id', r.id, 'refund_class', p_class, 'amount_kobo', v_amount, 'currency', f.currency,
      'payment_id', f.provider_payment_id, 'request_id', p_request_id));
  return v_result;
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
      where f.outcome = 'fulfilled' and f.currency = o.currency and f.amount_kobo > o.amount_kobo and f.method = 'card'),
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

-- Part 1's refund assessment, with one change: excess is not offered for a card payment.
create or replace function private.refund_assessment(p_order private.payment_orders, p_payment private.payment_fulfilments,
  p_identity_hashes text[], p_requested_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.payment_policy;
  v_paid timestamptz := p_order.paid_at;
  v_now timestamptz := clock_timestamp();
  v_excess bigint := case when p_payment.outcome = 'fulfilled' and p_payment.currency = p_order.currency
    and p_payment.amount_kobo > p_order.amount_kobo then p_payment.amount_kobo - p_order.amount_kobo else 0 end;
  v_bot integer := 0; v_exams integer := 0; v_answers integer := 0; v_reveals integer := 0; v_topics integer := 0;
  v_used integer;
  v_reasons text[] := '{}';
  v_classes text[];
begin
  select * into strict v_policy from private.payment_policy;
  if p_payment.outcome = 'fulfilled' then
    -- Card excess goes through Bachs support, so only a bank-transfer excess is offered here.
    v_classes := array['standard', 'our-fault']
      || case when v_excess > 0 and p_payment.method <> 'card' then array['excess'] else '{}'::text[] end;
    select count(*) filter (where kind = 'campus-bot-reply'), count(*) filter (where kind = 'theory-reveal'),
        count(distinct coalesce(course_id::text, '') || ':' || ref) filter (where kind = 'notes-topic')
      into v_bot, v_reveals, v_topics
      from private.plan_use_events u
      where u.order_id = p_order.id and u.occurred_at >= v_paid and u.occurred_at <= v_now
        and not private.payment_course_is_free(u.course_id);
    select count(*) into v_exams from public.quiz_attempts q
      where q.user_id = p_order.user_id and q.mode = 'exam' and q.created_at >= v_paid
        and q.created_at <= v_now and not private.payment_course_is_free(q.course_id);
    select count(*) into v_answers from public.quiz_attempt_answers a join public.quiz_attempts q on q.id = a.attempt_id
      where q.user_id = p_order.user_id and q.mode is distinct from 'exam' and a.answered_at >= v_paid
        and a.answered_at <= v_now and not private.payment_course_is_free(q.course_id);
    v_answers := v_answers + v_reveals;
    if p_requested_at > v_paid + make_interval(hours => v_policy.refund_window_hours) then
      v_reasons := v_reasons || 'window'::text;
    end if;
    if v_bot > v_policy.refund_campus_bot_replies_allowed then v_reasons := v_reasons || 'campus-bot'::text; end if;
    if v_exams > v_policy.refund_exams_allowed then v_reasons := v_reasons || 'exam'::text; end if;
    if v_answers > v_policy.refund_practice_answers_allowed then v_reasons := v_reasons || 'practice'::text; end if;
    if v_topics > v_policy.refund_notes_topics_allowed then v_reasons := v_reasons || 'notes'::text; end if;
  else
    v_classes := array['our-fault', 'duplicate'];
    v_reasons := array['no-plan'];
  end if;
  select count(*) into v_used from private.payment_refunds r
    where r.refund_class = 'standard' and r.status <> 'failed'
      and ((p_order.user_id is not null and r.user_id = p_order.user_id) or r.identity_hashes && p_identity_hashes);
  if p_payment.outcome = 'fulfilled' and v_used >= v_policy.refunds_per_student then
    v_reasons := v_reasons || 'limit'::text;
  end if;
  return jsonb_build_object('classes_allowed', to_jsonb(v_classes),
    'standard_allowed', cardinality(v_reasons) = 0, 'standard_refused', to_jsonb(v_reasons),
    'requested_at', p_requested_at, 'window_ends_at', v_paid + make_interval(hours => v_policy.refund_window_hours),
    'use_counted_until', v_now, 'excess_kobo', v_excess,
    'counts', jsonb_build_object('campus_bot_replies', v_bot, 'exams_started', v_exams, 'practice_answers', v_answers,
      'notes_topics', v_topics),
    'allowed', jsonb_build_object('campus_bot_replies', v_policy.refund_campus_bot_replies_allowed,
      'exams_started', v_policy.refund_exams_allowed, 'practice_answers', v_policy.refund_practice_answers_allowed,
      'notes_topics', v_policy.refund_notes_topics_allowed),
    'refunds_used', v_used, 'refund_limit', v_policy.refunds_per_student,
    'amount_kobo', p_payment.amount_kobo, 'currency', p_payment.currency, 'method', p_payment.method);
end;
$$;

revoke all on function private.payment_check_due(private.payment_orders, timestamptz),
  private.payment_check_overdue(private.payment_orders, timestamptz),
  public.claim_payment_checks(integer, boolean, uuid), public.record_payment_check(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_payment_checks(integer, boolean, uuid),
  public.record_payment_check(uuid, text, uuid) to service_role;
