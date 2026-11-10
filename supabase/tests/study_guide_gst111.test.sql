-- supabase/tests/study_guide_gst111.test.sql — The GST 111 study guide import (20261111100000): 15 guide topics, 15
-- theory questions with their answers and the overview's two new lists, published through the managed-content history.
-- A rerun changes nothing; an edited note, overview or theory item is refused with nothing changed; rollback brings back
-- the course exactly as it was, and the guide applies again.
begin;
select no_plan();

create function pg_temp.course() returns uuid language sql stable as $$ select id from public.courses where content_key = 'use-of-english' $$;
create function pg_temp.item(p_key text) returns uuid language sql stable as $$
  select id from public.managed_content_items where course_id = pg_temp.course() and source_key = p_key $$;
-- Everything the import could touch on this course: each study item's pointers, lock and position, and the history.
create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'items', (select jsonb_agg(jsonb_build_array(id, kind, current_revision, approved_revision, published_revision,
      published_parent_revision, lock_version, position) order by id) from public.managed_content_items
      where course_id = pg_temp.course() and kind in ('course_overview', 'note', 'theory_question', 'model_answer', 'rubric')),
    'revisions', (select count(*) from public.managed_content_revisions),
    'reviews', (select count(*) from public.managed_content_reviews),
    'publications', (select count(*) from public.managed_content_publications)) $$;
create function pg_temp.published(p_kind text) returns integer language sql stable as $$
  select count(*)::integer from public.managed_content_items
  where course_id = pg_temp.course() and kind = p_kind and published_revision is not null $$;

-- ---------------------------------------------------------------------------------------------------------------
-- After the migration.
-- ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.published('note'), 15, '15 guide topics are published');
select is(pg_temp.published('theory_question'), 15, 'with 15 theory questions');
select is(pg_temp.published('model_answer'), 15, 'and their 15 answers');
select is((select array_agg(position order by position) from public.managed_content_items
    where course_id = pg_temp.course() and kind = 'note'), array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15], 'topics in order');
select is((select r.payload->>'title' from public.managed_content_items i join public.managed_content_revisions r
    on r.item_id = i.id and r.revision = i.published_revision where i.id = pg_temp.item('guide-topic:1')), 'Listening Skills', 'topic 1');
select is((select count(*)::integer from public.managed_content_items i join public.managed_content_revisions r
    on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = pg_temp.course() and i.kind = 'note' and r.payload->>'noteType' = 'guide_topic'
      and r.payload->'theory'->>'itemId' = (select id::text from public.managed_content_items q
        where q.id = pg_temp.item('guide-theory:' || (r.payload->>'number'))) and r.payload->'practice'->0->>'named' = 'false'),
  15, 'each topic links its own theory question and one practice topic');
select is((select count(*)::integer from public.managed_content_items a join public.managed_content_items q on q.id = a.parent_item_id
    where a.course_id = pg_temp.course() and a.kind = 'model_answer' and a.published_parent_revision = q.published_revision
      and a.source_key = replace(q.source_key, 'guide-theory', 'guide-answer')), 15, 'each answer is bound to its question');
select is((select array_agg(distinct created_by) from public.managed_content_items
    where course_id = pg_temp.course() and kind in ('note', 'theory_question', 'model_answer')),
  array['00000000-0000-4000-8000-000000000045'::uuid], 'every guide item carries the guide import provenance');
select is((select jsonb_build_array(published_revision, current_revision, approved_revision) from public.managed_content_items
    where id = pg_temp.item('course-overview')), '[3,3,3]'::jsonb, 'the overview publishes revision three');
select is((select r.payload->'assessment' from public.managed_content_items i join public.managed_content_revisions r
    on r.item_id = i.id and r.revision = i.published_revision where i.id = pg_temp.item('course-overview')),
  '["The exam is objective (CBT). Questions test definitions, lists and counts, examples, symbols and the exact wording used in this course.", "Every topic is examinable."]'::jsonb,
  'how you are assessed, with the guide no longer mentioned');
select is((select jsonb_array_length(r.payload->'outcomes') from public.managed_content_items i join public.managed_content_revisions r
    on r.item_id = i.id and r.revision = i.published_revision where i.id = pg_temp.item('course-overview')), 12, 'twelve outcomes');
select is((select (r3.payload - 'outcomes' - 'assessment') = r2.payload from public.managed_content_revisions r3
    join public.managed_content_revisions r2 on r2.item_id = r3.item_id and r2.revision = 2
    where r3.item_id = pg_temp.item('course-overview') and r3.revision = 3), true, 'the rest of the overview is unchanged');
select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id
    where i.course_id = pg_temp.course() and p.acted_by = '00000000-0000-4000-8000-000000000045' and p.action = 'publish'), 46,
  'every publication is in the history: 45 items and the overview');

-- ---------------------------------------------------------------------------------------------------------------
-- A rerun changes nothing; edits after the import are refused by rollback.
-- ---------------------------------------------------------------------------------------------------------------
create temporary table applied on commit drop as select pg_temp.state() state;
select is(private.study_guide('study_guide_gst111', 'apply'), 'unchanged', 'a rerun is unchanged');
select is(pg_temp.state(), (select state from applied), 'and changes nothing');

savepoint edited_note;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select id, 2, '{"title":"Operator draft","body":"Draft"}'::jsonb, '11111111-1111-4111-8111-111111111111'
  from public.managed_content_items where id = pg_temp.item('guide-topic:3');
update public.managed_content_items set current_revision = 2, lock_version = lock_version + 1 where id = pg_temp.item('guide-topic:3');
create temporary table edited_note on commit drop as select pg_temp.state() state;
select throws_ok($$select private.study_guide('study_guide_gst111', 'rollback')$$, 'P0001',
  'Study guide GST111: the published notes, theory or overview are not the ones this import published', 'an edited note is refused');
select is(pg_temp.state(), (select state from edited_note), 'and nothing changed');
rollback to savepoint edited_note;

savepoint edited_theory;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  values (pg_temp.item('guide-theory:7'), 2, '{"prompt":"An operator question"}', '11111111-1111-4111-8111-111111111111');
update public.managed_content_items set current_revision = 2, approved_revision = 2, published_revision = 2,
  lock_version = lock_version + 3 where id = pg_temp.item('guide-theory:7');
create temporary table edited_theory on commit drop as select pg_temp.state() state;
select throws_ok($$select private.study_guide('study_guide_gst111', 'apply')$$, 'P0001',
  'Study guide GST111: the published notes, theory or overview are not the ones this import replaces',
  'an edited theory question is refused by a rerun');
select is(pg_temp.state(), (select state from edited_theory), 'and nothing changed');
rollback to savepoint edited_theory;

-- ---------------------------------------------------------------------------------------------------------------
-- Rollback brings back the course as it was before the import.
-- ---------------------------------------------------------------------------------------------------------------
select is(private.study_guide('study_guide_gst111', 'rollback'), 'rolled-back', 'rollback runs');
select is(pg_temp.published('note') + pg_temp.published('theory_question') + pg_temp.published('model_answer'), 0,
  'no note, theory question or answer is published, as before the import');
select is((select count(*)::integer from public.managed_content_items where course_id = pg_temp.course()
    and kind in ('note', 'theory_question', 'model_answer')), 45, 'nothing was deleted');
select is((select jsonb_build_array(i.published_revision, r.authored_by) from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.id = pg_temp.item('course-overview')), '[2, "00000000-0000-4000-8000-000000000044"]'::jsonb,
  'the overview publishes its revision two again');
select is(private.study_guide('study_guide_gst111', 'rollback'), 'unchanged', 'a second rollback is unchanged');

-- From here, an edited overview or a note added by an operator is refused by apply, with nothing changed.
create temporary table rolled_back on commit drop as select pg_temp.state() state;
savepoint edited_overview;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select pg_temp.item('course-overview'), 4, '{"title":"Communication in English","body":"Edited"}'::jsonb,
    '11111111-1111-4111-8111-111111111111';
update public.managed_content_items set current_revision = 4, approved_revision = 4, published_revision = 4,
  lock_version = lock_version + 3 where id = pg_temp.item('course-overview');
create temporary table edited_overview on commit drop as select pg_temp.state() state;
select throws_ok($$select private.study_guide('study_guide_gst111', 'apply')$$, 'P0001',
  'Study guide GST111: the published notes, theory or overview are not the ones this import replaces', 'an edited overview is refused');
select is(pg_temp.state(), (select state from edited_overview), 'and nothing changed');
rollback to savepoint edited_overview;

savepoint added_note;
insert into public.managed_content_items (id, course_id, kind, source_key, current_revision, approved_revision,
    published_revision, lock_version, created_by)
  values ('90000000-0000-4000-8000-000000000045', pg_temp.course(), 'note', 'operator-note', 1, 1, 1, 3,
    '11111111-1111-4111-8111-111111111111');
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  values ('90000000-0000-4000-8000-000000000045', 1, '{"title":"Operator","body":"Note"}', '11111111-1111-4111-8111-111111111111');
select throws_ok($$select private.study_guide('study_guide_gst111', 'apply')$$, 'P0001',
  'Study guide GST111: the published notes, theory or overview are not the ones this import replaces',
  'a note published by someone else is refused');
rollback to savepoint added_note;
select is(pg_temp.state(), (select state from rolled_back), 'back to the rolled-back state');

-- ---------------------------------------------------------------------------------------------------------------
-- The guide applies again, reusing what it wrote.
-- ---------------------------------------------------------------------------------------------------------------
select is(private.study_guide('study_guide_gst111', 'apply'), 'applied', 'apply after rollback');
select is(pg_temp.published('note') + pg_temp.published('theory_question') + pg_temp.published('model_answer'), 45, 'all published');
select is((select published_revision from public.managed_content_items where id = pg_temp.item('course-overview')), 3,
  'the overview publishes revision three again');
select is((select count(*)::integer from public.managed_content_revisions where authored_by = '00000000-0000-4000-8000-000000000045'),
  46, 'no revision was written twice');

-- ---------------------------------------------------------------------------------------------------------------
-- With the overview correction (20261110090000): both roll back in reverse order and apply again.
-- ---------------------------------------------------------------------------------------------------------------
select is(private.study_guide('study_guide_gst111', 'rollback'), 'rolled-back', 'the guide rolls back first');
select is(private.course_overview_revisions('rollback'), 'rolled-back', 'then the overview correction');
select is((select jsonb_build_array(i.published_revision, r.authored_by) from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.id = pg_temp.item('course-overview')), '[1, "00000000-0000-4000-8000-000000000042"]'::jsonb,
  'the overview publishes its seeded revision one');
select is(private.course_overview_revisions('apply'), 'applied', 'the correction applies again');
select is(private.study_guide('study_guide_gst111', 'apply'), 'applied', 'and then the guide');
select is((select jsonb_build_array(published_revision, current_revision, approved_revision) from public.managed_content_items
    where id = pg_temp.item('course-overview')), '[3,3,3]'::jsonb, 'the overview publishes revision three again');
select is((select count(*)::integer from public.managed_content_revisions where item_id = pg_temp.item('course-overview')), 3,
  'with no revision written twice');

select ok(not has_function_privilege(r, 'private.study_guide(text, text)', 'execute'), format('%s cannot run the import', r))
  from unnest(array['anon', 'authenticated', 'service_role']) r;

select * from finish();
rollback;
