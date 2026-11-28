-- Owner decisions, 27 November 2026. Live tier limits, not a refill: recorded usage, window rows,
-- order snapshots and the settlement functions are unchanged. Weekly use still counts the provider's actual use.
update private.campus_bot_tiers set
  session_hours = 5, session_tokens = case tier when 'standard' then 105000 else 210000 end,
  week_days = 7, week_tokens = case tier when 'standard' then 1050000 else 2100000 end,
  updated_at = now(), updated_by = 'migration:20261127300000'
where tier in ('standard', 'plus');

-- All 197 published topics fit without dropping notes at 18000. Twelve maximum-length wire messages would
-- require 21500 on the largest topic; the owner ceiling is 18000 and older messages give way before notes.
-- The 1500 written cap also removes the test/live configuration drift. Haiku reservation: 18000 + 5*1500 = 25500.
update private.campus_bot_request_caps set read_tokens_max = 18000, written_tokens_max = 1500,
  updated_at = now(), updated_by = 'migration:20261127300000' where step = 'chat';

-- The existing admission, with only its history_messages answer added. Funding is chosen under the existing
-- account locks; a browser cannot claim Plus memory or tester funding. No payment or refund function changes.
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
    'history_messages', case when v_mode = 'tester' or exists (
      select 1 from public.entitlement_grants g where g.id = v_grant and g.campus_bot_tier = 'plus'
    ) then 12 else 6 end,
    'reservation_seconds', v_settings.reply_reservation_seconds,
    'course', jsonb_build_object('code', v_course_code, 'title', v_course_title),
    'topic', jsonb_build_object('title', v_title), 'passages', v_passages)
    || case when v_mode = 'tester' then jsonb_build_object('funding', 'tester') else '{}'::jsonb end;
end;
$$;
