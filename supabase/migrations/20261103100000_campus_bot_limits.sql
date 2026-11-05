-- supabase/migrations/20261103100000_campus_bot_limits.sql — Payments part 2b: Campus Bot token limits and paid AI.
-- Builds on A2 (20261101120000, 20261102180000) and part 1 (20261102100000); every A2 function redefined here was taken
-- from that head and changed only where marked.
--
-- Funding. A paid grant bound to the student's current term, within its effective end (no slack, and a Session plan's
-- second half funds nothing before its term), or an active Early Access grant (Plus limits during the free month), funds
-- Campus Bot sets by tokens. The higher tier wins and limits are never added together; between equal tiers Early
-- Access funds. Limits are read live from the grant's tier in campus_bot_tiers. Otherwise the existing rules apply:
-- a Discovery Pass keeps its one set and a seven-day trial its sets. plan_catalogue.ai_sets_per_term no longer limits
-- anything (new orders store 0; the column is dropped after part 3).
--
-- Tokens. A request costs (read + written_token_weight x written) x the model's price_weight, from the provider's own
-- usage report: read is every prompt token (input, cache reads and cache writes), written every output token. The
-- weights and the model are copied onto the request at admission. Only a delivered set is charged; a failure, a
-- timeout, a refusal, a flagged, truncated, invalid or low-confidence result and an unknown (abandoned) result charge 0.
--
-- Windows. A session window (session_hours) opens at the first admitted request when none is open, and a week window
-- (week_days, rolling) at the first request of that week; each window's end is stored when it opens, so a reset time a
-- student has seen never moves. A set starts only when both windows have its worst-case cost left (writing step, plus
-- the check step when enabled); a started set always finishes and is charged to the windows it reserved from, which may
-- end below zero. A refill (one student or everyone) makes the next request open fresh windows; nothing is deleted.
--
-- Platform. ai_practice_policy.global_daily_generations (500) per UTC day for everyone; requests not funded by a paid
-- plan stop paid_daily_reserve (150) short of it. Each student has undelivered_per_day (10) undelivered tries per day.
-- Existing controls stay: uploads per day, one generation in flight.
--
-- Also: a set that finishes after access ends is kept and charged (it was admitted while access lasted); no Discovery
-- Pass is offered after any paid grant, ever, and an open free-pass exam survives buying a plan; plan use for refunds is
-- recorded with the allowed read (record_plan_use: notes topics, theory reveals) or the delivery (Campus Bot sets).
--
-- Lock order: A1's write prefix (lock_course_access_scope: Auth user, entitlement account, profile, academic calendar),
-- then the feature lock (ai-practice-generation:<user>), pending binding, the student's window rows, the platform day
-- lock, then generation, document and usage rows. Reads (get_my_campus_bot_usage, record_plan_use's opening) take A2's
-- shared read opening and never upgrade it. Refills and settings take no account lock.

-- ---------------------------------------------------------------------------
-- Settings.
-- ---------------------------------------------------------------------------
alter table private.ai_practice_policy
  add column paid_daily_reserve integer not null default 150 check (paid_daily_reserve >= 0),
  -- A reserve above the day's total leaves nothing for unpaid requests; 0 a day stops everyone (an emergency stop).
  add column undelivered_per_day integer not null default 10 check (undelivered_per_day between 0 and 1000);

-- The provider's id for each weighted model; a model the server may be asked to use must have one.
alter table private.campus_bot_models
  add column provider_model text unique check (provider_model ~ '^claude-[a-z0-9-]{1,60}$');
update private.campus_bot_models set provider_model = case model when 'haiku' then 'claude-haiku-5-5'
  when 'sonnet' then 'claude-sonnet-5-5' end where model in ('haiku', 'sonnet');

-- The team's model choice per step. Haiku writes; the check step (later) has its own model, caps and weight.
create table private.campus_bot_settings (
  singleton boolean primary key default true check (singleton),
  writing_model text not null references private.campus_bot_models (model) on delete restrict,
  check_model text references private.campus_bot_models (model) on delete restrict,
  check_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120),
  constraint campus_bot_settings_check_step check (not check_enabled or check_model is not null)
);
insert into private.campus_bot_settings (writing_model, updated_by) values ('haiku', 'migration:20261103100000');

-- Paid plans have no per-semester set count.
update private.plan_catalogue set ai_sets_per_term = 0, updated_at = now(), updated_by = 'migration:20261103100000'
  where ai_sets_per_term <> 0;
alter table private.plan_catalogue add constraint plan_catalogue_ai_sets_retired_check check (ai_sets_per_term = 0);
comment on column private.plan_catalogue.ai_sets_per_term is
  'Retired by 20261103100000 (Campus Bot is limited by tokens): not read, new orders store 0, dropped after part 3.';

-- ---------------------------------------------------------------------------
-- Windows, refills and requests.
-- ---------------------------------------------------------------------------
create table private.campus_bot_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('session', 'week')),
  starts_at timestamptz not null,
  -- Stored when the window opens: later setting changes never move a reset a student has seen.
  ends_at timestamptz not null,
  constraint campus_bot_windows_range_check check (ends_at > starts_at)
);
create index campus_bot_windows_user_idx on private.campus_bot_windows (user_id, kind, starts_at desc);

-- user_id null: everyone.
create table private.campus_bot_refills (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  actor text not null check (char_length(actor) between 1 and 120),
  reason text not null check (char_length(btrim(reason)) between 3 and 500)
);
create index campus_bot_refills_user_idx on private.campus_bot_refills (user_id, at desc);

-- One row per provider call of a token-funded set, with the model and weights copied at admission.
create table private.campus_bot_requests (
  generation_id uuid not null references public.ai_practice_generations (id) on delete cascade,
  step text not null check (step in ('writing', 'check')),
  model text not null,
  provider_model text not null,
  price_weight integer not null check (price_weight between 1 and 1000),
  written_token_weight integer not null check (written_token_weight between 1 and 100),
  read_tokens_max integer not null check (read_tokens_max > 0),
  written_tokens_max integer not null check (written_tokens_max > 0),
  read_tokens bigint check (read_tokens >= 0),
  written_tokens bigint check (written_tokens >= 0),
  charged_tokens bigint check (charged_tokens >= 0),
  settled_at timestamptz,
  primary key (generation_id, step)
);

alter table public.ai_usage_events
  add column reserved_tokens bigint check (reserved_tokens >= 0),
  add column charged_tokens bigint check (charged_tokens >= 0),
  add column session_window_id uuid references private.campus_bot_windows (id) on delete set null,
  add column week_window_id uuid references private.campus_bot_windows (id) on delete set null,
  add constraint ai_usage_events_tokens_check check (reserved_tokens is null
    or (funding_source in ('paid', 'early_access') and session_window_id is not null and week_window_id is not null));
create index ai_usage_events_session_window_idx on public.ai_usage_events (session_window_id)
  where session_window_id is not null;
create index ai_usage_events_week_window_idx on public.ai_usage_events (week_window_id) where week_window_id is not null;

alter table private.campus_bot_settings enable row level security;
alter table private.campus_bot_windows enable row level security;
alter table private.campus_bot_refills enable row level security;
alter table private.campus_bot_requests enable row level security;
revoke all on table private.campus_bot_settings, private.campus_bot_windows, private.campus_bot_refills,
  private.campus_bot_requests from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Token funding and limits.
-- ---------------------------------------------------------------------------
-- The student's token funding at p_at among p_sources, with the tier's live limits. Paid: bound to the current term
-- and department, started, and within the effective end (capped at the semester end). Early Access: Plus while active.
create function private.campus_bot_plan(p_user uuid, p_at timestamptz, p_sources text[])
returns table (source text, grant_id uuid, tier text, ends_at timestamptz, session_hours integer, session_tokens integer,
  week_days integer, week_tokens integer, written_token_weight integer)
language sql stable security definer set search_path = '' as $$
  with scope as (select private.current_course_scope(p_user, p_at) as s),
  candidates as (
    select 'paid'::text as source, g.id, g.campus_bot_tier as tier, private.grant_effective_end(g) as ends_at
      from public.entitlement_grants g cross join scope
      where 'paid' = any (p_sources) and g.user_id = p_user and g.source = 'paid' and g.order_id is not null
        and g.revoked_at is null and g.starts_at <= p_at and private.grant_effective_end(g) > p_at
        and scope.s->>'state' = 'ready' and g.course_term_id = (scope.s->>'term_id')::uuid
        and g.course_department_id = (scope.s->>'department_id')::uuid
    union all
    select 'early_access', g.id, 'plus', g.ends_at from public.entitlement_grants g
      where 'early_access' = any (p_sources) and g.user_id = p_user and g.source = 'early_access'
        and g.revoked_at is null and g.starts_at <= p_at and g.ends_at > p_at
  )
  select c.source, c.id, c.tier, c.ends_at, t.session_hours, t.session_tokens, t.week_days, t.week_tokens,
    t.written_token_weight
  from candidates c join private.campus_bot_tiers t on t.tier = c.tier
  order by (c.tier = 'plus') desc, (c.source = 'early_access') desc, c.ends_at desc, c.id
  limit 1;
$$;

-- The writing step's model and caps, and the worst-case cost of one set: the writing step plus, when enabled, the
-- check step, each at its own caps and model weight.
create function private.campus_bot_writing(p_written_token_weight integer)
returns table (model text, provider_model text, price_weight integer, read_tokens_max integer,
  written_tokens_max integer, set_max bigint)
language sql stable security definer set search_path = '' as $$
  select m.model, m.provider_model, m.price_weight, c.read_tokens_max, c.written_tokens_max,
    (c.read_tokens_max + p_written_token_weight::bigint * c.written_tokens_max) * m.price_weight
      + coalesce((select (k.read_tokens_max + p_written_token_weight::bigint * k.written_tokens_max) * km.price_weight
          from private.campus_bot_request_caps k join private.campus_bot_models km on km.model = s.check_model
          where s.check_enabled and k.step = 'check'), 0)
  from private.campus_bot_settings s
  join private.campus_bot_models m on m.model = s.writing_model
  join private.campus_bot_request_caps c on c.step = 'writing';
$$;

-- The student's running window of a kind: the latest opened after the last refill that applies to them.
create function private.campus_bot_open_window(p_user uuid, p_kind text, p_at timestamptz)
returns setof private.campus_bot_windows
language sql stable security definer set search_path = '' as $$
  select w.* from private.campus_bot_windows w
  where w.user_id = p_user and w.kind = p_kind and w.starts_at <= p_at and w.ends_at > p_at
    and w.starts_at > coalesce((select max(r.at) from private.campus_bot_refills r
      where r.user_id = p_user or r.user_id is null), '-infinity'::timestamptz)
  order by w.starts_at desc
  limit 1;
$$;

-- Charged tokens of delivered sets in a window, and the worst-case cost of sets still in flight.
create function private.campus_bot_window_use(p_window uuid, out used bigint, out in_flight bigint)
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(e.charged_tokens) filter (where e.state = 'consumed'), 0)::bigint,
    coalesce(sum(e.reserved_tokens) filter (where e.state = 'reserved'
      and e.reserved_at > clock_timestamp() - make_interval(mins => p.reservation_minutes)), 0)::bigint
  from public.ai_usage_events e cross join private.ai_practice_policy p
  where p_window is not null and (e.session_window_id = p_window or e.week_window_id = p_window);
$$;

-- A window as the student sees it; a window not yet opened has its whole limit and no reset time.
create function private.campus_bot_window_view(p_window private.campus_bot_windows, p_limit integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('limit', p_limit, 'used', u.used, 'in_flight', u.in_flight,
    'left', p_limit - u.used - u.in_flight, 'resets_at', p_window.ends_at)
  from private.campus_bot_window_use(p_window.id) u;
$$;

-- AI is funded now: token funding, or a current trial or test window (A2's check, with paid added).
create function private.ai_funding_current(p_user uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.campus_bot_plan(p_user, p_at, array['paid', 'early_access']))
    or exists (select 1 from private.effective_ai_window(p_user, array['trial', 'early_access', 'test']) w
      where w.starts_at <= p_at and w.ends_at > p_at);
$$;

-- ---------------------------------------------------------------------------
-- A2 and earlier functions, redefined (changes marked 2b).
-- ---------------------------------------------------------------------------
create or replace function private.ai_course_allowed(p_user uuid,p_course uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select (private.course_on_current_list(p_user,p_course,p_at) or exists(
      select 1 from private.course_access_decision(p_user,p_course,p_at) a where a.allowed and a.team_added))
    -- 2b: paid funding counts too, bound to the current term (private.ai_funding_current).
    and private.ai_funding_current(p_user,p_at);
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
    -- 2b: paid funding counts too (read-only: no lock beyond lock_course_access_select).
    and private.ai_funding_current(u, v_now);
end;
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
begin
  if p_request_id is null or p_document_id is null
      or coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'paid', 'test'] then
    raise exception 'Invalid generation request' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user_id::text, 0));
  perform private.bind_pending_course_grants(v_user_id);
  -- 2b: the student's windows, after the feature lock and before the platform day lock.
  perform 1 from private.campus_bot_windows where user_id = v_user_id order by id for update;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day',0));
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
  v_now := clock_timestamp();
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
    if v_writing.provider_model is null then return jsonb_build_object('state', 'capacity'); end if;
    v_reserved := v_writing.set_max;
    select * into v_session from private.campus_bot_open_window(v_user_id, 'session', v_now);
    select * into v_week from private.campus_bot_open_window(v_user_id, 'week', v_now);
    select v_plan.session_tokens - u.used - u.in_flight into v_session_left from private.campus_bot_window_use(v_session.id) u;
    select v_plan.week_tokens - u.used - u.in_flight into v_week_left from private.campus_bot_window_use(v_week.id) u;
    if v_session_left < v_reserved then
      return jsonb_build_object('state', 'session-limit', 'resets_at', v_session.ends_at);
    end if;
    if v_week_left < v_reserved then
      return jsonb_build_object('state', 'week-limit', 'resets_at', v_week.ends_at);
    end if;
  end if;

  -- The platform's day; requests not funded by a paid plan leave the paying students' reserve.
  select count(*) into v_today from public.ai_usage_events
    where reserved_at >= date_trunc('day', v_now at time zone 'utc') at time zone 'utc';
  if v_today >= v_policy.global_daily_generations
      - (case when v_allowance ->> 'source' = 'paid' then 0 else v_policy.paid_daily_reserve end) then
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
  insert into public.ai_usage_events (user_id, feature, funding_source, funding_grant_id, reserved_tokens,
      session_window_id, week_window_id)
    values (v_user_id, 'upload_practice', v_allowance ->> 'source', (v_allowance ->> 'grant_id')::uuid,
      v_reserved, v_session.id, v_week.id)
    returning id into v_event_id;
  insert into public.ai_practice_generations (user_id, request_id, document_id, institutional_course_id,
    usage_event_id, expires_at)
  values (v_user_id, p_request_id, p_document_id, v_document.institutional_course_id, v_event_id,
    clock_timestamp() + make_interval(days => v_policy.set_retention_days))
  returning id into v_generation_id;
  if v_allowance ->> 'mode' = 'tokens' then
    insert into private.campus_bot_requests (generation_id, step, model, provider_model, price_weight,
        written_token_weight, read_tokens_max, written_tokens_max)
      values (v_generation_id, 'writing', v_writing.model, v_writing.provider_model, v_writing.price_weight,
        v_plan.written_token_weight, v_writing.read_tokens_max, v_writing.written_tokens_max);
    -- The server must use exactly this model and written-token cap: the set is charged at these weights.
    return jsonb_build_object('state', 'started', 'generation_id', v_generation_id, 'total', null,
      'used', (v_allowance ->> 'used')::integer + 1, 'ends_at', v_allowance -> 'ends_at',
      'model', v_writing.provider_model, 'max_output_tokens', v_writing.written_tokens_max);
  end if;
  return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
    'total', (v_allowance ->> 'total')::integer, 'used', (v_allowance ->> 'used')::integer + 1,
    'ends_at', v_allowance -> 'ends_at');
end;
$$;

create or replace function public.finish_ai_practice_generation(
  p_user_id uuid, p_generation_id uuid, p_status text, p_outcome_reason text, p_question_set jsonb, p_usage jsonb
) returns jsonb
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
begin
  if p_status not in ('generated', 'insufficient_source', 'flagged_for_review', 'failed')
      or (p_status = 'generated') <> (p_question_set is not null)
      or (p_usage is not null and jsonb_typeof(p_usage) <> 'object') then
    raise exception 'Invalid generation result' using errcode = '22023';
  end if;
  if p_question_set is not null then
    -- The stored format is personal and unverified by construction; anything else is refused.
    v_count := case when jsonb_typeof(p_question_set -> 'questions') = 'array'
      then jsonb_array_length(p_question_set -> 'questions') else 0 end;
    if jsonb_typeof(p_question_set) <> 'object' or p_question_set ->> 'formatVersion' <> '1'
        or p_question_set ->> 'origin' <> 'ai-generated' or p_question_set ->> 'visibility' <> 'personal'
        or p_question_set ->> 'verification' <> 'unverified' or v_count not between 1 and 5
        or octet_length(p_question_set::text) > 65536 then
      raise exception 'Invalid question set' using errcode = '22023';
    end if;
  end if;
  -- Account row first, in the same order as scheduling and the deletion worker.
  perform private.lock_course_access_scope(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || p_user_id::text,0));
  perform private.bind_pending_course_grants(p_user_id);
  select * into v_generation from public.ai_practice_generations
    where id = p_generation_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  perform 1 from public.ai_usage_events where id=v_generation.usage_event_id for update;
  if v_generation.status <> 'running' then
    return jsonb_build_object('state', 'already-finished', 'status', v_generation.status);
  end if;
  -- 2b: a set admitted while access lasted is delivered and charged even if access has since ended (design row 28).
  -- A set finished after deletion was scheduled can never be shown, so it is neither stored nor charged.
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    v_status := 'failed';
    v_reason := 'account-restricted';
    v_set := null;
  end if;
  -- A Discovery Pass has one set to give: it is never spent on a partial or malformed one.
  if v_status = 'generated' and not private.discovery_ai_set_complete(v_set) and exists (
      select 1 from public.ai_usage_events event
      where event.id = v_generation.usage_event_id and private.is_discovery_grant(event.funding_grant_id)) then
    v_status := 'failed';
    v_reason := 'incomplete-set';
    v_set := null;
  end if;
  update public.ai_practice_generations
    set status = v_status, outcome_reason = v_reason, question_set = v_set, completed_at = now()
    where id = p_generation_id;
  -- 2b: token-funded steps are charged from the provider's own report at the weights copied at admission, and only for
  -- a delivered set. Read is every prompt token; a missing report (timeout) counts nothing.
  update private.campus_bot_requests r
    set read_tokens = coalesce((p_usage ->> 'inputTokens')::bigint, 0) + coalesce((p_usage ->> 'cacheReadInputTokens')::bigint, 0)
        + coalesce((p_usage ->> 'cacheCreationInputTokens')::bigint, 0),
      written_tokens = coalesce((p_usage ->> 'outputTokens')::bigint, 0),
      charged_tokens = case when v_status = 'generated' then
        (coalesce((p_usage ->> 'inputTokens')::bigint, 0) + coalesce((p_usage ->> 'cacheReadInputTokens')::bigint, 0)
          + coalesce((p_usage ->> 'cacheCreationInputTokens')::bigint, 0)
          + r.written_token_weight * coalesce((p_usage ->> 'outputTokens')::bigint, 0)) * r.price_weight else 0 end,
      settled_at = now()
    where r.generation_id = p_generation_id and r.step = 'writing' and r.settled_at is null;
  -- Only a delivered set consumes allowance; every other outcome releases the reservation.
  update public.ai_usage_events
    set state = case when v_status = 'generated' then 'consumed' else 'released' end, settled_at = now(),
        provider = p_usage ->> 'provider', model = p_usage ->> 'model',
        input_tokens = (p_usage ->> 'inputTokens')::integer, output_tokens = (p_usage ->> 'outputTokens')::integer,
        cache_read_input_tokens = (p_usage ->> 'cacheReadInputTokens')::integer,
        cache_creation_input_tokens = (p_usage ->> 'cacheCreationInputTokens')::integer,
        cost_usd = (p_usage ->> 'estimatedCostUsd')::numeric, duration_ms = (p_usage ->> 'durationMs')::integer,
        charged_tokens = case when reserved_tokens is null then null else coalesce((select sum(r.charged_tokens)
          from private.campus_bot_requests r where r.generation_id = p_generation_id), 0) end
    where id = v_generation.usage_event_id and state = 'reserved';
  -- 2b: a delivered set is plan use for refunds, at the time it was admitted. Free courses are never recorded.
  if v_status = 'generated' then
    perform private.mark_plan_use(p_user_id, 'campus-bot-reply',
      (select c.repository_course_id from public.institutional_courses c where c.id = v_generation.institutional_course_id),
      v_generation.id::text, (select e.reserved_at from public.ai_usage_events e where e.id = v_generation.usage_event_id));
  end if;
  return jsonb_build_object('state', 'finished', 'status', v_status);
end;
$$;

create or replace function public.discovery_preview(p_session_id uuid, p_course_id uuid, p_kind text, p_claim boolean,
  p_item_id uuid default null, p_exam_seconds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_grant public.entitlement_grants;
  v_preview private.discovery_previews;
  v_content jsonb;
  v_now timestamptz;
begin
  if p_course_id is null or p_claim is null or p_kind is null or p_kind not in ('cbt', 'study_guide')
      or (p_exam_seconds is not null and (p_kind <> 'cbt' or p_exam_seconds not between 300 and 10800))
      or (p_claim and p_kind = 'cbt' and p_exam_seconds is null)
      or (p_claim and p_kind = 'study_guide' and p_item_id is null) then
    raise exception 'Invalid preview request' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  -- Same per-account lock as trial activation and Early Access enrollment. The clock is read only once it is held.
  perform private.bind_pending_course_grants(v_user_id);
  perform 1 from private.discovery_previews where user_id=v_user_id for update;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out');
  end if;
  if exists(select 1 from public.institutional_courses where repository_course_id=p_course_id and is_free) then
    return jsonb_build_object('state','free-course'); end if;
  if not private.discovery_course_allowed(v_user_id,p_course_id,clock_timestamp()) then
    return jsonb_build_object('state','not-offered');
  end if;
  v_now := clock_timestamp();
  select * into strict v_policy from private.entitlement_policy;
  if not exists (select 1 from public.courses where id = p_course_id) then
    return jsonb_build_object('state', 'invalid-course');
  end if;
  -- A free course or a full plan reads the course itself; nothing is ever spent on it.
  if exists (select 1 from public.institutional_courses where repository_course_id = p_course_id and is_free) then
    return jsonb_build_object('state', 'free-course');
  end if;
  -- 2b: buying a plan keeps a free-pass preview already opened for this course: its deadline and score-only result.
  if (private.has_full_access(v_user_id)
      or exists (select 1 from public.profiles where id = v_user_id and role = 'operator'))
      and not exists (select 1 from private.discovery_previews p join public.entitlement_grants g on g.id = p.grant_id
        where p.user_id = v_user_id and p.course_id = p_course_id and p.kind = p_kind
          and g.source = 'trial' and g.trial_policy = 'discovery') then
    return jsonb_build_object('state', 'full-access');
  end if;
  select * into v_grant from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  if v_grant.id is null then return jsonb_build_object('state', 'no-pass'); end if;
  -- Fail closed the instant the pass ends or is revoked, whatever was opened before. A seven-day trial that has
  -- ended was this account's one trial, so it never becomes a pass.
  if v_grant.trial_policy <> 'discovery' or v_grant.revoked_at is not null or v_grant.ends_at <= v_now
      or v_grant.starts_at > v_now then
    return jsonb_build_object('state', 'expired');
  end if;
  if not private.course_has_active_offering(p_course_id) then
    return jsonb_build_object('state', 'not-offered');
  end if;

  perform private.close_overdue_discovery_exam(v_grant.id);
  select * into v_preview from private.discovery_previews where grant_id = v_grant.id and kind = p_kind;
  if v_preview.grant_id is not null and v_preview.course_id <> p_course_id then
    return jsonb_build_object('state', 'used-elsewhere', 'now', v_now, 'ends_at', v_grant.ends_at,
      'content_key', (select content_key from public.courses where id = v_preview.course_id));
  end if;
  if v_preview.grant_id is null then
    if p_kind = 'cbt' and (select count(*) from private.discovery_cbt_pool(p_course_id))
        < v_policy.discovery_cbt_questions then
      return jsonb_build_object('state', 'nothing-to-preview');
    end if;
    -- The exam runs for the course's whole duration or not at all: it is never shortened to fit the pass.
    if p_kind = 'cbt' and p_exam_seconds is not null
        and v_now + make_interval(secs => p_exam_seconds) > v_grant.ends_at then
      return jsonb_build_object('state', 'not-enough-time', 'now', v_now, 'ends_at', v_grant.ends_at);
    end if;
    if not p_claim then
      return jsonb_build_object('state', 'available', 'now', v_now, 'ends_at', v_grant.ends_at,
        'topics', case when p_kind = 'study_guide' then private.discovery_topic_titles(p_course_id) end);
    end if;
    v_content := private.discovery_preview_content(p_course_id, p_kind, p_item_id);
    if jsonb_array_length(v_content) = 0 then return jsonb_build_object('state', 'nothing-to-preview'); end if;
    insert into private.discovery_previews (grant_id, user_id, kind, course_id, content, deadline_at)
      values (v_grant.id, v_user_id, p_kind, p_course_id, v_content, case when p_kind = 'cbt'
        then v_now + make_interval(secs => p_exam_seconds) end)
      returning * into v_preview;
    perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.preview-opened', 'student',
      jsonb_build_object('kind', p_kind, 'course_id', p_course_id, 'items', jsonb_array_length(v_content)));
  end if;
  return jsonb_build_object('state', 'ready', 'now', v_now, 'ends_at', v_grant.ends_at,
    'preview', private.discovery_preview_view(v_preview));
end;
$$;

create or replace function public.discovery_pass_eligibility(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_session_id is null or not private.discovery_claim_hashes_valid(p_claim_hashes) then
    return jsonb_build_object('eligible', false);
  end if;
  -- The conditions of ai_practice_session_user(), without its account row lock: a page read never waits on Auth.
  select s.user_id into v_user_id from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session_id and (s.not_after is null or s.not_after > v_now) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= v_now)
      and not exists (select 1 from private.account_deletion_jobs j where j.user_id = s.user_id);
  if v_user_id is null then return jsonb_build_object('eligible', false); end if;
  return jsonb_build_object('eligible',
    not exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'trial')
    and private.discovery_email_allowed(v_user_id)
    -- 2b: no Discovery Pass after any paid grant, ever (refunded or revoked included).
    and not exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'paid')
    and private.current_course_scope(v_user_id,v_now)->>'state'='ready'
    and not private.discovery_early_access_bars(v_user_id)
    and private.discovery_claim_keys_sound(p_claim_hashes)
    and not private.discovery_claim_matches(v_user_id,p_claim_hashes));
end;
$$;

create or replace function public.activate_discovery_pass(p_session_id uuid, p_claim_hashes jsonb,
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
  v_now timestamptz;
begin
  if not private.discovery_claim_hashes_valid(p_claim_hashes) then
    raise exception 'Invalid activation request' using errcode = '22023';
  end if;
  -- Only a live, confirmed account that is not scheduled for deletion.
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.entitlement_policy;
  perform private.bind_pending_course_grants(v_user_id);
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim-keys',0));
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || (p_claim_hashes->0->>'hash'),0));
  perform pg_advisory_xact_lock(hashtextextended('discovery-activation-global-day',0));
  v_now := clock_timestamp();
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out'); end if;
  -- 2b: no Discovery Pass after any paid grant, ever. Payment fulfilment takes the same account lock.
  if not private.discovery_email_allowed(v_user_id)
    or exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'paid')
    or private.current_course_scope(v_user_id,clock_timestamp())->>'state'<>'ready' then
    return jsonb_build_object('state','trial-not-offered'); end if;
  -- Nothing is decided on a key configuration that cannot verify every unexpired claim: fail closed, audited.
  v_key_state := private.discovery_claim_keys_check(p_claim_hashes);
  if v_key_state is not null then return jsonb_build_object('state', v_key_state); end if;

  select * into v_existing from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  if v_existing.id is not null then
    return jsonb_build_object('state', 'already-activated', 'ends_at', v_existing.ends_at);
  end if;
  -- No pass while Early Access is active, so neither is spent during the free month. Not ended is enough: an
  -- enrollment that won the account lock may carry a start a moment after this transaction's clock_timestamp().
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  if v_early.id is not null and v_early.ends_at > clock_timestamp() then
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
  if private.discovery_claim_matches(v_user_id,p_claim_hashes) then
    perform private.log_entitlement_event(v_user_id, null, 'discovery.claim-refused', 'student', '{}'::jsonb);
    return jsonb_build_object('state', 'already-claimed',
      'retention_months', round(extract(epoch from v_policy.discovery_claim_retention) / 2629800)::integer);
  end if;

  if v_policy.discovery_activations_per_day is not null then
    perform pg_advisory_xact_lock(hashtextextended('discovery-activation-global-day', 0));
    select count(*) into v_today from public.entitlement_grants
      where source = 'trial' and trial_policy = 'discovery'
        and created_at >= date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc';
    if v_today >= v_policy.discovery_activations_per_day then
      return jsonb_build_object('state', 'capacity');
    end if;
  end if;

  -- Start and end both come from this transaction's clock: exactly discovery_hours from activation. The AI allowance
  -- is fixed here; later policy edits never change a running pass.
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units,
      created_by)
    values (v_user_id, 'trial', 'discovery', v_now, v_now + make_interval(hours => v_policy.discovery_hours), 'capped',
      v_policy.discovery_ai_generations, 'student')
    returning * into v_grant;
  -- An expired claim of the same address (not yet purged) is replaced by the new one.
  insert into private.discovery_pass_claims (claim_hash, key_version, user_id, grant_id, claimed_at, expires_at)
    values (v_claim_hash, v_key_version, v_user_id, v_grant.id, v_now, v_now + v_policy.discovery_claim_retention)
    on conflict (claim_hash) do update set key_version = excluded.key_version, user_id = excluded.user_id,
      grant_id = excluded.grant_id, claimed_at = excluded.claimed_at, expires_at = excluded.expires_at;
  perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.activated', 'student',
    jsonb_build_object('ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units, 'policy', 'discovery',
      'profile_revision', p_expected_profile_revision));
  return jsonb_build_object('state', 'activated', 'ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units);
end;
$$;

-- ---------------------------------------------------------------------------
-- What a student has left (part 3's usage bar). A pure read: no lock, no write.
-- ---------------------------------------------------------------------------
create function public.get_my_campus_bot_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_plan record;
  v_writing record;
  v_session private.campus_bot_windows;
  v_week private.campus_bot_windows;
  v_session_view jsonb;
  v_week_view jsonb;
begin
  if v_user is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_plan from private.campus_bot_plan(v_user, v_now, array['paid', 'early_access']);
  if not found then
    return jsonb_build_object('state', case when exists (select 1 from private.effective_ai_window(v_user,
      array['trial', 'test']) w where w.starts_at <= v_now and w.ends_at > v_now) then 'units' else 'not-entitled' end);
  end if;
  select * into v_writing from private.campus_bot_writing(v_plan.written_token_weight);
  select * into v_session from private.campus_bot_open_window(v_user, 'session', v_now);
  select * into v_week from private.campus_bot_open_window(v_user, 'week', v_now);
  v_session_view := private.campus_bot_window_view(v_session, v_plan.session_tokens);
  v_week_view := private.campus_bot_window_view(v_week, v_plan.week_tokens);
  return jsonb_build_object('state', 'tokens', 'tier', v_plan.tier, 'session', v_session_view, 'week', v_week_view,
    'next_set_max', v_writing.set_max,
    'can_start', (v_session_view->>'left')::bigint >= v_writing.set_max and (v_week_view->>'left')::bigint >= v_writing.set_max);
end;
$$;

-- ---------------------------------------------------------------------------
-- Plan use from the read paths (service role): notes topics opened and theory answers revealed. Recorded with the
-- allowed read, under A2's read opening, before the server shows anything: the student comes from the session, the
-- course must be readable now and the reference one of its published items of that kind. Free courses and students
-- without a paid plan are not counted.
-- ---------------------------------------------------------------------------
create function public.record_plan_use(p_session_id uuid, p_kind text, p_course_id uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_count integer;
begin
  if p_session_id is null or p_kind is null or p_kind not in ('notes-topic', 'theory-reveal') or p_course_id is null
      or p_ref is null or p_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'Invalid plan use' using errcode = '22023';
  end if;
  v_user := private.course_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  begin
    perform private.open_course_access_read(v_user, p_session_id);
  exception when insufficient_privilege then return jsonb_build_object('state', 'signed-out');
  end;
  if not exists (select 1 from public.managed_content_items i where i.id = p_ref::uuid and i.course_id = p_course_id
        and i.published_revision is not null
        and i.kind = case p_kind when 'notes-topic' then 'note' else 'theory_question' end)
      or not private.can_read_course_content(v_user, p_course_id) then
    return jsonb_build_object('state', 'not-allowed');
  end if;
  v_count := private.mark_plan_use(v_user, p_kind, p_course_id, p_ref, clock_timestamp());
  return jsonb_build_object('state', case when v_count > 0 then 'recorded' else 'not-counted' end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator settings (service role), audited with the actor and reason.
-- ---------------------------------------------------------------------------
-- A refill: the student's (or everyone's) next request opens fresh session and week windows.
create function public.admin_campus_bot_refill(p_user_id uuid, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_at timestamptz;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_user_id is not null and not exists (select 1 from auth.users where id = p_user_id) then
    return jsonb_build_object('state', 'not-found');
  end if;
  insert into private.campus_bot_refills (user_id, actor, reason)
    values (p_user_id, left('operator:' || btrim(p_actor), 120), btrim(p_reason)) returning at into v_at;
  perform private.log_entitlement_event(p_user_id, null, 'campus-bot.refilled', left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('scope', case when p_user_id is null then 'everyone' else 'student' end, 'reason', btrim(p_reason)));
  return jsonb_build_object('state', 'refilled', 'scope', case when p_user_id is null then 'everyone' else 'student' end,
    'at', v_at);
end;
$$;

-- The platform's AI sets per UTC day, the paying students' reserve of them, and undelivered tries per student per day.
create function public.admin_set_ai_limits(p_daily_generations integer, p_paid_reserve integer,
  p_undelivered_per_day integer, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before private.ai_practice_policy; v_after private.ai_practice_policy;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if num_nonnulls(p_daily_generations, p_paid_reserve, p_undelivered_per_day) = 0 then
    raise exception 'Name at least one AI limit' using errcode = '22023';
  end if;
  select * into strict v_before from private.ai_practice_policy for update;
  update private.ai_practice_policy set global_daily_generations = coalesce(p_daily_generations, global_daily_generations),
      paid_daily_reserve = coalesce(p_paid_reserve, paid_daily_reserve),
      undelivered_per_day = coalesce(p_undelivered_per_day, undelivered_per_day)
    where singleton
    returning * into v_after;
  perform private.log_entitlement_event(null, null, 'ai.limits-changed', left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('reason', btrim(p_reason),
      'before', jsonb_build_object('daily', v_before.global_daily_generations, 'paid_reserve', v_before.paid_daily_reserve,
        'undelivered_per_day', v_before.undelivered_per_day),
      'after', jsonb_build_object('daily', v_after.global_daily_generations, 'paid_reserve', v_after.paid_daily_reserve,
        'undelivered_per_day', v_after.undelivered_per_day)));
  return jsonb_build_object('state', 'changed', 'daily', v_after.global_daily_generations,
    'paid_reserve', v_after.paid_daily_reserve, 'undelivered_per_day', v_after.undelivered_per_day);
end;
$$;

-- The writing model (a team setting), recorded on each request so its weight applies.
create function public.admin_set_campus_bot_writing_model(p_model text, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before text;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_model is null or not exists (select 1 from private.campus_bot_models where model = p_model
      and provider_model is not null) then
    raise exception 'Unknown model' using errcode = '22023';
  end if;
  select writing_model into strict v_before from private.campus_bot_settings for update;
  if v_before = p_model then return jsonb_build_object('state', 'unchanged', 'writing_model', p_model); end if;
  update private.campus_bot_settings set writing_model = p_model, updated_at = now(),
      updated_by = left('operator:' || btrim(p_actor), 120)
    where singleton;
  perform private.log_entitlement_event(null, null, 'campus-bot.writing-model-changed',
    left('operator:' || btrim(p_actor), 120), jsonb_build_object('reason', btrim(p_reason), 'from', v_before, 'to', p_model));
  return jsonb_build_object('state', 'changed', 'writing_model', p_model);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. CREATE OR REPLACE keeps existing grants; new functions are locked down here.
-- ---------------------------------------------------------------------------
revoke all on function private.campus_bot_plan(uuid, timestamptz, text[]), private.campus_bot_writing(integer),
  private.campus_bot_open_window(uuid, text, timestamptz), private.campus_bot_window_use(uuid),
  private.campus_bot_window_view(private.campus_bot_windows, integer), private.ai_funding_current(uuid, timestamptz),
  public.get_my_campus_bot_usage(), public.record_plan_use(uuid, text, uuid, text),
  public.admin_campus_bot_refill(uuid, text, text), public.admin_set_ai_limits(integer, integer, integer, text, text),
  public.admin_set_campus_bot_writing_model(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_campus_bot_usage() to authenticated;
grant execute on function public.record_plan_use(uuid, text, uuid, text),
  public.admin_campus_bot_refill(uuid, text, text), public.admin_set_ai_limits(integer, integer, integer, text, text),
  public.admin_set_campus_bot_writing_model(text, text, text)
  to service_role;
