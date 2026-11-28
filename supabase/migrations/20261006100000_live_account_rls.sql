-- supabase/migrations/20261006100000_live_account_rls.sql
-- Require a live Auth session as well as ownership for account data.
-- auth.uid() alone survives revocation until the signed access JWT expires.

create function private.has_live_account_session()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id text := auth.jwt()->>'session_id';
begin
  -- Guard the cast separately: malformed/missing claims must return false,
  -- rather than depend on boolean-expression evaluation order or leak errors.
  if v_user_id is null or v_session_id is null or
     v_session_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return exists (
    select 1 from auth.sessions s
    where s.id = v_session_id::uuid and s.user_id = v_user_id
      and (s.not_after is null or s.not_after > pg_catalog.statement_timestamp())
  );
end;
$$;

-- Policies bind this function by OID when created. EXECUTE is required during
-- evaluation; private schema USAGE stays revoked, so callers cannot resolve it
-- by name. The private schema is also outside the exposed PostgREST schemas.
-- No Auth table/schema privileges are granted to the browser-facing roles.
revoke all on function private.has_live_account_session() from public, anon, authenticated, service_role;
grant execute on function private.has_live_account_session() to authenticated;
comment on function private.has_live_account_session() is
  'RLS-only boolean check of the JWT actor and session against live auth.sessions, including not_after. Takes no client identity arguments.';

alter policy "Profiles are selectable by their owner" on public.profiles
  using ((select auth.uid()) = id and (select private.has_live_account_session()));

alter policy "Profiles are updatable by their owner with active selection" on public.profiles
  using ((select auth.uid()) = id and (select private.has_live_account_session()))
  with check (
    (select auth.uid()) = id
    and (select private.has_live_account_session())
    and department_id is not null
    and academic_level_id is not null
    and academic_period_id is not null
    and exists (
      select 1 from public.departments
      where departments.id = profiles.department_id and departments.is_active
    )
    and exists (
      select 1 from public.academic_levels
      where academic_levels.id = profiles.academic_level_id and academic_levels.is_active
    )
    and exists (
      select 1 from public.academic_periods
      where academic_periods.id = profiles.academic_period_id and academic_periods.is_active
    )
  );

alter policy "Students read their own bookmarks" on public.student_bookmarks
  using ((select auth.uid()) = user_id and (select private.has_live_account_session()));
alter policy "Students add their own bookmarks" on public.student_bookmarks
  with check ((select auth.uid()) = user_id and (select private.has_live_account_session()));
alter policy "Students remove their own bookmarks" on public.student_bookmarks
  using ((select auth.uid()) = user_id and (select private.has_live_account_session()));

alter policy "Quiz attempts are selectable by their owner" on public.quiz_attempts
  using ((select auth.uid()) = user_id and (select private.has_live_account_session()));
alter policy "Quiz answers are selectable by their attempt owner" on public.quiz_attempt_answers
  using ((select private.has_live_account_session()) and exists (
    select 1 from public.quiz_attempts
    where quiz_attempts.id = quiz_attempt_answers.attempt_id
      and quiz_attempts.user_id = (select auth.uid())
  ));
alter policy "Attempt questions are selectable by their attempt owner" on public.quiz_attempt_questions
  using ((select private.has_live_account_session()) and exists (
    select 1 from public.quiz_attempts a
    where a.id = quiz_attempt_questions.attempt_id and a.user_id = (select auth.uid())
  ));

-- This SECURITY DEFINER RPC bypasses bookmark RLS. Derive its actor through the
-- existing live-account boundary before reading or creating an import receipt.
create or replace function public.reconcile_student_bookmarks(
  p_reconciliation_id uuid, p_course_ids uuid[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := private.require_live_account();
  v_course_ids uuid[];
  v_existing_ids uuid[];
  v_applied boolean;
begin
  if v_user_id is null or p_reconciliation_id is null or p_course_ids is null
      or cardinality(p_course_ids) > 32 or array_position(p_course_ids, null) is not null then
    raise exception 'Invalid bookmark reconciliation' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct input.course_id order by input.course_id), '{}'::uuid[])
    into v_course_ids from unnest(p_course_ids) as input(course_id);

  insert into public.student_bookmark_reconciliations
    (user_id, reconciliation_id, course_ids)
  values (v_user_id, p_reconciliation_id, v_course_ids)
  on conflict do nothing
  returning true into v_applied;

  if v_applied then
    insert into public.student_bookmarks (user_id, course_id)
    select v_user_id, input.course_id from unnest(v_course_ids) as input(course_id)
    on conflict do nothing;
    return true;
  end if;

  select course_ids into v_existing_ids
    from public.student_bookmark_reconciliations
    where user_id = v_user_id and reconciliation_id = p_reconciliation_id;
  if v_existing_ids is distinct from v_course_ids then
    raise exception 'Bookmark reconciliation payload changed' using errcode = '22023';
  end if;
  return false;
end;
$$;

revoke all on function public.reconcile_student_bookmarks(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reconcile_student_bookmarks(uuid, uuid[]) to authenticated;
