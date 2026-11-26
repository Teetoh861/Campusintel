-- supabase/migrations/20261125200000_owner_tester_access.sql — Owner tester access on the test site (removable).
-- A named account can test every course of whatever department, level and semester it saves, change that selection at
-- any time, and use Campus Bot without plan limits under a daily cap, for a set time. Nothing here is a grant, an
-- order or plan use, and payments are untouched.
--
-- Two layers keep it to the test site:
-- * private.tester_site holds one row only in the test project's database. No function, migration or seed writes it:
--   it is inserted by hand in that project's SQL editor (docs/entitlements-operations.md, "Tester access"). Without it
--   every check below answers false.
-- * Tester rows are written only by public.admin_set_tester_access, which refuses without that row, and its operator
--   command refuses every project but the test one before sending anything.
-- The database decides by itself from the account it identifies (auth.uid(), a verified session, or the profile row's
-- owner). No function a student can call takes a tester argument.
--
-- Tester access steps aside whenever the account holds any unrevoked grant, any paid or order grant, or any payment
-- order: the course lock (which comes only from grants), grant binding, plan use and refunds then never meet it.
--
-- Removal after launch: restore each function redefined below to the body it replaces (named in its section),
-- then drop the two tables and the functions created here, and narrow the four ledger checks (NOT VALID where tester
-- rows exist).

-- ---------------------------------------------------------------------------
-- The two ledgers accept tester funding: no grant, tokens reserved, no plan windows.
-- ---------------------------------------------------------------------------
alter table public.ai_usage_events drop constraint ai_usage_events_funding_source_check;
alter table public.ai_usage_events add constraint ai_usage_events_funding_source_check
  check (funding_source in ('trial', 'early_access', 'test', 'paid', 'tester'));
alter table public.ai_usage_events drop constraint ai_usage_events_funding_check;
alter table public.ai_usage_events add constraint ai_usage_events_funding_check check (
  (funding_grant_id is not null) = (funding_source is not null and funding_source not in ('test', 'tester')));
alter table public.ai_usage_events drop constraint ai_usage_events_tokens_check;
alter table public.ai_usage_events add constraint ai_usage_events_tokens_check check (reserved_tokens is null
  or (funding_source in ('paid', 'early_access') and session_window_id is not null and week_window_id is not null)
  or (funding_source = 'tester' and session_window_id is null and week_window_id is null));
alter table private.campus_bot_replies drop constraint campus_bot_replies_funding_source_check;
alter table private.campus_bot_replies add constraint campus_bot_replies_funding_source_check
  check (funding_source in ('paid', 'early_access', 'trial', 'tester'));

-- ---------------------------------------------------------------------------
-- The test-site setting and the tester accounts. Neither is reachable by any API role, service_role included.
-- ---------------------------------------------------------------------------
create table private.tester_site (
  singleton boolean primary key default true check (singleton),
  project_ref text not null check (char_length(project_ref) between 1 and 40),
  enabled_at timestamptz not null default clock_timestamp(),
  enabled_by text not null check (char_length(enabled_by) between 1 and 120),
  reason text not null check (char_length(reason) between 3 and 500)
);
comment on table private.tester_site is
  'One row only in the test project''s database, inserted by hand. Never written by a function, migration or seed.';

create table private.tester_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  starts_at timestamptz not null,
  expires_at timestamptz not null,
  daily_cap_tokens bigint not null default 3000000 check (daily_cap_tokens between 100000 and 50000000),
  set_by text not null check (char_length(set_by) between 1 and 120),
  reason text not null check (char_length(reason) between 3 and 500),
  revoked_at timestamptz,
  revoked_by text check (char_length(revoked_by) between 1 and 120),
  revoke_reason text check (char_length(revoke_reason) between 3 and 500),
  updated_at timestamptz not null,
  constraint tester_accounts_window_check check (expires_at > starts_at),
  constraint tester_accounts_revoked_check check ((revoked_at is null) = (revoked_by is null))
);

alter table private.tester_site enable row level security;
alter table private.tester_accounts enable row level security;
revoke all on table private.tester_site, private.tester_accounts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The one check. Pure read: no lock, no write, never raises, so RLS and read-only paths may call it. Callers pass
-- their own clock (taken after their locks). Expiry is a comparison; nothing sweeps it.
-- ---------------------------------------------------------------------------
create function private.tester_access_ends(p_user uuid, p_at timestamptz) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select t.expires_at from private.tester_accounts t
  where p_user is not null and p_at is not null
    and exists (select 1 from private.tester_site)
    and t.user_id = p_user and t.revoked_at is null and t.starts_at <= p_at and t.expires_at > p_at
    and not exists (select 1 from public.entitlement_grants g where g.user_id = p_user
      and (g.revoked_at is null or g.source = 'paid' or g.order_id is not null))
    and not exists (select 1 from private.payment_orders o where o.user_id = p_user);
$$;

create function private.tester_access_active(p_user uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.tester_access_ends(p_user, p_at) is not null;
$$;

-- Replies and sets are weighed with the Standard tier's written-token weight.
create function private.tester_written_weight() returns integer
language sql stable security definer set search_path = '' as $$
  select t.written_token_weight from private.campus_bot_tiers t where t.tier = 'standard';
$$;

-- The tester's day is the UTC day, as every other Campus Bot daily limit.
create function private.tester_day_end(p_at timestamptz) returns timestamptz
language sql immutable set search_path = '' as $$
  select (date_trunc('day', p_at at time zone 'utc') + interval '1 day') at time zone 'utc';
$$;

-- Today's tester use across both ledgers: charged tokens of delivered requests plus live reservations
-- (private.campus_bot_window_use's rule, keyed by account and day instead of window).
create function private.tester_cap_use(p_user uuid, p_at timestamptz, out used bigint, out in_flight bigint)
language sql stable security definer set search_path = '' as $$
  with day as (
    select private.tester_day_end(p_at) - interval '1 day' as starts
  ), sets as (
    select coalesce(sum(e.charged_tokens) filter (where e.state = 'consumed'), 0)::bigint as used,
      coalesce(sum(e.reserved_tokens) filter (where e.state = 'reserved'
        and e.reserved_at > p_at - make_interval(mins => p.reservation_minutes)), 0)::bigint as in_flight
    from public.ai_usage_events e cross join private.ai_practice_policy p cross join day
    where e.user_id = p_user and e.funding_source = 'tester' and e.reserved_at >= day.starts
  ), replies as (
    select coalesce(sum(r.charged_tokens) filter (where r.state = 'consumed'), 0)::bigint as used,
      coalesce(sum(r.reserved_tokens) filter (where r.state = 'reserved'
        and r.reserved_at > p_at - make_interval(secs => s.reply_reservation_seconds)), 0)::bigint as in_flight
    from private.campus_bot_replies r cross join private.campus_bot_settings s cross join day
    where r.user_id = p_user and r.funding_source = 'tester' and r.reserved_at >= day.starts
  )
  select sets.used + replies.used, sets.in_flight + replies.in_flight from sets cross join replies;
$$;

create function private.tester_cap_left(p_user uuid, p_at timestamptz) returns bigint
language sql stable security definer set search_path = '' as $$
  select coalesce((select t.daily_cap_tokens from private.tester_accounts t where t.user_id = p_user), 0)
    - u.used - u.in_flight
  from private.tester_cap_use(p_user, p_at) u;
$$;

-- ---------------------------------------------------------------------------
-- Operator: switch on (or renew from now), and switch off. Service role only; refuses without the test-site row.
-- ---------------------------------------------------------------------------
create function public.admin_set_tester_access(p_user_id uuid, p_action text, p_days integer, p_daily_cap bigint,
  p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor text;
  v_now timestamptz;
  v_row private.tester_accounts;
  v_active boolean;
  v_days integer := coalesce(p_days, 7);
  v_cap bigint;
  v_grants jsonb;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_user_id is null or p_action is null or p_action not in ('grant', 'revoke') then
    raise exception 'Invalid tester request' using errcode = '22023';
  end if;
  v_actor := left('operator:' || btrim(p_actor), 120);
  -- Not the test site: nothing is written but a record of the attempt.
  if not exists (select 1 from private.tester_site) then
    perform private.log_entitlement_event(null, null, 'operator.tester-refused', v_actor,
      jsonb_build_object('reason', btrim(p_reason), 'user_id', p_user_id, 'action', p_action, 'refusal', 'not-test-site'));
    return jsonb_build_object('state', 'not-test-site');
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('state', 'not-found');
  end if;
  -- The account prefix grants, saves, admissions and payments take, so commit order decides every race with them.
  perform private.lock_course_access_scope(p_user_id);
  v_now := clock_timestamp();
  select * into v_row from private.tester_accounts where user_id = p_user_id for update;
  v_active := v_row.user_id is not null and v_row.revoked_at is null and v_row.expires_at > v_now;

  if p_action = 'revoke' then
    if not v_active then return jsonb_build_object('state', 'not-active'); end if;
    update private.tester_accounts
      set revoked_at = v_now, revoked_by = v_actor, revoke_reason = btrim(p_reason), updated_at = v_now
      where user_id = p_user_id;
    perform private.log_entitlement_event(p_user_id, null, 'operator.tester-revoked', v_actor,
      jsonb_build_object('reason', btrim(p_reason), 'was_expires_at', v_row.expires_at));
    return jsonb_build_object('state', 'revoked', 'revoked_at', v_now);
  end if;

  if v_days not between 1 and 30 then raise exception 'Days must be 1 to 30' using errcode = '22023'; end if;
  v_cap := coalesce(p_daily_cap, v_row.daily_cap_tokens, 3000000);
  if v_cap not between 100000 and 50000000 then
    raise exception 'Daily cap must be 100000 to 50000000 tokens' using errcode = '22023';
  end if;
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    return jsonb_build_object('state', 'account-restricted');
  end if;
  if exists (select 1 from public.profiles where id = p_user_id and role = 'operator') then
    return jsonb_build_object('state', 'operator-account');
  end if;
  if exists (select 1 from private.payment_orders where user_id = p_user_id)
      or exists (select 1 from public.entitlement_grants where user_id = p_user_id
        and (source = 'paid' or order_id is not null)) then
    return jsonb_build_object('state', 'payment-records');
  end if;
  select jsonb_agg(jsonb_build_object('grant_id', g.id, 'source', g.source, 'ends_at', g.ends_at) order by g.created_at)
    into v_grants from public.entitlement_grants g where g.user_id = p_user_id and g.revoked_at is null;
  if v_grants is not null then return jsonb_build_object('state', 'has-grants', 'grants', v_grants); end if;
  if not v_active and (select count(*) from private.tester_accounts
      where user_id <> p_user_id and revoked_at is null and expires_at > v_now) >= 3 then
    return jsonb_build_object('state', 'too-many-testers');
  end if;

  insert into private.tester_accounts as t (user_id, starts_at, expires_at, daily_cap_tokens, set_by, reason, updated_at)
    values (p_user_id, v_now, v_now + make_interval(days => v_days), v_cap, v_actor, btrim(p_reason), v_now)
    on conflict (user_id) do update
      set starts_at = case when v_active then t.starts_at else excluded.starts_at end,
        expires_at = excluded.expires_at, daily_cap_tokens = excluded.daily_cap_tokens, set_by = excluded.set_by,
        reason = excluded.reason, revoked_at = null, revoked_by = null, revoke_reason = null,
        updated_at = excluded.updated_at
      where t.user_id = excluded.user_id
    returning * into v_row;
  perform private.log_entitlement_event(p_user_id, null,
    case when v_active then 'operator.tester-renewed' else 'operator.tester-granted' end, v_actor,
    jsonb_build_object('reason', btrim(p_reason), 'days', v_days, 'expires_at', v_row.expires_at,
      'daily_cap_tokens', v_cap));
  return jsonb_build_object('state', case when v_active then 'renewed' else 'granted' end,
    'starts_at', v_row.starts_at, 'expires_at', v_row.expires_at, 'daily_cap_tokens', v_row.daily_cap_tokens);
end;
$$;

-- What is on, for whom, until when, why, and today's use against the cap. Read-only; no email is returned.
create function public.admin_tester_status(p_user_id uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'now', clock_timestamp(),
    'site', (select jsonb_build_object('project_ref', s.project_ref, 'enabled_at', s.enabled_at,
      'enabled_by', s.enabled_by, 'reason', s.reason) from private.tester_site s),
    'day_resets_at', private.tester_day_end(clock_timestamp()),
    'testers', coalesce((select jsonb_agg(x.item order by x.updated_at desc) from (
      select t.updated_at, jsonb_build_object('user_id', t.user_id,
        'state', case when t.revoked_at is not null then 'revoked'
          when t.expires_at <= clock_timestamp() then 'expired'
          when not exists (select 1 from private.tester_site) then 'no-test-site'
          when private.tester_access_active(t.user_id, clock_timestamp()) then 'active'
          else 'stepped-aside' end,
        'starts_at', t.starts_at, 'expires_at', t.expires_at, 'set_by', t.set_by, 'reason', t.reason,
        'revoked_at', t.revoked_at, 'revoked_by', t.revoked_by, 'revoke_reason', t.revoke_reason,
        'daily_cap_tokens', t.daily_cap_tokens, 'used_today', u.used, 'in_flight', u.in_flight,
        -- What makes tester access step aside, by name: any unrevoked grant (ended ones included), any paid or order
        -- grant, any payment order.
        'stepped_aside_by', jsonb_build_object(
          'grants', coalesce((select jsonb_agg(jsonb_build_object('grant_id', g.id, 'source', g.source,
              'ends_at', g.ends_at, 'ended', g.ends_at <= clock_timestamp(), 'revoked', g.revoked_at is not null,
              'order_id', g.order_id) order by g.created_at) from public.entitlement_grants g where g.user_id = t.user_id
            and (g.revoked_at is null or g.source = 'paid' or g.order_id is not null)), '[]'::jsonb),
          'payment_orders', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'status', o.status,
              'created_at', o.created_at) order by o.created_at) from private.payment_orders o
            where o.user_id = t.user_id), '[]'::jsonb))) as item
      from private.tester_accounts t cross join lateral private.tester_cap_use(t.user_id, clock_timestamp()) u
      where p_user_id is null or t.user_id = p_user_id
      order by t.updated_at desc limit 50) x), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Redefined functions. Each keeps its owner and grants (CREATE OR REPLACE); only the marked lines are new.
-- Bodies replaced: course_access_decision and guard_course_selection (20261029100000_own_course_access.sql),
-- course_on_current_list and discovery_email_allowed (20261101120000_course_access_part_2.sql), ai_funding_current,
-- ai_allowance_admission and get_my_ai_allowance (20261103100000_campus_bot_limits.sql),
-- begin_ai_practice_generation (20261103140000_campus_bot_review_fixes.sql), campus_bot_reply_funding,
-- begin_campus_bot_explanation and begin_campus_bot_chat (20261117100000_campus_bot_explain_ask.sql),
-- begin_campus_bot_topic_set and finish_campus_bot_topic_set (20261117110000_campus_bot_topic_sets.sql),
-- get_my_entitlement (20261104120000_paid_plan_semester.sql), attempt_review_unavailable_reason
-- (20261102180000_course_access_review_fixes.sql).
-- ---------------------------------------------------------------------------

create or replace function private.course_access_decision(p_user uuid, p_institutional uuid, p_at timestamptz)
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
  -- Owner tester access (20261125200000): every course of her saved department, level and semester, whatever
  -- the calendar says, and nothing else. An incomplete selection falls through to the usual prompt.
  ends_at := private.tester_access_ends(p_user, p_at);
  if ends_at is not null and exists (select 1 from public.profiles p where p.id = p_user and p.department_id is not null
      and p.academic_level_id is not null and p.academic_period_id is not null) then
    select exists (select 1 from public.profiles p join public.course_applicability a
      on a.department_id = p.department_id and a.academic_level_id = p.academic_level_id
        and a.academic_period_id = p.academic_period_id
      where p.id = p_user and a.institutional_course_id = p_institutional) into on_list;
    if on_list then allowed := true; reason := 'tester'; else ends_at := null; end if;
    return next; return;
  end if;
  ends_at := null;
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
    where g.user_id = p_user and g.course_term_id = v_scope_term and g.course_department_id = (s->>'department_id')::uuid
      and (g.source <> 'trial' or g.trial_policy = 'seven-day') and g.revoked_at is null
      and g.starts_at <= p_at and least(g.ends_at, e.ends_at) > p_at;
  if v_full_end is null then reason := 'needs-plan'; return next; return; end if;
  allowed := true; reason := case when on_list then 'own-list' else 'team-added' end;
  ends_at := case when on_list then v_full_end else least(v_full_end, v_add_end) end;
  return next;
end;
$$;

create or replace function private.guard_course_selection() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_state text;
  v_operator boolean;
  v_period uuid;
  v_tester boolean;
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
  -- Owner tester access (20261125200000): a lock-free read; her own saves may name any semester.
  v_tester := current_setting('role', true) = 'authenticated' and private.tester_access_active(old.id, v_now);

  if (new.department_id, new.academic_level_id, new.academic_period_id)
      is not distinct from (old.department_id, old.academic_level_id, old.academic_period_id) then
    -- A name-only save, or the same courses again. It never moves the confirmation, except that confirming the same
    -- courses after the semester ended is the re-pick for the new semester.
    -- Only a student's selection save is restricted. The shared calendar lock is already held;
    -- use the fresh post-wait clock and the same running-term convention as course access. Invalid/inactive
    -- references keep their existing RLS refusal instead of being reported as a semester mismatch.
    if v_state = 'reselect' and current_setting('role', true) = 'authenticated' and not v_tester
        and exists (select 1 from public.departments where id = new.department_id and is_active)
        and exists (select 1 from public.academic_levels where id = new.academic_level_id and is_active)
        and exists (select 1 from public.academic_periods where id = new.academic_period_id and is_active) then
      select academic_period_id into v_period from private.access_term_at(new.department_id, v_now);
      if v_period is not null and new.academic_period_id is distinct from v_period then
        raise exception 'That semester is not running now' using errcode = 'CI422';
      end if;
    end if;
    if v_state = 'reselect' then
      new.selection_confirmed_at := v_now;
      perform private.log_course_selection_event(old.id, null, old.department_id, 'selection.confirmed-again',
        private.course_selection_actor(),
        jsonb_build_object('department_id', new.department_id, 'academic_level_id', new.academic_level_id,
          'academic_period_id', new.academic_period_id)
          || case when v_tester then jsonb_build_object('exemption', 'tester') else '{}'::jsonb end);
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
  -- Only a student's selection save is restricted. The shared calendar lock is already held;
  -- use the fresh post-wait clock and the same running-term convention as course access. Invalid/inactive
  -- references keep their existing RLS refusal instead of being reported as a semester mismatch.
  if current_setting('role', true) = 'authenticated' and not v_tester
      and exists (select 1 from public.departments where id = new.department_id and is_active)
      and exists (select 1 from public.academic_levels where id = new.academic_level_id and is_active)
      and exists (select 1 from public.academic_periods where id = new.academic_period_id and is_active) then
    select academic_period_id into v_period from private.access_term_at(new.department_id, v_now);
    if v_period is not null and new.academic_period_id is distinct from v_period then
      raise exception 'That semester is not running now' using errcode = 'CI422';
    end if;
  end if;
  new.selection_confirmed_at := case when new.department_id is not null then v_now end;
  perform private.log_course_selection_event(old.id, null, new.department_id, 'selection.changed',
    private.course_selection_actor(),
    jsonb_build_object('state_before', v_state,
      'from', jsonb_build_object('department_id', old.department_id, 'academic_level_id', old.academic_level_id,
        'academic_period_id', old.academic_period_id),
      'to', jsonb_build_object('department_id', new.department_id, 'academic_level_id', new.academic_level_id,
        'academic_period_id', new.academic_period_id))
      || case when v_tester then jsonb_build_object('exemption', 'tester') else '{}'::jsonb end);
  return new;
end;
$$;

create or replace function private.course_on_current_list(p_user uuid,p_course uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  -- Owner tester access (20261125200000): her saved selection counts whatever the calendar says.
  select (private.current_course_scope(p_user,p_at)->>'state'='ready' or private.tester_access_active(p_user,p_at))
    and exists(
    select 1 from public.profiles p join public.course_applicability a
      on a.department_id=p.department_id and a.academic_level_id=p.academic_level_id
      and a.academic_period_id=p.academic_period_id
    join public.departments d on d.id=a.department_id and d.is_active
    join public.academic_levels l on l.id=a.academic_level_id and l.is_active
    join public.academic_periods t on t.id=a.academic_period_id and t.is_active
    where p.id=p_user and a.institutional_course_id=p_course);
$$;

create or replace function private.ai_funding_current(p_user uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.campus_bot_plan(p_user, p_at, array['paid', 'early_access']))
    or exists (select 1 from private.effective_ai_window(p_user, array['trial', 'early_access', 'test']) w
      where w.starts_at <= p_at and w.ends_at > p_at)
    -- Owner tester access (20261125200000): funded by the tester setting while it is on.
    or private.tester_access_active(p_user, p_at);
$$;

create or replace function private.ai_allowance_admission(p_user_id uuid, p_accepted_sources text[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window record;
  v_used integer;
  v_plan record;
begin
  if coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'paid', 'test'] then
    raise exception 'Invalid accepted grant sources' using errcode = '22023';
  end if;
  -- Owner tester access (20261125200000): the database decides by itself; no plan, pass or window applies.
  if private.tester_access_active(p_user_id, clock_timestamp()) then
    return jsonb_build_object('state', 'active', 'mode', 'tester', 'total', null, 'used', 0,
      'ends_at', private.tester_access_ends(p_user_id, clock_timestamp()), 'source', 'tester', 'grant_id', null);
  end if;
  -- 2b: token funding (paid, Early Access) has no set count; begin applies the Campus Bot limits.
  select * into v_plan from private.campus_bot_plan(p_user_id, clock_timestamp(), p_accepted_sources);
  if found then
    return jsonb_build_object('state', 'active', 'mode', 'tokens', 'total', null,
      'used', private.ai_units_used(p_user_id, v_plan.grant_id, '-infinity'::timestamptz), 'ends_at', v_plan.ends_at,
      'source', v_plan.source, 'grant_id', v_plan.grant_id, 'tier', v_plan.tier);
  end if;
  -- 2b: a paid grant never funds by set count.
  select * into v_window from private.effective_ai_window(p_user_id, array_remove(p_accepted_sources, 'paid'));
  if not found then return jsonb_build_object('state', 'not-entitled'); end if;
  if not v_window.active then
    return jsonb_build_object('state', 'allowance-expired', 'total', v_window.total_units, 'ends_at', v_window.ends_at);
  end if;
  v_used := private.ai_units_used(p_user_id, v_window.grant_id, v_window.starts_at);
  if v_window.total_units is not null and v_used >= v_window.total_units then
    return jsonb_build_object('state', 'allowance-exhausted', 'total', v_window.total_units, 'used', v_used,
      'ends_at', v_window.ends_at);
  end if;
  -- source and grant_id name the funding grant; admission records them on the reservation.
  return jsonb_build_object('state', 'active', 'total', v_window.total_units, 'used', v_used,
    'ends_at', v_window.ends_at, 'source', v_window.source, 'grant_id', v_window.grant_id);
end;
$$;

create or replace function public.get_my_ai_allowance() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_window record;
  v_plan record;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- Owner tester access (20261125200000): no count and no limits shown.
  if private.tester_access_active(v_user_id, clock_timestamp()) then
    return jsonb_build_object('state', 'active', 'source', 'tester', 'total', null, 'used', 0,
      'ends_at', private.tester_access_ends(v_user_id, clock_timestamp()));
  end if;
  -- 2b: token funding has no set count (total null); get_my_campus_bot_usage shows the limits.
  select * into v_plan from private.campus_bot_plan(v_user_id, clock_timestamp(), array['paid', 'early_access']);
  if found then
    return jsonb_build_object('state', 'active', 'source', v_plan.source, 'total', null,
      'used', private.ai_units_used(v_user_id, v_plan.grant_id, '-infinity'::timestamptz), 'ends_at', v_plan.ends_at);
  end if;
  select * into v_window from private.effective_ai_window(v_user_id, array['trial', 'early_access', 'test']);
  if not found then
    return jsonb_build_object('state', 'not-entitled', 'total', 0, 'used', 0);
  end if;
  return jsonb_build_object('state', case when v_window.active then 'active' else 'expired' end,
    'source', v_window.source, 'total', v_window.total_units,
    'used', private.ai_units_used(v_user_id, v_window.grant_id, v_window.starts_at), 'ends_at', v_window.ends_at,
    'source_char_limit', case when private.is_discovery_grant(v_window.grant_id)
      then (select discovery_ai_source_chars from private.entitlement_policy) end);
end;
$$;

create or replace function private.campus_bot_reply_funding(p_user uuid, p_at timestamptz)
returns table (mode text, source text, grant_id uuid, session_hours integer, session_tokens integer, week_days integer,
  week_tokens integer, written_token_weight integer)
language sql stable security definer set search_path = '' as $$
  -- Owner tester access (20261125200000): first, ahead of any plan or pass.
  with tester as (
    select 1 where private.tester_access_active(p_user, p_at)
  ), plan as (
    select * from private.campus_bot_plan(p_user, p_at, array['paid', 'early_access'])
  ), pass as (
    select g.id from public.entitlement_grants g
    where g.user_id = p_user and g.source = 'trial' and g.ai_terms <> 'none' and g.revoked_at is null
      and g.starts_at <= p_at and g.ends_at > p_at
  )
  select 'tester'::text, 'tester'::text, null::uuid, null::integer, null::integer, null::integer, null::integer,
    private.tester_written_weight()
  from tester
  union all
  select 'tokens'::text, plan.source, plan.grant_id, plan.session_hours, plan.session_tokens, plan.week_days,
    plan.week_tokens, plan.written_token_weight
  from plan
  where not exists (select 1 from tester)
  union all
  select 'count'::text, 'trial'::text, pass.id, null::integer, null::integer, null::integer, null::integer,
    (select t.written_token_weight from private.campus_bot_tiers t where t.tier = 'standard')
  from pass
  where not exists (select 1 from plan) and not exists (select 1 from tester)
  limit 1;
$$;

create or replace function public.begin_ai_practice_generation(
  p_session_id uuid, p_request_id uuid, p_document_id uuid, p_accepted_sources text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.ai_practice_policy;
  v_allowance jsonb;
  v_existing public.ai_practice_generations;
  v_document public.ai_practice_documents;
  v_grant_id uuid;
  v_attempts integer;
  v_today integer;
  v_event_id uuid;
  v_generation_id uuid;
  v_undelivered integer;
  v_now timestamptz;
  v_plan record;
  v_writing record;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_session_left bigint;
  v_week_left bigint;
  v_reserved bigint;
  v_refill_at timestamptz;
  v_paid_account boolean;
  v_written_weight integer;
begin
  if p_request_id is null or p_document_id is null
      or coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'paid', 'test'] then
    raise exception 'Invalid generation request' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user_id::text, 0));
  perform private.bind_pending_course_grants(v_user_id);
  -- 2b: the student's windows, after the feature lock and before the platform day lock.
  perform 1 from private.campus_bot_windows where user_id = v_user_id order by id for update;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day',0));
  select * into strict v_policy from private.ai_practice_policy;
  perform 1 from public.ai_practice_generations where user_id=v_user_id for update;
  select * into v_document from public.ai_practice_documents where id=p_document_id and user_id=v_user_id for share;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out'); end if;
  -- A previously delivered set is the owner's even after access ends; no source is reopened on this path.
  select * into v_existing from public.ai_practice_generations where user_id=v_user_id and request_id=p_request_id;
  if v_existing.id is not null and v_existing.document_id=p_document_id and v_existing.status='generated' then
    return jsonb_build_object('state','existing','generation_id',v_existing.id,'status',v_existing.status); end if;
  v_allowance:=private.ai_allowance_admission(v_user_id,p_accepted_sources);
  if v_allowance->>'state'='not-entitled' then return v_allowance; end if;
  if v_document.id is null then return jsonb_build_object('state','document-unavailable'); end if;
  if not private.ai_course_allowed(v_user_id,v_document.institutional_course_id,clock_timestamp()) then
    if private.course_on_current_list(v_user_id,v_document.institutional_course_id,clock_timestamp()) then
      v_allowance:=private.ai_allowance_admission(v_user_id,p_accepted_sources);
      if v_allowance->>'state'<>'active' then return v_allowance; end if;
    end if;
    return jsonb_build_object('state','not-entitled'); end if;
  perform private.release_abandoned_ai_generations(v_user_id, v_policy.reservation_minutes);

  select * into v_existing from public.ai_practice_generations
    where user_id = v_user_id and request_id = p_request_id;
  if found then
    if v_existing.document_id is distinct from p_document_id then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return jsonb_build_object('state', 'existing', 'generation_id', v_existing.id, 'status', v_existing.status);
  end if;

  v_allowance := private.ai_allowance_admission(v_user_id, p_accepted_sources);
  if v_allowance ->> 'state' = 'not-entitled' then return v_allowance; end if;

  select * into v_document from public.ai_practice_documents
    where id = p_document_id and user_id = v_user_id;
  if not found or v_document.status <> 'ready' or v_document.expires_at <= clock_timestamp() then
    return jsonb_build_object('state', 'document-unavailable');
  end if;

  if exists (select 1 from public.ai_practice_generations where user_id = v_user_id and status = 'running') then
    return jsonb_build_object('state', 'busy');
  end if;
  if v_allowance ->> 'state' <> 'active' then return v_allowance; end if;

  if v_allowance ->> 'source' = 'trial' and private.is_discovery_grant((v_allowance ->> 'grant_id')::uuid) then
    v_grant_id := (v_allowance ->> 'grant_id')::uuid;
    if v_document.discovery_grant_id is distinct from v_grant_id
        or not exists (select 1 from private.discovery_ai_uploads
          where grant_id = v_grant_id and document_id = v_document.id)
        or char_length(v_document.source_text)
          > (select discovery_ai_source_chars from private.entitlement_policy) then
      return jsonb_build_object('state', 'document-unavailable');
    end if;
    select count(*) into v_attempts from public.ai_usage_events where funding_grant_id = v_grant_id;
    if v_attempts >= (select discovery_ai_attempts from private.entitlement_policy) then
      return jsonb_build_object('state', 'allowance-exhausted', 'total', v_allowance -> 'total',
        'used', v_allowance -> 'used', 'ends_at', v_allowance -> 'ends_at');
    end if;
  end if;

  -- 2b: every lock is held; the rest is judged on this reading of the wall clock.
  -- Freeze one refill epoch before the final admission clock; both windows use exactly this snapshot.
  select coalesce(max(r.at), '-infinity'::timestamptz) into v_refill_at
    from private.campus_bot_refills r where r.user_id = v_user_id or r.user_id is null;
  v_now := greatest(clock_timestamp(), v_refill_at + interval '1 microsecond');
  -- Undelivered tries per student per UTC day (failures, refusals, abandoned requests), whatever funds them.
  select count(*) into v_undelivered from public.ai_usage_events
    where user_id = v_user_id and state = 'released'
      and reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  if v_undelivered >= v_policy.undelivered_per_day then
    return jsonb_build_object('state', 'undelivered-limit');
  end if;

  -- Campus Bot limits: both windows must have the set's worst-case cost left.
  if v_allowance ->> 'mode' = 'tokens' then
    select * into v_plan from private.campus_bot_plan(v_user_id, v_now, p_accepted_sources);
    if v_plan.grant_id is distinct from (v_allowance ->> 'grant_id')::uuid then
      return jsonb_build_object('state', 'not-entitled');
    end if;
    select * into v_writing from private.campus_bot_writing(v_plan.written_token_weight);
    v_written_weight := v_plan.written_token_weight;
    if v_writing.provider_model is null then return jsonb_build_object('state', 'capacity'); end if;
    v_reserved := v_writing.set_max;
    select * into v_session from private.campus_bot_open_window(v_user_id, 'session', v_now, v_refill_at);
    select * into v_week from private.campus_bot_open_window(v_user_id, 'week', v_now, v_refill_at);
    select v_plan.session_tokens - u.used - u.in_flight into v_session_left from private.campus_bot_window_use(v_session.id) u;
    select v_plan.week_tokens - u.used - u.in_flight into v_week_left from private.campus_bot_window_use(v_week.id) u;
    if v_session_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    if v_week_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  elsif v_allowance ->> 'mode' = 'tester' then
    -- Owner tester access (20261125200000): no windows; the tester's daily cap on the UTC day instead.
    v_written_weight := private.tester_written_weight();
    select * into v_writing from private.campus_bot_writing(v_written_weight);
    if v_writing.provider_model is null then return jsonb_build_object('state', 'capacity'); end if;
    v_reserved := v_writing.set_max;
    if private.tester_cap_left(v_user_id, v_now) < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', private.tester_day_end(v_now));
    end if;
  end if;

  -- Reserve eligibility belongs to the account, independently of Early Access supplying the higher limits.
  v_paid_account := exists (select 1 from private.campus_bot_plan(v_user_id, v_now, array['paid']));
  -- The platform's day; all admissions, including failed attempts, count against the spend guard.
  select count(*) into v_today from public.ai_usage_events
    where reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  if v_today >= v_policy.global_daily_generations
      - (case when v_paid_account then 0 else v_policy.paid_daily_reserve end) then
    return jsonb_build_object('state', 'capacity');
  end if;

  if v_allowance ->> 'mode' = 'tokens' then
    -- Each window's end is fixed when it opens.
    if v_session.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user_id, 'session', v_now, v_now + make_interval(hours => v_plan.session_hours)) returning * into v_session;
    end if;
    if v_week.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user_id, 'week', v_now, v_now + make_interval(days => v_plan.week_days)) returning * into v_week;
    end if;
  end if;
  insert into public.ai_usage_events (user_id, feature, funding_source, funding_grant_id, reserved_at, reserved_tokens,
      session_window_id, week_window_id)
    values (v_user_id, 'upload_practice', v_allowance ->> 'source', (v_allowance ->> 'grant_id')::uuid,
      v_now, v_reserved, v_session.id, v_week.id)
    returning id into v_event_id;
  insert into public.ai_practice_generations (user_id, request_id, document_id, institutional_course_id,
    usage_event_id, created_at, expires_at)
  values (v_user_id, p_request_id, p_document_id, v_document.institutional_course_id, v_event_id, v_now,
    v_now + make_interval(days => v_policy.set_retention_days))
  returning id into v_generation_id;
  if v_allowance ->> 'mode' in ('tokens', 'tester') then
    insert into private.campus_bot_requests (generation_id, step, model, provider_model, price_weight,
        written_token_weight, read_tokens_max, written_tokens_max)
      values (v_generation_id, 'writing', v_writing.model, v_writing.provider_model, v_writing.price_weight,
        v_written_weight, v_writing.read_tokens_max, v_writing.written_tokens_max);
    -- The server must use exactly this model and written-token cap: the set is charged at these weights.
    return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
      'reservation_seconds', v_policy.reservation_minutes * 60, 'total', null,
      'used', (v_allowance ->> 'used')::integer + 1, 'ends_at', v_allowance -> 'ends_at',
      'model', v_writing.provider_model, 'max_output_tokens', v_writing.written_tokens_max)
      || case when v_allowance ->> 'mode' = 'tester' then jsonb_build_object('funding', 'tester') else '{}'::jsonb end;
  end if;
  return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
      'reservation_seconds', v_policy.reservation_minutes * 60,
    'total', (v_allowance ->> 'total')::integer, 'used', (v_allowance ->> 'used')::integer + 1,
    'ends_at', v_allowance -> 'ends_at');
end;
$$;

create or replace function public.begin_campus_bot_topic_set(p_session_id uuid, p_request_id uuid, p_course_id uuid,
  p_item_id uuid, p_accepted_sources text[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_policy private.ai_practice_policy;
  v_settings private.campus_bot_settings;
  v_existing public.ai_practice_generations;
  v_topic record;
  v_words integer;
  v_institutional uuid;
  v_course_code text;
  v_course_title text;
  v_allowance jsonb;
  v_plan record;
  v_now timestamptz;
  v_refill_at timestamptz;
  v_grant uuid;
  v_attempts integer;
  v_undelivered integer;
  v_today integer;
  v_paid_account boolean;
  v_calculation boolean;
  v_writer private.campus_bot_models;
  v_checker private.campus_bot_models;
  v_writing private.campus_bot_request_caps;
  v_check private.campus_bot_request_caps;
  v_weight integer;
  v_reserved bigint;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_left bigint;
  v_event uuid;
  v_generation uuid;
  v_previous jsonb;
begin
  if p_request_id is null or p_course_id is null or p_item_id is null
      or coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'paid', 'test'] then
    raise exception 'Invalid topic set request' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform 1 from private.campus_bot_windows where user_id = v_user order by id for update;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day', 0));
  select * into strict v_policy from private.ai_practice_policy;
  select * into strict v_settings from private.campus_bot_settings;
  perform 1 from public.ai_practice_generations where user_id = v_user for update;
  if private.course_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;

  -- One reading of the clock, after every lock, with the refill epoch frozen (as sets do).
  select coalesce(max(r.at), '-infinity'::timestamptz) into v_refill_at
    from private.campus_bot_refills r where r.user_id = v_user or r.user_id is null;
  v_now := greatest(clock_timestamp(), v_refill_at + interval '1 microsecond');
  -- An abandoned request is released first, so replaying it reports a failure instead of a set in progress forever.
  perform private.release_abandoned_ai_generations(v_user, v_policy.reservation_minutes);

  -- Every check a new quiz passes comes first; a retry of a request passes them too before it is told anything about
  -- what it became.
  -- The topic: a published note of a course this student can read now, or the topic their free pass pinned.
  select * into v_topic from private.campus_bot_topic_context(v_user, p_course_id, p_item_id, v_now, 36000);
  if v_topic.state is distinct from 'ready' or v_topic.revision is null then
    return jsonb_build_object('state', case when v_topic.state = 'locked' then 'locked' else 'not-found' end);
  end if;
  -- Below 150 words a topic cannot carry five fair questions (lib/ai-practice/contract.ts minSourceWords).
  select coalesce(sum(cardinality(regexp_split_to_array(btrim(p.value ->> 'body'), '\s+'))), 0) into v_words
    from jsonb_array_elements(v_topic.passages) p;
  if v_words < 150 then return jsonb_build_object('state', 'too-short'); end if;
  select c.id, c.course_code, c.display_title into v_institutional, v_course_code, v_course_title
    from public.institutional_courses c where c.repository_course_id = p_course_id;
  if v_institutional is null then return jsonb_build_object('state', 'not-found'); end if;
  -- Funding: token plans by the windows, a free pass (or a test grant) by its count of sets. A student without Campus
  -- Bot now is told so, a retry included.
  v_allowance := private.ai_allowance_admission(v_user, p_accepted_sources);
  if v_allowance ->> 'state' in ('not-entitled', 'allowance-expired') then
    return jsonb_build_object('state', 'not-entitled');
  end if;

  -- The same request again, only now: what it became, bound to the course and topic it named. It comes before the switch,
  -- so a quiz being written when the switch goes off still reaches its page.
  select * into v_existing from public.ai_practice_generations where user_id = v_user and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.source_kind <> 'notes-topic' or v_existing.source_course_id is distinct from p_course_id
        or v_existing.source_item_id is distinct from p_item_id then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return jsonb_build_object('state', 'existing', 'generation_id', v_existing.id, 'status', v_existing.status);
  end if;
  if not v_settings.topic_sets_enabled then return jsonb_build_object('state', 'disabled'); end if;

  -- As an upload set's admission: a set in flight answers before the allowance does, so a second tap while a pass's one
  -- set is being written is told to wait, not that the pass is used (that set may still fail and leave it unused).
  if exists (select 1 from public.ai_practice_generations where user_id = v_user and status = 'running') then
    return jsonb_build_object('state', 'busy');
  end if;
  if v_allowance ->> 'state' = 'allowance-exhausted' then return jsonb_build_object('state', 'pass-used'); end if;
  if v_allowance ->> 'state' <> 'active' then return jsonb_build_object('state', 'not-entitled'); end if;
  if v_allowance ->> 'source' = 'trial' and private.is_discovery_grant((v_allowance ->> 'grant_id')::uuid) then
    -- The pass's provider attempts, uploads and topics together, delivered or not.
    v_grant := (v_allowance ->> 'grant_id')::uuid;
    select count(*) into v_attempts from public.ai_usage_events where funding_grant_id = v_grant;
    if v_attempts >= (select discovery_ai_attempts from private.entitlement_policy) then
      return jsonb_build_object('state', 'pass-used');
    end if;
  end if;

  -- Undelivered tries per student per UTC day (failures, refusals, abandoned requests), whatever funds them.
  select count(*) into v_undelivered from public.ai_usage_events
    where user_id = v_user and state = 'released'
      and reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  if v_undelivered >= v_policy.undelivered_per_day then
    return jsonb_build_object('state', 'undelivered-limit');
  end if;

  -- The writing model and caps; on a calculation course, the checking model and its caps too.
  v_calculation := exists (select 1 from private.campus_bot_courses k where k.course_id = p_course_id and k.calculation);
  select * into v_writer from private.campus_bot_models where model = v_settings.writing_model;
  select * into v_writing from private.campus_bot_request_caps where step = 'writing';
  if v_writer.provider_model is null or v_writing.step is null then return jsonb_build_object('state', 'capacity'); end if;
  if v_calculation then
    select * into v_checker from private.campus_bot_models where model = v_settings.check_model;
    select * into v_check from private.campus_bot_request_caps where step = 'check';
    if v_checker.provider_model is null or v_check.step is null then return jsonb_build_object('state', 'capacity'); end if;
  end if;

  -- Campus Bot limits: both windows must hold the set's worst case, the check included, both at the writer's weight.
  if v_allowance ->> 'mode' = 'tokens' then
    select * into v_plan from private.campus_bot_plan(v_user, v_now, p_accepted_sources);
    if v_plan.grant_id is distinct from (v_allowance ->> 'grant_id')::uuid then
      return jsonb_build_object('state', 'not-entitled');
    end if;
    v_weight := v_plan.written_token_weight;
    v_reserved := (v_writing.read_tokens_max + v_weight::bigint * v_writing.written_tokens_max) * v_writer.price_weight
      + case when v_calculation
          then (v_check.read_tokens_max + v_weight::bigint * v_check.written_tokens_max) * v_writer.price_weight
          else 0 end;
    select * into v_session from private.campus_bot_open_window(v_user, 'session', v_now, v_refill_at);
    select * into v_week from private.campus_bot_open_window(v_user, 'week', v_now, v_refill_at);
    select v_plan.session_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_session.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    select v_plan.week_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_week.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  elsif v_allowance ->> 'mode' = 'tester' then
    -- Owner tester access (20261125200000): no windows; the tester's daily cap on the UTC day instead.
    v_weight := private.tester_written_weight();
    v_reserved := (v_writing.read_tokens_max + v_weight::bigint * v_writing.written_tokens_max) * v_writer.price_weight
      + case when v_calculation
          then (v_check.read_tokens_max + v_weight::bigint * v_check.written_tokens_max) * v_writer.price_weight
          else 0 end;
    if private.tester_cap_left(v_user, v_now) < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', private.tester_day_end(v_now));
    end if;
  end if;

  -- The platform's day, shared with upload sets; requests not funded by a paid plan leave the paying students' reserve.
  v_paid_account := exists (select 1 from private.campus_bot_plan(v_user, v_now, array['paid']));
  select count(*) into v_today from public.ai_usage_events
    where reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  if v_today >= v_policy.global_daily_generations
      - (case when v_paid_account then 0 else v_policy.paid_daily_reserve end) then
    return jsonb_build_object('state', 'capacity');
  end if;

  if v_allowance ->> 'mode' = 'tokens' then
    -- Each window's end is fixed when it opens.
    if v_session.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'session', v_now, v_now + make_interval(hours => v_plan.session_hours)) returning * into v_session;
    end if;
    if v_week.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'week', v_now, v_now + make_interval(days => v_plan.week_days)) returning * into v_week;
    end if;
  end if;
  insert into public.ai_usage_events (user_id, feature, funding_source, funding_grant_id, reserved_at, reserved_tokens,
      session_window_id, week_window_id)
    values (v_user, 'topic_practice', v_allowance ->> 'source', (v_allowance ->> 'grant_id')::uuid, v_now, v_reserved,
      v_session.id, v_week.id)
    returning id into v_event;
  insert into public.ai_practice_generations (user_id, request_id, document_id, institutional_course_id, usage_event_id,
      created_at, expires_at, source_kind, source_course_id, source_item_id, source_revision)
    values (v_user, p_request_id, null, v_institutional, v_event, v_now,
      v_now + make_interval(days => v_policy.set_retention_days), 'notes-topic', p_course_id, p_item_id, v_topic.revision)
    returning id into v_generation;
  if v_allowance ->> 'mode' in ('tokens', 'tester') then
    insert into private.campus_bot_requests (generation_id, step, model, provider_model, price_weight,
        written_token_weight, read_tokens_max, written_tokens_max)
      values (v_generation, 'writing', v_writer.model, v_writer.provider_model, v_writer.price_weight, v_weight,
        v_writing.read_tokens_max, v_writing.written_tokens_max);
    if v_calculation then
      -- The check runs on the checking model and is charged at the writer's weight (owner decision, 16 Nov 2026).
      insert into private.campus_bot_requests (generation_id, step, model, provider_model, price_weight,
          written_token_weight, read_tokens_max, written_tokens_max)
        values (v_generation, 'check', v_checker.model, v_checker.provider_model, v_writer.price_weight, v_weight,
          v_check.read_tokens_max, v_check.written_tokens_max);
    end if;
  end if;

  -- The student's last ten questions on this topic, newest first: the new set must not repeat them.
  select coalesce(jsonb_agg(q.prompt order by q.created_at desc, q.position), '[]'::jsonb) into v_previous
    from (
      select g.created_at, x.position, x.question ->> 'prompt' as prompt
      from public.ai_practice_generations g
      cross join lateral jsonb_array_elements(g.question_set -> 'questions') with ordinality as x(question, position)
      where g.user_id = v_user and g.source_kind = 'notes-topic' and g.source_item_id = p_item_id
        and g.status = 'generated' and g.expires_at > v_now and jsonb_typeof(x.question -> 'prompt') = 'string'
      order by g.created_at desc, x.position
      limit 10
    ) q;

  -- The server must use exactly these models and token caps: it bounds each whole prompt by max_input_tokens before
  -- calling, so neither call can cost more than was reserved for it.
  return jsonb_build_object('state', 'started', 'generation_id', v_generation,
    'reservation_seconds', v_policy.reservation_minutes * 60,
    'model', v_writer.provider_model, 'max_input_tokens', v_writing.read_tokens_max,
    'max_output_tokens', v_writing.written_tokens_max,
    'check', case when v_calculation then jsonb_build_object('model', v_checker.provider_model,
      'max_input_tokens', v_check.read_tokens_max, 'max_output_tokens', v_check.written_tokens_max) end,
    'course', jsonb_build_object('code', v_course_code, 'title', v_course_title),
    'topic', jsonb_build_object('title', v_topic.title, 'number', v_topic.number, 'revision', v_topic.revision,
      'pinned', v_topic.pinned),
    'passages', v_topic.passages, 'previous', v_previous)
    || case when v_allowance ->> 'mode' = 'tester' then jsonb_build_object('funding', 'tester') else '{}'::jsonb end;
end;
$$;

create or replace function public.finish_campus_bot_topic_set(p_user_id uuid, p_generation_id uuid, p_status text,
  p_outcome_reason text, p_question_set jsonb, p_usage jsonb, p_check_usage jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation public.ai_practice_generations;
  v_count integer;
  v_status text := p_status;
  v_reason text := p_outcome_reason;
  v_set jsonb := p_question_set;
  v_at timestamptz;
begin
  if p_user_id is null or p_generation_id is null
      or p_status is null or p_status not in ('generated', 'insufficient_source', 'flagged_for_review', 'failed')
      or (p_status = 'generated') <> (p_question_set is not null)
      or (p_outcome_reason is not null and char_length(p_outcome_reason) > 40)
      or (p_usage is not null and jsonb_typeof(p_usage) <> 'object')
      or (p_check_usage is not null and jsonb_typeof(p_check_usage) <> 'object') then
    raise exception 'Invalid topic set result' using errcode = '22023';
  end if;
  if p_question_set is not null then
    -- The stored format is personal and unverified by construction, and names the notes topic it was written from.
    v_count := case when jsonb_typeof(p_question_set -> 'questions') = 'array'
      then jsonb_array_length(p_question_set -> 'questions') else 0 end;
    if jsonb_typeof(p_question_set) <> 'object' or p_question_set ->> 'formatVersion' is distinct from '1'
        or p_question_set ->> 'origin' is distinct from 'ai-generated'
        or p_question_set ->> 'visibility' is distinct from 'personal'
        or p_question_set ->> 'verification' is distinct from 'unverified' or v_count not between 1 and 5
        or p_question_set -> 'source' ->> 'kind' is distinct from 'notes-topic'
        or octet_length(p_question_set::text) > 65536 then
      raise exception 'Invalid question set' using errcode = '22023';
    end if;
  end if;
  -- Account row first, in the same order as scheduling and the deletion worker.
  perform private.lock_course_access_scope(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || p_user_id::text, 0));
  perform private.bind_pending_course_grants(p_user_id);
  select * into v_generation from public.ai_practice_generations
    where id = p_generation_id and user_id = p_user_id and source_kind = 'notes-topic' for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  perform 1 from public.ai_usage_events where id = v_generation.usage_event_id for update;
  if v_generation.status <> 'running' then
    return jsonb_build_object('state', 'already-finished', 'status', v_generation.status);
  end if;
  -- A set is for the topic and revision it was admitted for, and nothing else.
  if v_set is not null and (v_set -> 'source' ->> 'itemId' is distinct from v_generation.source_item_id::text
      or v_set -> 'source' ->> 'revision' is distinct from v_generation.source_revision::text) then
    raise exception 'Invalid question set' using errcode = '22023';
  end if;
  v_at := clock_timestamp();
  -- A set finished after deletion was scheduled can never be shown, so it is neither stored nor charged.
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    v_status := 'failed';
    v_reason := 'account-restricted';
    v_set := null;
  end if;
  -- A set is delivered only if a new quiz would still be written now: the topic still one this student may read (or
  -- the topic their pass still pins), and the grant that funds it still current. Otherwise it is neither stored nor
  -- charged, and its reservation is released. Topic sets have no exam block (owner decision, 16 November 2026).
  -- Paid grants' stored ends include payment slack: admission's funding function decides the effective semester,
  -- current term and department, and must still select the recorded grant at delivery.
  if v_status = 'generated' and ((select t.state from private.campus_bot_topic_context(p_user_id,
        v_generation.source_course_id, v_generation.source_item_id, v_at, 1) t) is distinct from 'ready'
      or not (exists (select 1 from public.ai_usage_events e join public.entitlement_grants g on g.id = e.funding_grant_id
        where e.id = v_generation.usage_event_id and g.user_id = p_user_id and g.revoked_at is null
          and g.starts_at <= v_at and g.ends_at > v_at
          and (g.source <> 'paid' or exists (
            select 1 from private.campus_bot_plan(p_user_id, v_at, array['paid']) f where f.grant_id = g.id)))
        -- Owner tester access (20261125200000): funded by the tester setting, still on now.
        or exists (select 1 from public.ai_usage_events e where e.id = v_generation.usage_event_id
          and e.funding_source = 'tester' and private.tester_access_active(p_user_id, v_at)))) then
    v_status := 'failed';
    v_reason := 'access-ended';
    v_set := null;
  end if;
  -- A free pass has one set to give: it is never spent on a partial or malformed one.
  if v_status = 'generated' and not private.discovery_ai_set_complete(v_set) and exists (
      select 1 from public.ai_usage_events event
      where event.id = v_generation.usage_event_id and private.is_discovery_grant(event.funding_grant_id)) then
    v_status := 'failed';
    v_reason := 'incomplete-set';
    v_set := null;
  end if;
  update public.ai_practice_generations
    set status = v_status, outcome_reason = v_reason, question_set = v_set, completed_at = v_at
    where id = p_generation_id;
  -- Each step is charged from the provider's own report at the weights copied at admission, and only for a delivered
  -- set. Read is every prompt token; a missing report (a timeout, or a check that never ran) counts nothing. A step is
  -- never charged more than was reserved for it, whatever the provider reports, so the writer and the check together
  -- never pass the set's reservation.
  update private.campus_bot_requests r
    set read_tokens = coalesce((u.usage ->> 'inputTokens')::bigint, 0)
        + coalesce((u.usage ->> 'cacheReadInputTokens')::bigint, 0)
        + coalesce((u.usage ->> 'cacheCreationInputTokens')::bigint, 0),
      written_tokens = coalesce((u.usage ->> 'outputTokens')::bigint, 0),
      charged_tokens = case when v_status = 'generated' then least(
        (r.read_tokens_max + r.written_token_weight * r.written_tokens_max) * r.price_weight,
        (coalesce((u.usage ->> 'inputTokens')::bigint, 0) + coalesce((u.usage ->> 'cacheReadInputTokens')::bigint, 0)
          + coalesce((u.usage ->> 'cacheCreationInputTokens')::bigint, 0)
          + r.written_token_weight * coalesce((u.usage ->> 'outputTokens')::bigint, 0)) * r.price_weight) else 0 end,
      settled_at = v_at
    from (values ('writing', p_usage), ('check', p_check_usage)) as u(step, usage)
    where r.generation_id = p_generation_id and r.step = u.step and r.settled_at is null;
  -- The usage row adds the two calls together. A model this build cannot price is never called, so a cost is known.
  update public.ai_usage_events
    set state = case when v_status = 'generated' then 'consumed' else 'released' end, settled_at = v_at,
        provider = p_usage ->> 'provider', model = p_usage ->> 'model',
        input_tokens = case when p_usage is null and p_check_usage is null then null
          else (coalesce((p_usage ->> 'inputTokens')::bigint, 0) + coalesce((p_check_usage ->> 'inputTokens')::bigint, 0))::integer end,
        output_tokens = case when p_usage is null and p_check_usage is null then null
          else (coalesce((p_usage ->> 'outputTokens')::bigint, 0) + coalesce((p_check_usage ->> 'outputTokens')::bigint, 0))::integer end,
        cache_read_input_tokens = case when p_usage is null and p_check_usage is null then null
          else (coalesce((p_usage ->> 'cacheReadInputTokens')::bigint, 0)
            + coalesce((p_check_usage ->> 'cacheReadInputTokens')::bigint, 0))::integer end,
        cache_creation_input_tokens = case when p_usage is null and p_check_usage is null then null
          else (coalesce((p_usage ->> 'cacheCreationInputTokens')::bigint, 0)
            + coalesce((p_check_usage ->> 'cacheCreationInputTokens')::bigint, 0))::integer end,
        cost_usd = case when p_usage is null and p_check_usage is null then null
          else coalesce((p_usage ->> 'estimatedCostUsd')::numeric, 0)
            + coalesce((p_check_usage ->> 'estimatedCostUsd')::numeric, 0) end,
        duration_ms = case when p_usage is null and p_check_usage is null then null
          else (coalesce((p_usage ->> 'durationMs')::bigint, 0) + coalesce((p_check_usage ->> 'durationMs')::bigint, 0))::integer end,
        charged_tokens = case when reserved_tokens is null then null else coalesce((select sum(r.charged_tokens)
          from private.campus_bot_requests r where r.generation_id = p_generation_id), 0) end
    where id = v_generation.usage_event_id and state = 'reserved';
  -- A delivered set is plan use for refunds, at the time it was admitted. Free courses are never recorded.
  if v_status = 'generated' then
    perform private.mark_plan_use(p_user_id, 'campus-bot-reply', v_generation.source_course_id, v_generation.id::text,
      (select e.reserved_at from public.ai_usage_events e where e.id = v_generation.usage_event_id));
  end if;
  return jsonb_build_object('state', 'finished', 'status', v_status);
end;
$$;

create or replace function public.begin_campus_bot_explanation(p_session_id uuid, p_attempt_id uuid, p_question_id uuid,
  p_generate boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_settings private.campus_bot_settings;
  v_attempt public.quiz_attempts;
  v_question public.quiz_attempt_questions;
  v_answer public.quiz_attempt_answers;
  v_saved private.campus_bot_explanations;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_payload jsonb;
  v_passages jsonb;
  v_chosen integer;
  v_now timestamptz;
  v_refill_at timestamptz;
  v_mode text;
  v_source text;
  v_grant uuid;
  v_session_hours integer;
  v_session_tokens integer;
  v_week_days integer;
  v_week_tokens integer;
  v_weight integer;
  v_model text;
  v_provider_model text;
  v_price_weight integer;
  v_read_max integer;
  v_written_max integer;
  v_calculation boolean;
  v_check_provider text;
  v_check_read_max integer;
  v_check_written_max integer;
  v_reserved bigint;
  v_left bigint;
  v_used integer;
  v_rows integer;
  v_reply uuid;
  v_course_code text;
  v_course_title text;
begin
  if p_session_id is null or p_attempt_id is null or p_question_id is null or p_generate is null then
    raise exception 'Invalid explanation request' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform 1 from private.campus_bot_windows where user_id = v_user order by id for update;
  select * into strict v_settings from private.campus_bot_settings;
  -- The locks may have waited past logout or expiry.
  if private.course_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not v_settings.explain_enabled then return jsonb_build_object('state', 'disabled'); end if;

  -- The attempt check. Only the student's own server-run attempt and a question pinned in it.
  select * into v_attempt from public.quiz_attempts
    where id = p_attempt_id and user_id = v_user and deadline_at is not null;
  select * into v_question from public.quiz_attempt_questions
    where attempt_id = p_attempt_id and question_id = p_question_id;
  if v_attempt.id is null or v_question.attempt_id is null then return jsonb_build_object('state', 'not-found'); end if;
  select * into v_answer from public.quiz_attempt_answers
    where attempt_id = p_attempt_id and question_id = p_question_id;
  -- Topic practice: only a question already answered (its answer row is written when it is picked). An exam: only
  -- once it is graded, and then any of its questions, answered or left out.
  if (v_attempt.mode = 'instant' and v_answer.attempt_id is null)
      or (v_attempt.mode is distinct from 'instant' and v_attempt.status = 'in_progress') then
    return jsonb_build_object('state', 'not-answered');
  end if;
  v_chosen := coalesce(v_answer.option_index, -1);

  -- One refill epoch and one reading of the clock for everything below.
  select coalesce(max(r.at), '-infinity'::timestamptz) into v_refill_at
    from private.campus_bot_refills r where r.user_id = v_user or r.user_id is null;
  v_now := greatest(clock_timestamp(), v_refill_at + interval '1 microsecond');

  -- Never while an exam is open in this course: a practice exam or the free pass exam.
  if private.campus_bot_exam_open(v_user, v_attempt.course_id, v_now) then
    return jsonb_build_object('state', 'exam-open');
  end if;
  -- The rule that shows or withholds an attempt's answers (private.practice_view).
  if not private.attempt_material_allowed(v_attempt) then return jsonb_build_object('state', 'locked'); end if;

  select f.mode, f.source, f.grant_id, f.session_hours, f.session_tokens, f.week_days, f.week_tokens,
      f.written_token_weight
    into v_mode, v_source, v_grant, v_session_hours, v_session_tokens, v_week_days, v_week_tokens, v_weight
    from private.campus_bot_reply_funding(v_user, v_now) f;
  if v_mode is null then return jsonb_build_object('state', 'not-entitled'); end if;

  -- The explanation for this revision and choice, saved once for everyone.
  perform pg_advisory_xact_lock(hashtextextended('campus-bot-explanation:' || v_question.item_id::text || ':'
    || v_question.content_revision::text || ':' || v_chosen::text, 0));
  select * into v_saved from private.campus_bot_explanations
    where item_id = v_question.item_id and revision = v_question.content_revision and chosen_option = v_chosen;
  if v_saved.item_id is not null and v_saved.state = 'running'
      and v_saved.started_at <= v_now - make_interval(secs => v_settings.reply_reservation_seconds) then
    -- Its writer never settled. The reply row first, then the explanation row, as finishing does. The writer's
    -- reply belongs to another student: never waited on (see release_abandoned_campus_bot_replies). If another
    -- transaction holds it, that one is settling or reclaiming it, so this request is simply busy.
    perform 1 from private.campus_bot_replies where id = v_saved.reply_id for update skip locked;
    if not found and exists (select 1 from private.campus_bot_replies where id = v_saved.reply_id) then
      return jsonb_build_object('state', 'busy');
    end if;
    update private.campus_bot_replies
      set state = 'released', outcome = 'abandoned', settled_at = v_now,
        charged_tokens = case when reserved_tokens is null then null else 0 end
      where id = v_saved.reply_id and state = 'reserved';
    delete from private.campus_bot_explanations
      where item_id = v_question.item_id and revision = v_question.content_revision and chosen_option = v_chosen
        and state = 'running';
    select * into v_saved from private.campus_bot_explanations
      where item_id = v_question.item_id and revision = v_question.content_revision and chosen_option = v_chosen;
  end if;
  if v_saved.item_id is not null and v_saved.state = 'running' then return jsonb_build_object('state', 'busy'); end if;
  if v_saved.item_id is not null then
    -- No provider call and no charge. On a free pass, the first delivery of an explanation to this student counts
    -- toward the pass's explanations, like one written for them; reading it again is free.
    if v_saved.outcome = 'explained' and v_mode = 'count' and not exists (select 1
        from private.campus_bot_pass_explanations x where x.grant_id = v_grant and x.item_id = v_question.item_id
          and x.revision = v_question.content_revision and x.chosen_option = v_chosen) then
      if private.campus_bot_pass_explanations_used(v_grant, v_now, v_settings.reply_reservation_seconds)
          >= v_settings.pass_explanations then
        return jsonb_build_object('state', 'pass-limit');
      end if;
      insert into private.campus_bot_pass_explanations (grant_id, item_id, revision, chosen_option, delivered_at)
        values (v_grant, v_question.item_id, v_question.content_revision, v_chosen, v_now);
    end if;
    -- Reading an explanation is still Campus Bot use on a paid course.
    if v_saved.outcome = 'explained' then
      perform private.mark_plan_use(v_user, 'campus-bot-message', v_attempt.course_id,
        private.campus_bot_explanation_ref(v_question.item_id, v_question.content_revision, v_chosen), v_now);
    end if;
    return jsonb_build_object('state', 'saved') || private.campus_bot_explanation_view(v_saved);
  end if;
  -- Nothing saved and the server cannot write one now.
  if not p_generate then return jsonb_build_object('state', 'disabled'); end if;

  perform private.release_abandoned_campus_bot_replies(v_user, v_now);
  if exists (select 1 from private.campus_bot_replies
      where user_id = v_user and feature = 'explain' and state = 'reserved') then
    return jsonb_build_object('state', 'busy');
  end if;
  if (select count(*) from private.campus_bot_replies where user_id = v_user and state = 'released'
        and reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc')
      >= v_settings.reply_undelivered_per_day then
    return jsonb_build_object('state', 'undelivered-limit');
  end if;

  -- The notes this question is explained from.
  select r.payload into v_payload from public.managed_content_revisions r
    where r.item_id = v_question.item_id and r.revision = v_question.content_revision;
  select coalesce(jsonb_agg(jsonb_build_object('item_id', s.item_id, 'topic_number', s.topic_number,
      'topic_title', s.topic_title, 'heading', s.heading, 'body', s.body) order by s.place), '[]'::jsonb)
    into v_passages
    from private.note_search(v_attempt.course_id,
      concat_ws(' ', v_payload ->> 'prompt', v_payload -> 'options' ->> ((v_payload ->> 'correctOption')::integer),
        case when v_chosen >= 0 then v_payload -> 'options' ->> v_chosen end),
      private.practice_topic_of(v_payload), 3, 9000) s;
  if jsonb_array_length(v_passages) = 0 then
    -- The notes do not cover it: saved without a provider call, and nothing is charged.
    insert into private.campus_bot_explanations (item_id, revision, chosen_option, course_id, state, outcome,
        started_at, finished_at)
      values (v_question.item_id, v_question.content_revision, v_chosen, v_attempt.course_id, 'done', 'not-covered',
        v_now, v_now);
    return jsonb_build_object('state', 'saved', 'outcome', 'not-covered', 'body', null, 'topic', null);
  end if;

  -- The writing model and this step's caps; on a calculation course the checking model and its caps too.
  select m.model, m.provider_model, m.price_weight into v_model, v_provider_model, v_price_weight
    from private.campus_bot_models m where m.model = v_settings.writing_model;
  select c.read_tokens_max, c.written_tokens_max into v_read_max, v_written_max
    from private.campus_bot_request_caps c where c.step = 'explain';
  v_calculation := exists (select 1 from private.campus_bot_courses c
    where c.course_id = v_attempt.course_id and c.calculation);
  if v_calculation then
    select m.provider_model into v_check_provider
      from private.campus_bot_models m where m.model = v_settings.explain_check_model;
    select c.read_tokens_max, c.written_tokens_max into v_check_read_max, v_check_written_max
      from private.campus_bot_request_caps c where c.step = 'explain-check';
  end if;
  if v_provider_model is null or v_read_max is null
      or (v_calculation and (v_check_provider is null or v_check_read_max is null)) then
    return jsonb_build_object('state', 'capacity');
  end if;

  if v_mode = 'tokens' then
    -- The worst case of the request: the writing call and, on a calculation course, the check at the writer's weight.
    v_reserved := (v_read_max + v_weight::bigint * v_written_max
      + case when v_calculation then v_check_read_max + v_weight::bigint * v_check_written_max else 0 end) * v_price_weight;
    select * into v_session from private.campus_bot_open_window(v_user, 'session', v_now, v_refill_at);
    select * into v_week from private.campus_bot_open_window(v_user, 'week', v_now, v_refill_at);
    select v_session_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_session.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    select v_week_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_week.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  elsif v_mode = 'tester' then
    -- Owner tester access (20261125200000): no windows; the tester's daily cap on the UTC day instead.
    v_reserved := (v_read_max + v_weight::bigint * v_written_max
      + case when v_calculation then v_check_read_max + v_weight::bigint * v_check_written_max else 0 end) * v_price_weight;
    if private.tester_cap_left(v_user, v_now) < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', private.tester_day_end(v_now));
    end if;
  else
    v_used := private.campus_bot_pass_explanations_used(v_grant, v_now, v_settings.reply_reservation_seconds);
    if v_used >= v_settings.pass_explanations then return jsonb_build_object('state', 'pass-limit'); end if;
  end if;

  -- The platform's day. The row lock makes the count exact without a lock every student queues on.
  insert into private.campus_bot_reply_days as d (day, feature, admitted)
    select (v_now at time zone 'utc')::date, 'explain', 1 where v_settings.daily_explanations > 0
    on conflict (day, feature) do update set admitted = d.admitted + 1
      where d.admitted < v_settings.daily_explanations;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('state', 'capacity'); end if;

  if v_mode = 'tokens' then
    -- Each window's end is fixed when it opens.
    if v_session.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'session', v_now, v_now + make_interval(hours => v_session_hours)) returning * into v_session;
    end if;
    if v_week.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'week', v_now, v_now + make_interval(days => v_week_days)) returning * into v_week;
    end if;
  end if;
  insert into private.campus_bot_replies (user_id, feature, course_id, funding_source, funding_grant_id,
      session_window_id, week_window_id, reserved_tokens, model, provider_model, price_weight, written_token_weight,
      read_tokens_max, written_tokens_max, check_provider_model, reserved_at)
    values (v_user, 'explain', v_attempt.course_id, v_source, v_grant, v_session.id, v_week.id, v_reserved, v_model,
      v_provider_model, v_price_weight, v_weight, v_read_max, v_written_max, v_check_provider, v_now)
    returning id into v_reply;
  insert into private.campus_bot_explanations (item_id, revision, chosen_option, course_id, state, reply_id, started_at)
    values (v_question.item_id, v_question.content_revision, v_chosen, v_attempt.course_id, 'running', v_reply, v_now);

  select c.course_code, c.display_title into v_course_code, v_course_title
    from public.institutional_courses c where c.repository_course_id = v_attempt.course_id;
  -- The server must use exactly these models and token caps (it bounds the whole prompt by max_input_tokens before
  -- calling): the reply is charged at the weights recorded here, and never more than was reserved.
  return jsonb_build_object('state', 'started', 'reply_id', v_reply, 'model', v_provider_model,
    'max_input_tokens', v_read_max, 'max_output_tokens', v_written_max,
    'reservation_seconds', v_settings.reply_reservation_seconds,
    'check', case when v_calculation then jsonb_build_object('model', v_check_provider,
      'max_input_tokens', v_check_read_max, 'max_output_tokens', v_check_written_max) end,
    'course', jsonb_build_object('code', v_course_code, 'title', v_course_title),
    'question', jsonb_build_object('prompt', v_payload -> 'prompt', 'options', v_payload -> 'options',
      'correct_option', v_payload -> 'correctOption', 'chosen_option', case when v_chosen >= 0 then v_chosen end,
      'explanation', private.practice_explanation(v_payload)),
    'passages', v_passages)
    || case when v_mode = 'tester' then jsonb_build_object('funding', 'tester') else '{}'::jsonb end;
end;
$$;

create or replace function public.begin_campus_bot_chat(p_session_id uuid, p_request_id uuid, p_course_id uuid, p_item_id uuid,
  p_generate boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_settings private.campus_bot_settings;
  v_existing private.campus_bot_replies;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_topic_state text;
  v_passages jsonb;
  v_title text;
  v_now timestamptz;
  v_refill_at timestamptz;
  v_mode text;
  v_source text;
  v_grant uuid;
  v_session_hours integer;
  v_session_tokens integer;
  v_week_days integer;
  v_week_tokens integer;
  v_weight integer;
  v_model text;
  v_provider_model text;
  v_price_weight integer;
  v_read_max integer;
  v_written_max integer;
  v_reserved bigint;
  v_left bigint;
  v_used integer;
  v_rows integer;
  v_reply uuid;
  v_course_code text;
  v_course_title text;
begin
  if p_session_id is null or p_request_id is null or p_course_id is null or p_item_id is null or p_generate is null then
    raise exception 'Invalid chat request' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform 1 from private.campus_bot_windows where user_id = v_user order by id for update;
  select * into strict v_settings from private.campus_bot_settings;
  if private.course_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not v_settings.ask_enabled then return jsonb_build_object('state', 'disabled'); end if;

  select coalesce(max(r.at), '-infinity'::timestamptz) into v_refill_at
    from private.campus_bot_refills r where r.user_id = v_user or r.user_id is null;
  v_now := greatest(clock_timestamp(), v_refill_at + interval '1 microsecond');
  perform private.release_abandoned_campus_bot_replies(v_user, v_now);
  update private.campus_bot_replies set reply = null
    where user_id = v_user and reply is not null and reply_expires_at <= v_now;

  -- The topic, by the rule "Practise this topic" shares (private.campus_bot_topic_context).
  select t.state, t.title, t.passages into v_topic_state, v_title, v_passages
    from private.campus_bot_topic_context(v_user, p_course_id, p_item_id, v_now, 36000) t;
  if v_topic_state <> 'ready' then return jsonb_build_object('state', v_topic_state); end if;

  -- Not while an exam is open in this course.
  if private.campus_bot_exam_open(v_user, p_course_id, v_now) then
    return jsonb_build_object('state', 'exam-open');
  end if;

  select f.mode, f.source, f.grant_id, f.session_hours, f.session_tokens, f.week_days, f.week_tokens,
      f.written_token_weight
    into v_mode, v_source, v_grant, v_session_hours, v_session_tokens, v_week_days, v_week_tokens, v_weight
    from private.campus_bot_reply_funding(v_user, v_now) f;
  if v_mode is null then return jsonb_build_object('state', 'not-entitled'); end if;

  -- The same message again, only after every check above, so a retry gets what a new message would. It is bound to
  -- the course and topic it was asked about. Still being answered: wait. Answered: the kept reply, free, while it is
  -- kept.
  select * into v_existing from private.campus_bot_replies
    where user_id = v_user and request_id = p_request_id and state <> 'released';
  if v_existing.id is not null and (v_existing.course_id <> p_course_id or v_existing.item_id <> p_item_id) then
    return jsonb_build_object('state', 'not-found');
  end if;
  if v_existing.id is not null and v_existing.state = 'reserved' then return jsonb_build_object('state', 'busy'); end if;
  if v_existing.id is not null then
    return jsonb_build_object('state', 'answered', 'reply', v_existing.reply);
  end if;
  if not p_generate then return jsonb_build_object('state', 'disabled'); end if;

  if exists (select 1 from private.campus_bot_replies
      where user_id = v_user and feature = 'chat' and state = 'reserved') then
    return jsonb_build_object('state', 'busy');
  end if;
  if (select count(*) from private.campus_bot_replies where user_id = v_user and state = 'released'
        and reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc')
      >= v_settings.reply_undelivered_per_day then
    return jsonb_build_object('state', 'undelivered-limit');
  end if;

  select m.model, m.provider_model, m.price_weight into v_model, v_provider_model, v_price_weight
    from private.campus_bot_models m where m.model = v_settings.writing_model;
  select c.read_tokens_max, c.written_tokens_max into v_read_max, v_written_max
    from private.campus_bot_request_caps c where c.step = 'chat';
  if v_provider_model is null or v_read_max is null then return jsonb_build_object('state', 'capacity'); end if;

  if v_mode = 'tokens' then
    v_reserved := (v_read_max + v_weight::bigint * v_written_max) * v_price_weight;
    select * into v_session from private.campus_bot_open_window(v_user, 'session', v_now, v_refill_at);
    select * into v_week from private.campus_bot_open_window(v_user, 'week', v_now, v_refill_at);
    select v_session_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_session.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    select v_week_tokens - u.used - u.in_flight into v_left from private.campus_bot_window_use(v_week.id) u;
    if v_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  elsif v_mode = 'tester' then
    -- Owner tester access (20261125200000): no windows; the tester's daily cap on the UTC day instead.
    v_reserved := (v_read_max + v_weight::bigint * v_written_max) * v_price_weight;
    if private.tester_cap_left(v_user, v_now) < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', private.tester_day_end(v_now));
    end if;
  else
    select count(*) into v_used from private.campus_bot_replies r
      where r.funding_grant_id = v_grant and r.feature = 'chat' and (r.state = 'consumed' or (r.state = 'reserved'
        and r.reserved_at > v_now - make_interval(secs => v_settings.reply_reservation_seconds)));
    if v_used >= v_settings.pass_chat_messages then return jsonb_build_object('state', 'pass-limit'); end if;
  end if;

  insert into private.campus_bot_reply_days as d (day, feature, admitted)
    select (v_now at time zone 'utc')::date, 'chat', 1 where v_settings.daily_chat_messages > 0
    on conflict (day, feature) do update set admitted = d.admitted + 1
      where d.admitted < v_settings.daily_chat_messages;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return jsonb_build_object('state', 'capacity'); end if;

  if v_mode = 'tokens' then
    if v_session.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'session', v_now, v_now + make_interval(hours => v_session_hours)) returning * into v_session;
    end if;
    if v_week.id is null then
      insert into private.campus_bot_windows (user_id, kind, starts_at, ends_at)
        values (v_user, 'week', v_now, v_now + make_interval(days => v_week_days)) returning * into v_week;
    end if;
  end if;
  insert into private.campus_bot_replies (user_id, feature, request_id, item_id, course_id, funding_source,
      funding_grant_id, session_window_id, week_window_id, reserved_tokens, model, provider_model, price_weight,
      written_token_weight, read_tokens_max, written_tokens_max, reserved_at)
    values (v_user, 'chat', p_request_id, p_item_id, p_course_id, v_source, v_grant, v_session.id, v_week.id, v_reserved,
      v_model,
      v_provider_model, v_price_weight, v_weight, v_read_max, v_written_max, v_now)
    returning id into v_reply;

  select c.course_code, c.display_title into v_course_code, v_course_title
    from public.institutional_courses c where c.repository_course_id = p_course_id;
  return jsonb_build_object('state', 'started', 'reply_id', v_reply, 'model', v_provider_model,
    'max_input_tokens', v_read_max, 'max_output_tokens', v_written_max,
    'reservation_seconds', v_settings.reply_reservation_seconds,
    'course', jsonb_build_object('code', v_course_code, 'title', v_course_title),
    'topic', jsonb_build_object('title', v_title), 'passages', v_passages)
    || case when v_mode = 'tester' then jsonb_build_object('funding', 'tester') else '{}'::jsonb end;
end;
$$;

create or replace function public.get_my_entitlement() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_policy private.entitlement_policy;
  v_access public.entitlement_grants;
  v_access_ends timestamptz;
  v_sales_open boolean;
  v_term record;
  v_trial public.entitlement_grants;
  v_early_grant public.entitlement_grants;
  v_early jsonb;
  v_trial_status text;
  v_tester_ends timestamptz;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  v_early := private.early_access_status(v_user_id);
  if v_early->>'status' = 'eligible' then
    perform private.reconcile_early_access(v_user_id, 'system:plan-read');
    v_early := private.early_access_status(v_user_id);
  end if;
  select * into strict v_policy from private.entitlement_policy;
  -- The same grants private.has_full_access() counts: a seven-day trial is full access, a Discovery Pass is not.
  -- Part 3: a paid plan's grant counts within its effective end (its semester), never in the stored slack.
  select g.* into v_access from public.entitlement_grants g
    where g.user_id = v_user_id and (g.source <> 'trial' or g.trial_policy = 'seven-day') and g.revoked_at is null
      and g.starts_at <= clock_timestamp() and g.ends_at > clock_timestamp()
      and (g.order_id is null or private.grant_effective_end(g) > clock_timestamp())
    order by coalesce(private.grant_effective_end(g), g.ends_at) desc limit 1;
  v_access_ends := case when v_access.order_id is not null then private.grant_effective_end(v_access) else v_access.ends_at end;
  -- Owner tester access (20261125200000): full access until it ends, and no plans on offer.
  v_tester_ends := private.tester_access_ends(v_user_id, clock_timestamp());
  select sales_open into v_sales_open from private.payment_policy;
  -- The semester the student is in now, by their department's calendar (whether or not their courses are confirmed).
  select at.session_label, ap.key as period_key, ap.display_name as period_name, t.ends_at into v_term
    from public.profiles p cross join lateral private.access_term_at(p.department_id, clock_timestamp()) t
    join private.academic_terms at on at.id = t.term_id join public.academic_periods ap on ap.id = t.academic_period_id
    where p.id = v_user_id and p.department_id is not null;
  select * into v_trial from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  select * into v_early_grant from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;

  v_trial_status := case
    when v_trial.id is not null then
      case when v_trial.revoked_at is null and v_trial.starts_at <= clock_timestamp() and v_trial.ends_at > clock_timestamp()
        then 'active' else 'ended' end
    when private.discovery_early_access_bars(v_user_id) then 'not-offered'
    else 'available' end;

  return jsonb_build_object(
    'now', clock_timestamp(),
    'planned_launch_at', v_policy.planned_launch_at,
    'actual_launch_at', v_policy.actual_launch_at,
    'trial_hours', v_policy.discovery_hours,
    'trial_days', ceil(v_policy.discovery_hours / 24.0)::integer,
    'expiry_notice_hours', v_policy.expiry_notice_hours,
    'tier', case when v_access.id is null and v_tester_ends is null then 'free' else 'full' end,
    'access', case when v_tester_ends is not null then jsonb_build_object('source', 'tester', 'ends_at', v_tester_ends)
      when v_access.id is null then null
      else jsonb_build_object('source', v_access.source, 'ends_at', v_access_ends) end,
    'trial', jsonb_build_object('status', v_trial_status, 'policy', v_trial.trial_policy,
      'starts_at', v_trial.starts_at, 'ends_at', v_trial.ends_at,
      'available_from', case when v_trial_status = 'after-early-access' then v_early_grant.ends_at end),
    'discovery', jsonb_build_object(
      'cbt_questions', v_policy.discovery_cbt_questions,
      'ai_sets', coalesce(case when v_trial.trial_policy = 'discovery' then v_trial.ai_units end,
        v_policy.discovery_ai_generations),
      'previews', coalesce((select jsonb_agg(jsonb_build_object('kind', p.kind, 'content_key', c.content_key,
          'submitted', p.submitted_at is not null) order by p.kind)
        from private.discovery_previews p join public.courses c on c.id = p.course_id
        where p.grant_id = v_trial.id), '[]'::jsonb)),
    'early_access', jsonb_build_object(
      'status', case when v_early->>'status' = 'eligible' then 'pending' else v_early->>'status' end,
      'starts_at', v_early->'starts_at', 'ends_at', v_early->'ends_at',
      'enrollment_closes_at', case when v_policy.actual_launch_at is null then null
        else v_policy.actual_launch_at + make_interval(days => v_policy.early_access_enrollment_days) end),
    -- Rollout compatibility only: builds from before this migration require the key. There is no code any more.
    'otp', null,
    -- Part 3: the copy switch (payment_policy.sales_open), the plans on sale with their catalogue prices, the semester
    -- they are for, the student's paid plan and their receipts. Plans and prices are offered only while sales are open;
    -- a Session plan only during a First Semester.
    'plans_on_sale', coalesce(v_sales_open, false),
    'term', case when v_term.session_label is null then null else jsonb_build_object('session_label', v_term.session_label,
      'period_key', v_term.period_key, 'period_name', v_term.period_name, 'ends_at', v_term.ends_at) end,
    'plans', case when coalesce(v_sales_open, false) and v_tester_ends is null then coalesce((select jsonb_agg(jsonb_build_object('plan', c.plan_key,
        'tier', c.tier, 'period', c.period, 'price_kobo', c.price_kobo) order by c.tier desc, c.period desc)
      from private.plan_catalogue c where c.active
        and (c.period = 'semester' or v_term.period_key is null or v_term.period_key = 'first-semester')), '[]'::jsonb)
      else '[]'::jsonb end,
    'paid', (select jsonb_build_object('plan', o.plan_key, 'tier', o.tier, 'period', o.period, 'order_id', o.id,
        'amount_kobo', o.amount_kobo, 'paid_at', o.paid_at, 'first_ends_at', private.grant_effective_end(g1),
        'second_starts_at', g2.starts_at, 'second_ends_at', private.grant_effective_end(g2),
        'term_session_label', o.term_session_label,
        -- The semester this plan was bought for (a Semester plan can be for the First or the Second Semester).
        'period_key', (select ap.key from public.academic_periods ap where ap.id = o.term_period_id),
        'period_name', (select ap.display_name from public.academic_periods ap where ap.id = o.term_period_id))
      from private.payment_orders o
      join public.entitlement_grants g1 on g1.order_id = o.id and g1.plan_part = 1 and g1.revoked_at is null
      left join public.entitlement_grants g2 on g2.order_id = o.id and g2.plan_part = 2 and g2.revoked_at is null
      where o.user_id = v_user_id and o.status = 'paid'
        and coalesce(private.grant_effective_end(g2), g2.ends_at, private.grant_effective_end(g1)) > clock_timestamp()
      order by o.paid_at desc limit 1),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('order_id', o.id, 'plan', o.plan_key, 'amount_kobo', o.amount_kobo,
        'paid_at', o.paid_at, 'status', case when o.status = 'refund-failed' then 'refund-pending' else o.status end)
        order by o.paid_at desc)
      from (select * from private.payment_orders where user_id = v_user_id
        and status in ('paid', 'paid-duplicate', 'refund-pending', 'refund-failed', 'refunded')
        order by paid_at desc limit 20) o), '[]'::jsonb));
end;
$$;

create or replace function private.discovery_email_allowed(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from auth.users u where u.id=p_user and
    split_part(lower(u.email),'@',2) = any(array['10minutemail.com','10minutemail.net','guerrillamail.com',
      'guerrillamail.net','guerrillamail.org','sharklasers.com','grr.la','mailinator.com','maildrop.cc',
      'temp-mail.org','tempmail.com','yopmail.com','yopmail.fr','getnada.com','dispostable.com','trashmail.com']))
    -- Owner tester access (20261125200000): no free pass or free month while it is on.
    and not private.tester_access_active(p_user, clock_timestamp())
$$;

create or replace function private.attempt_review_unavailable_reason(p_attempt public.quiz_attempts) returns text
language sql stable security definer set search_path = '' as $$
  select case when not private.has_full_access(p_attempt.user_id)
      and not private.tester_access_active(p_attempt.user_id, clock_timestamp()) then 'needs-plan'
    when d.reason = 'needs-selection' then 'needs-selection'
    when d.reason = 'outside-list' then 'outside-list'
    else 'needs-plan' end
  from private.course_access_decision(p_attempt.user_id,
    (select id from public.institutional_courses where repository_course_id = p_attempt.course_id),
    clock_timestamp()) d;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. New functions are locked down; only the two operator functions are callable, by the service role.
-- ---------------------------------------------------------------------------
revoke all on function private.tester_access_ends(uuid, timestamptz), private.tester_access_active(uuid, timestamptz),
  private.tester_written_weight(), private.tester_day_end(timestamptz),
  private.tester_cap_use(uuid, timestamptz), private.tester_cap_left(uuid, timestamptz),
  public.admin_set_tester_access(uuid, text, integer, bigint, text, text), public.admin_tester_status(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_set_tester_access(uuid, text, integer, bigint, text, text),
  public.admin_tester_status(uuid) to service_role;
