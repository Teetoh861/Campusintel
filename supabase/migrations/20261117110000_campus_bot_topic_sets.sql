-- supabase/migrations/20261117110000_campus_bot_topic_sets.sql — "Quiz me on this topic": a new set of practice
-- questions written from one notes topic (owner decisions of 16 November 2026). Builds on the Campus Bot limits
-- (20261103100000, 20261103140000, 20261103160000) and on Explain and Ask Campus Bot (20261117100000): its switch
-- (campus_bot_settings.topic_sets_enabled), its topic rule (private.campus_bot_topic_context) and its calculation
-- courses (private.campus_bot_courses).
--
-- A topic set is a set. It is stored, metered and settled as an upload set is (public.ai_practice_generations and
-- public.ai_usage_events), so it shares the student's session and week windows, the undelivered tries a day, one set in
-- flight, the platform's sets a day and a free pass's one set. Only the source differs: CampusIntell's published notes
-- for one topic the student may read now (the notes read's own rule), or the topic a current free pass pinned. Every
-- tap writes a new set; nothing is shared between students.
--
-- Writing: the writing model for every funding, at the 'writing' step's caps. On a calculation course the sets' own
-- checking model (campus_bot_settings.check_model, Sonnet) checks every question at the 'check' step's caps, charged at
-- the writer's weight (owner decision). check_enabled stays false: upload sets are still never checked. Each call is
-- handed its input cap (max_input_tokens, the step's read cap) and the server bounds the whole prompt by it; a step is
-- never charged more than was reserved for it. Only a delivered set is charged, and only if the topic and its funding
-- still hold at delivery; a free pass's set must have five questions, as an upload set must. A retry of a request is
-- answered only after every check a new quiz passes. The student's last ten questions on the topic go with the request,
-- so a new set does not repeat them.
--
-- Lock order, as begin_ai_practice_generation (20261103140000): the account write prefix, the student's Campus Bot lock
-- (ai-practice-generation:<user>), pending grant binding, the student's window rows, the platform day lock, the
-- student's generation rows. Every time decision reads the clock once, after them. Settlement takes the account scope,
-- the student's Campus Bot lock, the generation row, then its usage row, as finish_ai_practice_generation does.

-- ---------------------------------------------------------------------------
-- Settings (owner decisions of 16 November 2026).
-- ---------------------------------------------------------------------------
-- The sets' checking model, used only by topic sets on calculation courses.
update private.campus_bot_settings set check_model = 'sonnet', updated_at = now(),
  updated_by = 'migration:20261117110000' where singleton;
-- One check reads a whole set and the passages it cites: 3,000 read / 1,500 written was sized for one answer.
update private.campus_bot_request_caps set read_tokens_max = 10000, written_tokens_max = 3000, updated_at = now(),
  updated_by = 'migration:20261117110000' where step = 'check';
-- The platform's newly written sets a day, uploads and topics together.
update private.ai_practice_policy set global_daily_generations = 2000 where singleton;

-- ---------------------------------------------------------------------------
-- Ledger and storage.
-- ---------------------------------------------------------------------------
alter table public.ai_usage_events drop constraint ai_usage_events_feature_check;
alter table public.ai_usage_events add constraint ai_usage_events_feature_check
  check (feature in ('upload_practice', 'topic_practice'));

-- What a set was written from: the student's upload (document_id, which its expiry clears), or one notes topic at the
-- revision that was read.
alter table public.ai_practice_generations
  add column source_kind text not null default 'upload' check (source_kind in ('upload', 'notes-topic')),
  add column source_course_id uuid references public.courses (id) on delete cascade,
  add column source_item_id uuid references public.managed_content_items (id) on delete cascade,
  add column source_revision integer check (source_revision > 0),
  add constraint ai_practice_generations_source_check check (case when source_kind = 'notes-topic'
    then document_id is null and source_course_id is not null and source_item_id is not null
      and source_revision is not null
    else source_course_id is null and source_item_id is null and source_revision is null end);
create index ai_practice_generations_topic_idx on public.ai_practice_generations (user_id, source_item_id, created_at desc)
  where source_kind = 'notes-topic';

-- The one set a free pass delivers: as 20261021100000, except that the source may be a notes topic (its title) and a
-- question may cite a notes passage (N1, N2, ...).
create or replace function private.discovery_ai_set_complete(p_set jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_set -> 'questions') = 'array' and jsonb_array_length(p_set -> 'questions') = 5
    and (select count(distinct q ->> 'id') from jsonb_array_elements(p_set -> 'questions') q) = 5
    and not exists (select 1 from jsonb_array_elements(p_set -> 'questions') q where not coalesce(
      jsonb_typeof(q) = 'object' and (q ->> 'id') ~ '^ai_[0-9a-f]{24}$'
      and jsonb_typeof(q -> 'prompt') = 'string' and btrim(q ->> 'prompt') <> '' and char_length(q ->> 'prompt') <= 600
      and jsonb_typeof(q -> 'options') = 'array' and jsonb_array_length(q -> 'options') = 4
      and not exists (select 1 from jsonb_array_elements(q -> 'options') o where not coalesce(jsonb_typeof(o) = 'string'
        and btrim(o #>> '{}') <> '' and char_length(o #>> '{}') <= 240, false))
      and jsonb_typeof(q -> 'correctOption') = 'number' and (q ->> 'correctOption') in ('0', '1', '2', '3')
      and jsonb_typeof(q -> 'explanation') = 'string' and btrim(q ->> 'explanation') <> ''
        and char_length(q ->> 'explanation') <= 1200
      and jsonb_typeof(q -> 'section') = 'string' and btrim(q ->> 'section') <> '' and char_length(q ->> 'section') <= 120
      and jsonb_typeof(q -> 'grounding') = 'object'
      and (q -> 'grounding' ->> 'documentId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and (q -> 'grounding' ->> 'sourceSha256') ~ '^[0-9a-f]{64}$'
      and (q -> 'grounding' ->> 'passageId') ~ '^[PN][1-9][0-9]*$'
      and jsonb_typeof(q -> 'grounding' -> 'passageStart') = 'number' and (q -> 'grounding' ->> 'passageStart') ~ '^[0-9]+$'
      and jsonb_typeof(q -> 'grounding' -> 'passageEnd') = 'number' and (q -> 'grounding' ->> 'passageEnd') ~ '^[0-9]+$'
      and jsonb_typeof(q -> 'grounding' -> 'quote') = 'string' and btrim(q -> 'grounding' ->> 'quote') <> ''
        and char_length(q -> 'grounding' ->> 'quote') <= 400, false))
    and jsonb_typeof(p_set -> 'source') = 'object'
    and ((jsonb_typeof(p_set -> 'source' -> 'fileName') = 'string' and btrim(p_set -> 'source' ->> 'fileName') <> ''
        and char_length(p_set -> 'source' ->> 'fileName') <= 255)
      or (p_set -> 'source' ->> 'kind' = 'notes-topic' and jsonb_typeof(p_set -> 'source' -> 'title') = 'string'
        and btrim(p_set -> 'source' ->> 'title') <> '' and char_length(p_set -> 'source' ->> 'title') <= 240)), false);
$$;

-- ---------------------------------------------------------------------------
-- Admission. Service role only; the student comes from the session.
-- ---------------------------------------------------------------------------
create function public.begin_campus_bot_topic_set(p_session_id uuid, p_request_id uuid, p_course_id uuid,
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
  if v_allowance ->> 'mode' = 'tokens' then
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
    'passages', v_topic.passages, 'previous', v_previous);
end;
$$;

-- ---------------------------------------------------------------------------
-- Settlement. Only a delivered set is charged; every other outcome releases the reservation.
-- ---------------------------------------------------------------------------
create function public.finish_campus_bot_topic_set(p_user_id uuid, p_generation_id uuid, p_status text,
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
  if v_status = 'generated' and ((select t.state from private.campus_bot_topic_context(p_user_id,
        v_generation.source_course_id, v_generation.source_item_id, v_at, 1) t) is distinct from 'ready'
      or not exists (select 1 from public.ai_usage_events e join public.entitlement_grants g on g.id = e.funding_grant_id
        where e.id = v_generation.usage_event_id and g.user_id = p_user_id and g.revoked_at is null
          and g.starts_at <= v_at and g.ends_at > v_at)) then
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

-- ---------------------------------------------------------------------------
-- Operator settings (service role), audited with the actor and reason.
-- ---------------------------------------------------------------------------
-- The model that checks topic sets on calculation courses. Explain has its own (admin_set_campus_bot_checker).
create function public.admin_set_campus_bot_set_checker(p_model text, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_before text;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_model is null or not exists (select 1 from private.campus_bot_models
      where model = p_model and provider_model is not null) then
    raise exception 'Unknown model' using errcode = '22023';
  end if;
  select check_model into strict v_before from private.campus_bot_settings for update;
  if v_before is not distinct from p_model then
    return jsonb_build_object('state', 'unchanged', 'set_checker', p_model);
  end if;
  update private.campus_bot_settings set check_model = p_model, updated_at = now(),
      updated_by = left('operator:' || btrim(p_actor), 120)
    where singleton;
  perform private.log_entitlement_event(null, null, 'campus-bot.set-checker-changed',
    left('operator:' || btrim(p_actor), 120), jsonb_build_object('reason', btrim(p_reason), 'from', v_before, 'to', p_model));
  return jsonb_build_object('state', 'changed', 'set_checker', p_model);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. CREATE OR REPLACE keeps existing grants; new functions are locked down here.
-- ---------------------------------------------------------------------------
revoke all on function public.begin_campus_bot_topic_set(uuid, uuid, uuid, uuid, text[]),
  public.finish_campus_bot_topic_set(uuid, uuid, text, text, jsonb, jsonb, jsonb),
  public.admin_set_campus_bot_set_checker(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_campus_bot_topic_set(uuid, uuid, uuid, uuid, text[]),
  public.finish_campus_bot_topic_set(uuid, uuid, text, text, jsonb, jsonb, jsonb),
  public.admin_set_campus_bot_set_checker(text, text, text)
  to service_role;
