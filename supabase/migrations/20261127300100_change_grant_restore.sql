-- Operator recovery must respect paid orders and the site claim identity. No payment/refund function changes.
-- Lock order: claim policy (free access), account write prefix, claim keys then retained claim hashes, grant row.
-- Paid changes take the account prefix then the order row before the grant, as fulfilment and refunds do.
create or replace function public.admin_change_grant(p_grant_id uuid, p_action text, p_ends_at timestamptz, p_ai_units integer,
  p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_grant public.entitlement_grants;
  v_scope_user uuid;
  v_scope_source text;
  v_scope_policy text;
  v_order uuid;
  v_order_status text;
  v_hash text;
  v_email text;
  v_now timestamptz;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_action is null or p_action not in ('extend', 'revoke', 'restore', 'set-ai-units') then
    raise exception 'Invalid grant change' using errcode = '22023';
  end if;
  select user_id, source, trial_policy, order_id into v_scope_user, v_scope_source, v_scope_policy, v_order
    from public.entitlement_grants where id = p_grant_id;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if v_scope_source = 'early_access' then perform 1 from private.entitlement_policy for share; end if;
  if v_scope_source <> 'trial' or v_scope_policy = 'seven-day' then
    perform private.lock_course_access_scope(v_scope_user);
  end if;
  if v_scope_source = 'early_access' and p_action in ('restore', 'extend') then
    -- Claim creation and every restore/extension serialize here, even for two accounts sharing an address.
    -- No Auth/account lock is acquired after this lock, so it follows claim_early_access's lock order.
    perform pg_advisory_xact_lock(hashtextextended('discovery-claim-keys', 0));
    for v_hash in select claim_hash from private.early_access_claims
        where user_id = v_scope_user or grant_id = p_grant_id order by claim_hash loop
      perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || v_hash, 0));
    end loop;
    select private.canonical_claim_email(email) into v_email from auth.users
      where id = v_scope_user and email_confirmed_at is not null;
  elsif v_scope_source = 'paid' and p_action in ('restore', 'extend') then
    select status into v_order_status from private.payment_orders
      where id = v_order and user_id = v_scope_user for update;
  end if;
  select * into v_grant from public.entitlement_grants where id = p_grant_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  v_now := clock_timestamp();
  if p_action = 'extend' and (p_ends_at is null or p_ends_at <= v_grant.starts_at
      or p_ends_at > v_now + interval '366 days') then
    raise exception 'Invalid grant end' using errcode = '22023';
  end if;
  if p_action in ('restore', 'extend') and v_grant.source = 'paid' and v_order_status is distinct from 'paid' then
    return jsonb_build_object('state', 'order-not-paid');
  end if;
  -- Extend can revive an expired grant too. Do not leave it as another way around the same active-identity check.
  if v_grant.source = 'early_access' and (p_action = 'restore'
      or (p_action = 'extend' and v_grant.revoked_at is null and p_ends_at > v_now)) and exists (
    select 1 from public.entitlement_grants other join auth.users u on u.id = other.user_id
    where other.source = 'early_access' and other.id <> v_grant.id and other.revoked_at is null
      and other.starts_at <= v_now and other.ends_at > v_now
      and (other.user_id = v_grant.user_id or (v_email is not null and u.email_confirmed_at is not null
        and private.canonical_claim_email(u.email) = v_email))
  ) then return jsonb_build_object('state', 'duplicate-identity'); end if;

  if p_action = 'extend' then
    update public.entitlement_grants set ends_at = p_ends_at where id = p_grant_id;
  elsif p_action = 'revoke' then
    update public.entitlement_grants set revoked_at = v_now, revoked_by = 'operator:' || p_actor,
      revoke_reason = p_reason where id = p_grant_id and revoked_at is null;
  elsif p_action = 'restore' then
    update public.entitlement_grants set revoked_at = null, revoked_by = null, revoke_reason = null
      where id = p_grant_id;
  else
    if v_grant.ai_terms <> 'capped' or p_ai_units is null or p_ai_units not between 0 and 1000 then
      raise exception 'Only a capped grant takes an AI allowance' using errcode = '22023';
    end if;
    update public.entitlement_grants set ai_units = p_ai_units where id = p_grant_id;
  end if;
  perform private.log_entitlement_event(v_grant.user_id, p_grant_id, 'operator.' || p_action, 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'previous_ends_at', v_grant.ends_at, 'ends_at', p_ends_at,
      'previous_ai_units', v_grant.ai_units, 'ai_units', p_ai_units));
  return jsonb_build_object('state', 'changed');
end;
$$;
