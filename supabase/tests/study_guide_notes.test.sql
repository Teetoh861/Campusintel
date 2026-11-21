-- supabase/tests/study_guide_notes.test.sql — The study guide notes system (20261112110000): the guide topic payload
-- and the two overview lists are checked, notes follow their position, guide sources are refused when a chunk is
-- missing or changed, and only migrations can reach any of it.
begin;
select no_plan();

create temporary table guide (payload jsonb) on commit drop;
insert into guide values ('{"title":"Listening Skills","body":"What to know","noteType":"guide_topic","number":1,
  "mustKnow":[{"text":"what listening is"},{"text":" and why","bold":true}],
  "introMore":[{"type":"preformatted","text":"2 | 4 7"}],
  "lessons":[{"number":"1.1","title":"Listening","mustKnow":[{"type":"paragraph","text":[{"text":"Listen","bold":true,"italic":true}]},
    {"type":"list","ordered":true,"start":4,"items":[{"text":[{"text":"Item"}],"blocks":[{"type":"list","ordered":false,"items":[{"text":[{"text":"Nested"}]}]}]}]}],
    "explainMore":[{"type":"table","header":[[],[{"text":"Cost"}]],"rows":[[[{"text":"A"}],[{"text":"400"}]]]}]}],
  "recap":[{"type":"list","ordered":false,"items":[{"text":[{"text":"Recap"}]}]}],
  "theory":{"itemId":"11111111-1111-4111-8111-111111111111","question":[{"type":"paragraph","text":[{"text":"Why?"}]}]},
  "practice":[{"topic":"Listening Skills and Note-taking","named":false}]}');

select lives_ok($$select private.assert_managed_payload('note', (select payload from guide))$$, 'a guide topic is accepted');
create function pg_temp.refused(p_payload jsonb) returns boolean language plpgsql as $$
begin
  perform private.assert_managed_payload('note', p_payload);
  return false;
exception when sqlstate '22023' then return true;
end $$;
select ok(pg_temp.refused(payload || jsonb_build_object(key, value)), label)
  from guide, (values
    ('recap', '[{"type":"html","text":"<b>x</b>"}]'::jsonb, 'an unknown block type is refused'),
    ('recap', '[{"type":"paragraph","text":[{"text":"x","html":"<b>x</b>"}]}]', 'a stray key on a span is refused'),
    ('recap', '[{"type":"paragraph","text":[{"text":"x","bold":false}]}]', 'a false flag is refused'),
    ('recap', '[{"type":"paragraph","text":[{"text":""}]}]', 'empty text is refused'),
    ('recap', '[{"type":"list","ordered":true,"items":[{"text":[{"text":"x"}]}]}]', 'a numbered list needs its start'),
    ('recap', '[{"type":"list","ordered":false,"start":1,"items":[{"text":[{"text":"x"}]}]}]', 'a bulleted list has no start'),
    ('recap', '[{"type":"table","header":[[{"text":"a"}],[{"text":"b"}]],"rows":[[[{"text":"x"}]]]}]', 'a short table row is refused'),
    ('recap', '[]', 'an empty recap is refused'),
    ('lessons', '[]', 'a topic needs a lesson'),
    ('lessons', '[{"number":"1","title":"L","mustKnow":[{"type":"paragraph","text":[{"text":"x"}]}]}]', 'a lesson number is N.M'),
    ('theory', '{"itemId":"not-a-uuid","question":[{"type":"paragraph","text":[{"text":"x"}]}]}', 'a theory link is an item id'),
    ('practice', '[{"topic":"A","named":"yes"}]', 'a practice button is named or not'),
    ('number', '0', 'a topic number starts at 1'),
    ('script', '"<script>"', 'an unknown key is refused')
  ) as broken(key, value, label);
select ok(pg_temp.refused((select payload from guide) - 'lessons'), 'lessons are required');
select ok(pg_temp.refused(jsonb_build_object('title', 'T', 'body', 'B', 'noteType', 'topic_note', 'keyPoints',
  jsonb_build_array('a'), 'lessons', '[]'::jsonb)), 'the older note types refuse guide fields');
-- A guide topic refuses the older note types' fields, each of them, exactly as the site's check does
-- (lib/operator/editor-contract.ts: the guide topic shape is strict).
select ok(pg_temp.refused(payload || jsonb_build_object(key, value)), label)
  from guide, (values
    ('keyPoints', '["A key point"]'::jsonb, 'a guide topic with key points is refused'),
    ('examTip', '"An exam tip"', 'a guide topic with an exam tip is refused'),
    ('example', '"An example"', 'a guide topic with a calculator example is refused'),
    ('formula', '"a + b"', 'a guide topic with a formula is refused')
  ) as foreign_field(key, value, label);
select lives_ok($$select private.assert_managed_payload('note', '{"title":"T","body":"B","noteType":"topic_note","keyPoints":["a"]}')$$,
  'a topic note is still accepted');
-- Nesting stops at depth 6.
select ok(pg_temp.refused((select payload from guide) || jsonb_build_object('recap', (
  with recursive deep(n, block) as (
    select 1, '{"type":"list","ordered":false,"items":[{"text":[{"text":"x"}]}]}'::jsonb
    union all select n + 1, jsonb_build_object('type', 'list', 'ordered', false, 'items',
      jsonb_build_array(jsonb_build_object('text', '[{"text":"x"}]'::jsonb, 'blocks', jsonb_build_array(block)))) from deep where n < 9)
  select jsonb_build_array(block) from deep where n = 9))), 'nesting deeper than six is refused');

select lives_ok($$select private.assert_managed_payload('course_overview',
  '{"title":"T","body":"B","outcomes":["Listen"],"assessment":["Every topic is examinable."]}')$$, 'an overview takes outcomes and assessment');
select throws_ok($$select private.assert_managed_payload('course_overview', '{"title":"T","body":"B","outcomes":[1]}')$$,
  '22023', null, 'outcomes are text');
select throws_ok($$select private.assert_managed_payload('course_overview', '{"title":"T","body":"B","assessment":[""]}')$$,
  '22023', null, 'assessment lines are not empty');

-- ---------------------------------------------------------------------------------------------------------------
-- Notes follow their position; those without one follow, oldest first.
-- ---------------------------------------------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated',
  'guide-order-operator@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at)
  values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-4444-4444-8444-444444444444', now(), now());
update public.profiles set role = 'operator' where id = '44444444-4444-4444-8444-444444444444';
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  values ('44444444-4444-4444-8444-444444444444', 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test');

-- business-statistics: eleven seeded topic notes. Number them in reverse, leave one without a position.
update public.managed_content_items set position = 12 - substring(source_key from 'topic-note:(\d+)')::integer
  where course_id = (select id from public.courses where content_key = 'business-statistics') and kind = 'note';
update public.managed_content_items set position = null
  where course_id = (select id from public.courses where content_key = 'business-statistics') and source_key = 'topic-note:1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","session_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}';
select is((select array_agg(source_key) from public.read_published_managed_content(
    (select id from public.courses where content_key = 'business-statistics')) where kind = 'note'),
  array['topic-note:11','topic-note:10','topic-note:9','topic-note:8','topic-note:7','topic-note:6','topic-note:5',
    'topic-note:4','topic-note:3','topic-note:2','topic-note:1'], 'the published read follows position, then the rest');
reset role;
select is((select array_agg(value->>'title') from jsonb_array_elements(private.discovery_topic_titles(
    (select id from public.courses where content_key = 'business-statistics')))),
  (select array_agg(r.payload->>'title' order by i.position nulls last, i.created_at, i.id) from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = (select id from public.courses where content_key = 'business-statistics') and i.kind = 'note'),
  'free-pass topic titles follow the same order');
select throws_ok($$update public.managed_content_items set position = 0 where kind = 'note'
  and course_id = (select id from public.courses where content_key = 'business-statistics')$$, '23514', null,
  'a position starts at 1');

-- ---------------------------------------------------------------------------------------------------------------
-- A guide source is read whole or not at all.
-- ---------------------------------------------------------------------------------------------------------------
create function pg_temp.load(p_text text, p_chunks text[], p_digest text default null) returns void language plpgsql as $$
begin
  delete from private.study_guide_chunks where guide = 'study_guide_test';
  delete from private.study_guides where guide = 'study_guide_test';
  insert into private.study_guides values ('study_guide_test', array_length(p_chunks, 1),
    coalesce(p_digest, encode(sha256(convert_to(p_text, 'UTF8')), 'hex')));
  insert into private.study_guide_chunks select 'study_guide_test', n, chunk from unnest(p_chunks) with ordinality u(chunk, n);
end $$;
select pg_temp.load('{"guide":"study_guide_test","x":1}', array['{"guide":"study_guide_', 'test","x":1}']);
select is(private.study_guide_source('study_guide_test'), '{"guide":"study_guide_test","x":1}'::jsonb, 'chunks join in order');
delete from private.study_guide_chunks where guide = 'study_guide_test' and ordinal = 2;
select throws_ok($$select private.study_guide_source('study_guide_test')$$, 'P0001',
  'Study guide study_guide_test: its source rows are missing or changed', 'a missing chunk is refused');
select pg_temp.load('{"guide":"study_guide_test","x":1}', array['{"guide":"study_guide_', 'test","x":2}'],
  encode(sha256(convert_to('{"guide":"study_guide_test","x":1}', 'UTF8')), 'hex'));
select throws_ok($$select private.study_guide_source('study_guide_test')$$, 'P0001',
  'Study guide study_guide_test: its source rows are missing or changed', 'a changed chunk is refused');
select throws_ok($$select private.study_guide_source('study_guide_none')$$, 'P0001',
  'Study guide study_guide_none: its source rows are missing or changed', 'an unknown guide is refused');

-- ---------------------------------------------------------------------------------------------------------------
-- Only migrations reach the sources and the import.
-- ---------------------------------------------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'private.study_guide_chunks'::regclass), 'row level security is on');
select ok(not has_table_privilege(r, t, 'select, insert, update, delete'), format('%s has no access to %s', r, t))
  from unnest(array['anon', 'authenticated', 'service_role']) r,
       unnest(array['private.study_guides', 'private.study_guide_chunks']) t;
select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot call %s', r, f))
  from unnest(array['anon', 'authenticated', 'service_role']) r,
       unnest(array['private.study_guide(text, text)', 'private.study_guide_source(text)',
         'private.study_guide_state(jsonb)', 'private.valid_guide_topic(jsonb)']) f;

select * from finish();
rollback;
