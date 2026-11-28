-- Student deletion requests are private capabilities, never client-owned profile fields.
create table private.account_deletion_jobs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  requested_at timestamptz not null,
  deadline timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  retry_at timestamptz not null,
  last_error_code text check (last_error_code ~ '^[A-Z0-9]{5}$'),
  escalated_at timestamptz,
  check (deadline = requested_at + interval '720 hours')
);
create index account_deletion_due on private.account_deletion_jobs(deadline, retry_at);
alter table private.account_deletion_jobs enable row level security;
revoke all on private.account_deletion_jobs from public, anon, authenticated, service_role;

-- Former operators with governed history require a separate operator procedure too.
create function private.is_governed_account(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = p_user_id and role = 'operator')
    or exists (select 1 from public.managed_content_items where created_by = p_user_id)
    or exists (select 1 from public.managed_content_revisions where authored_by = p_user_id)
    or exists (select 1 from public.managed_content_reviews where reviewed_by = p_user_id)
    or exists (select 1 from public.managed_content_publications where acted_by = p_user_id)
    or exists (select 1 from private.managed_content_create_intents where actor_id = p_user_id)
    or exists (select 1 from public.question_reports where reviewed_by = p_user_id);
$$;

create function private.has_live_auth_session()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_session text := auth.jwt()->>'session_id';
begin
  if auth.uid() is null or v_session is null or
    v_session !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then return false; end if;
  return exists (select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = v_session::uuid and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > clock_timestamp())
      and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= clock_timestamp()));
end;
$$;

-- Used only for the mandatory decision page, login routing and live identity checks.
-- Reading this state NEVER cancels a request. The deadline is database time.
create function public.read_account_lifecycle()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job private.account_deletion_jobs%rowtype; v_role text;
begin
  if not private.has_live_auth_session() then
    return jsonb_build_object('status', 'signed-out');
  end if;
  select * into v_job from private.account_deletion_jobs where user_id = auth.uid();
  if found then
    return jsonb_build_object('status', case when v_job.deadline <= clock_timestamp()
      then 'expired' else 'scheduled' end, 'deadline', v_job.deadline, 'requestId', v_job.id);
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  return jsonb_build_object('status', 'active', 'deletionAllowed', coalesce(v_role = 'student', false));
end;
$$;

-- Server-only: both session identities must come from validated Auth responses.
-- The route verifies the CURRENT password using Auth before calling this RPC.
create function public.schedule_student_deletion(p_session_id uuid, p_verified_session_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_job private.account_deletion_jobs%rowtype; v_now timestamptz;
begin
  select user_id into v_user from auth.sessions where id = p_session_id;
  if v_user is null then raise exception 'Account session required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:' || v_user::text, 0));
  perform 1 from auth.users where id = v_user for update;
  perform 1 from public.profiles where id = v_user and role = 'student' for update;
  if not found or private.is_governed_account(v_user) then
    return jsonb_build_object('status', 'operator-excluded');
  end if;
  v_now := clock_timestamp();
  if p_session_id is not distinct from p_verified_session_id or not exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session_id and s.user_id = v_user
      and (s.not_after is null or s.not_after > v_now) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= v_now)
  ) or not exists (
    select 1 from auth.sessions where id = p_verified_session_id and user_id = v_user
      and created_at >= v_now - interval '5 minutes'
      and (not_after is null or not_after > v_now)
  ) then raise exception 'Password verification required' using errcode = '42501'; end if;

  select * into v_job from private.account_deletion_jobs where user_id = v_user for update;
  if found and v_job.deadline <= clock_timestamp() then
    return jsonb_build_object('status', 'expired');
  end if;
  -- A repeated request preserves the original deadline, including after a lost response.
  if v_job.user_id is null then
    v_now := clock_timestamp();
    insert into private.account_deletion_jobs(user_id, requested_at, deadline, retry_at)
    values (v_user, v_now, v_now + interval '720 hours', v_now + interval '720 hours')
    returning * into v_job;
  end if;
  delete from public.auth_recovery_grants where user_id = v_user;
  delete from auth.refresh_tokens where user_id = v_user::text;
  delete from auth.sessions where user_id = v_user;
  return jsonb_build_object('status', 'scheduled', 'deadline', v_job.deadline, 'requestId', v_job.id);
end;
$$;

create function public.cancel_student_deletion(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_job private.account_deletion_jobs%rowtype;
begin
  if v_user is null then raise exception 'Account session required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('account-lifecycle:' || v_user::text, 0));
  perform 1 from auth.users where id = v_user for update;
  select * into v_job from private.account_deletion_jobs where user_id = v_user for update;
  -- Revalidate AFTER all waits; a stale JWT or an elapsed deadline cannot cancel.
  if not private.has_live_auth_session() then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  if v_job.user_id is null then return jsonb_build_object('status', 'active'); end if;
  if v_job.deadline <= clock_timestamp() then return jsonb_build_object('status', 'expired'); end if;
  if p_request_id is distinct from v_job.id then return jsonb_build_object('status', 'conflict'); end if;
  delete from private.account_deletion_jobs where user_id = v_user and id = p_request_id;
  return jsonb_build_object('status', 'active');
end;
$$;

revoke all on function private.is_governed_account(uuid) from public, anon, authenticated, service_role;
revoke all on function private.has_live_auth_session() from public, anon, authenticated, service_role;
revoke all on function public.read_account_lifecycle() from public, anon, authenticated, service_role;
revoke all on function public.schedule_student_deletion(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_student_deletion(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_account_lifecycle() to authenticated;
grant execute on function public.schedule_student_deletion(uuid,uuid) to service_role;
grant execute on function public.cancel_student_deletion(uuid) to authenticated;

comment on table private.account_deletion_jobs is
  'Pending student deletion only. Cancellation or successful purge removes the row; no retained user/job receipt or report evidence. Never exposed to API table roles.';
