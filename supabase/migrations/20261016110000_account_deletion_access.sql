-- Existing RLS and definer RPCs share the same ordinary-account restriction.
create function private.account_not_scheduled()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and not exists (
    select 1 from private.account_deletion_jobs where user_id = auth.uid());
$$;
revoke all on function private.account_not_scheduled() from public, anon, authenticated, service_role;
grant execute on function private.account_not_scheduled() to authenticated;

create or replace function private.has_live_account_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_live_auth_session() and private.account_not_scheduled();
$$;

create or replace function private.require_live_account()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  -- Serialize definer work against scheduling/purging before checking lifecycle.
  perform 1 from auth.users where id = v_user for share;
  if not private.has_live_account_session() then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create or replace function private.require_live_operator()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_live_account();
begin
  if not exists (select 1 from public.profiles where id = v_user and role = 'operator') then
    raise exception 'Operator authorization required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

-- Reference/catalogue data has existing authenticated policies. Add lifecycle
-- restrictions without changing its existing ownership/visibility semantics.
create policy "Scheduled accounts cannot read departments" on public.departments
  as restrictive for select to authenticated using ((select private.account_not_scheduled()));
create policy "Scheduled accounts cannot read levels" on public.academic_levels
  as restrictive for select to authenticated using ((select private.account_not_scheduled()));
create policy "Scheduled accounts cannot read periods" on public.academic_periods
  as restrictive for select to authenticated using ((select private.account_not_scheduled()));
create policy "Scheduled accounts cannot read courses" on public.courses
  as restrictive for select to authenticated using ((select private.account_not_scheduled()));
create policy "Scheduled accounts cannot read applicability" on public.course_applicability
  as restrictive for select to authenticated using ((select private.account_not_scheduled()));
create policy "Scheduled accounts cannot read institutional courses" on public.institutional_courses
  as restrictive for select to authenticated using ((select private.account_not_scheduled()));

-- RLS observes the statement snapshot. Mutation triggers also recheck after
-- waiting for the account lock, closing writes already queued at scheduling.
create function private.guard_student_account_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('role', true) = 'authenticated' then perform private.require_live_account(); end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_student_account_write() from public, anon, authenticated, service_role;
create trigger profiles_guard_account_lifecycle before update on public.profiles
  for each row execute function private.guard_student_account_write();
create trigger bookmarks_guard_account_lifecycle before insert or delete on public.student_bookmarks
  for each row execute function private.guard_student_account_write();

-- Keep canonical scoring/snapshots intact. The old implementation is private
-- and uncallable by API roles; the service-only wrapper adds lifecycle locking.
alter function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)
  set schema private;
revoke all on function private.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)
  from public, anon, authenticated, service_role;
create function public.write_quiz_attempt(
  p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_question_count integer,
  p_operation text, p_expected_revision integer, p_status text, p_answers jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select user_id into v_user from auth.sessions where id = p_session_id;
  if v_user is null then return jsonb_build_object('status', 'signed-out'); end if;
  perform 1 from auth.users where id = v_user for share;
  if not found or exists (select 1 from private.account_deletion_jobs where user_id = v_user) then
    return jsonb_build_object('status', 'signed-out');
  end if;
  return private.write_quiz_attempt(p_session_id, p_attempt_id, p_course_id, p_question_count,
    p_operation, p_expected_revision, p_status, p_answers);
end;
$$;
revoke all on function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb) to service_role;

-- Delayed purge must not allow Auth to issue/refresh sessions or replace a
-- password after expiry, even via direct provider APIs outside the app routes.
create function private.guard_expired_account_auth()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if tg_table_name = 'users' then
    if new.encrypted_password is not distinct from old.encrypted_password then return new; end if;
    v_user := new.id;
  else v_user := new.user_id;
  end if;
  perform 1 from auth.users where id = v_user for share;
  if exists (select 1 from private.account_deletion_jobs
    where user_id = v_user and deadline <= clock_timestamp()) then
    raise exception 'Account recovery unavailable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_expired_account_auth() from public, anon, authenticated, service_role;
create trigger account_deletion_guard_sessions before insert or update on auth.sessions
  for each row execute function private.guard_expired_account_auth();
create trigger account_deletion_guard_password before update of encrypted_password on auth.users
  for each row execute function private.guard_expired_account_auth();

-- Recovery grants also recheck at issue and consume. Pre-expiry recovery can
-- replace a password, but never restores ordinary access or cancels deletion.
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
  insert into public.auth_recovery_grants(grant_hash,user_id,flow_binding,created_at,expires_at)
    values(p_hash,p_user_id,p_binding,v_now,v_now + interval '10 minutes')
    on conflict (user_id) do update set grant_hash = excluded.grant_hash,
      flow_binding = excluded.flow_binding, created_at = excluded.created_at, expires_at = excluded.expires_at;
end;
$$;

create or replace function public.consume_recovery_grant(p_hash text, p_binding text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_expires timestamptz;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or (p_binding is not null and p_binding !~ '^[a-f0-9]{64}$')
    then raise exception 'Invalid recovery grant' using errcode = '22023'; end if;
  -- Account then grant is the same lock order used by scheduling and purging.
  select user_id into v_user from public.auth_recovery_grants where grant_hash = p_hash;
  if v_user is null then return null; end if;
  perform 1 from auth.users where id = v_user for share;
  delete from public.auth_recovery_grants
    where grant_hash = p_hash and (p_binding is null or flow_binding = p_binding)
    returning user_id, expires_at into v_user, v_expires;
  if p_binding is not null and v_expires > clock_timestamp() and not exists (
    select 1 from private.account_deletion_jobs where user_id = v_user and deadline <= clock_timestamp()
  ) then return v_user; end if;
  return null;
end;
$$;
