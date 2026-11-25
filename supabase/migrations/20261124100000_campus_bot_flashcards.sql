-- Campus Bot flashcards (owner decisions B5 and B6, mock 8). "Make flashcards" in Ask Campus Bot is a chat request:
-- the same admission, funding, limits, caps, exam block, retry by request id and 10-minute keep as any message
-- (public.begin_campus_bot_chat is unchanged). Its delivered reply is kept in a shape of its own,
-- {"cards": [{"term", "meaning"}, ...]}: 4 to 10 cards, each term 1 to 80 characters and each meaning 1 to 200, neither
-- blank, and no other key on the reply or on a card.
--
-- Refunds (owner decision of 23 November 2026): a delivered set of flashcards ends the 48-hour standard refund, as a
-- question set does. It is recorded as plan use of kind 'campus-bot-reply' (a set, allowance 0) with the reference
-- 'flashcards:<request id>', once per request; a text reply stays 'campus-bot-message' with 'chat:<request id>'.
--
-- public.finish_campus_bot_chat is copied from 20261123100000_campus_bot_marked_replies.sql with two changes only: its
-- reply-shape check also accepts the flashcards shape (both text shapes are still accepted, and a reply mixing the two
-- is refused), and a delivered flashcards reply records its plan use as a set. Locking, the delivery checks, charging,
-- settlement, the keep time, the owner, the grants and the security settings are as they were. Released before the
-- code that writes flashcards: until that code lands, nothing sends cards.

-- Ask Campus Bot: settlement. A delivered reply is charged and kept for a short while; a failure is charged nothing.
create or replace function public.finish_campus_bot_chat(p_user_id uuid, p_reply_id uuid, p_outcome text, p_reply jsonb,
  p_usage jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_reply private.campus_bot_replies;
  v_outcome text := p_outcome;
  v_now timestamptz;
  v_keep integer;
  v_read bigint;
  v_written bigint;
  -- A reply with cards is flashcards; any other reply is held to the text shapes.
  v_flashcards boolean := p_reply is not null and jsonb_typeof(p_reply) = 'object' and p_reply ? 'cards';
begin
  if p_user_id is null or p_reply_id is null or p_outcome is null or p_outcome not in ('answered', 'failed')
      or (p_outcome = 'answered') <> (p_reply is not null)
      or (p_reply is not null and jsonb_typeof(p_reply) <> 'object')
      or (p_usage is not null and jsonb_typeof(p_usage) <> 'object') then
    raise exception 'Invalid chat result' using errcode = '22023';
  end if;
  -- Flashcards: exactly {"cards": [...]}, 4 to 10 cards, each exactly {"term", "meaning"}, a term of 1 to 80 characters
  -- and a meaning of 1 to 200, neither blank. A reply that also carries text is refused here.
  if v_flashcards and (jsonb_typeof(p_reply -> 'cards') is distinct from 'array'
      or p_reply - 'cards' <> '{}'::jsonb
      or jsonb_array_length(case when jsonb_typeof(p_reply -> 'cards') = 'array' then p_reply -> 'cards'
        else '[]'::jsonb end) not between 4 and 10
      or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_reply -> 'cards') = 'array'
          then p_reply -> 'cards' else '[]'::jsonb end) c(card)
        where case when jsonb_typeof(c.card) is distinct from 'object' then true
          else c.card - 'term' - 'meaning' <> '{}'::jsonb
            or jsonb_typeof(c.card -> 'term') is distinct from 'string'
            or jsonb_typeof(c.card -> 'meaning') is distinct from 'string'
            or char_length(c.card ->> 'term') not between 1 and 80 or btrim(c.card ->> 'term') = ''
            or char_length(c.card ->> 'meaning') not between 1 and 200 or btrim(c.card ->> 'meaning') = '' end)) then
    raise exception 'Invalid chat result' using errcode = '22023';
  end if;
  -- The kept reply is plain text and one flag ({text, in_notes}, as written before replies were marked), or that with
  -- how an answer was marked and the check question and memory trick shown with it, each null when there is none, every
  -- key present. Nothing else: never the check question's answer.
  if p_reply is not null and not v_flashcards and (jsonb_typeof(p_reply -> 'text') is distinct from 'string'
      or char_length(btrim(p_reply ->> 'text')) not between 1 and 4000
      or jsonb_typeof(p_reply -> 'in_notes') is distinct from 'boolean'
      or (p_reply - 'text' - 'in_notes' <> '{}'::jsonb and (
        jsonb_typeof(p_reply -> 'verdict') is distinct from 'string'
        or (p_reply ->> 'verdict') not in ('correct', 'not-quite', 'none')
        or coalesce(jsonb_typeof(p_reply -> 'check'), 'missing') not in ('string', 'null')
        or (jsonb_typeof(p_reply -> 'check') = 'string' and (char_length(p_reply ->> 'check') not between 1 and 300
          or btrim(p_reply ->> 'check') = ''))
        or coalesce(jsonb_typeof(p_reply -> 'memory_trick'), 'missing') not in ('string', 'null')
        or (jsonb_typeof(p_reply -> 'memory_trick') = 'string'
          and (char_length(p_reply ->> 'memory_trick') not between 1 and 200 or btrim(p_reply ->> 'memory_trick') = ''))
        or p_reply - 'text' - 'in_notes' - 'verdict' - 'check' - 'memory_trick' <> '{}'::jsonb))) then
    raise exception 'Invalid chat result' using errcode = '22023';
  end if;
  perform private.lock_course_access_scope(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || p_user_id::text, 0));
  perform private.bind_pending_course_grants(p_user_id);
  select * into v_reply from private.campus_bot_replies
    where id = p_reply_id and user_id = p_user_id and feature = 'chat' for update;
  if v_reply.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if v_reply.state <> 'reserved' then return jsonb_build_object('state', 'already-finished'); end if;
  select chat_reply_keep_seconds into strict v_keep from private.campus_bot_settings;
  v_now := clock_timestamp();
  -- A reply is delivered only if a new message would still be answered now: no deletion scheduled, the topic still
  -- one this student may ask about, no exam open in the course, Campus Bot still theirs. Otherwise it is neither kept
  -- nor charged.
  if v_outcome = 'answered' and (exists (select 1 from private.account_deletion_jobs where user_id = p_user_id)
      or (select t.state from private.campus_bot_topic_context(p_user_id, v_reply.course_id, v_reply.item_id, v_now, 1) t)
        is distinct from 'ready'
      or private.campus_bot_exam_open(p_user_id, v_reply.course_id, v_now)
      or not exists (select 1 from private.campus_bot_reply_funding(p_user_id, v_now) f where f.mode is not null)) then
    v_outcome := 'failed';
  end if;
  v_read := coalesce((p_usage ->> 'inputTokens')::bigint, 0) + coalesce((p_usage ->> 'cacheReadInputTokens')::bigint, 0)
    + coalesce((p_usage ->> 'cacheCreationInputTokens')::bigint, 0);
  v_written := coalesce((p_usage ->> 'outputTokens')::bigint, 0);
  update private.campus_bot_replies
    set state = case when v_outcome = 'answered' then 'consumed' else 'released' end, outcome = v_outcome,
      settled_at = v_now, read_tokens = v_read, written_tokens = v_written,
      -- Never more than was reserved, whatever the provider reports.
      charged_tokens = case when reserved_tokens is null then null when v_outcome = 'answered'
        then least(reserved_tokens, (v_read + written_token_weight * v_written) * price_weight) else 0 end,
      cost_usd = (p_usage ->> 'estimatedCostUsd')::numeric, duration_ms = (p_usage ->> 'durationMs')::integer,
      reply = case when v_outcome = 'answered' then p_reply end,
      reply_expires_at = case when v_outcome = 'answered' then v_now + make_interval(secs => v_keep) end
    where id = p_reply_id;
  if v_outcome = 'answered' and v_flashcards then
    -- Flashcards are a set: once per request, so a retry or a second settlement never counts twice.
    perform private.mark_plan_use(p_user_id, 'campus-bot-reply', v_reply.course_id,
      'flashcards:' || v_reply.request_id::text, v_reply.reserved_at);
  elsif v_outcome = 'answered' then
    -- One reply per request: a retry of the same request never counts twice.
    perform private.mark_plan_use(p_user_id, 'campus-bot-message', v_reply.course_id,
      'chat:' || v_reply.request_id::text, v_reply.reserved_at);
  end if;
  return jsonb_build_object('state', 'finished', 'outcome', v_outcome);
end;
$$;

-- CREATE OR REPLACE keeps the function's owner and grants; they are restated as 20261117100000 set them.
revoke all on function public.finish_campus_bot_chat(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_campus_bot_chat(uuid, uuid, text, jsonb, jsonb) to service_role;
