-- supabase/migrations/20261112100000_recovery_grant_retry.sql — A new password the provider rejects (weak or reused)
-- changes nothing, so the student may try again on the same grant: the same credential (the same browser) and the
-- same expiry, never a new grant and never a longer one, and at most five times for one code.
--
-- While a reset request tries a password it holds the grant. The row is re-keyed from the credential's hash to a
-- value built from that hash and a one-time claim id, so the credential alone no longer finds the row and no other
-- request can use it. The same UPDATE counts the attempt (password_attempts). The request then does exactly one of two
-- things:
--   restore: the provider rejected the password, so the row is re-keyed back. Nothing here writes created_at,
--            expires_at or the count, so a restored grant expires exactly when it always would have and keeps its
--            attempts. The fifth rejected password is not restored: the code is used up.
--   finish:  anything else (the password was accepted, the attempt failed some other way, or it could not go back):
--            the row is deleted.
-- So a grant that can still be used has a count equal to the passwords the provider has rejected on it. A held grant
-- whose request died does neither; it stays unusable and is pruned at expiry like any other row.
--
-- consume_recovery_grant is unchanged: a held row matches no credential hash, and the account purge still removes it
-- by user_id. issue_recovery_grant is redefined only to start a new code's count at zero when it replaces a grant.

-- Five rejected passwords per code. The functions below name the same limit as c_password_attempts.
alter table public.auth_recovery_grants
  add column password_attempts smallint not null default 0 check (password_attempts between 0 and 5);
comment on column public.auth_recovery_grants.password_attempts is
  'Reset requests that held this grant to try a new password. Restore stops at five: one code allows five rejected passwords.';

-- A new code is a new grant with a fresh count, also when it replaces this student's earlier grant, held or not.
-- Otherwise unchanged from 20261016110000_account_deletion_access.sql.
create or replace function public.issue_recovery_grant(p_hash text, p_user_id uuid, p_binding text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_user_id is null
    or p_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  perform 1 from auth.users where id = p_user_id for share;
  if not found then raise exception 'Recovery unavailable' using errcode = '42501'; end if;
  v_now := clock_timestamp();
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id and deadline <= v_now)
    then raise exception 'Recovery unavailable' using errcode = '42501'; end if;
  insert into public.auth_recovery_grants(grant_hash,user_id,flow_binding,created_at,expires_at,password_attempts)
    values(p_hash,p_user_id,p_binding,v_now,v_now + interval '10 minutes',0)
    on conflict (user_id) do update set grant_hash = excluded.grant_hash,
      flow_binding = excluded.flow_binding, created_at = excluded.created_at, expires_at = excluded.expires_at,
      password_attempts = 0;
end;
$$;

-- The key a held grant is filed under. Only the claimed credential's hash with its claim id rebuilds it.
create function private.recovery_grant_held_key(p_hash text, p_claim uuid)
returns text language sql immutable set search_path = '' as $$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_hash || ':' || p_claim::text, 'UTF8')), 'hex');
$$;
revoke all on function private.recovery_grant_held_key(text,uuid) from public, anon, authenticated, service_role;

create function public.claim_recovery_grant(p_hash text, p_binding text)
returns table (holder uuid, claim uuid) language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_expires timestamptz; v_claim uuid := pg_catalog.gen_random_uuid(); v_key text;
  c_password_attempts constant smallint := 5;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  -- Account then grant is the same lock order used by scheduling and purging.
  select g.user_id into v_user from public.auth_recovery_grants g where g.grant_hash = p_hash;
  if v_user is null then return; end if;
  perform 1 from auth.users u where u.id = v_user for share;
  v_key := private.recovery_grant_held_key(p_hash, v_claim);
  -- One UPDATE holds the grant and counts this attempt, even for concurrent requests, so two tabs or a double submit
  -- never get a try that is not counted; the binding is part of that claim, as in consume. Restore never puts back a
  -- grant at the limit, so the last condition only keeps a row edited by hand from being held past it.
  update public.auth_recovery_grants g set grant_hash = v_key, password_attempts = g.password_attempts + 1
    where g.grant_hash = p_hash and g.flow_binding = p_binding and g.password_attempts < c_password_attempts
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
declare v_user uuid; v_key text; c_password_attempts constant smallint := 5;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
    or p_claim is null
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  v_key := private.recovery_grant_held_key(p_hash, p_claim);
  select g.user_id into v_user from public.auth_recovery_grants g where g.grant_hash = v_key;
  if v_user is null then return false; end if;
  perform 1 from auth.users u where u.id = v_user for share;
  -- Only the key goes back, never the timestamps or the count. A grant that expired meanwhile, or whose count has
  -- reached the limit (this was its fifth rejected password), stays held for its request to finish, or to be pruned.
  update public.auth_recovery_grants g set grant_hash = p_hash
    where g.grant_hash = v_key and g.flow_binding = p_binding and g.expires_at > clock_timestamp()
      and g.password_attempts < c_password_attempts;
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

-- The same narrow capability as issue and consume: the server's own key only. issue keeps its grants (create or
-- replace leaves them as they were).
revoke all on function public.claim_recovery_grant(text,text) from public, anon, authenticated;
revoke all on function public.restore_recovery_grant(text,text,uuid) from public, anon, authenticated;
revoke all on function public.finish_recovery_grant(text,uuid) from public, anon, authenticated;
grant execute on function public.claim_recovery_grant(text,text) to service_role;
grant execute on function public.restore_recovery_grant(text,text,uuid) to service_role;
grant execute on function public.finish_recovery_grant(text,uuid) to service_role;
