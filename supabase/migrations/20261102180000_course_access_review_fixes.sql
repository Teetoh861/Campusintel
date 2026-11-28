-- RLS SELECTs also run in PostgREST read-only transactions. Serialize against account/calendar
-- writers with read-only-safe advisory locks, then project pending bindings without persisting them.
-- No Auth/profile row lock, enrollment, binding, audit INSERT or lock upgrade belongs in this path.
create function private.lock_course_access_select(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('entitlement-account:' || p_user::text, 0));
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
end;
$$;

create function private.course_access_select_allowed(p_user uuid, p_course uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(d.allowed or (d.reason = 'needs-plan' and exists (
    select 1 from public.entitlement_grants g
    left join private.pending_course_grant_bindings(p_user, p_at) b on b.grant_id = g.id
    join private.academic_term_ends(coalesce(b.department_id, g.course_department_id)) e
      on e.term_id = coalesce(b.term_id, g.course_term_id)
    where g.user_id = p_user and coalesce(b.term_id, g.course_term_id) = d.term_id
      and coalesce(b.department_id, g.course_department_id) =
        (select p.department_id from public.profiles p where p.id = p_user)
      and (g.source <> 'trial' or g.trial_policy = 'seven-day') and g.revoked_at is null
      and g.starts_at <= p_at and least(g.ends_at, e.ends_at) > p_at
  )), false) from private.course_access_decision(p_user, p_course, p_at) d;
$$;

create or replace function private.can_read_attempt_answers(p_attempt uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); sid uuid; a public.quiz_attempts; v_now timestamptz;
begin
  if u is null or not private.has_live_account_session() then return false; end if;
  sid := (auth.jwt()->>'session_id')::uuid;
  perform private.lock_course_access_select(u);
  v_now := clock_timestamp();
  select * into a from public.quiz_attempts where id = p_attempt and user_id = u;
  return private.course_session_user(sid) = u and a.id is not null and a.status <> 'in_progress'
    and private.course_access_select_allowed(u,
      (select id from public.institutional_courses where repository_course_id = a.course_id), v_now);
end;
$$;

create or replace function private.can_read_ai_course(p_course uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid(); sid uuid; v_now timestamptz;
begin
  if u is null or not private.has_live_account_session() then return false; end if;
  sid := (auth.jwt()->>'session_id')::uuid;
  perform private.lock_course_access_select(u);
  v_now := clock_timestamp();
  return private.course_session_user(sid) = u
    and (private.course_on_current_list(u, p_course, v_now) or exists (
      select 1 from private.course_access_decision(u, p_course, v_now) d
      where d.team_added and private.course_access_select_allowed(u, p_course, v_now)))
    and exists (select 1 from private.effective_ai_window(u, array['trial','early_access','test']) w
      where w.starts_at <= v_now and w.ends_at > v_now);
end;
$$;

-- The score-only screen needs the server's reason, including on a restored review after a scope change.
create function private.attempt_review_unavailable_reason(p_attempt public.quiz_attempts) returns text
language sql stable security definer set search_path = '' as $$
  select case when not private.has_full_access(p_attempt.user_id) then 'needs-plan'
    when d.reason = 'needs-selection' then 'needs-selection'
    when d.reason = 'outside-list' then 'outside-list'
    else 'needs-plan' end
  from private.course_access_decision(p_attempt.user_id,
    (select id from public.institutional_courses where repository_course_id = p_attempt.course_id),
    clock_timestamp()) d;
$$;

create or replace function private.practice_view(p_attempt public.quiz_attempts) returns jsonb
language sql stable security definer set search_path = '' as $$
  with permission as materialized (select private.attempt_material_allowed(p_attempt) as allowed)
  select jsonb_build_object('id', p_attempt.id, 'course_id', p_attempt.course_id, 'mode', p_attempt.mode,
    'topic', p_attempt.topic, 'intent', p_attempt.intent, 'redo_of', p_attempt.redo_of, 'status', p_attempt.status,
    'started_at', p_attempt.deadline_at - make_interval(secs => p_attempt.duration_seconds),
    'deadline_at', p_attempt.deadline_at, 'duration_seconds', p_attempt.duration_seconds,
    'question_count', p_attempt.question_count, 'bank_size', p_attempt.bank_size,
    'questions', case when not allowed and (p_attempt.status <> 'in_progress' or not private.attempt_resume_allowed(p_attempt))
      then '[]'::jsonb when p_attempt.mode = 'instant' then private.practice_instant_questions(p_attempt.id)
      else private.practice_questions(p_attempt.id, p_attempt.status <> 'in_progress') end,
    'saved', case when p_attempt.status = 'in_progress' then jsonb_build_object('revision', p_attempt.saved_revision,
      'answers', coalesce(p_attempt.saved_answers, '{}'::jsonb)) end,
    'result', case when p_attempt.status <> 'in_progress' then jsonb_build_object('score', p_attempt.score,
      'total', p_attempt.question_count, 'timed_out', p_attempt.status = 'timed_out', 'finished_at', p_attempt.finished_at) end)
    || case when p_attempt.status <> 'in_progress' then jsonb_build_object('review_available', allowed, 'can_start_new', allowed)
      || case when not allowed then jsonb_build_object('review_unavailable_reason',
        private.attempt_review_unavailable_reason(p_attempt)) else '{}'::jsonb end else '{}'::jsonb end
  from permission;
$$;

revoke all on function private.lock_course_access_select(uuid),
  private.course_access_select_allowed(uuid, uuid, timestamptz),
  private.attempt_review_unavailable_reason(public.quiz_attempts) from public, anon, authenticated, service_role;
