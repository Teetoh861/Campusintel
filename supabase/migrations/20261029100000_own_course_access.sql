-- Part 1: full plans cover one semester and only the student's confirmed list plus audited team additions.
-- Discovery, AI and existing attempt/review permissions are intentionally unchanged (part 2).
-- Lock order: policy when required; auth account; entitlement-account; profile; shared calendar; feature; resources.
-- A direct profile UPDATE already owns its profile row: its trigger never takes an account advisory/feature lock.

alter table public.entitlement_grants
  add column course_term_id uuid references private.academic_terms(id) on delete restrict,
  add column course_department_id uuid references public.departments(id) on delete restrict;
comment on column public.entitlement_grants.course_term_id is
  'Database-owned full-plan semester. Never moved to another semester by renewal, restore or profile re-selection.';

create function private.access_term_at(p_department uuid, p_at timestamptz)
returns table (term_id uuid, academic_period_id uuid, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select t.id, t.academic_period_id, e.ends_at
  from private.academic_term_ends(p_department) e join private.academic_terms t on t.id = e.term_id
  where e.ends_at > p_at order by e.ends_at, t.id limit 1;
$$;

create function private.current_course_scope(p_user uuid, p_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles; t record; v_previous timestamptz;
begin
  select * into p from public.profiles where id = p_user;
  if p.id is null or p.department_id is null or p.academic_level_id is null
      or p.academic_period_id is null or p.selection_confirmed_at is null then
    return jsonb_build_object('state', 'needs-selection');
  end if;
  select * into t from private.access_term_at(p.department_id, p_at);
  if t.term_id is null then return jsonb_build_object('state', 'missing-calendar'); end if;
  select max(ends_at) into v_previous from private.academic_term_ends(p.department_id) where ends_at <= p_at;
  if p.selection_confirmed_at > p_at or p.selection_confirmed_at < v_previous
      or p.academic_period_id <> t.academic_period_id then
    return jsonb_build_object('state', 'needs-selection');
  end if;
  return jsonb_build_object('state', 'ready', 'term_id', t.term_id, 'department_id', p.department_id,
    'ends_at', t.ends_at);
end;
$$;

create function private.lock_course_access_scope(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id = p_user for share;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || p_user::text, 0));
  perform 1 from public.profiles where id = p_user for share;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
end;
$$;

-- Recheck the wall clock after queued scope/feature locks; require_live_account's RLS check uses a statement snapshot.
create function private.require_course_access_account() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := private.require_live_account();
begin
  if private.ai_practice_session_user((auth.jwt()->>'session_id')::uuid) is distinct from v_user then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

-- Binding uses issuance/start time, never the time of a later read or restore. A missing calendar stays pending;
-- its eventual resolution still uses the original anchor, so it cannot roll a grant into the next semester.
create function private.bind_full_course_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_department uuid;
begin
  if new.source = 'trial' and new.trial_policy = 'discovery' then return new; end if;
  perform private.lock_course_access_scope(new.user_id);
  select department_id into v_department from public.profiles where id = new.user_id;
  new.course_department_id := v_department;
  new.course_term_id := null;
  if v_department is not null then
    select term_id into new.course_term_id
      from private.access_term_at(v_department, greatest(new.created_at, new.starts_at));
  end if;
  perform private.log_entitlement_event(new.user_id, new.id, 'course.grant-bound', 'system:grant',
    jsonb_build_object('term_id', new.course_term_id, 'department_id', v_department));
  return new;
end;
$$;
create trigger entitlement_grants_bind_course before insert on public.entitlement_grants
  for each row execute function private.bind_full_course_grant();

create function private.bind_pending_course_grants(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; g record; v_term uuid; v_current uuid;
begin
  select * into p from public.profiles where id = p_user;
  select term_id into v_current from private.access_term_at(p.department_id, clock_timestamp());
  for g in select * from public.entitlement_grants where user_id = p_user
      and (source <> 'trial' or trial_policy = 'seven-day') order by id for update loop
    v_term := g.course_term_id;
    if v_term is null and p.department_id is not null then
      select term_id into v_term from private.access_term_at(p.department_id, greatest(g.created_at, g.starts_at));
    end if;
    if v_term is distinct from g.course_term_id or (v_term = v_current
        and p.department_id is distinct from g.course_department_id) then
      update public.entitlement_grants set course_term_id = v_term,
        course_department_id = case when v_term = v_current then p.department_id else g.course_department_id end
        where id = g.id;
      perform private.log_entitlement_event(p_user, g.id, 'course.grant-bound', 'system:selection',
        jsonb_build_object('term_id', v_term, 'from_department_id', g.course_department_id,
          'department_id', p.department_id));
    end if;
  end loop;
end;
$$;

create function private.bind_profile_course_scope() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- No advisory account lock here: a direct UPDATE owns the profile already.
  perform 1 from auth.users where id = new.id for share;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  perform private.bind_pending_course_grants(new.id);
  return null;
end;
$$;
create trigger profiles_bind_course_scope after update of department_id, academic_level_id,
  academic_period_id, selection_confirmed_at on public.profiles for each row
  execute function private.bind_profile_course_scope();

-- Existing records keep all dates/allowances/history. An old grant binds using its own original issuance window.
do $$ declare u uuid;
begin
  for u in select distinct user_id from public.entitlement_grants order by user_id loop
    perform private.lock_course_access_scope(u);
    perform private.bind_pending_course_grants(u);
  end loop;
end $$;

create table private.student_course_additions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institutional_course_id uuid not null references public.institutional_courses(id) on delete restrict,
  term_id uuid not null references private.academic_terms(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_at timestamptz not null default clock_timestamp(),
  actor text not null check (char_length(btrim(actor)) between 1 and 120),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  revision bigint not null default 1 check (revision > 0),
  idempotency_key uuid not null unique,
  constraint course_additions_revocation check ((revoked_at is null) = (revoked_by is null)
    and (revoked_at is null) = (revoke_reason is null)),
  constraint course_additions_revoke_actor check (revoked_by is null or char_length(btrim(revoked_by)) between 1 and 120),
  constraint course_additions_revoke_reason check (revoke_reason is null or char_length(btrim(revoke_reason)) between 1 and 500)
);
create unique index course_additions_one_active on private.student_course_additions(user_id, institutional_course_id, term_id)
  where revoked_at is null;
create index course_additions_user_term on private.student_course_additions(user_id, term_id);
alter table private.student_course_additions enable row level security;
revoke all on table private.student_course_additions from public, anon, authenticated, service_role;

-- The single explicit-time decision, using institutional identity even when no content has been built.
create function private.course_access_decision(p_user uuid, p_institutional uuid, p_at timestamptz)
returns table (allowed boolean, reason text, on_list boolean, team_added boolean, term_id uuid, ends_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare s jsonb; v_full_end timestamptz; v_add_end timestamptz; v_scope_term uuid;
begin
  allowed := false; on_list := false; team_added := false; reason := 'outside-list';
  if p_user is null or p_at is null then reason := 'unavailable'; return next; return; end if;
  if exists (select 1 from public.institutional_courses c where c.id = p_institutional and c.is_free) then
    allowed := true; reason := 'free'; return next; return;
  end if;
  if exists (select 1 from public.profiles p where p.id = p_user and p.role = 'operator') then
    allowed := true; reason := 'operator'; return next; return;
  end if;
  s := private.current_course_scope(p_user, p_at);
  if s->>'state' <> 'ready' then reason := s->>'state'; return next; return; end if;
  term_id := (s->>'term_id')::uuid; v_scope_term := term_id;
  select exists (select 1 from public.profiles p join public.course_applicability a
    on a.department_id = p.department_id and a.academic_level_id = p.academic_level_id
      and a.academic_period_id = p.academic_period_id
    where p.id = p_user and a.institutional_course_id = p_institutional) into on_list;
  select max(least(a.ends_at, e.ends_at)) into v_add_end from private.student_course_additions a
    join private.academic_term_ends((s->>'department_id')::uuid) e on e.term_id = a.term_id
    where a.user_id = p_user and a.institutional_course_id = p_institutional and a.term_id = v_scope_term
      and a.revoked_at is null and a.starts_at <= p_at and least(a.ends_at, e.ends_at) > p_at;
  team_added := v_add_end is not null;
  if not on_list and not team_added then return next; return; end if;
  select max(least(g.ends_at, e.ends_at)) into v_full_end from public.entitlement_grants g
    join private.academic_term_ends(g.course_department_id) e on e.term_id = g.course_term_id
    where g.user_id = p_user and g.course_term_id = v_scope_term and g.course_department_id is not null
      and (g.source <> 'trial' or g.trial_policy = 'seven-day') and g.revoked_at is null
      and g.starts_at <= p_at and least(g.ends_at, e.ends_at) > p_at;
  if v_full_end is null then reason := 'needs-plan'; return next; return; end if;
  allowed := true; reason := case when on_list then 'own-list' else 'team-added' end;
  ends_at := case when on_list then v_full_end else least(v_full_end, v_add_end) end;
  return next;
end;
$$;

create or replace function private.can_read_course_content(p_user_id uuid, p_course_id uuid) returns boolean
language sql volatile security definer set search_path = '' as $$
  select coalesce(d.allowed, false) from private.course_access_decision(p_user_id,
    (select id from public.institutional_courses where repository_course_id = p_course_id), clock_timestamp()) d;
$$;
create or replace function private.practice_can_start(p_user_id uuid, p_course_id uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(d.allowed, false) from private.course_access_decision(p_user_id,
    (select id from public.institutional_courses where repository_course_id = p_course_id), p_at) d;
$$;

create function public.get_my_course_access(p_institutional_course_ids uuid[])
returns table (institutional_course_id uuid, allowed boolean, reason text, on_list boolean,
  team_added boolean, ends_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_now timestamptz;
begin
  if v_user is null or not private.has_live_account_session() then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  if p_institutional_course_ids is null or cardinality(p_institutional_course_ids) not between 1 and 200
      or array_position(p_institutional_course_ids, null) is not null then
    raise exception 'Course identities required' using errcode = '22023';
  end if;
  -- Preserve automatic Early Access enrollment; its policy/account prefix precedes profile/calendar/feature locks.
  if private.early_access_status(v_user)->>'status' = 'eligible' then
    perform private.reconcile_early_access(v_user, 'system:course-read');
  end if;
  perform private.lock_course_access_scope(v_user);
  perform private.bind_pending_course_grants(v_user);
  v_user := private.require_course_access_account();
  v_now := clock_timestamp();
  return query select c.id, d.allowed, d.reason, d.on_list, d.team_added, d.ends_at
    from (select distinct unnest(p_institutional_course_ids) as id) c
    cross join lateral private.course_access_decision(v_user, c.id, v_now) d order by c.id;
end;
$$;

create function public.admin_add_student_course(p_user_id uuid, p_institutional_course_id uuid, p_term_id uuid,
  p_expected_profile_revision bigint, p_idempotency_key uuid, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.profiles; a private.student_course_additions; s jsonb; v_now timestamptz;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_user_id is null or p_institutional_course_id is null or p_term_id is null
      or p_expected_profile_revision is null or p_idempotency_key is null then
    raise exception 'Student, course, term, revision and request key required' using errcode = '22023';
  end if;
  perform private.lock_course_access_scope(p_user_id);
  if not exists (select 1 from auth.users where id = p_user_id) then return jsonb_build_object('state', 'not-found'); end if;
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    return jsonb_build_object('state', 'account-restricted');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('course-addition:' || p_idempotency_key::text, 0));
  select * into a from private.student_course_additions where idempotency_key = p_idempotency_key;
  if found then
    if (a.user_id, a.institutional_course_id, a.term_id, a.actor, a.reason)
      is distinct from (p_user_id, p_institutional_course_id, p_term_id, p_actor, p_reason) then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return jsonb_build_object('state', 'existing', 'id', a.id, 'revision', a.revision, 'ends_at', a.ends_at);
  end if;
  select * into p from public.profiles where id = p_user_id;
  if p.revision is distinct from p_expected_profile_revision then return jsonb_build_object('state', 'conflict'); end if;
  v_now := clock_timestamp(); s := private.current_course_scope(p_user_id, v_now);
  if s->>'state' <> 'ready' or (s->>'term_id')::uuid is distinct from p_term_id then
    return jsonb_build_object('state', 'invalid-term');
  end if;
  if not exists (select 1 from public.institutional_courses where id = p_institutional_course_id) then
    return jsonb_build_object('state', 'invalid-course');
  end if;
  if exists (select 1 from public.institutional_courses where id = p_institutional_course_id and is_free)
      or exists (select 1 from public.course_applicability where institutional_course_id = p_institutional_course_id
        and department_id = p.department_id and academic_level_id = p.academic_level_id
        and academic_period_id = p.academic_period_id) then return jsonb_build_object('state', 'already-included'); end if;
  if exists (select 1 from private.student_course_additions where user_id = p_user_id
      and institutional_course_id = p_institutional_course_id and term_id = p_term_id and revoked_at is null) then
    return jsonb_build_object('state', 'already-added');
  end if;
  insert into private.student_course_additions(user_id, institutional_course_id, term_id, department_id,
    starts_at, ends_at, actor, reason, idempotency_key)
    values(p_user_id, p_institutional_course_id, p_term_id, p.department_id, v_now, (s->>'ends_at')::timestamptz,
      p_actor, p_reason, p_idempotency_key) returning * into a;
  perform private.log_course_selection_event(p_user_id, p_term_id, p.department_id, 'operator.course-added',
    'operator:' || p_actor, jsonb_build_object('id', a.id, 'course_id', p_institutional_course_id,
      'reason', p_reason, 'ends_at', a.ends_at, 'idempotency_key', p_idempotency_key));
  return jsonb_build_object('state', 'added', 'id', a.id, 'revision', a.revision, 'ends_at', a.ends_at);
end;
$$;

create function public.admin_student_course_status(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('selection', private.current_course_scope(p_user_id, clock_timestamp()),
    'additions', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at, a.id)
      from private.student_course_additions a where a.user_id = p_user_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from private.course_selection_events e
      where e.user_id = p_user_id and e.event in ('operator.course-added', 'operator.course-revoked')), '[]'::jsonb));
$$;

create function public.admin_revoke_student_course(p_user_id uuid, p_addition_id uuid, p_expected_revision bigint,
  p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a private.student_course_additions;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_user_id is null or p_addition_id is null or p_expected_revision is null then
    raise exception 'Student, addition and revision required' using errcode = '22023';
  end if;
  perform private.lock_course_access_scope(p_user_id);
  select * into a from private.student_course_additions where id = p_addition_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if a.revoked_at is not null then return jsonb_build_object('state', 'already-revoked', 'revision', a.revision); end if;
  if a.revision <> p_expected_revision then return jsonb_build_object('state', 'conflict'); end if;
  update private.student_course_additions set revoked_at = clock_timestamp(), revoked_by = p_actor,
    revoke_reason = p_reason, revision = revision + 1 where id = a.id returning * into a;
  perform private.log_course_selection_event(p_user_id, a.term_id, a.department_id, 'operator.course-revoked',
    'operator:' || p_actor, jsonb_build_object('id', a.id, 'course_id', a.institutional_course_id,
      'reason', p_reason, 'revision', a.revision));
  return jsonb_build_object('state', 'revoked', 'id', a.id, 'revision', a.revision);
end;
$$;

revoke all on function private.access_term_at(uuid, timestamptz), private.current_course_scope(uuid, timestamptz),
  private.lock_course_access_scope(uuid), private.require_course_access_account(),
  private.bind_full_course_grant(), private.bind_pending_course_grants(uuid),
  private.bind_profile_course_scope(), private.course_access_decision(uuid, uuid, timestamptz),
  public.get_my_course_access(uuid[]), public.admin_add_student_course(uuid, uuid, uuid, bigint, uuid, text, text),
  public.admin_student_course_status(uuid), public.admin_revoke_student_course(uuid, uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_course_access(uuid[]) to authenticated;
grant execute on function public.admin_add_student_course(uuid, uuid, uuid, bigint, uuid, text, text),
  public.admin_student_course_status(uuid), public.admin_revoke_student_course(uuid, uuid, bigint, text, text)
  to service_role;


create or replace function private.course_selection_state_for(p_user_id uuid, p_department_id uuid, p_confirmed_at timestamptz,
  p_at timestamptz) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope_start timestamptz;
  v_next record;
  v_grant record;
begin
  if p_department_id is null then return jsonb_build_object('state', 'incomplete'); end if;
  select max(ends_at) into v_scope_start from private.academic_term_ends(p_department_id) where ends_at <= p_at;
  select * into v_next from private.academic_term_ends(p_department_id) where ends_at > p_at order by ends_at limit 1;
  if v_scope_start is not null and p_confirmed_at < v_scope_start then
    return jsonb_build_object('state', 'reselect', 'term_id', v_next.term_id, 'last_day', v_next.last_day,
      'ends_at', v_next.ends_at);
  end if;
  select id, source, trial_policy into v_grant from public.entitlement_grants
    where user_id = p_user_id and revoked_at is null and starts_at <= p_at and ends_at > p_confirmed_at
      and ((source = 'trial' and trial_policy = 'discovery') or v_next.term_id is null or course_term_id = v_next.term_id)
    order by (ends_at > p_at) desc, ends_at desc, id
    limit 1;
  if v_grant.id is null then
    return jsonb_build_object('state', 'open', 'term_id', v_next.term_id, 'last_day', v_next.last_day,
      'ends_at', v_next.ends_at);
  end if;
  return jsonb_build_object('state', 'locked', 'term_id', v_next.term_id, 'last_day', v_next.last_day,
    'ends_at', v_next.ends_at, 'grant_id', v_grant.id,
    'reason', case when v_grant.source = 'trial' and v_grant.trial_policy = 'discovery' then 'discovery-pass'
      when v_grant.source = 'early_access' then 'early-access' else v_grant.source end);
end;
$$;

create or replace function public.admin_change_course_selection(p_user_id uuid, p_department_key text, p_level_key text,
  p_period_key text, p_expected_revision bigint, p_allow_empty boolean, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_department uuid;
  v_level uuid;
  v_period uuid;
  v_profile public.profiles;
  v_before jsonb;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_user_id is null or p_expected_revision is null then
    raise exception 'A student and the revision shown by selection-status are required' using errcode = '22023';
  end if;
  select id into v_department from public.departments where key = p_department_key and is_active;
  select id into v_level from public.academic_levels where key = p_level_key and is_active;
  select id into v_period from public.academic_periods where key = p_period_key and is_active;
  if v_department is null or v_level is null or v_period is null then
    raise exception 'Unknown or inactive department, level or semester' using errcode = '22023';
  end if;

  perform 1 from auth.users where id = p_user_id for share;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    return jsonb_build_object('state', 'account-restricted');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || p_user_id::text, 0));
  select * into v_profile from public.profiles where id = p_user_id for update;
  if v_profile.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if v_profile.revision <> p_expected_revision then
    return jsonb_build_object('state', 'conflict', 'revision', v_profile.revision);
  end if;
  if (v_profile.department_id, v_profile.academic_level_id, v_profile.academic_period_id)
      is not distinct from (v_department, v_level, v_period) then
    return jsonb_build_object('state', 'unchanged', 'revision', v_profile.revision);
  end if;
  if not coalesce(p_allow_empty, false) and not exists (select 1 from public.course_applicability
      where department_id = v_department and academic_level_id = v_level and academic_period_id = v_period) then
    return jsonb_build_object('state', 'empty-selection');
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  v_before := private.course_selection_state(p_user_id);
  if v_before->>'state' = 'locked' and exists (
      select 1 from public.entitlement_grants g join private.academic_terms t on t.id = g.course_term_id
      where g.user_id = p_user_id and g.course_term_id = (v_before->>'term_id')::uuid
        and (g.source <> 'trial' or g.trial_policy = 'seven-day') and g.revoked_at is null
        and g.starts_at <= clock_timestamp() and g.ends_at > v_profile.selection_confirmed_at
        and t.academic_period_id <> v_period) then
    raise exception 'Course correction would transfer this plan to another semester' using errcode = 'CI423';
  end if;
  perform private.log_course_selection_event(p_user_id, null, v_department, 'operator.selection-changed',
    'operator:' || p_actor, jsonb_build_object('reason', p_reason, 'state_before', v_before->>'state',
      'allow_empty', coalesce(p_allow_empty, false),
      'from', jsonb_build_object('department_id', v_profile.department_id,
        'academic_level_id', v_profile.academic_level_id, 'academic_period_id', v_profile.academic_period_id),
      'to', jsonb_build_object('department_id', v_department, 'academic_level_id', v_level,
        'academic_period_id', v_period)));
  update public.profiles set department_id = v_department, academic_level_id = v_level, academic_period_id = v_period
    where id = p_user_id returning * into v_profile;
  return jsonb_build_object('state', 'changed', 'revision', v_profile.revision,
    'lock', private.course_selection_state(p_user_id));
end;
$$;

create or replace function private.reconcile_early_access(p_user_id uuid, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_policy private.entitlement_policy;
  v_grant public.entitlement_grants;
begin
  -- Lock-free answer for states a launch cannot change.
  v_status := private.early_access_status(p_user_id);
  if v_status->>'status' in ('not-listed', 'active', 'ended') then return v_status; end if;
  -- Waits for an in-flight launch activation, then sees its committed launch time.
  select * into strict v_policy from private.entitlement_policy for share;
  perform 1 from auth.users where id = p_user_id and email_confirmed_at is not null for share;
  if not found then return jsonb_build_object('status', 'not-listed'); end if;
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    return jsonb_build_object('status', 'account-restricted');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || p_user_id::text, 0));
  begin
    perform 1 from public.profiles where id = p_user_id for share nowait;
  exception when lock_not_available then
    return jsonb_build_object('status', 'deferred');
  end;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  -- Level 4 (shared): no member can change group from here on, so the root read below is final.
  perform pg_advisory_xact_lock_shared(hashtextextended('entitlement-early-access-regroup', 0));
  v_status := private.early_access_status(p_user_id);
  if v_status->>'status' <> 'eligible' then return v_status; end if;
  -- Level 5: the group, then decide again under it (a reconciliation or import may have just enrolled the group).
  perform pg_advisory_xact_lock(hashtextextended('entitlement-early-access:' || (v_status->>'root'), 0));
  v_status := private.early_access_status(p_user_id);
  if v_status->>'status' <> 'eligible' then return v_status; end if;

  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, reference, created_by)
    values (p_user_id, 'early_access', now(), now() + v_policy.early_access_duration, 'uncapped',
      jsonb_build_object('member_id', v_status->>'member_id'), p_actor)
    returning * into v_grant;
  update private.early_access_members set claimed_at = now(), claimed_by = p_user_id
    where id = (v_status->>'member_id')::uuid;
  perform private.log_entitlement_event(p_user_id, v_grant.id, 'early-access.granted', p_actor,
    jsonb_build_object('member_id', v_status->>'member_id', 'ends_at', v_grant.ends_at));
  return jsonb_build_object('status', 'granted', 'grant_id', v_grant.id, 'starts_at', v_grant.starts_at,
    'ends_at', v_grant.ends_at);
end;
$$;

create or replace function private.lock_early_access_accounts(p_email text) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_locked uuid[] := '{}';
begin
  for v_account in select id from auth.users where lower(btrim(email)) = p_email order by id for share loop
    perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_account::text, 0));
    v_locked := v_locked || v_account;
  end loop;
  for v_account in select unnest(v_locked) order by 1 loop
    perform 1 from public.profiles where id = v_account for share nowait;
  end loop;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  return v_locked;
end;
$$;

create or replace function private.lock_early_access_accounts(p_accounts uuid[]) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_locked uuid[] := '{}';
begin
  for v_account in select id from auth.users where id = any (p_accounts) order by id for share nowait loop
    perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_account::text, 0));
    v_locked := v_locked || v_account;
  end loop;
  for v_account in select unnest(v_locked) order by 1 loop
    perform 1 from public.profiles where id = v_account for share nowait;
  end loop;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  return v_locked;
end;
$$;

create or replace function private.reconcile_all_early_access(p_actor text, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid[];
  v_locked uuid[] := '{}';
  v_user uuid;
  v_granted integer := 0;
  v_remaining integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid sweep batch size' using errcode = '22023';
  end if;
  select coalesce(array_agg(account_id order by joined_at, added_at, member_id), '{}') into v_batch from (
    select * from private.early_access_sweep_candidates() order by joined_at, added_at, member_id limit p_limit) batch;
  -- Phase 1 (level 2): every account this batch will touch, in ascending id, before any group lock. An account row
  -- held by an in-flight confirmation is skipped: its own trigger enrolls it, and waiting could invert the order.
  for v_user in select unnest(v_batch) order by 1 loop
    perform 1 from auth.users where id = v_user for share skip locked;
    if found then
      perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user::text, 0));
      v_locked := v_locked || v_user;
    end if;
  end loop;
  for v_user in select unnest(v_locked) order by 1 loop
    begin
      perform 1 from public.profiles where id = v_user for share nowait;
    exception when lock_not_available then
      v_locked := array_remove(v_locked, v_user);
    end;
  end loop;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  -- Phase 2 (levels 4-6): reconcile in join order. Every account lock reconciliation asks for is already held, so a
  -- group lock is never followed by an account lock.
  foreach v_user in array v_batch loop
    if v_user = any (v_locked) and private.reconcile_early_access(v_user, p_actor)->>'status' = 'granted' then
      v_granted := v_granted + 1;
    end if;
  end loop;
  select count(*) into v_remaining from private.early_access_sweep_candidates();
  return jsonb_build_object('granted', v_granted, 'remaining', v_remaining,
    'deferred', cardinality(v_batch) - cardinality(v_locked));
end;
$$;

create or replace function public.admin_grant_access(p_user_id uuid, p_days integer, p_actor text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.entitlement_grants;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Invalid grant length' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for share;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  perform private.lock_course_access_scope(p_user_id);
  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, reference, created_by)
    values (p_user_id, 'manual', now(), now() + make_interval(days => p_days), 'none',
      jsonb_build_object('reason', p_reason), 'operator:' || p_actor)
    returning * into v_grant;
  perform private.log_entitlement_event(p_user_id, v_grant.id, 'operator.granted', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'days', p_days));
  return jsonb_build_object('state', 'granted', 'grant_id', v_grant.id, 'ends_at', v_grant.ends_at);
end;
$$;

create or replace function public.admin_change_grant(p_grant_id uuid, p_action text, p_ends_at timestamptz, p_ai_units integer,
  p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.entitlement_grants;
  v_member_email text;
  v_scope_user uuid;
  v_scope_source text;
  v_scope_policy text;
  v_accounts uuid[];
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_action is null or p_action not in ('extend', 'revoke', 'restore', 'set-ai-units') then
    raise exception 'Invalid grant change' using errcode = '22023';
  end if;
  select user_id, source, trial_policy into v_scope_user, v_scope_source, v_scope_policy
    from public.entitlement_grants where id = p_grant_id;
  if v_scope_source = 'early_access' then perform 1 from private.entitlement_policy for share; end if;
  if v_scope_source = 'early_access' and p_action = 'restore' then
    select m.email into v_member_email from private.early_access_members m join public.entitlement_grants g
      on g.reference->>'member_id' = m.id::text where g.id = p_grant_id;
    v_accounts := array(select id from auth.users where id = v_scope_user
      or lower(btrim(email)) = v_member_email order by id);
    begin
      perform private.lock_early_access_accounts(v_accounts);
    exception when lock_not_available then return jsonb_build_object('state', 'deferred'); end;
    if v_member_email is not null then perform private.lock_early_access_groups(array[v_member_email]); end if;
  elsif v_scope_user is not null and (v_scope_source <> 'trial' or v_scope_policy = 'seven-day') then
    perform private.lock_course_access_scope(v_scope_user);
  end if;
  select * into v_grant from public.entitlement_grants where id = p_grant_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if p_action = 'extend' then
    if p_ends_at is null or p_ends_at <= v_grant.starts_at or p_ends_at > now() + interval '366 days' then
      raise exception 'Invalid grant end' using errcode = '22023';
    end if;
    update public.entitlement_grants set ends_at = p_ends_at where id = p_grant_id;
  elsif p_action = 'revoke' then
    update public.entitlement_grants set revoked_at = now(), revoked_by = 'operator:' || p_actor,
      revoke_reason = p_reason where id = p_grant_id and revoked_at is null;
  elsif p_action = 'restore' then
    if v_grant.source = 'early_access' and v_grant.revoked_at is not null and exists (
        select 1 from public.entitlement_grants other
        join private.early_access_members other_member on other_member.id::text = other.reference->>'member_id'
        join private.early_access_members this_member on this_member.id::text = v_grant.reference->>'member_id'
        where other.source = 'early_access' and other.revoked_at is null and other.id <> v_grant.id
          and coalesce(other_member.duplicate_of, other_member.id) = coalesce(this_member.duplicate_of, this_member.id)) then
      -- The identity already has its Early Access month on another grant.
      return jsonb_build_object('state', 'duplicate-identity');
    end if;
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

create or replace function public.read_published_managed_content(p_course_id uuid)
returns table (
  item_id uuid, course_id uuid, kind text, question_id uuid, source_key text,
  parent_item_id uuid, revision integer, payload jsonb
)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  v_user := private.require_live_account();
  perform private.lock_course_access_scope(v_user);
  perform private.bind_pending_course_grants(v_user);
  v_user := private.require_course_access_account();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  if not private.can_read_course_content(v_user, p_course_id) then
    raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
  end if;
  return query
    select i.id, i.course_id, i.kind, i.question_id, i.source_key,
           i.parent_item_id, i.published_revision, r.payload
    from public.managed_content_items i
    join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course_id and i.published_revision is not null
      -- CBT questions reach a student only inside their own practice attempt.
      and i.kind <> 'cbt_question'
      and (i.parent_item_id is null or exists (
        select 1 from public.managed_content_items parent
        where parent.id = i.parent_item_id
          and parent.published_revision = i.published_parent_revision
      ))
    order by i.created_at, i.id;
end;
$$;

create or replace function public.published_cbt_summary(p_course_ids uuid[])
returns table (course_id uuid, bank_size integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_course uuid;
begin
  v_user := private.require_live_account();
  perform private.lock_course_access_scope(v_user);
  perform private.bind_pending_course_grants(v_user);
  v_user := private.require_course_access_account();
  if p_course_ids is null or cardinality(p_course_ids) not between 1 and 200
      or array_position(p_course_ids, null) is not null then
    raise exception using errcode = '22023', message = 'Course identities required';
  end if;
  foreach v_course in array p_course_ids loop
    if not private.can_read_course_content(v_user, v_course) then
      raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
    end if;
  end loop;
  return query
    select listed.id, (select count(*)::integer from private.practice_pool(listed.id))
    from (select distinct unnest(p_course_ids) as id) listed
    order by listed.id;
end;
$$;

create or replace function public.practice_start(p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_intent text,
  p_redo_of uuid, p_size integer, p_seconds integer, p_sections jsonb, p_expected_size integer,
  p_expected_seconds integer, p_expected_whole_bank boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_now timestamptz;
  v_attempt public.quiz_attempts;
  v_origin public.quiz_attempts;
  v_bank integer;
  v_size integer;
begin
  if p_attempt_id is null or p_course_id is null or p_intent is null or p_intent not in ('new', 'redo')
      or (p_intent = 'redo') <> (p_redo_of is not null)
      or p_size is null or p_size not between 1 and 100 or p_seconds is null or p_seconds not between 300 and 10800
      or p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 100
      or exists (select 1 from jsonb_array_elements(p_sections) s where jsonb_typeof(s) <> 'string')
      or p_expected_size is null or p_expected_seconds is null or p_expected_whole_bank is null then
    raise exception 'Invalid practice start' using errcode = '22023';
  end if;
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform private.lock_course_access_scope(v_user);
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;


  -- A replayed start (lost response) returns what that start created, whatever has happened to it since.
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id;
  if v_attempt.id is not null then
    if v_attempt.user_id <> v_user or v_attempt.course_id <> p_course_id or v_attempt.deadline_at is null
        or v_attempt.intent <> p_intent or v_attempt.redo_of is distinct from p_redo_of then
      return jsonb_build_object('state', 'conflict');
    end if;
    return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
  end if;
  select * into v_attempt from public.quiz_attempts where user_id = v_user and course_id = p_course_id
    and status = 'in_progress' and deadline_at is not null;
  if v_attempt.id is not null then return private.practice_answer('in-progress', v_attempt); end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    return jsonb_build_object('state', 'invalid-course');
  end if;
  -- Publishing changes the item row: holding every CBT item of the course keeps the pool stable until the snapshot
  -- of revisions below commits.
  perform 1 from public.managed_content_items where course_id = p_course_id and kind = 'cbt_question' for share;
  -- Every lock is held. A fresh start is judged now, on the wall clock: the session must still be live and the course
  -- readable at this moment, not merely when the request began (a grant that ended while it waited starts nothing).
  v_now := clock_timestamp();
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not private.practice_can_start(v_user, p_course_id, v_now) then
    return jsonb_build_object('state', 'locked');
  end if;
  select count(*)::integer into v_bank from private.practice_pool(p_course_id);
  if p_intent = 'new' then
    if v_bank = 0 then return jsonb_build_object('state', 'unavailable'); end if;
    v_size := least(p_size, v_bank);
  else
    select * into v_origin from public.quiz_attempts where id = p_redo_of and user_id = v_user
      and course_id = p_course_id and status <> 'in_progress';
    if v_origin.id is null then return jsonb_build_object('state', 'not-found'); end if;
    -- Redo repeats exactly what was shown: every question still offered at the revision the student saw.
    if (select count(*) from public.quiz_attempt_questions where attempt_id = v_origin.id) <> v_origin.question_count
        or exists (select 1 from public.quiz_attempt_questions q where q.attempt_id = v_origin.id
          and not exists (select 1 from private.practice_pool(p_course_id) pool where pool.question_id = q.question_id
            and pool.item_id = q.item_id and pool.revision = q.content_revision)) then
      return jsonb_build_object('state', 'questions-changed');
    end if;
    v_size := v_origin.question_count;
  end if;
  if v_size <> p_expected_size or p_seconds <> p_expected_seconds
      or (v_bank <= v_size) is distinct from p_expected_whole_bank then
    return jsonb_build_object('state', 'policy-changed', 'question_count', v_size, 'duration_seconds', p_seconds,
      'bank_size', v_bank);
  end if;

  insert into public.quiz_attempts (id, user_id, course_id, question_count, deadline_at, duration_seconds, intent,
      redo_of, bank_size)
    values (p_attempt_id, v_user, p_course_id, v_size, v_now + make_interval(secs => p_seconds), p_seconds, p_intent,
      p_redo_of, v_bank)
    returning * into v_attempt;
  if p_intent = 'new' then
    insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
      select v_attempt.id, d.question_id, d.ordinal, d.item_id, d.revision
      from private.practice_draw(v_user, p_course_id, v_attempt.id, v_size, p_sections) d;
  else
    insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
      select v_attempt.id, q.question_id, q.ordinal, q.item_id, q.content_revision
      from public.quiz_attempt_questions q where q.attempt_id = v_origin.id;
  end if;
  return private.practice_answer('ready', v_attempt);
end;
$$;
