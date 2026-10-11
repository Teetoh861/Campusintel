-- A stale recovery page cannot claim or discard another flow's current credential.
create or replace function public.consume_recovery_grant(p_hash text, p_binding text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_expires timestamptz;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or (p_binding is not null and p_binding !~ '^[a-f0-9]{64}$')
  then raise exception using errcode = '22023', message = 'Invalid recovery grant'; end if;
  -- Binding is part of the atomic claim, not a check after deletion.
  -- NULL is reserved for explicit server-owned global invalidation (logout).
  delete from public.auth_recovery_grants
    where grant_hash = p_hash and (p_binding is null or flow_binding = p_binding)
    returning user_id, expires_at into v_user_id, v_expires;
  if p_binding is not null and v_expires > pg_catalog.clock_timestamp()
    then return v_user_id; end if;
  return null;
end;
$$;

-- Same signature and narrow capability; no new table access or exposed helper.
revoke all on function public.consume_recovery_grant(text,text) from public, anon, authenticated;
grant execute on function public.consume_recovery_grant(text,text) to service_role;
