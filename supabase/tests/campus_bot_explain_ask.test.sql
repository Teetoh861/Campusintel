-- supabase/tests/campus_bot_explain_ask.test.sql — Campus Bot Explain and Ask Campus Bot
-- (20261117100000_campus_bot_explain_ask.sql): settings and switches; the notes as passages and the search over them;
-- the attempt check; explanations saved once for everyone and reused free; the calculation check, charged at the
-- writer's weight; funding, limits and charging only what is delivered; the shared topic rule, the free pass's pinned
-- topic and kept chat replies; corrections and republished notes; operator functions and privileges; replies on a paid
-- course as plan use for refunds.
-- The provider is never called: each result is reported to the finish functions as the server reports it. Time is
-- simulated by moving timestamps (every decision reads clock_timestamp()). Everything rolls back.
begin;
select no_plan();

-- The owner content rule (20261122120000) withdraws content this test uses as fixtures. It is rolled back here, inside
-- this test's transaction, so the content stands as the earlier migrations left it.
select is(private.owner_content_rule('rollback'), 'rolled-back', 'the owner content rule (20261122120000) rolled back for this test');

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('cb100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('cb200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.a(n integer) returns uuid language sql immutable
  as $$ select ('cb300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n integer) returns uuid language sql immutable
  as $$ select ('cb400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- Course 08 is GST 111 (free, with a study guide); 09 is GST 112 (free, no notes).
create function pg_temp.c(n text) returns uuid language sql immutable
  as $$ select ('40000000-0000-4000-8000-0000000000' || n)::uuid $$;
create function pg_temp.course(p_key text) returns uuid language sql stable security definer set search_path = ''
  as $$ select id from public.courses where content_key = p_key $$;
-- The notes topic a practice topic links to, and a course's n-th notes topic in page order.
create function pg_temp.topic(p_course uuid, p_practice text) returns uuid language sql stable security definer
  set search_path = '' as $$
  select i.id from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  where i.course_id = p_course and i.kind = 'note'
    and r.payload -> 'practice' @> jsonb_build_array(jsonb_build_object('topic', p_practice))
  order by i.position nulls last, i.created_at, i.id limit 1 $$;
create function pg_temp.nth(p_course uuid, p_n integer) returns uuid language sql stable security definer
  set search_path = '' as $$
  select i.id from public.managed_content_items i where i.course_id = p_course and i.kind = 'note'
    and i.published_revision is not null order by i.position nulls last, i.created_at, i.id offset p_n - 1 limit 1 $$;
create function pg_temp.title(p_item uuid) returns text language sql stable security definer set search_path = '' as $$
  select r.payload ->> 'title' from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision where i.id = p_item $$;
create function pg_temp.student(n integer) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
    'bot-explain-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.s(n), pg_temp.u(n), now(), now()) $$;
-- The free month (Standard Campus Bot limits, by tokens), and the free pass (counted).
create function pg_temp.early(n integer) returns void language sql as $$
  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by)
  values (pg_temp.u(n), 'early_access', clock_timestamp() - interval '1 day', clock_timestamp() + interval '20 days',
    'uncapped', null, 'cb-test') $$;
create function pg_temp.pass(n integer) returns void language sql as $$
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by)
  values (pg_temp.u(n), 'trial', 'discovery', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '2 days',
    'capped', 1, 'cb-test') $$;
-- Calls as the application server makes them (the caller sets the service role). Topic practice draws every question
-- of the topic, so each student's attempt holds the same questions.
create function pg_temp.istart(p_user integer, p_attempt integer, p_topic text default 'Listening Skills and Note-taking',
  p_course text default '08') returns jsonb language sql as $$
  select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c(p_course), 'new', null, 100, 10800,
    '[]', null, null, null, 'instant', p_topic) $$;
create function pg_temp.estart(p_user integer, p_attempt integer) returns jsonb language sql as $$
  select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c('08'), 'new', null, 5, 1800, '[]',
    5, 1800, false) $$;
-- An attempt's n-th question by question id (the same question in every attempt on the topic), or the one at an ordinal.
create function pg_temp.qn(p_attempt integer, p_n integer) returns uuid language sql stable security definer
  set search_path = '' as $$ select question_id from public.quiz_attempt_questions
    where attempt_id = pg_temp.a(p_attempt) order by question_id offset p_n - 1 limit 1 $$;
create function pg_temp.qo(p_attempt integer, p_ordinal integer) returns uuid language sql stable security definer
  set search_path = '' as $$ select question_id from public.quiz_attempt_questions
    where attempt_id = pg_temp.a(p_attempt) and ordinal = p_ordinal $$;
-- A question's key as an attempt showed it, or the next option (a wrong one).
create function pg_temp.opt(p_attempt integer, p_question uuid, p_right boolean) returns integer language sql stable
  security definer set search_path = '' as $$
  select case when p_right then (r.payload ->> 'correctOption')::integer
      else ((r.payload ->> 'correctOption')::integer + 1) % jsonb_array_length(r.payload -> 'options') end
  from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = pg_temp.a(p_attempt) and q.question_id = p_question $$;
create function pg_temp.pick(p_user integer, p_attempt integer, p_question uuid, p_right boolean) returns jsonb
  language sql as $$ select public.practice_pick(pg_temp.s(p_user), pg_temp.a(p_attempt), p_question,
    pg_temp.opt(p_attempt, p_question, p_right)) $$;
create function pg_temp.explain(p_user integer, p_attempt integer, p_question uuid, p_generate boolean default true)
  returns jsonb language sql as $$
  select public.begin_campus_bot_explanation(pg_temp.s(p_user), pg_temp.a(p_attempt), p_question, p_generate) $$;
-- The provider's usage report, as the server passes it on.
create function pg_temp.usage(p_input integer, p_output integer, p_model text default 'claude-haiku-5-5') returns jsonb
  language sql immutable as $$ select jsonb_build_object('provider', 'anthropic', 'model', p_model,
    'inputTokens', p_input, 'outputTokens', p_output, 'cacheReadInputTokens', 0, 'cacheCreationInputTokens', 0,
    'estimatedCostUsd', 0.0005, 'durationMs', 900) $$;
create function pg_temp.reply(p_result jsonb) returns uuid language sql immutable
  as $$ select (p_result ->> 'reply_id')::uuid $$;
-- Settle an explanation: 'explained' (naming its notes topic), 'not-covered', 'check-failed' (naming it) or 'failed'.
create function pg_temp.settle(p_user integer, p_started jsonb, p_outcome text, p_topic uuid default null,
  p_check jsonb default null) returns jsonb language sql as $$
  select public.finish_campus_bot_explanation(pg_temp.u(p_user), pg_temp.reply(p_started), p_outcome,
    case when p_outcome = 'explained' then '  Option B is right because the notes say so.  ' end, p_topic,
    pg_temp.usage(3300, 400), p_check) $$;
create function pg_temp.chat(p_user integer, p_request integer, p_item uuid, p_course uuid default null,
  p_generate boolean default true) returns jsonb language sql as $$
  select public.begin_campus_bot_chat(pg_temp.s(p_user), pg_temp.r(p_request), coalesce(p_course, pg_temp.c('08')),
    p_item, p_generate) $$;
create function pg_temp.answer(p_user integer, p_started jsonb, p_outcome text default 'answered') returns jsonb
  language sql as $$ select public.finish_campus_bot_chat(pg_temp.u(p_user), pg_temp.reply(p_started), p_outcome,
    case when p_outcome = 'answered' then '{"text":"Your notes say a good listener prepares.","in_notes":true}'::jsonb end,
    pg_temp.usage(6000, 350)) $$;
-- A read through the student's own session.
create function pg_temp.as_student(n integer, p_call text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'session_id', pg_temp.s(n),
    'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select ' || p_call into v;
  reset role;
  return v;
end $$;
grant execute on function pg_temp.as_student(integer, text) to authenticated;
create function pg_temp.keys(p_value jsonb) returns text[] language sql immutable as $$
  with recursive walk(v) as (select p_value union all
    select child from walk, lateral (
      select value from jsonb_each(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end)
      union all select value from jsonb_array_elements(case when jsonb_typeof(walk.v) = 'array' then walk.v else '[]' end)
    ) children(child))
  select coalesce(array_agg(distinct k order by k), '{}') from walk, lateral jsonb_object_keys(
    case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end) k $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
create temporary table fixture (name text primary key, id uuid) on commit drop;
grant all on outcome, fixture to authenticated, service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable
  as $$ select result from outcome where step = p_step $$;
create function pg_temp.f(p_name text) returns uuid language sql stable as $$ select id from fixture where name = p_name $$;
insert into fixture values ('t1', pg_temp.topic(pg_temp.c('08'), 'Listening Skills and Note-taking')),
  ('bua', pg_temp.course('principles-business-administration'));
insert into fixture values ('bua-1', pg_temp.nth(pg_temp.f('bua'), 1)), ('bua-2', pg_temp.nth(pg_temp.f('bua'), 2));

-- 1. Settings, steps, the first calculation courses, privileges ---------------------------------------------------------
select is((select jsonb_build_object('explain', explain_enabled, 'ask', ask_enabled, 'topic_sets', topic_sets_enabled,
    'checker', explain_check_model, 'pass', jsonb_build_array(pass_explanations, pass_chat_messages),
    'daily', jsonb_build_array(daily_explanations, daily_chat_messages), 'undelivered', reply_undelivered_per_day,
    'reservation', reply_reservation_seconds, 'keep', chat_reply_keep_seconds) from private.campus_bot_settings),
  '{"explain":false,"ask":false,"topic_sets":false,"checker":"sonnet","pass":[5,10],"daily":[3000,10000],"undelivered":20,"reservation":180,"keep":600}'::jsonb,
  'every feature starts switched off, with the owner''s limits');
select is((select jsonb_agg(jsonb_build_array(step, read_tokens_max, written_tokens_max) order by step)
    from private.campus_bot_request_caps where step in ('chat', 'explain', 'explain-check')),
  '[["chat",14000,800],["explain",8000,800],["explain-check",4000,2000]]'::jsonb, 'each new step has its per-request caps');
select is((select array_agg(k.content_key order by k.content_key collate "C") from private.campus_bot_courses b
    join public.courses k on k.id = b.course_id where b.calculation),
  array['business-statistics', 'business-statistics-1', 'business-taxation-2', 'elements-banking',
    'fundamentals-deposit-insurance', 'introduction-actuarial-science', 'introduction-computer', 'introduction-finance',
    'introduction-financial-accounting-1', 'introduction-insurance', 'introduction-microeconomics',
    'leadership-governance', 'managerial-economics', 'mathematics-business', 'principles-economics-1',
    'principles-marketing'],
  'the calculation courses are the 16 whose exam runs 40 minutes');
select is((select count(*)::integer from unnest(array['private.campus_bot_courses', 'private.note_passages',
    'private.campus_bot_replies', 'private.campus_bot_reply_days', 'private.campus_bot_explanations',
    'private.campus_bot_pass_explanations']) t,
    unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, t, privilege)), 0, 'no API role reads or writes the new tables');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.campus_bot_courses'::regclass,
  'private.note_passages'::regclass, 'private.campus_bot_replies'::regclass, 'private.campus_bot_reply_days'::regclass,
  'private.campus_bot_explanations'::regclass, 'private.campus_bot_pass_explanations'::regclass)),
  'row-level security is on for every new table');
select is((select count(*)::integer from unnest(array['public.begin_campus_bot_explanation(uuid,uuid,uuid,boolean)',
    'public.finish_campus_bot_explanation(uuid,uuid,text,text,uuid,jsonb,jsonb)',
    'public.begin_campus_bot_chat(uuid,uuid,uuid,uuid,boolean)', 'public.finish_campus_bot_chat(uuid,uuid,text,jsonb,jsonb)',
    'public.admin_set_campus_bot_feature(text,boolean,text,text)',
    'public.admin_set_campus_bot_reply_limits(integer,integer,integer,integer,integer,text,text)',
    'public.admin_set_campus_bot_checker(text,text,text)', 'public.admin_set_campus_bot_course(text,boolean,text,text)',
    'public.admin_clear_campus_bot_explanations(text,text,text)', 'public.admin_campus_bot_status()',
    'public.admin_campus_bot_explanations(text,integer)', 'public.admin_campus_bot_review_sample(text,integer,integer)']) fn
  where not has_function_privilege('service_role', fn, 'EXECUTE') or has_function_privilege('authenticated', fn, 'EXECUTE')
    or has_function_privilege('anon', fn, 'EXECUTE')), 0, 'requests, settlements and operator settings are the server''s alone');
select ok(has_function_privilege('authenticated', 'public.get_campus_bot_features()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_campus_bot_features()', 'EXECUTE'),
  'a signed-in page reads the switches; a visitor does not');
select is((select count(*)::integer from unnest(array['private.guide_inline_text(jsonb)',
    'private.guide_blocks_text(jsonb,integer)', 'private.note_passages_of(jsonb)', 'private.tsquery_or(tsquery)',
    'private.refresh_note_passages()', 'private.note_topic_view(uuid,uuid)', 'private.note_topic_passages(uuid,integer)',
    'private.note_search(uuid,text,text,integer,integer)', 'private.campus_bot_window_use(uuid)',
    'private.campus_bot_reply_funding(uuid,timestamptz)', 'private.release_abandoned_campus_bot_replies(uuid,timestamptz)',
    'private.campus_bot_exam_open(uuid,uuid,timestamptz)',
    'private.campus_bot_pass_explanations_used(uuid,timestamptz,integer)',
    'private.campus_bot_topic_context(uuid,uuid,uuid,timestamptz,integer)',
    'private.campus_bot_explanation_view(private.campus_bot_explanations)',
    'private.campus_bot_explanation_ref(uuid,integer,integer)', 'public.purge_campus_bot_chat_replies()']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'the helpers are callable by no API role');
select ok(exists (select 1 from cron.job where jobname = 'campusintell-campus-bot-reply-purge' and active
  and schedule = '* * * * *'), 'kept chat replies are deleted by a job every minute, whatever the traffic');

-- 2. Notes as passages ------------------------------------------------------------------------------------------------
select isnt(pg_temp.f('t1'), null, 'GST 111''s first practice topic links to a notes topic');
select is((select count(*)::integer from public.managed_content_items i where i.kind = 'note'
    and i.published_revision is not null and not exists (select 1 from private.note_passages p where p.item_id = i.id)), 0,
  'every published note has passages');
select ok((select bool_and(p.revision = i.published_revision and p.course_id = i.course_id) from private.note_passages p
  join public.managed_content_items i on i.id = p.item_id), 'each passage carries its note''s published revision and course');
select is((select jsonb_build_array((array_agg(heading order by ordinal))[1], (array_agg(heading order by ordinal desc))[1])
    from private.note_passages where item_id = pg_temp.f('t1')),
  '["What you must know", "Recap"]'::jsonb, 'a guide topic reads as what you must know, its lessons, then the recap');
select is((select count(*)::integer from private.note_passages where item_id = pg_temp.f('t1')
    and heading not in ('What you must know', 'Recap')),
  (select jsonb_array_length(r.payload -> 'lessons') from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.id = pg_temp.f('t1')), 'one passage per lesson');
select ok(not exists (select 1 from private.note_passages where body ~ '"(text|bold|italic|type)":'),
  'passages are plain text, never the stored structure');
select is((select jsonb_agg(jsonb_build_array(ordinal, heading, body) order by ordinal) from private.note_passages_of(
    '{"title":"Depreciation","body":"Spread the cost.","noteType":"topic_note","keyPoints":["Cost","Life"],"examTip":"Show working."}')),
  jsonb_build_array(jsonb_build_array(0, 'Depreciation', E'Spread the cost.\n- Cost\n- Life\nShow working.')),
  'any other note is one passage: its text, key points and tip');
select is((select count(*)::integer from private.note_passages_of('{"noteType":"guide_topic","lessons":"not a list"}')), 0,
  'a shape it cannot read gives no passages, and no error');
select is(private.guide_blocks_text('[{"type":"list","ordered":true,"start":3,"items":[{"text":[{"text":"a"}]},{"text":[{"text":"b","bold":true}],"blocks":[{"type":"paragraph","text":[{"text":"c"}]}]}]},{"type":"table","header":[[{"text":"H1"}],[{"text":"H2"}]],"rows":[[[{"text":"x"}],[]]]},{"type":"preformatted","text":"y = mx + c"}]'),
  E'3. a\n4. b\n  c\nH1 | H2\nx | \ny = mx + c\n', 'lists, nesting, tables and formulas become lines of text');

-- 3. Searching a course's notes ---------------------------------------------------------------------------------------
select is((select item_id from private.note_search(pg_temp.c('08'), 'how should a student take notes while listening',
    'Listening Skills and Note-taking', 3, 9000) where place = 1), pg_temp.f('t1'),
  'the notes topic linked to the question''s own topic comes first');
select ok((select count(*) from private.note_search(pg_temp.c('08'), 'listening lecture notes', null, 3, 9000)) between 1 and 3,
  'without a link, full-text search over the course''s notes finds up to three passages');
select ok((select bool_and(i.course_id = pg_temp.c('08')) from private.note_search(pg_temp.c('08'),
    'culture economy listening grammar', null, 3, 9000) s join public.managed_content_items i on i.id = s.item_id),
  'only from that course');
select is((select count(*)::integer from private.note_search(pg_temp.c('08'), 'qzxv wqpz', null, 3, 9000)), 0,
  'words the notes never use find nothing');
select is((select count(*)::integer from private.note_search(pg_temp.c('08'), 'listening', 'Listening Skills and Note-taking',
  3, 1)), 1, 'past the character budget only the best passage is kept');
select is((select count(*)::integer from private.note_search(pg_temp.c('09'), 'culture', 'Culture and Society', 3, 9000)), 0,
  'a course without published notes has nothing to search');

-- 4. Explain: the switch and the attempt check ------------------------------------------------------------------------
select pg_temp.student(n) from generate_series(1, 8) n;
select pg_temp.early(n) from unnest(array[1, 2, 5, 6, 7]) n;
select pg_temp.pass(4);
set local role service_role;
insert into outcome values ('start-1', pg_temp.istart(1, 1));
insert into outcome values ('off', pg_temp.explain(1, 1, pg_temp.qn(1, 1)));
insert into outcome values ('switch-on', public.admin_set_campus_bot_feature('explain', true, 'Ops', 'explain test'));
insert into outcome values ('not-answered', pg_temp.explain(1, 1, pg_temp.qn(1, 1)));
insert into outcome values ('pick-1', pg_temp.pick(1, 1, pg_temp.qn(1, 1), false));
insert into outcome values ('signed-out', public.begin_campus_bot_explanation(gen_random_uuid(), pg_temp.a(1),
  pg_temp.qn(1, 1), true));
insert into outcome values ('not-yours', pg_temp.explain(2, 1, pg_temp.qn(1, 1)));
insert into outcome values ('not-in-attempt', public.begin_campus_bot_explanation(pg_temp.s(1), pg_temp.a(1),
  gen_random_uuid(), true));
insert into outcome values ('e1', pg_temp.explain(1, 1, pg_temp.qn(1, 1)));
reset role;
insert into fixture values ('cbt-item', (select item_id from public.quiz_attempt_questions where attempt_id = pg_temp.a(1)
  order by ordinal limit 1));
select is(pg_temp.o('start-1') ->> 'state', 'ready', 'student 1 practises GST 111''s first topic');
select is(pg_temp.o('off'), '{"state":"disabled"}'::jsonb, 'Explain does nothing until the team switches it on');
select is(pg_temp.o('switch-on'), '{"state":"changed","feature":"explain","enabled":true}'::jsonb, 'the team switches it on');
select is(pg_temp.o('not-answered'), '{"state":"not-answered"}'::jsonb,
  'in topic practice, a question not yet answered is never explained');
select is(pg_temp.o('pick-1') ->> 'state', 'picked', 'student 1 answers it, wrongly');
select is(pg_temp.o('signed-out'), '{"state":"signed-out"}'::jsonb, 'without a live session, nothing');
select is(pg_temp.o('not-yours'), '{"state":"not-found"}'::jsonb, 'another student''s attempt is not found');
select is(pg_temp.o('not-in-attempt'), '{"state":"not-found"}'::jsonb, 'nor is a question outside the attempt');
select is(pg_temp.o('e1') ->> 'state', 'started', 'an answered question is explained');
select is(jsonb_build_object('model', pg_temp.o('e1') ->> 'model', 'max', (pg_temp.o('e1') ->> 'max_output_tokens')::integer,
    'check', pg_temp.o('e1') -> 'check', 'seconds', (pg_temp.o('e1') ->> 'reservation_seconds')::integer,
    'course', pg_temp.o('e1') -> 'course' ->> 'code'),
  '{"model":"claude-haiku-5-5","max":800,"check":null,"seconds":180,"course":"GST111"}'::jsonb,
  'Haiku writes within the explain step''s cap; GST 111 is not a calculation course, so nothing checks it');
select is(pg_temp.o('e1') -> 'question' -> 'chosen_option', to_jsonb(pg_temp.opt(1, pg_temp.qn(1, 1), false)),
  'the option the student chose comes from their attempt');
select is(pg_temp.o('e1') -> 'question' -> 'correct_option', to_jsonb(pg_temp.opt(1, pg_temp.qn(1, 1), true)),
  'with the official key');
select is(pg_temp.o('e1') -> 'passages' -> 0 ->> 'item_id', pg_temp.f('t1')::text,
  'the first passage comes from the notes topic linked to the question''s topic');
select ok(jsonb_array_length(pg_temp.o('e1') -> 'passages') between 1 and 3, 'at most three passages');
select ok(position(pg_temp.u(1)::text in pg_temp.o('e1')::text) = 0 and position(pg_temp.a(1)::text in pg_temp.o('e1')::text) = 0
  and position('example.test' in pg_temp.o('e1')::text) = 0, 'nothing in the request names the student or their attempt');
select is((select jsonb_build_object('feature', feature, 'state', state, 'funding', funding_source,
    'reserved', reserved_tokens, 'model', model, 'provider', provider_model,
    'weights', jsonb_build_array(price_weight, written_token_weight), 'caps', jsonb_build_array(read_tokens_max, written_tokens_max),
    'windows', session_window_id is not null and week_window_id is not null)
  from private.campus_bot_replies where id = pg_temp.reply(pg_temp.o('e1'))),
  '{"feature":"explain","state":"reserved","funding":"early_access","reserved":12000,"model":"haiku","provider":"claude-haiku-5-5","weights":[1,5],"caps":[8000,800],"windows":true}'::jsonb,
  'one reservation of the worst case, (8,000 + 5 x 800) x 1, in the student''s windows');
select is((select state from private.campus_bot_explanations where reply_id = pg_temp.reply(pg_temp.o('e1'))), 'running',
  'the explanation is being written');

-- 5. Explain: one writer, charged from the report, saved for everyone -------------------------------------------------
set local role service_role;
insert into outcome values ('same-again', pg_temp.explain(1, 1, pg_temp.qn(1, 1)));
insert into outcome values ('pick-2', pg_temp.pick(1, 1, pg_temp.qn(1, 2), true));
insert into outcome values ('second', pg_temp.explain(1, 1, pg_temp.qn(1, 2)));
insert into outcome values ('settle-1', pg_temp.settle(1, pg_temp.o('e1'), 'explained', pg_temp.f('t1')));
insert into outcome values ('settle-again', pg_temp.settle(1, pg_temp.o('e1'), 'explained', pg_temp.f('t1')));
insert into outcome values ('reread', pg_temp.explain(1, 1, pg_temp.qn(1, 1)));
insert into outcome values ('start-2', pg_temp.istart(2, 2));
insert into outcome values ('pick-2-same', pg_temp.pick(2, 2, pg_temp.qn(2, 1), false));
insert into outcome values ('shared', pg_temp.explain(2, 2, pg_temp.qn(2, 1)));
insert into outcome values ('start-3', pg_temp.istart(3, 3));
insert into outcome values ('pick-3-same', pg_temp.pick(3, 3, pg_temp.qn(3, 1), false));
insert into outcome values ('no-campus-bot', pg_temp.explain(3, 3, pg_temp.qn(3, 1)));
reset role;
select is(pg_temp.o('same-again'), '{"state":"busy"}'::jsonb, 'the same explanation while it is being written: busy');
select is(pg_temp.o('second'), '{"state":"busy"}'::jsonb, 'one explanation at a time per student');
select is(pg_temp.o('settle-1') - 'topic',
  '{"state":"finished","outcome":"explained","body":"Option B is right because the notes say so."}'::jsonb,
  'a delivered explanation is saved, trimmed');
select is(pg_temp.o('settle-1') -> 'topic', jsonb_build_object('item_id', pg_temp.f('t1'),
    'number', (select n from (select i.id, row_number() over (order by i.position nulls last, i.created_at, i.id) n
      from public.managed_content_items i where i.course_id = pg_temp.c('08') and i.kind = 'note'
        and i.published_revision is not null) t where t.id = pg_temp.f('t1')), 'title', pg_temp.title(pg_temp.f('t1'))),
  'with the notes topic it came from, numbered as the notes page numbers it');
select is(pg_temp.o('settle-again'), '{"state":"already-finished"}'::jsonb, 'settling twice changes nothing');
select is((select jsonb_build_object('state', state, 'outcome', outcome, 'read', read_tokens, 'written', written_tokens,
    'charged', charged_tokens, 'cost', cost_usd) from private.campus_bot_replies where id = pg_temp.reply(pg_temp.o('e1'))),
  '{"state":"consumed","outcome":"explained","read":3300,"written":400,"charged":5300,"cost":0.0005}'::jsonb,
  'charged from the provider''s report: (3,300 + 5 x 400) x 1');
select is((select used from private.campus_bot_window_use((select session_window_id from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('e1'))))), 5300::bigint, 'it counts in the student''s 5-hour window');
select is(pg_temp.o('reread') - 'topic',
  '{"state":"saved","outcome":"explained","body":"Option B is right because the notes say so."}'::jsonb,
  'asking again returns the saved explanation');
select is((select count(*)::integer from private.campus_bot_replies where user_id = pg_temp.u(1)), 1,
  'and reserves nothing more');
select is((select count(*)::integer from private.plan_use_events where user_id = pg_temp.u(1)), 0,
  'a free course is never recorded as plan use');
select is(pg_temp.qn(2, 1), pg_temp.qn(1, 1), 'two attempts on the topic hold the same questions');
select is(pg_temp.o('shared') - 'topic',
  '{"state":"saved","outcome":"explained","body":"Option B is right because the notes say so."}'::jsonb,
  'another student with the same question and choice gets the saved explanation');
select is((select count(*)::integer from private.campus_bot_replies where user_id = pg_temp.u(2)), 0,
  'with nothing reserved or charged');
select is((select count(*)::integer from private.campus_bot_windows where user_id = pg_temp.u(2)), 0,
  'not even a window opened');
select is(pg_temp.o('no-campus-bot'), '{"state":"not-entitled"}'::jsonb, 'a saved explanation still needs Campus Bot');

-- 6. Explain: nothing delivered, nothing charged ----------------------------------------------------------------------
set local role service_role;
insert into outcome values ('e2', pg_temp.explain(1, 1, pg_temp.qn(1, 2)));
insert into outcome values ('e2-failed', pg_temp.settle(1, pg_temp.o('e2'), 'failed'));
insert into outcome values ('e2-retry', pg_temp.explain(1, 1, pg_temp.qn(1, 2)));
insert into outcome values ('e2-uncovered', pg_temp.settle(1, pg_temp.o('e2-retry'), 'not-covered'));
insert into outcome values ('e2-saved', pg_temp.explain(1, 1, pg_temp.qn(1, 2)));
insert into outcome values ('pick-3', pg_temp.pick(1, 1, pg_temp.qn(1, 3), true));
insert into outcome values ('cannot-write', pg_temp.explain(1, 1, pg_temp.qn(1, 3), false));
insert into outcome values ('start-gst112', pg_temp.istart(1, 4, 'Islam and Political Culture', '09'));
insert into outcome values ('pick-gst112', pg_temp.pick(1, 4, pg_temp.qn(4, 1), true));
insert into outcome values ('no-notes', pg_temp.explain(1, 4, pg_temp.qn(4, 1)));
reset role;
select is(pg_temp.o('e2') ->> 'state', 'started', 'another question is explained');
select is(pg_temp.o('e2-failed'), '{"state":"finished","outcome":"failed"}'::jsonb, 'a failure saves nothing');
select is((select jsonb_build_array(state, outcome, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('e2'))), '["released","failed",0]'::jsonb, 'and charges nothing');
select is(pg_temp.o('e2-retry') ->> 'state', 'started', 'so the next tap writes it again');
select is(pg_temp.o('e2-uncovered'), '{"state":"finished","outcome":"not-covered","body":null,"topic":null}'::jsonb,
  'when the notes do not cover it, that is what is saved');
select is((select jsonb_build_array(state, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('e2-retry'))), '["released",0]'::jsonb, 'charged nothing');
select is(pg_temp.o('e2-saved'), '{"state":"saved","outcome":"not-covered","body":null,"topic":null}'::jsonb,
  'and said again at once, for everyone');
select is(pg_temp.o('cannot-write'), '{"state":"disabled"}'::jsonb,
  'with no provider, a question not yet explained has nothing to show');
select is(pg_temp.o('no-notes'), '{"state":"saved","outcome":"not-covered","body":null,"topic":null}'::jsonb,
  'a course with no notes: not covered, said at once without a provider call');
select is((select count(*)::integer from private.campus_bot_replies where user_id = pg_temp.u(1)
  and course_id = pg_temp.c('09')), 0, 'and nothing reserved');

-- 7. Explain: exams -----------------------------------------------------------------------------------------------------
insert into public.quiz_attempts (id, user_id, course_id, question_count, status, finished_at)
  values (pg_temp.a(6), pg_temp.u(1), pg_temp.c('08'), 1, 'submitted', now());
set local role service_role;
insert into outcome values ('legacy', pg_temp.explain(1, 6, pg_temp.qn(1, 1)));
insert into outcome values ('exam', pg_temp.estart(1, 5));
insert into outcome values ('exam-open', pg_temp.explain(1, 1, pg_temp.qn(1, 1)));
insert into outcome values ('exam-running', pg_temp.explain(1, 5, pg_temp.qo(5, 0)));
insert into outcome values ('exam-submit', public.practice_submit(pg_temp.s(1), pg_temp.a(5), gen_random_uuid(), 1, 0,
  (select jsonb_object_agg(pg_temp.qo(5, n)::text, pg_temp.opt(5, pg_temp.qo(5, n), true)) from generate_series(0, 3) n)));
insert into outcome values ('left-out', pg_temp.explain(1, 5, pg_temp.qo(5, 4)));
insert into outcome values ('left-out-settled', pg_temp.settle(1, pg_temp.o('left-out'), 'explained',
  (pg_temp.o('left-out') -> 'passages' -> 0 ->> 'item_id')::uuid));
reset role;
select is(pg_temp.o('legacy'), '{"state":"not-found"}'::jsonb, 'an attempt from before server-run practice is never explained');
select is(pg_temp.o('exam') ->> 'state', 'ready', 'student 1 starts a timed exam in the same course');
select is(pg_temp.o('exam-open'), '{"state":"exam-open"}'::jsonb, 'while it runs, nothing in that course is explained');
select is(pg_temp.o('exam-running'), '{"state":"not-answered"}'::jsonb, 'least of all the running exam''s own questions');
select is(pg_temp.o('exam-submit') ->> 'state', 'graded', 'the exam is submitted, one question left out');
select is(pg_temp.o('left-out') ->> 'state', 'started', 'a graded exam''s question left out is explained');
select is(pg_temp.o('left-out') -> 'question' -> 'chosen_option', 'null'::jsonb, 'with no choice of the student''s');
select is((select chosen_option from private.campus_bot_explanations where reply_id = pg_temp.reply(pg_temp.o('left-out'))),
  -1, 'saved for everyone who leaves that question out');

-- 8. Explain on a free pass: counted, and the pass's own exam ---------------------------------------------------------
set local role service_role;
insert into outcome values ('pass-start', pg_temp.istart(4, 7));
insert into outcome values ('pass-pick', pg_temp.pick(4, 7, pg_temp.qn(7, 4), true));
reset role;
-- The pass's own exam open in the course (a direct row: the app never opens one on a free course; the rule is the
-- course's).
insert into private.discovery_previews (grant_id, user_id, kind, course_id, content, deadline_at)
  select g.id, pg_temp.u(4), 'cbt', pg_temp.c('08'),
    '[{"item_id":"00000000-0000-4000-8000-000000000001","prompt":"p","options":["a","b"],"correct_option":0}]',
    clock_timestamp() + interval '1 hour'
  from public.entitlement_grants g where g.user_id = pg_temp.u(4) and g.source = 'trial';
set local role service_role;
insert into outcome values ('pass-exam-open', pg_temp.explain(4, 7, pg_temp.qn(7, 4)));
reset role;
delete from private.discovery_previews where user_id = pg_temp.u(4) and kind = 'cbt';
set local role service_role;
insert into outcome values ('pass-limit-1', public.admin_set_campus_bot_reply_limits(1, null, null, null, null, 'Ops',
  'pass test'));
insert into outcome values ('pass-e1', pg_temp.explain(4, 7, pg_temp.qn(7, 4)));
insert into outcome values ('pass-e1-settled', pg_temp.settle(4, pg_temp.o('pass-e1'), 'explained', pg_temp.f('t1')));
insert into outcome values ('pass-pick-2', pg_temp.pick(4, 7, pg_temp.qn(7, 5), true));
insert into outcome values ('pass-e2', pg_temp.explain(4, 7, pg_temp.qn(7, 5)));
insert into outcome values ('pass-saved', pg_temp.explain(4, 7, pg_temp.qn(7, 4)));
-- Student 1's saved explanation of the first question, for the same wrong choice: written for someone else.
insert into outcome values ('pass-pick-shared', pg_temp.pick(4, 7, pg_temp.qn(7, 1), false));
insert into outcome values ('pass-shared-over', pg_temp.explain(4, 7, pg_temp.qn(7, 1)));
insert into outcome values ('pass-limit-2', public.admin_set_campus_bot_reply_limits(2, null, null, null, null, 'Ops',
  'pass test'));
insert into outcome values ('pass-shared', pg_temp.explain(4, 7, pg_temp.qn(7, 1)));
insert into outcome values ('pass-shared-again', pg_temp.explain(4, 7, pg_temp.qn(7, 1)));
insert into outcome values ('pass-limit-5', public.admin_set_campus_bot_reply_limits(5, null, null, null, null, 'Ops',
  'restore'));
reset role;
select is(pg_temp.o('pass-exam-open'), '{"state":"exam-open"}'::jsonb, 'nor while the free pass exam is open in that course');
select is(pg_temp.o('pass-e1') ->> 'state', 'started', 'a free pass funds explanations');
select is((select jsonb_build_array(funding_source, reserved_tokens, session_window_id) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('pass-e1'))), '["trial",null,null]'::jsonb, 'by count: no tokens, no windows');
select is((select jsonb_build_array(state, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('pass-e1'))), '["consumed",null]'::jsonb, 'a delivered one is counted');
select is(pg_temp.o('pass-e2'), '{"state":"pass-limit"}'::jsonb, 'past the pass''s explanations, no more are written');
select is(pg_temp.o('pass-saved') ->> 'state', 'saved', 'saved ones stay free to read');
select is(pg_temp.o('pass-shared-over'), '{"state":"pass-limit"}'::jsonb,
  'an explanation saved for someone else counts toward the pass too: past its explanations, none is delivered');
select is(jsonb_build_array(pg_temp.o('pass-shared') ->> 'state', pg_temp.o('pass-shared') ->> 'outcome'),
  '["saved","explained"]'::jsonb, 'with room on the pass it is delivered, from what was saved');
select is((select count(*)::integer from private.campus_bot_pass_explanations x join public.entitlement_grants g
    on g.id = x.grant_id where g.user_id = pg_temp.u(4)), 2, 'and counted once on the pass, as the second of its two');
select is(jsonb_build_array(pg_temp.o('pass-shared-again') ->> 'state', (select count(*)::integer
    from private.campus_bot_pass_explanations x join public.entitlement_grants g on g.id = x.grant_id
    where g.user_id = pg_temp.u(4))), '["saved",2]'::jsonb, 'reading it again is free');

-- 9. Explain: abandoned reservations, limits, the day's ceiling -------------------------------------------------------
set local role service_role;
insert into outcome values ('s5-start', pg_temp.istart(5, 8));
insert into outcome values ('s5-pick', pg_temp.pick(5, 8, pg_temp.qn(8, 6), false));
insert into outcome values ('s5-e', pg_temp.explain(5, 8, pg_temp.qn(8, 6)));
reset role;
update private.campus_bot_replies set reserved_at = reserved_at - interval '10 minutes'
  where id = pg_temp.reply(pg_temp.o('s5-e'));
update private.campus_bot_explanations set started_at = started_at - interval '10 minutes'
  where reply_id = pg_temp.reply(pg_temp.o('s5-e'));
set local role service_role;
insert into outcome values ('s5-again', pg_temp.explain(5, 8, pg_temp.qn(8, 6)));
insert into outcome values ('s5-late', pg_temp.settle(5, pg_temp.o('s5-e'), 'explained', pg_temp.f('t1')));
insert into outcome values ('s5-again-failed', pg_temp.settle(5, pg_temp.o('s5-again'), 'failed'));
insert into outcome values ('s5-pick-2', pg_temp.pick(5, 8, pg_temp.qn(8, 7), false));
reset role;
select is(pg_temp.o('s5-again') ->> 'state', 'started',
  'a reservation never settled is released, and the explanation written again');
select is((select jsonb_build_array(state, outcome, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('s5-e'))), '["released","abandoned",0]'::jsonb, 'charging nothing for it');
select is(pg_temp.o('s5-late'), '{"state":"already-finished"}'::jsonb, 'a writer that comes back late saves nothing');
update private.campus_bot_tiers set session_tokens = 1000 where tier = 'standard';
set local role service_role;
insert into outcome values ('session-limit', pg_temp.explain(5, 8, pg_temp.qn(8, 7)));
reset role;
update private.campus_bot_tiers set session_tokens = 350000, week_tokens = 1000 where tier = 'standard';
set local role service_role;
insert into outcome values ('week-limit', pg_temp.explain(5, 8, pg_temp.qn(8, 7)));
reset role;
update private.campus_bot_tiers set week_tokens = 700000 where tier = 'standard';
select is(pg_temp.o('session-limit'), jsonb_build_object('state', 'session-limit', 'resets_at', (select ends_at
    from private.campus_bot_windows where user_id = pg_temp.u(5) and kind = 'session')),
  'out of 5-hour tokens: refused, with the reset time stored when the window opened');
select is(pg_temp.o('week-limit'), jsonb_build_object('state', 'week-limit', 'resets_at', (select ends_at
    from private.campus_bot_windows where user_id = pg_temp.u(5) and kind = 'week')), 'out of weekly tokens: the same');
create temporary table today on commit drop as select admitted from private.campus_bot_reply_days
  where day = (clock_timestamp() at time zone 'utc')::date and feature = 'explain';
grant select on today to service_role;
set local role service_role;
insert into outcome values ('undelivered-2', public.admin_set_campus_bot_reply_limits(null, null, null, null, 2, 'Ops',
  'undelivered test'));
insert into outcome values ('undelivered', pg_temp.explain(5, 8, pg_temp.qn(8, 7)));
insert into outcome values ('undelivered-20', public.admin_set_campus_bot_reply_limits(null, null, null, null, 20, 'Ops',
  'restore'));
insert into outcome values ('ceiling', public.admin_set_campus_bot_reply_limits(null, null, (select admitted from today),
  null, null, 'Ops', 'ceiling test'));
insert into outcome values ('capacity', pg_temp.explain(5, 8, pg_temp.qn(8, 7)));
insert into outcome values ('ceiling-3000', public.admin_set_campus_bot_reply_limits(null, null, 3000, null, null, 'Ops',
  'restore'));
reset role;
select is(pg_temp.o('undelivered'), '{"state":"undelivered-limit"}'::jsonb,
  'a student''s undelivered tries for the day are used up (here two): no more today');
select is(pg_temp.o('capacity'), '{"state":"capacity"}'::jsonb, 'the platform''s explanations for the day are used up');

-- 10. Explain on a calculation course, and a course no longer included ------------------------------------------------
create temporary table unchecked on commit drop as select count(*)::integer as n from private.campus_bot_explanations
  where course_id = pg_temp.c('08') and state = 'done' and outcome = 'explained' and not checked;
set local role service_role;
insert into outcome values ('calc-on', public.admin_set_campus_bot_course('use-of-english', true, 'Ops', 'calculation test'));
insert into outcome values ('s7-start', pg_temp.istart(7, 9));
insert into outcome values ('s7-pick', pg_temp.pick(7, 9, pg_temp.qn(9, 1), false));
insert into outcome values ('calc', pg_temp.explain(7, 9, pg_temp.qn(9, 1)));
insert into outcome values ('calc-unchecked', pg_temp.settle(7, pg_temp.o('calc'), 'explained', pg_temp.f('t1')));
insert into outcome values ('calc-2', pg_temp.explain(7, 9, pg_temp.qn(9, 1)));
insert into outcome values ('calc-checked', pg_temp.settle(7, pg_temp.o('calc-2'), 'explained', pg_temp.f('t1'),
  pg_temp.usage(1700, 700, 'claude-sonnet-5-5')));
insert into outcome values ('s7-pick-2', pg_temp.pick(7, 9, pg_temp.qn(9, 8), true));
insert into outcome values ('calc-3', pg_temp.explain(7, 9, pg_temp.qn(9, 8)));
insert into outcome values ('calc-failed', pg_temp.settle(7, pg_temp.o('calc-3'), 'check-failed', pg_temp.f('t1'),
  pg_temp.usage(1700, 700, 'claude-sonnet-5-5')));
insert into outcome values ('calc-failed-saved', pg_temp.explain(7, 9, pg_temp.qn(9, 8)));
insert into outcome values ('calc-off', public.admin_set_campus_bot_course('use-of-english', false, 'Ops',
  'calculation test done'));
insert into outcome values ('s7-pick-3', pg_temp.pick(7, 9, pg_temp.qn(9, 9), true));
insert into outcome values ('plain', pg_temp.explain(7, 9, pg_temp.qn(9, 9)));
insert into outcome values ('plain-check-failed', pg_temp.settle(7, pg_temp.o('plain'), 'check-failed', pg_temp.f('t1')));
insert into outcome values ('s7-pick-4', pg_temp.pick(7, 9, pg_temp.qn(9, 10), true));
insert into outcome values ('elsewhere', pg_temp.explain(7, 9, pg_temp.qn(9, 10)));
insert into outcome values ('elsewhere-topic', pg_temp.settle(7, pg_temp.o('elsewhere'), 'explained', pg_temp.f('bua-1')));
reset role;
select is((pg_temp.o('calc-on') ->> 'explanations_removed')::integer, (select n from unchecked),
  'a course made a calculation course keeps no explanation that was never checked');
select is(pg_temp.o('calc') ->> 'state', 'started', 'so student 1''s explanation is written again, for student 7');
select is(pg_temp.o('calc') -> 'check',
  '{"model":"claude-sonnet-5-5","max_input_tokens":4000,"max_output_tokens":2000}'::jsonb,
  'with the stronger model''s check');
select is((select reserved_tokens from private.campus_bot_replies where id = pg_temp.reply(pg_temp.o('calc'))), 26000::bigint,
  'reserved for both calls at the writer''s weight: (8,000 + 5 x 800 + 4,000 + 5 x 2,000) x 1');
select is(pg_temp.o('calc-unchecked'), '{"state":"finished","outcome":"failed"}'::jsonb,
  'never saved as explained without the check''s own report');
select is(pg_temp.o('calc-checked') - 'topic',
  '{"state":"finished","outcome":"explained","body":"Option B is right because the notes say so."}'::jsonb,
  'saved once it passes the check');
select is((select jsonb_build_array(charged_tokens, check_read_tokens, check_written_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('calc-2'))), '[10500,1700,700]'::jsonb,
  'charged at the writer''s weight: (3,300 + 5 x 400 + 1,700 + 5 x 700) x 1, never the checker''s 20');
select ok((select checked from private.campus_bot_explanations where reply_id = pg_temp.reply(pg_temp.o('calc-2'))),
  'and marked as checked');
select is(pg_temp.o('calc-failed'), jsonb_build_object('state', 'finished', 'outcome', 'check-failed', 'body', null,
    'topic', private.note_topic_view(pg_temp.c('08'), pg_temp.f('t1'))),
  'a failed check saves the notes topic to read, and no explanation');
select is((select jsonb_build_array(state, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('calc-3'))), '["released",0]'::jsonb, 'and charges nothing');
select is(pg_temp.o('calc-failed-saved') ->> 'outcome', 'check-failed', 'every later student is shown the topic too');
select is(pg_temp.o('calc-off') ->> 'state', 'changed', 'the team can take a course off the list');
select is(pg_temp.o('plain-check-failed'), '{"state":"finished","outcome":"failed"}'::jsonb,
  'a course that is not checked cannot report a failed check');
select is(pg_temp.o('elsewhere-topic'), '{"state":"finished","outcome":"failed"}'::jsonb,
  'an explanation naming another course''s notes is never saved');
update public.institutional_courses set is_free = false where repository_course_id = pg_temp.c('08');
set local role service_role;
insert into outcome values ('locked', pg_temp.explain(7, 9, pg_temp.qn(9, 8)));
reset role;
update public.institutional_courses set is_free = true where repository_course_id = pg_temp.c('08');
select is(pg_temp.o('locked'), '{"state":"locked"}'::jsonb,
  'a course the student no longer has: its answers are withheld, and so are their explanations');

-- 11. Corrections and republished notes --------------------------------------------------------------------------------
create temporary table corrected on commit drop as select q.item_id, q.content_revision as old_revision
  from public.quiz_attempt_questions q where q.attempt_id = pg_temp.a(2) and q.question_id = pg_temp.qn(2, 1);
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select r.item_id, r.revision + 1, r.payload || '{"explanation":"Corrected."}'::jsonb, r.authored_by
  from public.managed_content_revisions r join corrected c on c.item_id = r.item_id and r.revision = c.old_revision;
update public.managed_content_items i set current_revision = c.old_revision + 1, published_revision = c.old_revision + 1
  from corrected c where i.id = c.item_id;
set local role service_role;
insert into outcome values ('s2-other-topic', pg_temp.istart(2, 10, 'Speaking Skills I: Sounds of English'));
insert into outcome values ('s2-again', pg_temp.istart(2, 11));
insert into outcome values ('s2-pick', pg_temp.pick(2, 11, pg_temp.qn(11, 1), false));
insert into outcome values ('corrected', pg_temp.explain(2, 11, pg_temp.qn(11, 1)));
insert into outcome values ('old-attempt', pg_temp.explain(2, 2, pg_temp.qn(2, 1)));
reset role;
select is((select content_revision from public.quiz_attempt_questions where attempt_id = pg_temp.a(11)
    and question_id = pg_temp.qn(11, 1)), (select old_revision + 1 from corrected), 'a new attempt shows the corrected question');
select is(pg_temp.o('corrected') ->> 'state', 'started', 'whose explanation is written afresh');
select is(pg_temp.o('old-attempt') ->> 'state', 'saved', 'while an attempt that showed the old question keeps its own');
create temporary table t1_state on commit drop as select i.published_revision as revision,
  (select count(*)::integer from private.note_passages p where p.item_id = i.id) as passages
  from public.managed_content_items i where i.id = pg_temp.f('t1');
select ok((select count(*) from private.campus_bot_explanations where topic_item_id = pg_temp.f('t1')) > 0
  and (select count(*) from private.campus_bot_explanations where course_id = pg_temp.c('08')
    and outcome = 'not-covered') > 0, 'explanations name GST 111''s first topic, and some questions are not covered');
update public.managed_content_items set published_revision = null where id = pg_temp.f('t1');
select is((select count(*)::integer from private.note_passages where item_id = pg_temp.f('t1')), 0,
  'a withdrawn topic has no passages');
select is((select count(*)::integer from private.campus_bot_explanations where topic_item_id = pg_temp.f('t1')), 0,
  'the explanations written from it are removed');
select is((select count(*)::integer from private.campus_bot_explanations where course_id = pg_temp.c('08')
  and outcome = 'not-covered'), 0, 'as are the course''s "not covered" answers, which the change may now answer');
update public.managed_content_items set published_revision = (select revision from t1_state) where id = pg_temp.f('t1');
select is((select count(*)::integer from private.note_passages where item_id = pg_temp.f('t1')),
  (select passages from t1_state), 'republished, it has its passages again');

-- 12. Ask Campus Bot -----------------------------------------------------------------------------------------------------
-- A BUA 201 topic student 4's free pass pinned; BUA 201 is not free, and no student here has it.
insert into private.discovery_previews (grant_id, user_id, kind, course_id, content)
  select g.id, pg_temp.u(4), 'study_guide', pg_temp.f('bua'),
    private.discovery_preview_content(pg_temp.f('bua'), 'study_guide', pg_temp.f('bua-1'))
  from public.entitlement_grants g where g.user_id = pg_temp.u(4) and g.source = 'trial';
set local role service_role;
insert into outcome values ('ask-off', pg_temp.chat(6, 1, pg_temp.f('t1')));
insert into outcome values ('ask-on', public.admin_set_campus_bot_feature('ask', true, 'Ops', 'ask test'));
insert into outcome values ('c1', pg_temp.chat(6, 1, pg_temp.f('t1')));
reset role;
insert into outcome select 'c1-row', jsonb_build_array(feature, request_id, state, reserved_tokens)
  from private.campus_bot_replies where id = pg_temp.reply(pg_temp.o('c1'));
set local role service_role;
insert into outcome values ('c1-busy', pg_temp.chat(6, 1, pg_temp.f('t1')));
insert into outcome values ('c2-busy', pg_temp.chat(6, 2, pg_temp.f('t1')));
insert into outcome values ('c1-answered', pg_temp.answer(6, pg_temp.o('c1')));
insert into outcome values ('c1-again', pg_temp.answer(6, pg_temp.o('c1')));
insert into outcome values ('c1-retry', pg_temp.chat(6, 1, pg_temp.f('t1')));
insert into outcome values ('c3', pg_temp.chat(6, 3, pg_temp.f('t1')));
insert into outcome values ('c3-failed', pg_temp.answer(6, pg_temp.o('c3'), 'failed'));
insert into outcome values ('c3-retry', pg_temp.chat(6, 3, pg_temp.f('t1')));
insert into outcome values ('c3-answered', pg_temp.answer(6, pg_temp.o('c3-retry')));
insert into outcome values ('ask-no-campus-bot', pg_temp.chat(8, 4, pg_temp.f('t1')));
insert into outcome values ('unknown', pg_temp.chat(6, 5, gen_random_uuid()));
insert into outcome values ('question-item', pg_temp.chat(6, 6, pg_temp.f('cbt-item')));
insert into outcome values ('locked-topic', pg_temp.chat(6, 7, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('pinned', pg_temp.chat(4, 8, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('pinned-other', pg_temp.chat(4, 9, pg_temp.f('bua-2'), pg_temp.f('bua')));
reset role;
select is(pg_temp.o('ask-off'), '{"state":"disabled"}'::jsonb, 'Ask Campus Bot does nothing until it is switched on');
select is(pg_temp.o('c1') ->> 'state', 'started', 'a question about a topic the student can read is answered');
select is(jsonb_build_object('model', pg_temp.o('c1') ->> 'model', 'max', (pg_temp.o('c1') ->> 'max_output_tokens')::integer,
    'course', pg_temp.o('c1') -> 'course' ->> 'code', 'topic', pg_temp.o('c1') -> 'topic' ->> 'title'),
  jsonb_build_object('model', 'claude-haiku-5-5', 'max', 800, 'course', 'GST111', 'topic', pg_temp.title(pg_temp.f('t1'))),
  'by Haiku within the chat step''s cap, about this topic');
select is(jsonb_array_length(pg_temp.o('c1') -> 'passages'), (select count(*)::integer from private.note_passages
  where item_id = pg_temp.f('t1')), 'with the whole topic''s notes');
select is(pg_temp.o('c1') -> 'passages' -> 0 ->> 'heading', 'What you must know', 'in reading order');
select ok(not (pg_temp.keys(pg_temp.o('c1')) && array['correct_option', 'correctOption', 'options', 'prompt', 'explanation',
  'item_id', 'question']), 'and nothing of a question bank or an answer key');
select is(pg_temp.o('c1-row'), jsonb_build_array('chat', pg_temp.r(1), 'reserved', 18000),
  'one reservation of the worst case, (14,000 + 5 x 800) x 1');
select is(pg_temp.o('c1-busy'), '{"state":"busy"}'::jsonb, 'the same message again while it is answered: busy');
select is(pg_temp.o('c2-busy'), '{"state":"busy"}'::jsonb, 'one message at a time');
select is(pg_temp.o('c1-answered'), '{"state":"finished","outcome":"answered"}'::jsonb, 'a delivered reply is recorded');
select is(pg_temp.o('c1-again'), '{"state":"already-finished"}'::jsonb, 'once');
select is((select jsonb_build_array(state, charged_tokens, reply) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('c1'))),
  '["consumed",7750,{"text":"Your notes say a good listener prepares.","in_notes":true}]'::jsonb,
  'charged (6,000 + 5 x 350) x 1, and the reply kept');
select ok((select reply_expires_at between clock_timestamp() + interval '9 minutes' and clock_timestamp() + interval '10 minutes'
  from private.campus_bot_replies where id = pg_temp.reply(pg_temp.o('c1'))), 'for ten minutes');
select is(pg_temp.o('c1-retry'),
  '{"state":"answered","reply":{"text":"Your notes say a good listener prepares.","in_notes":true}}'::jsonb,
  'a retry of the same message gets the kept reply');
select is((select count(*)::integer from private.campus_bot_replies where user_id = pg_temp.u(6)
  and request_id = pg_temp.r(1)), 1, 'free: nothing new is reserved');
select is(pg_temp.o('c3-failed'), '{"state":"finished","outcome":"failed"}'::jsonb, 'a reply not delivered');
select is((select jsonb_build_array(state, charged_tokens, reply) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('c3'))), '["released",0,null]'::jsonb, 'is neither charged nor kept');
select is(pg_temp.o('c3-retry') ->> 'state', 'started', 'and the same message can be asked again');
select is(pg_temp.o('ask-no-campus-bot'), '{"state":"not-entitled"}'::jsonb, 'a student without Campus Bot');
select is(pg_temp.o('unknown'), '{"state":"not-found"}'::jsonb, 'an unknown topic');
select is(pg_temp.o('question-item'), '{"state":"not-found"}'::jsonb,
  'a practice question is never a topic: Ask never reads a question bank');
select is(pg_temp.o('locked-topic'), '{"state":"locked"}'::jsonb, 'a topic of a course the student cannot read');
select is(pg_temp.o('pinned') ->> 'state', 'started', 'the topic the free pass pinned');
select is((select jsonb_build_array(funding_source, reserved_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('pinned'))), '["trial",null]'::jsonb, 'counted on the pass');
select is(pg_temp.o('pinned') -> 'topic' ->> 'title', (select e.value -> 'note' ->> 'title' from private.discovery_previews p
    cross join lateral jsonb_array_elements(p.content) e where p.user_id = pg_temp.u(4) and p.kind = 'study_guide'),
  'about that topic as it was pinned');
select is(pg_temp.o('pinned-other'), '{"state":"locked"}'::jsonb, 'and no other topic of that course');
update private.campus_bot_replies set reply_expires_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.reply(pg_temp.o('c1'));
set local role service_role;
insert into outcome values ('c1-expired', pg_temp.chat(6, 1, pg_temp.f('t1')));
reset role;
select is(pg_temp.o('c1-expired'), '{"state":"answered","reply":null}'::jsonb, 'after ten minutes the reply is gone');
select is((select reply from private.campus_bot_replies where id = pg_temp.reply(pg_temp.o('c1'))), null::jsonb,
  'deleted from the database too');
update private.campus_bot_replies set reply_expires_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.reply(pg_temp.o('c3-retry'));
select is(public.purge_campus_bot_chat_replies(), 1, 'the minute job deletes replies whose time is up');
select is((select count(*)::integer from private.campus_bot_replies where reply is not null
  and reply_expires_at <= clock_timestamp()), 0, 'leaving none past their time');
insert into fixture values ('t-other', (select i.id from public.managed_content_items i where i.course_id = pg_temp.c('08')
  and i.kind = 'note' and i.published_revision is not null and i.id <> pg_temp.f('t1') order by i.id limit 1));
set local role service_role;
insert into outcome values ('c1-other-topic', pg_temp.chat(6, 1, pg_temp.f('t-other')));
insert into outcome values ('c13', pg_temp.chat(6, 13, pg_temp.f('t1')));
insert into outcome values ('s6-exam', pg_temp.estart(6, 12));
insert into outcome values ('c1-replay-exam', pg_temp.chat(6, 1, pg_temp.f('t1')));
insert into outcome values ('c13-late', pg_temp.answer(6, pg_temp.o('c13')));
insert into outcome values ('exam-open-ask', pg_temp.chat(6, 10, pg_temp.f('t1')));
insert into outcome values ('pinned-answered', pg_temp.answer(4, pg_temp.o('pinned')));
insert into outcome values ('pass-messages-1', public.admin_set_campus_bot_reply_limits(null, 1, null, null, null, 'Ops',
  'pass test'));
insert into outcome values ('pass-chat-limit', pg_temp.chat(4, 11, pg_temp.f('t1')));
insert into outcome values ('pass-messages-10', public.admin_set_campus_bot_reply_limits(null, 10, null, null, null, 'Ops',
  'restore'));
reset role;
select is(pg_temp.o('exam-open-ask'), '{"state":"exam-open"}'::jsonb, 'nothing is asked in a course while an exam runs there');
select is(pg_temp.o('c1-other-topic'), '{"state":"not-found"}'::jsonb,
  'a stored message is answered only for the course and topic it was asked about');
select is(pg_temp.o('c1-replay-exam'), '{"state":"exam-open"}'::jsonb,
  'a retry after an exam opened gets what a new message would, not the stored reply');
select is(pg_temp.o('c13') ->> 'state', 'started', 'a message admitted before the exam opened');
select is(pg_temp.o('c13-late'), '{"state":"finished","outcome":"failed"}'::jsonb,
  'whose reply arrives once the exam is open is not delivered');
select is((select jsonb_build_array(state, charged_tokens, reply) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('c13'))), '["released",0,null]'::jsonb, 'nor kept, nor charged');
select is((pg_temp.o('c1') ->> 'max_input_tokens')::integer, 14000,
  'the server is told the input cap too, and bounds the whole prompt by it');
select is((select jsonb_build_array(state, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('pinned'))), '["consumed",null]'::jsonb, 'a reply on the pass is counted, not metered');
select is(pg_temp.o('pass-chat-limit'), '{"state":"pass-limit"}'::jsonb, 'past the pass''s messages, Campus Bot stops');
select is((pg_temp.as_student(6, 'public.get_my_campus_bot_usage()') -> 'session' ->> 'used')::integer, 15500,
  'replies count in the student''s Campus Bot usage, as sets do');
select is(pg_temp.as_student(6, 'public.get_campus_bot_features()'),
  '{"explain":true,"ask":true,"topic_sets":false}'::jsonb, 'a signed-in page reads the switches');

-- 13. Operator settings -----------------------------------------------------------------------------------------------
-- The steps above left no saved explanation in the course; one as Explain leaves it, for the review and the clear-out.
insert into private.campus_bot_explanations (item_id, revision, chosen_option, course_id, state, outcome, body,
    topic_item_id, started_at, finished_at)
  select i.id, i.published_revision, 0, i.course_id, 'done', 'explained', 'Option A is right because the notes say so.',
    pg_temp.f('t1'), now(), now()
  from public.managed_content_items i where i.course_id = pg_temp.c('08') and i.kind = 'cbt_question'
    and i.published_revision is not null
  order by i.id limit 1;
set local role service_role;
insert into outcome values ('topic-sets-on', public.admin_set_campus_bot_feature('topic-sets', true, 'Ops', 'their feature'));
insert into outcome values ('topic-sets-same', public.admin_set_campus_bot_feature('topic-sets', true, 'Ops', 'again'));
insert into outcome values ('topic-sets-off', public.admin_set_campus_bot_feature('topic-sets', false, 'Ops', 'not yet'));
insert into outcome values ('checker-haiku', public.admin_set_campus_bot_checker('haiku', 'Ops', 'checker test'));
insert into outcome values ('checker-back', public.admin_set_campus_bot_checker('sonnet', 'Ops', 'restore'));
insert into outcome values ('course-unknown', public.admin_set_campus_bot_course('no-such-course', true, 'Ops', 'typo'));
insert into outcome values ('status', public.admin_campus_bot_status());
insert into outcome values ('review', public.admin_campus_bot_explanations('use-of-english', 5));
insert into outcome values ('sample', public.admin_campus_bot_review_sample('principles-economics-1', 4, 2));
reset role;
create temporary table saved_before on commit drop as select count(*)::integer as n from private.campus_bot_explanations
  where course_id = pg_temp.c('08') and state = 'done';
set local role service_role;
insert into outcome values ('cleared', public.admin_clear_campus_bot_explanations('use-of-english', 'Ops',
  'review found one wrong'));
reset role;
select is(pg_temp.o('topic-sets-on'), '{"state":"changed","feature":"topic-sets","enabled":true}'::jsonb,
  'the topic sets switch is the team''s too');
select is(pg_temp.o('topic-sets-same') ->> 'state', 'unchanged', 'setting it again changes nothing');
select is(pg_temp.o('topic-sets-off') ->> 'state', 'changed', 'and it goes off again');
select throws_ok($$select public.admin_set_campus_bot_feature('sets', true, 'Ops', 'typo')$$, '22023', null,
  'only the three features have switches');
select throws_ok($$select public.admin_set_campus_bot_feature('ask', false, 'Ops', '')$$, '22023', null,
  'every change needs a reason');
select throws_ok($$select public.admin_set_campus_bot_reply_limits(null, null, null, null, null, 'Ops', 'nothing')$$, '22023',
  null, 'a limits change names at least one');
select throws_ok($$select public.admin_set_campus_bot_checker('gpt', 'Ops', 'typo')$$, '22023', null,
  'only a known model checks');
select is(pg_temp.o('checker-haiku') ->> 'state', 'changed', 'the checking model is the team''s setting');
select is(pg_temp.o('course-unknown'), '{"state":"not-found"}'::jsonb, 'an unknown course is not found');
select ok(pg_temp.o('status') ?& array['settings', 'caps', 'models', 'calculation_courses', 'today', 'saved_explanations'],
  'the status shows the settings, the caps, the list, today''s requests and what is saved');
select ok((pg_temp.o('status') -> 'today' ->> 'explain')::integer > 0 and (pg_temp.o('status') -> 'today' ->> 'chat')::integer > 0,
  'today''s requests per feature');
select ok(jsonb_array_length(pg_temp.o('review')) between 1 and 5
  and pg_temp.o('review') -> 0 ?& array['prompt', 'options', 'correct_option', 'outcome', 'body', 'topic'],
  'saved explanations come with their questions, for the human review');
select is(jsonb_build_object('calculation', pg_temp.o('sample') -> 'course' -> 'calculation',
    'questions', jsonb_array_length(pg_temp.o('sample') -> 'questions'), 'topics', jsonb_array_length(pg_temp.o('sample') -> 'topics')),
  '{"calculation":true,"questions":4,"topics":2}'::jsonb, 'the review sample: a calculation course''s questions and topics');
select ok((select bool_and((q ->> 'chosen_option')::integer <> (q ->> 'correct_option')::integer
    and jsonb_array_length(q -> 'passages') between 0 and 3) from jsonb_array_elements(pg_temp.o('sample') -> 'questions') q),
  'each with a wrong choice and the passages Explain would get');
select is(pg_temp.o('sample') -> 'questions', public.admin_campus_bot_review_sample('principles-economics-1', 4, 2) -> 'questions',
  'and always the same questions');
select is(jsonb_build_array((select n from saved_before) > 0, (pg_temp.o('cleared') ->> 'removed')::integer),
  jsonb_build_array(true, (select n from saved_before)),
  'a course''s saved explanations can be cleared, to be written again when next asked for');
select is((select count(*)::integer from private.campus_bot_explanations where course_id = pg_temp.c('08')
    and state = 'done'), 0, 'none is left');
select ok((select count(*) from private.entitlement_events where event like 'campus-bot.%' and actor = 'operator:Ops') >= 10,
  'every operator change is audited with its actor');

-- 14. Plan use for refunds ----------------------------------------------------------------------------------------------
-- Owner decision of 17 Nov 2026: a delivered Explain or notes-chat reply on a paid course is plan use of its own kind,
-- 'campus-bot-message', dated when it was asked for, once per reply: a chat message by its request id, an explanation by
-- the explanation shown, so neither a retry nor a reread counts again. Student 9 buys Standard for BUA 200 (the running
-- First Semester began 100 days ago).
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 100;
select pg_temp.student(9);
update public.profiles set first_name = 'Ada', department_id = '10000000-0000-4000-8000-000000000002',
  academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
  where id = pg_temp.u(9);
select public.admin_set_sales_open(true, 'Ops', 'plan use test');
create temporary table o9 on commit drop as select (public.create_payment_order(pg_temp.s(9), 'standard_semester',
    (select revision from public.profiles where id = pg_temp.u(9)), gen_random_uuid(), '/access', 'fake')
  -> 'order' ->> 'id')::uuid as id;
select public.attach_payment_checkout(id, 'fake', 'chk_' || replace(id::text, '-', ''),
  'https://checkout.example.test/c/' || id, clock_timestamp() + interval '1 hour') from o9;
select public.fulfil_payment(id, 'fake', 'ch_' || replace(id::text, '-', ''), 'succeeded', 400000, 'NGN', 'card',
  clock_timestamp(), 'webhook', 'test') from o9;
select public.admin_set_campus_bot_feature(f, true, 'Ops', 'plan use test') from unnest(array['explain', 'ask']) f;
set local role service_role;
insert into outcome values ('paid-chat', pg_temp.chat(9, 20, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('paid-chat-answered', pg_temp.answer(9, pg_temp.o('paid-chat')));
insert into outcome values ('paid-chat-retry', pg_temp.chat(9, 20, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('paid-start', pg_temp.istart(9, 20, 'Introduction to Business and Management', '02'));
insert into outcome values ('paid-pick', pg_temp.pick(9, 20, pg_temp.qn(20, 1), false));
insert into outcome values ('paid-explain', pg_temp.explain(9, 20, pg_temp.qn(20, 1)));
insert into outcome values ('paid-explained', pg_temp.settle(9, pg_temp.o('paid-explain'), 'explained', pg_temp.f('bua-1')));
insert into outcome values ('paid-reread', pg_temp.explain(9, 20, pg_temp.qn(20, 1)));
reset role;
select is(jsonb_build_array(pg_temp.o('paid-chat') ->> 'state', pg_temp.o('paid-chat-answered') ->> 'state',
    pg_temp.o('paid-chat-retry') ->> 'state', pg_temp.o('paid-explain') ->> 'state',
    pg_temp.o('paid-explained') ->> 'outcome', pg_temp.o('paid-reread') ->> 'state'),
  '["started","finished","answered","started","explained","saved"]'::jsonb,
  'a paid student asks about a topic of a paid course, has a question explained and reads it again');
select is((select jsonb_agg(jsonb_build_array(kind, ref, course_id) order by ref) from private.plan_use_events
    where user_id = pg_temp.u(9)),
  jsonb_build_array(
    jsonb_build_array('campus-bot-message', 'chat:' || pg_temp.r(20), pg_temp.f('bua')),
    jsonb_build_array('campus-bot-message', (select private.campus_bot_explanation_ref(q.item_id, q.content_revision,
        pg_temp.opt(20, q.question_id, false)) from public.quiz_attempt_questions q
      where q.attempt_id = pg_temp.a(20) and q.question_id = pg_temp.qn(20, 1)), pg_temp.f('bua'))),
  'each delivered reply is one Campus Bot message, the chat by its request id and the explanation by itself; '
    || 'neither the retry nor the reread counts again');
select is((select bool_and(u.occurred_at = r.reserved_at) from private.plan_use_events u
    join private.campus_bot_replies r on r.user_id = u.user_id and r.state = 'consumed'
      and r.feature = case when u.ref like 'chat:%' then 'chat' else 'explain' end
    where u.user_id = pg_temp.u(9)), true, 'each dated when it was asked for');
select is((select jsonb_build_array(e -> 'standard_allowed', e -> 'counts' -> 'campus_bot_messages',
    e -> 'counts' -> 'campus_bot_sets') from (select public.refund_eligibility((select id from o9), null,
    clock_timestamp()) e) x), '[true, 2, 0]'::jsonb,
  'the refund check counts them as replies, not sets, and two leave the standard refund open');

-- Codex B review of #168: delivery rechecks access, and no settlement charges past its reservation.
set local role service_role;
insert into outcome values ('paid-pick-2', pg_temp.pick(9, 20, pg_temp.qn(20, 2), false));
insert into outcome values ('paid-late', pg_temp.explain(9, 20, pg_temp.qn(20, 2)));
reset role;
-- A practice exam opens in the course while the explanation is being written (the topic practice handed in first:
-- one open practice per course).
update public.quiz_attempts set status = 'submitted', finished_at = clock_timestamp(), score = 0
  where id = pg_temp.a(20);
insert into public.quiz_attempts (id, user_id, course_id, question_count, status, mode, deadline_at, duration_seconds,
    intent, bank_size)
  values (pg_temp.a(21), pg_temp.u(9), pg_temp.f('bua'), 5, 'in_progress', 'exam', clock_timestamp() + interval '30 minutes',
    1800, 'new', 5);
set local role service_role;
insert into outcome values ('paid-late-settled', pg_temp.settle(9, pg_temp.o('paid-late'), 'explained', pg_temp.f('bua-1')));
reset role;
delete from public.quiz_attempts where id = pg_temp.a(21);
set local role service_role;
insert into outcome values ('paid-chat-2', pg_temp.chat(9, 21, pg_temp.f('bua-1'), pg_temp.f('bua')));
insert into outcome values ('paid-chat-2-answered', public.finish_campus_bot_chat(pg_temp.u(9),
  pg_temp.reply(pg_temp.o('paid-chat-2')), 'answered', '{"text":"Your notes say so.","in_notes":true}'::jsonb,
  pg_temp.usage(100000, 5000)));
reset role;
select is((pg_temp.o('paid-late') ->> 'max_input_tokens')::integer, 8000, 'an explanation is admitted with its input cap');
select is(pg_temp.o('paid-late-settled'), '{"state":"finished","outcome":"failed"}'::jsonb,
  'an explanation finished after an exam opened in the course is not delivered');
select is((select jsonb_build_array(state, charged_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('paid-late'))), '["released",0]'::jsonb, 'and nothing is charged');
select is((select count(*)::integer from private.campus_bot_explanations e join public.quiz_attempt_questions q
    on q.item_id = e.item_id and q.content_revision = e.revision
    where q.attempt_id = pg_temp.a(20) and q.question_id = pg_temp.qn(20, 2)), 0, 'nor saved for anyone');
select is((select jsonb_build_array(reserved_tokens, charged_tokens, read_tokens) from private.campus_bot_replies
    where id = pg_temp.reply(pg_temp.o('paid-chat-2'))), '[18000,18000,100000]'::jsonb,
  'a provider report past the caps is recorded, but never charged past what was reserved');

select * from finish();
rollback;
