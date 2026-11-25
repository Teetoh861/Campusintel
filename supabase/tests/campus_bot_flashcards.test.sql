-- supabase/tests/campus_bot_flashcards.test.sql — Make flashcards in Ask Campus Bot
-- (20261124100000_campus_bot_flashcards.sql): the shape a delivered set of flashcards must have; on a paid course, one
-- set of plan use per request (a delivered set ends the 48-hour standard refund, owner decision of 23 November 2026)
-- while a text reply stays a message; charging, settlement once, the kept reply and its retry, exactly as for any chat
-- reply; nothing recorded on a free course; a free pass counting each set as one of its messages; and the redefined
-- function's owner, security settings and grants. The provider is never called: each result is reported to
-- finish_campus_bot_chat as the server reports it. Everything rolls back.
begin;
select no_plan();

-- The owner content rule (20261122120000) withdraws content this test uses as fixtures. It is rolled back here, inside
-- this test's transaction, so the content stands as the earlier migrations left it.
select is(array[private.study_guide('study_guide_bua203', 'rollback'), private.study_guide('study_guide_lag_bua210', 'rollback'),
    private.official_bank_bua203('rollback'), private.official_bank_lag_bua210('rollback')],
  array_fill('rolled-back'::text, array[4]), 'the BUA203 and LAG-BUA210 copies (20261125100000) rolled back for this test');
select is(private.owner_content_rule('rollback'), 'rolled-back', 'the owner content rule (20261122120000) rolled back for this test');

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('cf100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('cf200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n integer) returns uuid language sql immutable
  as $$ select ('cf400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- Course 08 is GST 111 (free, with a study guide).
create function pg_temp.c(n text) returns uuid language sql immutable
  as $$ select ('40000000-0000-4000-8000-0000000000' || n)::uuid $$;
create function pg_temp.course(p_key text) returns uuid language sql stable security definer set search_path = ''
  as $$ select id from public.courses where content_key = p_key $$;
create function pg_temp.nth(p_course uuid, p_n integer) returns uuid language sql stable security definer
  set search_path = '' as $$
  select i.id from public.managed_content_items i where i.course_id = p_course and i.kind = 'note'
    and i.published_revision is not null order by i.position nulls last, i.created_at, i.id offset p_n - 1 limit 1 $$;
create function pg_temp.student(n integer) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
    'bot-flashcards-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.s(n), pg_temp.u(n), now(), now()) $$;
-- The free pass (counted, not metered).
create function pg_temp.pass(n integer) returns void language sql as $$
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
  values (pg_temp.u(n), 'trial', 'discovery', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 days',
    'capped', 1, 'cf-test') $$;
-- The provider's usage report, as the server passes it on.
create function pg_temp.usage(p_input integer, p_output integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('provider', 'anthropic', 'model', 'claude-haiku-5-5', 'inputTokens', p_input,
    'outputTokens', p_output, 'cacheReadInputTokens', 0, 'cacheCreationInputTokens', 0, 'estimatedCostUsd', 0.0008,
    'durationMs', 900) $$;
create function pg_temp.reply(p_result jsonb) returns uuid language sql immutable
  as $$ select (p_result ->> 'reply_id')::uuid $$;
create function pg_temp.chat(p_user integer, p_request integer, p_item uuid, p_course uuid) returns jsonb language sql as $$
  select public.begin_campus_bot_chat(pg_temp.s(p_user), pg_temp.r(p_request), p_course, p_item, true) $$;
-- A delivered set of n flashcards as the server reports it, and a set whose first card is replaced.
create function pg_temp.cards(n integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('cards', coalesce(jsonb_agg(jsonb_build_object('term', 'Term ' || i,
    'meaning', 'What term ' || i || ' means in this topic''s notes.') order by i), '[]'::jsonb))
  from generate_series(1, n) i $$;
create function pg_temp.first_card(p_card jsonb) returns jsonb language sql immutable
  as $$ select jsonb_set(pg_temp.cards(4), '{cards,0}', p_card) $$;
-- A delivered text reply (20261123100000), marked, with its next check question and a memory trick.
create function pg_temp.marked() returns jsonb language sql immutable as $$
  select '{"text":"The answer is that a manager plans first.","in_notes":true,"verdict":"not-quite",
    "check":"What does a manager do before organising?","memory_trick":"Plan, then organise."}'::jsonb $$;
create function pg_temp.finish(p_user integer, p_started jsonb, p_reply jsonb, p_usage jsonb) returns jsonb
  language sql as $$ select public.finish_campus_bot_chat(pg_temp.u(p_user), pg_temp.reply(p_started),
    case when p_reply is null then 'failed' else 'answered' end, p_reply, p_usage) $$;
-- The shape check alone: an accepted shape reaches the lookup of an unknown reply and is not found; any other is
-- refused before anything is read.
create function pg_temp.kept_shape(p_reply jsonb) returns jsonb language sql as $$
  select public.finish_campus_bot_chat(pg_temp.u(1), gen_random_uuid(), 'answered', p_reply, pg_temp.usage(6000, 600)) $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
create temporary table fixture (name text primary key, id uuid) on commit drop;
grant all on outcome, fixture to service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable
  as $$ select result from outcome where step = p_step $$;
create function pg_temp.f(p_name text) returns uuid language sql stable as $$ select id from fixture where name = p_name $$;
insert into fixture values ('bua', pg_temp.course('principles-business-administration'));
insert into fixture values ('bua-1', pg_temp.nth(pg_temp.f('bua'), 1)), ('gst-1', pg_temp.nth(pg_temp.c('08'), 1));

-- 1. The shape of a delivered set of flashcards ------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.kept_shape(pg_temp.cards(4)), '{"state":"not-found"}'::jsonb, '4 cards are accepted');
select is(pg_temp.kept_shape(pg_temp.cards(10)), '{"state":"not-found"}'::jsonb, 'and 10');
select is(pg_temp.kept_shape(pg_temp.first_card(jsonb_build_object('term', repeat('t', 80), 'meaning', repeat('m', 200)))),
  '{"state":"not-found"}'::jsonb, 'a term of 80 characters and a meaning of 200');
-- Both text shapes are still accepted.
select is(pg_temp.kept_shape(pg_temp.marked()), '{"state":"not-found"}'::jsonb, 'a marked text reply is still accepted');
select is(pg_temp.kept_shape('{"text":"Your notes say so.","in_notes":true}'::jsonb), '{"state":"not-found"}'::jsonb,
  'and the old text shape ({text, in_notes})');
select throws_ok(format('select pg_temp.kept_shape(%L::jsonb)', r.reply), '22023', 'Invalid chat result', r.why)
  from (values
    (pg_temp.cards(3), '3 cards are refused'),
    (pg_temp.cards(11), 'as are 11'),
    (pg_temp.cards(0), 'and none'),
    (pg_temp.cards(4) || '{"extra":1}', 'a set with another key'),
    (pg_temp.first_card('{"term":"Planning","meaning":"Deciding in advance what to do.","hint":"P"}'),
      'a card with another key'),
    (pg_temp.first_card('{"term":"Planning"}'), 'a card without its meaning'),
    (pg_temp.first_card('{"meaning":"Deciding in advance what to do."}'), 'a card without its term'),
    (pg_temp.first_card('{"term":"","meaning":"Deciding in advance what to do."}'), 'an empty term'),
    (pg_temp.first_card('{"term":"   ","meaning":"Deciding in advance what to do."}'), 'a blank term'),
    (pg_temp.first_card('{"term":"Planning","meaning":"  "}'), 'a blank meaning'),
    (pg_temp.first_card(jsonb_build_object('term', repeat('t', 81), 'meaning', 'Deciding in advance what to do.')),
      'a term over 80 characters'),
    (pg_temp.first_card(jsonb_build_object('term', 'Planning', 'meaning', repeat('m', 201))), 'a meaning over 200'),
    (pg_temp.first_card('{"term":42,"meaning":"Deciding in advance what to do."}'), 'a term that is not text'),
    (pg_temp.first_card('{"term":"Planning","meaning":["Deciding"]}'), 'a meaning that is not text'),
    (pg_temp.first_card('"Planning"'), 'a card that is not an object'),
    ('{"cards":{"term":"Planning","meaning":"Deciding in advance what to do."}}'::jsonb, 'cards that are not a list'),
    ('{"cards":null}'::jsonb, 'or null'),
    (pg_temp.marked() || pg_temp.cards(4), 'a reply mixing a marked text reply and cards'),
    ('{"text":"Your notes say so.","in_notes":true}'::jsonb || pg_temp.cards(4), 'or the old text shape and cards')
  ) as r(reply, why);
reset role;

-- 2. A paid course: plan use for refunds, charging, settling once, the kept set and its retry -----------------------
-- Student 1 buys Standard for BUA 200 (the running First Semester began 100 days ago), as in
-- campus_bot_explain_ask.test.sql.
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 100;
select pg_temp.student(1);
update public.profiles set first_name = 'Ada', department_id = '10000000-0000-4000-8000-000000000002',
  academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
  where id = pg_temp.u(1);
select public.admin_set_sales_open(true, 'Ops', 'flashcards test');
create temporary table o1 on commit drop as select (public.create_payment_order(pg_temp.s(1), 'standard_semester',
    (select revision from public.profiles where id = pg_temp.u(1)), gen_random_uuid(), '/access', 'fake')
  -> 'order' ->> 'id')::uuid as id;
select public.attach_payment_checkout(id, 'fake', 'chk_' || replace(id::text, '-', ''),
  'https://checkout.example.test/c/' || id, clock_timestamp() + interval '1 hour') from o1;
select public.fulfil_payment(id, 'fake', 'ch_' || replace(id::text, '-', ''), 'succeeded', 400000, 'NGN', 'card',
  clock_timestamp(), 'webhook', 'test') from o1;
select public.admin_set_campus_bot_feature('ask', true, 'Ops', 'flashcards test');
set local role service_role;
-- Make flashcards (request 1), then a text reply (request 2).
insert into outcome values ('cards', pg_temp.chat(1, 1, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('cards-done', pg_temp.finish(1, pg_temp.o('cards'), pg_temp.cards(8), pg_temp.usage(6000, 600)));
insert into outcome values ('cards-again', pg_temp.finish(1, pg_temp.o('cards'), pg_temp.cards(8), pg_temp.usage(6000, 600)));
insert into outcome values ('cards-retry', pg_temp.chat(1, 1, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('text', pg_temp.chat(1, 2, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('text-done', pg_temp.finish(1, pg_temp.o('text'), pg_temp.marked(), pg_temp.usage(6000, 350)));
reset role;
select is(jsonb_build_array(pg_temp.o('cards') ->> 'state', pg_temp.o('cards-done'), pg_temp.o('text') ->> 'state',
    pg_temp.o('text-done')),
  '["started",{"state":"finished","outcome":"answered"},"started",{"state":"finished","outcome":"answered"}]'::jsonb,
  'a paid student makes flashcards on a topic of a paid course, then asks a question');
select is((select jsonb_agg(jsonb_build_array(kind, ref, course_id) order by ref) from private.plan_use_events
    where user_id = pg_temp.u(1)),
  jsonb_build_array(jsonb_build_array('campus-bot-message', 'chat:' || pg_temp.r(2), pg_temp.f('bua')),
    jsonb_build_array('campus-bot-reply', 'flashcards:' || pg_temp.r(1), pg_temp.f('bua'))),
  'the flashcards are one Campus Bot set (flashcards:<request id>) and no message; the text reply is still a message');
select is((select u.occurred_at = r.reserved_at from private.plan_use_events u
    join private.campus_bot_replies r on r.user_id = u.user_id and r.request_id = pg_temp.r(1)
    where u.user_id = pg_temp.u(1) and u.kind = 'campus-bot-reply'), true, 'dated when the flashcards were asked for');
select is(pg_temp.o('cards-again'), '{"state":"already-finished"}'::jsonb, 'a second settlement finds the set settled');
select is((select count(*)::integer from private.plan_use_events where user_id = pg_temp.u(1)
  and ref = 'flashcards:' || pg_temp.r(1)), 1, 'and records nothing twice');
select is((select jsonb_agg(jsonb_build_array(request_id, state, reserved_tokens, charged_tokens) order by request_id)
    from private.campus_bot_replies where user_id = pg_temp.u(1)),
  jsonb_build_array(jsonb_build_array(pg_temp.r(1), 'consumed', 18000, 9000),
    jsonb_build_array(pg_temp.r(2), 'consumed', 18000, 7750)),
  'charging is unchanged: each reserved at the chat step''s caps, (14,000 + 5 x 800) x 1, and charged '
    || '(read + 5 x written) x 1 from the provider''s report');
select is((select bool_and(charged_tokens = least(reserved_tokens, (read_tokens + written_token_weight * written_tokens)
    * price_weight)) from private.campus_bot_replies where user_id = pg_temp.u(1)), true,
  'by the same rule for flashcards as for a text reply');
select is((select reply from private.campus_bot_replies where request_id = pg_temp.r(1)), pg_temp.cards(8),
  'the set is kept exactly as reported');
select ok((select reply_expires_at between clock_timestamp() + interval '9 minutes' and clock_timestamp() + interval '10 minutes'
  from private.campus_bot_replies where request_id = pg_temp.r(1)), 'for ten minutes, as any chat reply');
select is(pg_temp.o('cards-retry'), jsonb_build_object('state', 'answered', 'reply', pg_temp.cards(8)),
  'a retry of the same request gets the kept cards');
select is((select count(*)::integer from private.campus_bot_replies where user_id = pg_temp.u(1)
  and request_id = pg_temp.r(1)), 1, 'free: nothing new is reserved');
select is((select jsonb_build_array(e -> 'standard_allowed', e -> 'standard_refused', e -> 'counts' -> 'campus_bot_sets',
    e -> 'counts' -> 'campus_bot_messages', e -> 'allowed' -> 'campus_bot_sets')
    from (select public.refund_eligibility((select id from o1), null, clock_timestamp()) e) x),
  '[false, ["campus-bot"], 1, 1, 0]'::jsonb,
  'the refund check counts the flashcards as one set, which ends the standard refund (reason campus-bot)');

-- 3. Nothing delivered is nothing recorded, and the same request may be tried again ----------------------------------
set local role service_role;
insert into outcome values ('few', pg_temp.chat(1, 3, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('few-failed', pg_temp.finish(1, pg_temp.o('few'), null, pg_temp.usage(6000, 300)));
insert into outcome values ('few-retry', pg_temp.chat(1, 3, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('few-retry-failed', pg_temp.finish(1, pg_temp.o('few-retry'), null, null));
reset role;
select is(pg_temp.o('few-failed'), '{"state":"finished","outcome":"failed"}'::jsonb, 'flashcards that failed');
select is((select jsonb_build_array(state, charged_tokens, reply) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('few'))), '["released",0,null]'::jsonb, 'are neither charged nor kept');
select is((select count(*)::integer from private.plan_use_events where ref = 'flashcards:' || pg_temp.r(3)), 0,
  'nor recorded as plan use');
select is(pg_temp.o('few-retry') ->> 'state', 'started', 'and Try again with the same request is admitted again');

-- 4. A free course records nothing --------------------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('gst', pg_temp.chat(1, 4, pg_temp.f('gst-1'), pg_temp.c('08')));
insert into outcome values ('gst-done', pg_temp.finish(1, pg_temp.o('gst'), pg_temp.cards(6), pg_temp.usage(6000, 500)));
reset role;
select is(pg_temp.o('gst-done'), '{"state":"finished","outcome":"answered"}'::jsonb,
  'flashcards on GST 111, a free course, are delivered');
select is((select count(*)::integer from private.plan_use_events where ref = 'flashcards:' || pg_temp.r(4)), 0,
  'and, as for any use of a free course, recorded as nothing');

-- 5. A free pass: each set is one of its messages -----------------------------------------------------------------------
select pg_temp.student(2);
select pg_temp.pass(2);
set local role service_role;
insert into outcome values ('pass-messages-1', public.admin_set_campus_bot_reply_limits(null, 1, null, null, null, 'Ops',
  'flashcards pass test'));
insert into outcome values ('pass-cards', pg_temp.chat(2, 5, pg_temp.f('gst-1'), pg_temp.c('08')));
insert into outcome values ('pass-cards-done', pg_temp.finish(2, pg_temp.o('pass-cards'), pg_temp.cards(5),
  pg_temp.usage(6000, 400)));
insert into outcome values ('pass-next', pg_temp.chat(2, 6, pg_temp.f('gst-1'), pg_temp.c('08')));
insert into outcome values ('pass-messages-10', public.admin_set_campus_bot_reply_limits(null, 10, null, null, null, 'Ops',
  'restore'));
reset role;
select is(pg_temp.o('pass-cards-done'), '{"state":"finished","outcome":"answered"}'::jsonb,
  'a free pass student makes flashcards');
select is((select jsonb_build_array(funding_source, state, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('pass-cards'))), '["trial","consumed",null]'::jsonb, 'counted on the pass, not metered');
select is(pg_temp.o('pass-next'), '{"state":"pass-limit"}'::jsonb, 'as one of its messages: with one allowed, the next stops');

-- 6. The redefined function -----------------------------------------------------------------------------------------------
select is((select jsonb_build_array(p.proowner = b.proowner, p.prosecdef, p.proconfig, p.provolatile)
    from pg_proc p, pg_proc b where p.oid = 'public.finish_campus_bot_chat(uuid,uuid,text,jsonb,jsonb)'::regprocedure
      and b.oid = 'public.begin_campus_bot_chat(uuid,uuid,uuid,uuid,boolean)'::regprocedure),
  '[true,true,["search_path=\"\""],"v"]'::jsonb,
  'the redefined function keeps its owner (that of the chat functions beside it) and security settings');
select ok(has_function_privilege('service_role', 'public.finish_campus_bot_chat(uuid,uuid,text,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_campus_bot_chat(uuid,uuid,text,jsonb,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.finish_campus_bot_chat(uuid,uuid,text,jsonb,jsonb)', 'execute'),
  'and its grants: the service role only');

select * from finish();
rollback;
