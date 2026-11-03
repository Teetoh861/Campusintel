-- Campus Bot review fixes. The reservation outlasts admission (15 s), two maximum provider calls (2 x 120 s),
-- and settlement (30 s): 285 s < the five-minute floor. Unknown/abandoned results are still discarded and charged 0.
alter table private.ai_practice_policy add constraint ai_practice_live_reservation_check check (reservation_minutes >= 5);

-- A frozen refill epoch for both lookups in one admission. The existing three-argument read stays pure.
create function private.campus_bot_open_window(p_user uuid, p_kind text, p_at timestamptz, p_refill_at timestamptz)
returns setof private.campus_bot_windows
language sql stable security definer set search_path = '' as $$
  select w.* from private.campus_bot_windows w
  where w.user_id = p_user and w.kind = p_kind and w.starts_at <= p_at and w.ends_at > p_at
    and w.starts_at > p_refill_at
  order by w.starts_at desc limit 1;
$$;
revoke all on function private.campus_bot_open_window(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.release_abandoned_ai_generations(p_user_id uuid, p_minutes integer) returns void
language sql set search_path = '' as $$
  with wall as materialized (select clock_timestamp() as at), abandoned as (
    update public.ai_practice_generations g set status = 'failed', outcome_reason = 'abandoned', completed_at = wall.at
      from wall where g.status = 'running' and g.created_at <= wall.at - make_interval(mins => p_minutes)
        and (p_user_id is null or g.user_id = p_user_id) returning g.id, g.usage_event_id
  ), requests as (
    update private.campus_bot_requests r set charged_tokens = 0, settled_at = wall.at
      from abandoned a cross join wall where r.generation_id = a.id and r.settled_at is null returning r.generation_id
  )
  update public.ai_usage_events e set state = 'released', settled_at = wall.at, charged_tokens = 0
    from wall where e.id in (select usage_event_id from abandoned) and e.state = 'reserved';
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
  if v_allowance ->> 'mode' = 'tokens' then
    insert into private.campus_bot_requests (generation_id, step, model, provider_model, price_weight,
        written_token_weight, read_tokens_max, written_tokens_max)
      values (v_generation_id, 'writing', v_writing.model, v_writing.provider_model, v_writing.price_weight,
        v_plan.written_token_weight, v_writing.read_tokens_max, v_writing.written_tokens_max);
    -- The server must use exactly this model and written-token cap: the set is charged at these weights.
    return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
      'reservation_seconds', v_policy.reservation_minutes * 60, 'total', null,
      'used', (v_allowance ->> 'used')::integer + 1, 'ends_at', v_allowance -> 'ends_at',
      'model', v_writing.provider_model, 'max_output_tokens', v_writing.written_tokens_max);
  end if;
  return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
      'reservation_seconds', v_policy.reservation_minutes * 60,
    'total', (v_allowance ->> 'total')::integer, 'used', (v_allowance ->> 'used')::integer + 1,
    'ends_at', v_allowance -> 'ends_at');
end;
$$;

create or replace function public.admin_set_ai_limits(p_daily_generations integer, p_paid_reserve integer,
  p_undelivered_per_day integer, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before private.ai_practice_policy; v_after private.ai_practice_policy;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if num_nonnulls(p_daily_generations, p_paid_reserve, p_undelivered_per_day) = 0 then
    raise exception 'Name at least one AI limit' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day', 0));
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


-- The student read reveals only prompts and whether feedback is available. Operator publication inspection stays intact.
drop function public.read_published_managed_content(uuid);
create function public.read_published_managed_content(p_course_id uuid)
returns table (
  item_id uuid, course_id uuid, kind text, question_id uuid, source_key text,
  parent_item_id uuid, revision integer, payload jsonb, feedback_available boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  v_user := auth.uid();
  perform private.open_course_access_read(v_user);
  v_user := private.require_course_access_account();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  if not private.can_read_course_content(v_user, p_course_id) then
    raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
  end if;
  return query
    select i.id, i.course_id, i.kind, i.question_id, i.source_key,
           i.parent_item_id, i.published_revision, r.payload,
           i.kind = 'theory_question' and exists (
             select 1 from public.managed_content_items answer where answer.parent_item_id = i.id
               and answer.kind = 'model_answer' and answer.published_revision is not null
               and answer.published_parent_revision = i.published_revision)
    from public.managed_content_items i
    join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course_id and i.published_revision is not null
      -- CBT questions reach a student only inside their own practice attempt.
      and i.kind <> 'cbt_question'
      and (i.kind not in ('model_answer', 'rubric') or exists (
        select 1 from public.profiles p where p.id = v_user and p.role = 'operator'))
      and (i.parent_item_id is null or exists (
        select 1 from public.managed_content_items parent
        where parent.id = i.parent_item_id
          and parent.published_revision = i.published_parent_revision
      ))
    order by i.created_at, i.id;
end;
$$;

revoke all on function public.read_published_managed_content(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_published_managed_content(uuid) to authenticated;

-- A theory reveal and its plan-use marker are one transaction. This is the only ordinary student delivery of feedback.
create function public.reveal_theory_feedback(p_session_id uuid, p_course_id uuid, p_item_id uuid,
  p_published_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; q public.managed_content_items; v_content jsonb; v_use jsonb;
begin
  if p_session_id is null or p_course_id is null or p_item_id is null or p_published_revision is null
      or p_published_revision < 1 then raise exception 'Invalid theory reveal' using errcode = '22023'; end if;
  v_user := private.course_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  begin
    perform private.open_course_access_read(v_user, p_session_id);
  exception when insufficient_privilege then return jsonb_build_object('state', 'signed-out');
  end;
  if not private.can_read_course_content(v_user, p_course_id) then
    return jsonb_build_object('state', 'locked'); end if;
  select * into q from public.managed_content_items where id = p_item_id and course_id = p_course_id
    and kind = 'theory_question';
  if q.id is null or q.published_revision is distinct from p_published_revision then
    return jsonb_build_object('state', 'content-changed'); end if;
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'course_id', i.course_id, 'kind', i.kind,
      'question_id', i.question_id, 'source_key', i.source_key, 'parent_item_id', i.parent_item_id,
      'revision', i.published_revision, 'payload', r.payload, 'feedback_available', i.kind = 'theory_question')
      order by i.created_at, i.id) into v_content
    from public.managed_content_items i join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course_id and i.published_revision is not null
      and (i.id = q.id or (i.parent_item_id = q.id and i.kind in ('model_answer', 'rubric')
        and i.published_parent_revision = q.published_revision));
  if not exists (select 1 from jsonb_array_elements(v_content) item where item->>'kind' = 'model_answer') then
    return jsonb_build_object('state', 'content-changed'); end if;
  v_use := public.record_plan_use(p_session_id, 'theory-reveal', p_course_id, p_item_id::text);
  if v_use->>'state' = 'signed-out' then return jsonb_build_object('state', 'signed-out'); end if;
  if coalesce(v_use->>'state', '') not in ('recorded', 'not-counted') then return jsonb_build_object('state', 'locked'); end if;
  return jsonb_build_object('state', 'ready', 'content', v_content);
end;
$$;
revoke all on function public.reveal_theory_feedback(uuid, uuid, uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.reveal_theory_feedback(uuid, uuid, uuid, bigint) to service_role;
