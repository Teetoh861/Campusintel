-- supabase/migrations/20261112100000_recovery_grant_retry.sql — A new password the provider rejects (weak or reused)
-- changes nothing, so the student may try again on the same grant: the same credential (the same browser) and the
-- same expiry, never a new grant and never a longer one.
--
-- While a reset request tries a password it holds the grant. The row is re-keyed from the credential's hash to a
-- value built from that hash and a one-time claim id, so the credential alone no longer finds the row and no other
-- request can use it. The request then does exactly one of two things:
--   restore: the provider rejected the password, so the row is re-keyed back. Nothing here writes created_at or
--            expires_at, so a restored grant expires exactly when it always would have.
--   finish:  anything else (the password was accepted, or the attempt failed some other way): the row is deleted.
-- A held grant whose request died does neither; it stays unusable and is pruned at expiry like any other row.
--
-- issue_recovery_grant and consume_recovery_grant are unchanged: a held row matches no credential hash, a newer
-- grant for the same student still replaces it, and the account purge still removes it by user_id.

-- The key a held grant is filed under. Only the claimed credential's hash with its claim id rebuilds it.
create function private.recovery_grant_held_key(p_hash text, p_claim uuid)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_hash || ':' || p_claim::text, 'UTF8')), 'hex');
$$;
revoke all on function private.recovery_grant_held_key(text,uuid) from public, anon, authenticated, service_role;

create function public.claim_recovery_grant(p_hash text, p_binding text)
returns table (holder uuid, claim uuid) language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_expires timestamptz; v_claim uuid := pg_catalog.gen_random_uuid(); v_key text;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  -- Account then grant is the same lock order used by scheduling and purging.
  select g.user_id into v_user from public.auth_recovery_grants g where g.grant_hash = p_hash;
  if v_user is null then return; end if;
  perform 1 from auth.users u where u.id = v_user for share;
  v_key := private.recovery_grant_held_key(p_hash, v_claim);
  -- One UPDATE holds the grant even for concurrent requests; the binding is part of that claim, as in consume.
  update public.auth_recovery_grants g set grant_hash = v_key
    where g.grant_hash = p_hash and g.flow_binding = p_binding
    returning g.user_id, g.expires_at into v_user, v_expires;
  if not found then return; end if;
  if v_expires > clock_timestamp() and not exists (
    select 1 from private.account_deletion_jobs j where j.user_id = v_user and j.deadline <= clock_timestamp()
  ) then
    holder := v_user;
    claim := v_claim;
    return next;
    return;
  end if;
  -- Expired, or the account is past its deletion deadline: the grant is spent, exactly as consume leaves it.
  delete from public.auth_recovery_grants g where g.grant_hash = v_key;
end;
$$;

create function public.restore_recovery_grant(p_hash text, p_binding text, p_claim uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_key text;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
    or p_claim is null
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  v_key := private.recovery_grant_held_key(p_hash, p_claim);
  select g.user_id into v_user from public.auth_recovery_grants g where g.grant_hash = v_key;
  if v_user is null then return false; end if;
  perform 1 from auth.users u where u.id = v_user for share;
  -- Only the key goes back. A grant that expired meanwhile stays held for its request to finish, or to be pruned.
  update public.auth_recovery_grants g set grant_hash = p_hash
    where g.grant_hash = v_key and g.flow_binding = p_binding and g.expires_at > clock_timestamp();
  return found;
end;
$$;

create function public.finish_recovery_grant(p_hash text, p_claim uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_key text;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_claim is null
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  v_key := private.recovery_grant_held_key(p_hash, p_claim);
  select g.user_id into v_user from public.auth_recovery_grants g where g.grant_hash = v_key;
  if v_user is null then return; end if;
  perform 1 from auth.users u where u.id = v_user for share;
  -- Only a held grant has this key, so a grant that was restored (or never held) is out of reach here.
  delete from public.auth_recovery_grants g where g.grant_hash = v_key;
end;
$$;

-- The same narrow capability as issue and consume: the server's own key only.
revoke all on function public.claim_recovery_grant(text,text) from public, anon, authenticated;
revoke all on function public.restore_recovery_grant(text,text,uuid) from public, anon, authenticated;
revoke all on function public.finish_recovery_grant(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_recovery_grant(text,text) to service_role;
grant execute on function public.restore_recovery_grant(text,text,uuid) to service_role;
grant execute on function public.finish_recovery_grant(text,uuid) to service_role;
