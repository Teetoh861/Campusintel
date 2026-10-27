-- supabase/migrations/20261026100000_course_selection_lock.sql — A student's courses are set for the semester once a
-- pass, Early Access or any other plan has started (launch sprint item 1, design of 26 October 2026, decisions D1-D15
-- approved by the owner the same day).
-- 1. The lock is a database rule on the three selection columns of public.profiles, whoever writes them: a student's
--    direct PostgREST call, the app or a service-role script. It is derived, never stored: a selection is locked while
--    it was confirmed in the current semester and a qualifying grant (any source, not revoked, D1/D14) has been active
--    since that confirmation. Saving the same courses, or any other profile field, never moves the confirmation, so no
--    save can unlock.
-- 2. The semester calendar (private.academic_terms) holds one resumption date per session and semester; each semester
--    ends exactly four months later, at 00:00 Lagos. Extensions move the end for one department or for all (D8) and are
--    refused once that end has passed (D11). At the end the lock lifts by itself (state 'reselect'). With no semester
--    after now, locks stay on.
-- 3. Only operators change a locked selection, through admin_change_course_selection() (service role, actor and reason,
--    audited). The change keeps the student locked and touches no grant, preview or practice attempt.
-- 4. A Discovery Pass activation can be bound to the profile revision the student saw (D7), so the pass sets exactly
--    the courses on screen.
-- 5. Existing holders of a pass or Early Access are locked when this commits (D2): complete selections are backfilled
--    as confirmed when their profile was created.
-- Lock order: account row (share), the per-account advisory lock, the profile row, then the calendar lock. The student
-- save path enters at the profile row (its UPDATE), then the account row share lock (profiles_guard_account_lifecycle,
-- compatible with every other share holder), then the calendar lock shared. Calendar writers take the calendar lock
-- exclusively and nothing after it. No path takes a profile row and then the per-account advisory lock.

-- ---------------------------------------------------------------------------
-- Profiles: when the current selection was confirmed. Database-owned; no API role may write it.
-- ---------------------------------------------------------------------------
alter table public.profiles add column selection_confirmed_at timestamptz;
comment on column public.profiles.selection_confirmed_at is
  'When the current selection was confirmed for its semester. Owned by private.guard_course_selection(); null while the selection is incomplete.';

-- course-lock:backfill:start
-- D2: every complete selection counts as confirmed when its profile was created, so a pass or Early Access month that
-- has already started locks it now. The revision trigger is paused so open forms are not invalidated by the backfill.
alter table public.profiles disable trigger profiles_set_updated_at;
update public.profiles set selection_confirmed_at = created_at
  where department_id is not null and selection_confirmed_at is null;
alter table public.profiles enable trigger profiles_set_updated_at;
-- course-lock:backfill:end

alter table public.profiles add constraint profiles_selection_confirmed_check
  check ((selection_confirmed_at is null) = (department_id is null));

-- ---------------------------------------------------------------------------
-- Semester calendar. No API role reads these tables: students see only their own derived values.
-- ---------------------------------------------------------------------------
create table private.academic_terms (
  id uuid primary key default gen_random_uuid(),
  session_label text not null check (session_label ~ '^[0-9]{4}/[0-9]{4}$'
    and split_part(session_label, '/', 2)::integer = split_part(session_label, '/', 1)::integer + 1),
  academic_period_id uuid not null references public.academic_periods (id) on delete restrict,
  -- The first day of teaching, a Lagos calendar day. Entered by the team (default for 2026/2027: Mon 9 Nov 2026).
  resumes_on date not null,
  -- The semester's last day: exactly four months after resumption, less one day. It ends at 00:00 Lagos the day after.
  last_day date not null generated always as ((resumes_on + interval '4 months' - interval '1 day')::date) stored,
  created_at timestamptz not null default now(),
  created_by text not null check (char_length(created_by) between 1 and 120),
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120),
  constraint academic_terms_one_per_period unique (session_label, academic_period_id),
  constraint academic_terms_resumes_unique unique (resumes_on)
);

-- A later last day for one department. Without a row the department follows the semester's own last day.
create table private.academic_term_extensions (
  term_id uuid not null references private.academic_terms (id) on delete restrict,
  department_id uuid not null references public.departments (id) on delete restrict,
  last_day date not null,
  set_at timestamptz not null default now(),
  set_by text not null check (char_length(set_by) between 1 and 120),
  reason text not null check (char_length(reason) between 1 and 500),
  primary key (term_id, department_id)
);

-- Append-only trail of calendar and selection changes. An operator change is recognised by its row in this table in
-- the same transaction (txid), which only definer functions can write.
create table private.course_selection_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  txid bigint not null default txid_current(),
  user_id uuid references auth.users (id) on delete set null,
  term_id uuid,
  department_id uuid,
  event text not null check (event ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  actor text not null check (char_length(actor) between 1 and 120),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096)
);
create index course_selection_events_user_idx on private.course_selection_events (user_id, occurred_at desc);
create index course_selection_events_txid_idx on private.course_selection_events (txid, user_id);

alter table private.academic_terms enable row level security;
alter table private.academic_term_extensions enable row level security;
alter table private.course_selection_events enable row level security;
revoke all on table private.academic_terms, private.academic_term_extensions, private.course_selection_events
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dates and scope. Every decision uses the database clock.
-- ---------------------------------------------------------------------------
create function private.academic_day_end(p_last_day date) returns timestamptz
language sql
stable
set search_path = ''
as $$
  -- Lagos has no daylight saving time, so midnight after the last day is exact.
  select ((p_last_day + 1)::timestamp at time zone 'Africa/Lagos');
$$;

-- Each semester's effective last day and end instant for one department (null: no department, the base dates).
create function private.academic_term_ends(p_department_id uuid)
returns table (term_id uuid, last_day date, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, coalesce(e.last_day, t.last_day), private.academic_day_end(coalesce(e.last_day, t.last_day))
  from private.academic_terms t
  left join private.academic_term_extensions e on e.term_id = t.id and e.department_id = p_department_id;
$$;

-- The one place the lock is decided, from a selection's department and confirmation time at an instant:
--   incomplete  no selection;
--   reselect    confirmed before the latest semester end at or before p_at: the semester ended, the lock is lifted;
--   locked      confirmed in the current semester, and a grant that is not revoked has started and ran past the
--               confirmation (D1: any source; D14: a revoked grant never counts);
--   open        otherwise.
-- The break between semesters belongs to the next one. When no semester ends after p_at the scope never ends (the
-- lock holds until the team enters dates). last_day is the department's last day of the current semester, if known.
create function private.course_selection_state_for(p_user_id uuid, p_department_id uuid, p_confirmed_at timestamptz,
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

create function private.course_selection_state(p_user_id uuid, p_at timestamptz default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile record;
begin
  select department_id, selection_confirmed_at into v_profile from public.profiles where id = p_user_id;
  if not found then return jsonb_build_object('state', 'missing-profile'); end if;
  return private.course_selection_state_for(p_user_id, v_profile.department_id, v_profile.selection_confirmed_at,
    coalesce(p_at, clock_timestamp()));
end;
$$;

create function private.log_course_selection_event(p_user_id uuid, p_term_id uuid, p_department_id uuid, p_event text,
  p_actor text, p_detail jsonb default '{}'::jsonb) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.course_selection_events (user_id, term_id, department_id, event, actor, detail)
    values (p_user_id, p_term_id, p_department_id, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
$$;

-- Who wrote a selection, for the trail: the API role in effect (the definer's current_user is always the owner).
create function private.course_selection_actor() returns text
language sql
stable
set search_path = ''
as $$
  select case when current_setting('role', true) = 'authenticated' then 'student'
    else 'system:' || coalesce(nullif(current_setting('role', true), 'none'), session_user) end;
$$;

-- ---------------------------------------------------------------------------
-- Enforcement on every write of the selection, for every role.
-- ---------------------------------------------------------------------------
create function private.guard_course_selection() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_state text;
  v_operator boolean;
begin
  if tg_op = 'INSERT' then
    new.selection_confirmed_at := case when new.department_id is not null then clock_timestamp() end;
    return new;
  end if;
  -- The confirmation belongs to this trigger: a direct write of it is ignored.
  new.selection_confirmed_at := old.selection_confirmed_at;
  if old.department_id is null and new.department_id is null then return new; end if;
  -- An extension committing at the semester end and this decision are serialized (extensions hold it exclusively).
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  v_now := clock_timestamp();
  v_state := private.course_selection_state_for(old.id, old.department_id, old.selection_confirmed_at, v_now)->>'state';

  if (new.department_id, new.academic_level_id, new.academic_period_id)
      is not distinct from (old.department_id, old.academic_level_id, old.academic_period_id) then
    -- A name-only save, or the same courses again. It never moves the confirmation, except that confirming the same
    -- courses after the semester ended is the re-pick for the new semester.
    if v_state = 'reselect' then
      new.selection_confirmed_at := v_now;
      perform private.log_course_selection_event(old.id, null, old.department_id, 'selection.confirmed-again',
        private.course_selection_actor(),
        jsonb_build_object('department_id', new.department_id, 'academic_level_id', new.academic_level_id,
          'academic_period_id', new.academic_period_id));
    end if;
    return new;
  end if;

  v_operator := exists (select 1 from private.course_selection_events
    where txid = txid_current() and user_id = old.id and event = 'operator.selection-changed'
      and detail -> 'to' = jsonb_build_object('department_id', new.department_id,
        'academic_level_id', new.academic_level_id, 'academic_period_id', new.academic_period_id));
  if v_operator then
    -- A different department can have an earlier semester end. Judge the resulting scope at the same instant,
    -- under the calendar lock; an exception also rolls back the operator's audit and profile revision.
    if v_state = 'locked' and private.course_selection_state_for(old.id, new.department_id,
        old.selection_confirmed_at, v_now)->>'state' is distinct from 'locked' then
      raise exception 'Course correction would unlock this student' using errcode = 'CI423';
    end if;
    -- An operator change never unlocks: the confirmation stays, unless the student had not picked for this semester.
    if v_state in ('incomplete', 'reselect') then new.selection_confirmed_at := v_now; end if;
    return new;
  end if;

  if v_state = 'locked' then
    raise exception 'Course selection is set for this semester' using errcode = 'CI423';
  end if;
  new.selection_confirmed_at := case when new.department_id is not null then v_now end;
  perform private.log_course_selection_event(old.id, null, new.department_id, 'selection.changed',
    private.course_selection_actor(),
    jsonb_build_object('state_before', v_state,
      'from', jsonb_build_object('department_id', old.department_id, 'academic_level_id', old.academic_level_id,
        'academic_period_id', old.academic_period_id),
      'to', jsonb_build_object('department_id', new.department_id, 'academic_level_id', new.academic_level_id,
        'academic_period_id', new.academic_period_id)));
  return new;
end;
$$;

create trigger profiles_guard_course_selection
  before update of department_id, academic_level_id, academic_period_id, selection_confirmed_at on public.profiles
  for each row execute function private.guard_course_selection();
create trigger profiles_guard_course_selection_insert before insert on public.profiles
  for each row execute function private.guard_course_selection();

-- ---------------------------------------------------------------------------
-- The read for the app: the signed-in student's own state only. The semester's last day is returned only while the
-- courses are set (D9); nothing else about the calendar reaches a student.
-- ---------------------------------------------------------------------------
create function public.get_my_course_selection() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_state jsonb;
  v_locked boolean;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_state := private.course_selection_state(v_user_id);
  v_locked := v_state->>'state' = 'locked';
  return jsonb_build_object('state', v_state->>'state', 'locked', v_locked,
    'reason', case when v_locked then v_state->'reason' end,
    'last_day', case when v_locked then v_state->'last_day' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator calendar (service role, scripts/entitlements/ops.cjs). Every change takes the calendar lock exclusively,
-- names an actor and a reason and is audited; nothing it does touches a profile.
-- ---------------------------------------------------------------------------
-- Why the calendar is inconsistent, or null. Semesters do not overlap, and for every department the effective ends
-- strictly increase in resumption order, so a semester end can never fall before an earlier one.
create function private.academic_calendar_problem() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from (select resumes_on, lag(last_day) over (order by resumes_on) as previous_last
        from private.academic_terms) t where t.previous_last >= t.resumes_on) then 'overlapping-semesters'
    when exists (select 1 from private.academic_term_extensions e join private.academic_terms t on t.id = e.term_id
        where e.last_day < t.last_day) then 'extension-before-last-day'
    when exists (select 1 from (select coalesce(e.last_day, t.last_day) as last_day,
          lag(coalesce(e.last_day, t.last_day)) over (partition by d.id order by t.resumes_on) as previous_last
        from public.departments d cross join private.academic_terms t
        left join private.academic_term_extensions e on e.term_id = t.id and e.department_id = d.id) x
        where x.previous_last >= x.last_day) then 'ends-out-of-order'
  end;
$$;

create function private.require_academic_calendar_consistent() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text := private.academic_calendar_problem();
begin
  if v_problem is not null then
    raise exception 'Semester dates refused: %', v_problem using errcode = '22023';
  end if;
end;
$$;

-- Create a semester, or move its resumption while it has not resumed. The new date may not be in the past.
create function public.admin_set_academic_term(p_session_label text, p_period_key text, p_resumes_on date,
  p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_today date;
  v_term private.academic_terms;
  v_state text;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_session_label is null or p_session_label !~ '^[0-9]{4}/[0-9]{4}$'
      or split_part(p_session_label, '/', 2)::integer <> split_part(p_session_label, '/', 1)::integer + 1
      or p_resumes_on is null then
    raise exception 'A session such as 2026/2027 and a resumption date are required' using errcode = '22023';
  end if;
  select id into v_period_id from public.academic_periods where key = p_period_key and is_active;
  if v_period_id is null then raise exception 'Unknown semester' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('academic-calendar', 0));
  v_today := (clock_timestamp() at time zone 'Africa/Lagos')::date;
  select * into v_term from private.academic_terms
    where session_label = p_session_label and academic_period_id = v_period_id for update;
  if v_term.id is not null and v_term.resumes_on = p_resumes_on then
    return jsonb_build_object('state', 'unchanged', 'term_id', v_term.id, 'resumes_on', v_term.resumes_on,
      'last_day', v_term.last_day);
  end if;
  if v_term.id is not null and v_term.resumes_on <= v_today then
    return jsonb_build_object('state', 'resumed', 'term_id', v_term.id, 'resumes_on', v_term.resumes_on);
  end if;
  if p_resumes_on < v_today then return jsonb_build_object('state', 'past-date'); end if;
  if v_term.id is not null and exists (select 1 from private.academic_term_extensions where term_id = v_term.id) then
    return jsonb_build_object('state', 'has-extensions', 'term_id', v_term.id);
  end if;

  if v_term.id is null then
    insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
      values (p_session_label, v_period_id, p_resumes_on, 'operator:' || p_actor, 'operator:' || p_actor)
      returning * into v_term;
    v_state := 'created';
    perform private.log_course_selection_event(null, v_term.id, null, 'calendar.term-created', 'operator:' || p_actor,
      jsonb_build_object('reason', p_reason, 'resumes_on', v_term.resumes_on, 'last_day', v_term.last_day));
  else
    perform private.log_course_selection_event(null, v_term.id, null, 'calendar.term-moved', 'operator:' || p_actor,
      jsonb_build_object('reason', p_reason, 'from', v_term.resumes_on, 'to', p_resumes_on));
    update private.academic_terms set resumes_on = p_resumes_on, updated_at = now(), updated_by = 'operator:' || p_actor
      where id = v_term.id returning * into v_term;
    v_state := 'moved';
  end if;
  perform private.require_academic_calendar_consistent();
  return jsonb_build_object('state', v_state, 'term_id', v_term.id, 'resumes_on', v_term.resumes_on,
    'last_day', v_term.last_day);
end;
$$;

-- Set one department's last day of a semester, or every department's ('all', D8). The last day may not be before the
-- semester's own, and must be after today; setting the semester's own last day removes the extension. Refused, with
-- nothing changed, when any department named has already reached its end (D11): a lifted lock never comes back.
create function public.admin_set_department_end(p_session_label text, p_period_key text, p_department_key text,
  p_last_day date, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_term private.academic_terms;
  v_departments uuid[];
  v_now timestamptz;
  v_ended text;
  v_department uuid;
  v_previous date;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_last_day is null or p_department_key is null then
    raise exception 'A department (or all) and a last day are required' using errcode = '22023';
  end if;
  if p_department_key = 'all' then
    select array_agg(id order by id) into v_departments from public.departments;
  else
    select array_agg(id) into v_departments from public.departments where key = p_department_key;
  end if;
  if v_departments is null then raise exception 'Unknown department' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('academic-calendar', 0));
  select t.* into v_term from private.academic_terms t join public.academic_periods p on p.id = t.academic_period_id
    where t.session_label = p_session_label and p.key = p_period_key for update of t;
  if v_term.id is null then return jsonb_build_object('state', 'not-found'); end if;
  v_now := clock_timestamp();
  select string_agg(d.key, ',' order by d.key) into v_ended
    from public.departments d
    left join private.academic_term_extensions e on e.term_id = v_term.id and e.department_id = d.id
    where d.id = any (v_departments) and private.academic_day_end(coalesce(e.last_day, v_term.last_day)) <= v_now;
  if v_ended is not null then return jsonb_build_object('state', 'ended', 'departments', v_ended); end if;
  if p_last_day < v_term.last_day then
    return jsonb_build_object('state', 'before-last-day', 'last_day', v_term.last_day);
  end if;
  if p_last_day <= (v_now at time zone 'Africa/Lagos')::date then
    return jsonb_build_object('state', 'past-date');
  end if;

  foreach v_department in array v_departments loop
    select last_day into v_previous from private.academic_term_extensions
      where term_id = v_term.id and department_id = v_department;
    if p_last_day = v_term.last_day then
      delete from private.academic_term_extensions where term_id = v_term.id and department_id = v_department;
    else
      insert into private.academic_term_extensions (term_id, department_id, last_day, set_by, reason)
        values (v_term.id, v_department, p_last_day, 'operator:' || p_actor, p_reason)
        on conflict (term_id, department_id) do update set last_day = excluded.last_day, set_at = now(),
          set_by = excluded.set_by, reason = excluded.reason;
    end if;
    perform private.log_course_selection_event(null, v_term.id, v_department, 'calendar.department-end-set',
      'operator:' || p_actor, jsonb_build_object('reason', p_reason, 'scope', p_department_key,
        'from', coalesce(v_previous, v_term.last_day), 'to', p_last_day));
  end loop;
  perform private.require_academic_calendar_consistent();
  return jsonb_build_object('state', 'changed', 'term_id', v_term.id, 'departments', cardinality(v_departments),
    'last_day', p_last_day);
end;
$$;

create function public.admin_academic_calendar() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'terms', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'session', t.session_label, 'semester', p.key,
        'resumes_on', t.resumes_on, 'last_day', t.last_day,
        'extensions', coalesce((select jsonb_agg(jsonb_build_object('department', d.key, 'last_day', e.last_day,
            'set_by', e.set_by, 'reason', e.reason) order by d.sort_order)
          from private.academic_term_extensions e join public.departments d on d.id = e.department_id
          where e.term_id = t.id), '[]'::jsonb)) order by t.resumes_on)
      from private.academic_terms t join public.academic_periods p on p.id = t.academic_period_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event, 'actor', e.actor,
        'term_id', e.term_id, 'department_id', e.department_id, 'detail', e.detail) order by e.id desc)
      from (select * from private.course_selection_events where event like 'calendar.%'
        order by id desc limit 50) e), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Operator selection change on a student's request (D12, D13). Lock order as activation: the account row (share), the
-- per-account advisory lock, then the profile row. The audit row is written before the update, in the same
-- transaction, and is what lets the update past the lock.
-- ---------------------------------------------------------------------------
create function public.admin_course_selection_status(p_user_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.id is null then jsonb_build_object('state', 'not-found') else jsonb_build_object(
    'revision', p.revision,
    'selection', case when p.department_id is null then null else jsonb_build_object('department', d.key,
      'level', l.key, 'semester', s.key) end,
    'confirmed_at', p.selection_confirmed_at,
    'lock', private.course_selection_state(p.id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event, 'actor', e.actor,
        'detail', e.detail) order by e.id desc)
      from (select * from private.course_selection_events where user_id = p_user_id order by id desc limit 50) e),
      '[]'::jsonb)) end
  from (select p_user_id as id) requested
  left join public.profiles p on p.id = requested.id
  left join public.departments d on d.id = p.department_id
  left join public.academic_levels l on l.id = p.academic_level_id
  left join public.academic_periods s on s.id = p.academic_period_id;
$$;

create function public.admin_change_course_selection(p_user_id uuid, p_department_key text, p_level_key text,
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

  v_before := private.course_selection_state(p_user_id);
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

-- ---------------------------------------------------------------------------
-- D7: a pass sets the courses the student saw. The bound activation takes the profile row (share) under the account
-- locks and refuses with 'selection-changed' when the revision moved, so a save from another tab either lands before
-- (and the pass is refused) or waits and is then refused by the lock. Body as in 20261023120000, plus that check.
-- Lock order: account row share lock (inside ai_practice_session_user), the per-account advisory lock, the claim-keys
-- lock, the profile row (share), the per-claim lock, then the global day lock. The two-argument form, which the app
-- calls until it sends the revision, is unbound and otherwise identical.
-- ---------------------------------------------------------------------------
create function public.activate_discovery_pass(p_session_id uuid, p_claim_hashes jsonb,
  p_expected_profile_revision bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_claim_hash text;
  v_key_version integer;
  v_existing public.entitlement_grants;
  v_early public.entitlement_grants;
  v_grant public.entitlement_grants;
  v_today integer;
  v_key_state text;
  v_revision bigint;
begin
  if not private.discovery_claim_hashes_valid(p_claim_hashes) then
    raise exception 'Invalid activation request' using errcode = '22023';
  end if;
  -- Only a live, confirmed account that is not scheduled for deletion.
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.entitlement_policy;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));
  -- Nothing is decided on a key configuration that cannot verify every unexpired claim: fail closed, audited.
  v_key_state := private.discovery_claim_keys_check(p_claim_hashes);
  if v_key_state is not null then return jsonb_build_object('state', v_key_state); end if;

  select * into v_existing from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  if v_existing.id is not null then
    return jsonb_build_object('state', 'already-activated', 'ends_at', v_existing.ends_at);
  end if;
  -- No pass while Early Access is active, so neither is spent during the free month. Not ended is enough: an
  -- enrollment that won the account lock may carry a start a moment after this transaction's now().
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  if v_early.id is not null and v_early.ends_at > now() then
    return jsonb_build_object('state', 'early-access-active', 'available_from', v_early.ends_at);
  end if;
  -- Nor afterwards, nor for a listed address: any Early Access ever on this account, or a list place for this confirmed
  -- email that is not excluded (owner decisions, 23 Oct 2026). Enrollment, imports and member changes take the account
  -- lock held here, so the answer cannot change before this transaction commits.
  if private.discovery_early_access_bars(v_user_id) then
    return jsonb_build_object('state', 'trial-not-offered');
  end if;
  -- D7: the selection the student saw. Held until commit, so it is the selection this pass locks.
  if p_expected_profile_revision is not null then
    select revision into v_revision from public.profiles where id = v_user_id for share;
    if v_revision is distinct from p_expected_profile_revision then
      return jsonb_build_object('state', 'selection-changed');
    end if;
  end if;

  -- The confirmed address claims at most one pass per retention period, even across deleted accounts. Expired claims
  -- no longer count (they are purged by purge_discovery_pass_claims()).
  v_claim_hash := p_claim_hashes -> 0 ->> 'hash';
  v_key_version := (p_claim_hashes -> 0 ->> 'version')::integer;
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || v_claim_hash, 0));
  if exists (select 1 from private.discovery_pass_claims c
      join jsonb_array_elements(p_claim_hashes) h on c.claim_hash = h ->> 'hash'
        and c.key_version = (h ->> 'version')::integer
      where c.expires_at > now()) then
    perform private.log_entitlement_event(v_user_id, null, 'discovery.claim-refused', 'student', '{}'::jsonb);
    return jsonb_build_object('state', 'already-claimed',
      'retention_months', round(extract(epoch from v_policy.discovery_claim_retention) / 2629800)::integer);
  end if;

  if v_policy.discovery_activations_per_day is not null then
    perform pg_advisory_xact_lock(hashtextextended('discovery-activation-global-day', 0));
    select count(*) into v_today from public.entitlement_grants
      where source = 'trial' and trial_policy = 'discovery'
        and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if v_today >= v_policy.discovery_activations_per_day then
      return jsonb_build_object('state', 'capacity');
    end if;
  end if;

  -- Start and end both come from this transaction's clock: exactly discovery_hours from activation. The AI allowance
  -- is fixed here; later policy edits never change a running pass.
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units,
      created_by)
    values (v_user_id, 'trial', 'discovery', now(), now() + make_interval(hours => v_policy.discovery_hours), 'capped',
      v_policy.discovery_ai_generations, 'student')
    returning * into v_grant;
  -- An expired claim of the same address (not yet purged) is replaced by the new one.
  insert into private.discovery_pass_claims (claim_hash, key_version, user_id, grant_id, expires_at)
    values (v_claim_hash, v_key_version, v_user_id, v_grant.id, now() + v_policy.discovery_claim_retention)
    on conflict (claim_hash) do update set key_version = excluded.key_version, user_id = excluded.user_id,
      grant_id = excluded.grant_id, claimed_at = now(), expires_at = excluded.expires_at;
  perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.activated', 'student',
    jsonb_build_object('ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units, 'policy', 'discovery',
      'profile_revision', p_expected_profile_revision));
  return jsonb_build_object('state', 'activated', 'ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units);
end;
$$;

create or replace function public.activate_discovery_pass(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.activate_discovery_pass(p_session_id, p_claim_hashes, null::bigint);
$$;

-- ---------------------------------------------------------------------------
-- Seed (D3): the default resumption of 2026/2027 First Semester. Data, not a rule: the team moves it with term-set
-- until the semester resumes.
-- ---------------------------------------------------------------------------
insert into private.academic_terms (session_label, academic_period_id, resumes_on, created_by, updated_by)
  select '2026/2027', id, date '2026-11-09', 'migration:20261026100000', 'migration:20261026100000'
  from public.academic_periods where key = 'first-semester';
insert into private.course_selection_events (term_id, event, actor, detail)
  select id, 'calendar.term-created', 'migration:20261026100000',
    jsonb_build_object('reason', 'default resumption date (D3)', 'resumes_on', resumes_on, 'last_day', last_day)
  from private.academic_terms;

-- ---------------------------------------------------------------------------
-- Privileges. Students: their own state only. Every calendar and selection write is service-role only.
-- ---------------------------------------------------------------------------
revoke all on function private.academic_day_end(date), private.academic_term_ends(uuid),
  private.course_selection_state_for(uuid, uuid, timestamptz, timestamptz),
  private.course_selection_state(uuid, timestamptz),
  private.log_course_selection_event(uuid, uuid, uuid, text, text, jsonb), private.course_selection_actor(),
  private.guard_course_selection(),
  private.academic_calendar_problem(), private.require_academic_calendar_consistent(),
  public.get_my_course_selection(),
  public.admin_set_academic_term(text, text, date, text, text),
  public.admin_set_department_end(text, text, text, date, text, text), public.admin_academic_calendar(),
  public.admin_course_selection_status(uuid),
  public.admin_change_course_selection(uuid, text, text, text, bigint, boolean, text, text),
  public.activate_discovery_pass(uuid, jsonb, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_course_selection() to authenticated;
grant execute on function public.admin_set_academic_term(text, text, date, text, text),
  public.admin_set_department_end(text, text, text, date, text, text), public.admin_academic_calendar(),
  public.admin_course_selection_status(uuid),
  public.admin_change_course_selection(uuid, text, text, text, bigint, boolean, text, text),
  public.activate_discovery_pass(uuid, jsonb, bigint)
  to service_role;

comment on function public.get_my_course_selection() is
  'The signed-in student''s course selection state: incomplete, open, locked or reselect; while locked, the reason and the semester''s last day.';
comment on function public.admin_change_course_selection(uuid, text, text, text, bigint, boolean, text, text) is
  'Operator change of a student''s selection on request. Audited; keeps the student locked; refuses an empty combination unless p_allow_empty.';
