-- supabase/tests/study_guide_import_rules.test.sql — The three rules 20261113090000_study_guide_imports.sql adds to
-- private.study_guide, on courses made for this test: an overview the import creates, study items it keeps published,
-- and a course it creates and links. Each is refused, with nothing changed, when the course is not as the import was
-- written; study_guide_imports.test.sql checks the same rules on the real guides.
begin;
select no_plan();

-- A guide document, stored as one chunk the way a migration stores it.
create function pg_temp.store(p_doc jsonb) returns text language plpgsql as $$
declare
  v_text text := p_doc::text;
begin
  delete from private.study_guide_chunks where guide = p_doc->>'guide';
  delete from private.study_guides where guide = p_doc->>'guide';
  insert into private.study_guides values (p_doc->>'guide', 1, encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
  insert into private.study_guide_chunks values (p_doc->>'guide', 1, v_text);
  return p_doc->>'guide';
end $$;
-- One guide topic with its theory question and answer, numbered from p_base.
create function pg_temp.topic(p_base text) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'notes', jsonb_build_array(jsonb_build_object('kind', 'note', 'itemId', p_base || '11', 'sourceKey', 'guide-topic:1', 'position', 1,
      'payload', jsonb_build_object('title', 'Topic', 'body', 'What to know', 'noteType', 'guide_topic', 'number', 1,
        'mustKnow', '[{"text":"What to know"}]'::jsonb,
        'lessons', '[{"number":"1.1","title":"Lesson","mustKnow":[{"type":"paragraph","text":[{"text":"Know this"}]}]}]'::jsonb,
        'recap', '[{"type":"paragraph","text":[{"text":"Recap"}]}]'::jsonb,
        'theory', jsonb_build_object('itemId', p_base || '12', 'question', '[{"type":"paragraph","text":[{"text":"Why?"}]}]'::jsonb)))),
    'theory', jsonb_build_array(jsonb_build_object('kind', 'theory_question', 'itemId', p_base || '12', 'sourceKey', 'guide-theory:1',
      'position', 1, 'payload', '{"prompt":"Why?"}'::jsonb,
      'answer', jsonb_build_object('kind', 'model_answer', 'itemId', p_base || '13', 'sourceKey', 'guide-answer:1',
        'payload', '{"body":"Because."}'::jsonb)))) $$;
create function pg_temp.overview(p_base text) returns jsonb language sql immutable as $$
  select jsonb_build_object('itemId', p_base || '10', 'create', true, 'after',
    '{"title":"Test course","body":"Every topic is examinable.","outcomes":["Do one thing."],"assessment":["The exam is objective."]}'::jsonb) $$;
create function pg_temp.pointers(p_item uuid) returns jsonb language sql stable as $$
  select jsonb_build_array(published_revision, current_revision, approved_revision, lock_version) from public.managed_content_items where id = p_item $$;
-- An item someone else published at revision one.
create function pg_temp.operator_item(p_id uuid, p_course uuid, p_kind text, p_key text, p_payload jsonb, p_parent uuid default null)
returns void language sql as $$
  insert into public.managed_content_items (id, course_id, kind, source_key, parent_item_id, current_revision, approved_revision,
      published_revision, published_parent_revision, lock_version, created_by)
    values (p_id, p_course, p_kind, p_key, p_parent, 1, 1, 1, case when p_parent is null then null else 1 end, 3,
      '11111111-1111-4111-8111-111111111111');
  insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
    values (p_id, 1, p_payload, '11111111-1111-4111-8111-111111111111') $$;
create function pg_temp.totals() returns jsonb language sql as $$
  select jsonb_build_object('items', (select count(*) from public.managed_content_items),
    'revisions', (select count(*) from public.managed_content_revisions),
    'publications', (select count(*) from public.managed_content_publications),
    'courses', (select count(*) from public.courses),
    'linked', (select count(*) from public.institutional_courses where repository_course_id is not null)) $$;

-- ---------------------------------------------------------------------------------------------------------------
-- An overview the import creates.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.courses (id, content_key, is_shared) values ('91000000-0000-4000-8000-000000000001', 'guide-rules-overview', null);
select pg_temp.store(jsonb_build_object('guide', 'study_guide_rules_a', 'code', 'RULES-A',
  'courseId', '91000000-0000-4000-8000-000000000001', 'actor', '00000000-0000-4000-8000-000000000045',
  'overview', pg_temp.overview('91000000-0000-4000-8000-0000000001'), 'retire', '[]'::jsonb)
  || pg_temp.topic('91000000-0000-4000-8000-0000000001'));

savepoint own_overview;
select pg_temp.operator_item('91000000-0000-4000-8000-000000000199', '91000000-0000-4000-8000-000000000001', 'course_overview',
  'operator-overview', '{"title":"Theirs","body":"Their own overview"}');
create temporary table before_a on commit drop as select pg_temp.totals() totals;
select throws_ok($$select private.study_guide('study_guide_rules_a', 'apply')$$, 'P0001',
  'Study guide RULES-A: the published notes, theory or overview are not the ones this import replaces',
  'a course that has gained an overview of its own is refused');
select is(pg_temp.totals(), (select totals from before_a), 'and nothing changed');
rollback to savepoint own_overview;

select is(private.study_guide('study_guide_rules_a', 'apply'), 'applied', 'a course with no overview gets one');
select is(pg_temp.pointers('91000000-0000-4000-8000-000000000110'), '[1, 1, 1, 3]'::jsonb, 'published at revision one, like a guide topic');
select is((select jsonb_build_array(kind, source_key, created_by, position) from public.managed_content_items
    where id = '91000000-0000-4000-8000-000000000110'),
  '["course_overview", "course-overview", "00000000-0000-4000-8000-000000000045", null]'::jsonb, 'the course overview, with the import as its author');
select is((select payload->'outcomes' from public.managed_content_revisions where item_id = '91000000-0000-4000-8000-000000000110'),
  '["Do one thing."]'::jsonb, 'holding the outcomes');
select is((select count(*)::integer from public.managed_content_publications where item_id = '91000000-0000-4000-8000-000000000110'
    and action = 'publish' and acted_by = '00000000-0000-4000-8000-000000000045'), 1, 'its publication is in the history');
select is(private.study_guide('study_guide_rules_a', 'apply'), 'unchanged', 'a rerun is unchanged');

savepoint edited_created_overview;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  values ('91000000-0000-4000-8000-000000000110', 2, '{"title":"Edited","body":"Edited"}', '11111111-1111-4111-8111-111111111111');
update public.managed_content_items set current_revision = 2, lock_version = lock_version + 1
  where id = '91000000-0000-4000-8000-000000000110';
select throws_ok($$select private.study_guide('study_guide_rules_a', 'rollback')$$, 'P0001',
  'Study guide RULES-A: the published notes, theory or overview are not the ones this import published',
  'an overview edited since is refused by rollback');
rollback to savepoint edited_created_overview;

select is(private.study_guide('study_guide_rules_a', 'rollback'), 'rolled-back', 'rollback runs');
select is(pg_temp.pointers('91000000-0000-4000-8000-000000000110'), '[null, 1, 1, 4]'::jsonb, 'the overview is unpublished, not deleted');
select is((select count(*)::integer from public.managed_content_publications where item_id = '91000000-0000-4000-8000-000000000110'
    and action = 'unpublish' and previous_revision = 1), 1, 'through the publish history');
select is(private.study_guide('study_guide_rules_a', 'apply'), 'applied', 'and the guide applies again');
select is((select count(*)::integer from public.managed_content_revisions where item_id = '91000000-0000-4000-8000-000000000110'), 1,
  'reusing the revision it wrote');

-- ---------------------------------------------------------------------------------------------------------------
-- Items the import keeps published, beside the notes it retires.
-- ---------------------------------------------------------------------------------------------------------------
insert into public.courses (id, content_key, is_shared) values ('92000000-0000-4000-8000-000000000001', 'guide-rules-keep', null);
select pg_temp.operator_item('92000000-0000-4000-8000-000000000201', '92000000-0000-4000-8000-000000000001', 'note', 'old-note',
  '{"title":"Old note","body":"Old"}');
select pg_temp.operator_item('92000000-0000-4000-8000-000000000202', '92000000-0000-4000-8000-000000000001', 'theory_question', 'theory:1',
  '{"prompt":"Their question"}');
select pg_temp.operator_item('92000000-0000-4000-8000-000000000203', '92000000-0000-4000-8000-000000000001', 'model_answer', 'answer:1',
  '{"body":"Their answer"}', '92000000-0000-4000-8000-000000000202');
select pg_temp.store(jsonb_build_object('guide', 'study_guide_rules_b', 'code', 'RULES-B',
  'courseId', '92000000-0000-4000-8000-000000000001', 'actor', '00000000-0000-4000-8000-000000000045',
  'overview', pg_temp.overview('92000000-0000-4000-8000-0000000001'),
  'retire', '[{"itemId":"92000000-0000-4000-8000-000000000201","revision":1,"parentRevision":null}]'::jsonb,
  'keep', '[{"itemId":"92000000-0000-4000-8000-000000000202","revision":1},{"itemId":"92000000-0000-4000-8000-000000000203","revision":1}]'::jsonb)
  || pg_temp.topic('92000000-0000-4000-8000-0000000001'));
create temporary table kept_start on commit drop as
  select pg_temp.pointers('92000000-0000-4000-8000-000000000202') question, pg_temp.pointers('92000000-0000-4000-8000-000000000203') answer;

select throws_ok($$select private.study_guide('study_guide_rules_b', 'rollback')$$, 'P0001',
  'Study guide RULES-B: the published notes, theory or overview are not the ones this import published',
  'a guide that has not been applied cannot be rolled back');

savepoint stray_item;
select pg_temp.operator_item('92000000-0000-4000-8000-000000000204', '92000000-0000-4000-8000-000000000001', 'note', 'another-note',
  '{"title":"Another","body":"Note"}');
select throws_ok($$select private.study_guide('study_guide_rules_b', 'apply')$$, 'P0001',
  'Study guide RULES-B: the published notes, theory or overview are not the ones this import replaces',
  'a published item the import neither keeps nor retires is refused');
rollback to savepoint stray_item;

savepoint kept_gone;
update public.managed_content_items set published_revision = null, published_parent_revision = null, lock_version = lock_version + 1
  where id = '92000000-0000-4000-8000-000000000203';
select throws_ok($$select private.study_guide('study_guide_rules_b', 'apply')$$, 'P0001',
  'Study guide RULES-B: the published notes, theory or overview are not the ones this import replaces',
  'an item it should keep, unpublished since, is refused');
rollback to savepoint kept_gone;

savepoint kept_revised;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  values ('92000000-0000-4000-8000-000000000202', 2, '{"prompt":"Revised"}', '11111111-1111-4111-8111-111111111111');
update public.managed_content_items set current_revision = 2, approved_revision = 2, published_revision = 2, lock_version = lock_version + 3
  where id = '92000000-0000-4000-8000-000000000202';
select throws_ok($$select private.study_guide('study_guide_rules_b', 'apply')$$, 'P0001',
  'Study guide RULES-B: the published notes, theory or overview are not the ones this import replaces',
  'an item it should keep, published at another revision, is refused');
rollback to savepoint kept_revised;

select is(private.study_guide('study_guide_rules_b', 'apply'), 'applied', 'the guide applies beside the items it keeps');
select is((select published_revision from public.managed_content_items where id = '92000000-0000-4000-8000-000000000201'), null,
  'the note it replaces is unpublished');
select is(jsonb_build_array(pg_temp.pointers('92000000-0000-4000-8000-000000000202'), pg_temp.pointers('92000000-0000-4000-8000-000000000203')),
  (select jsonb_build_array(question, answer) from kept_start), 'the kept question and answer are not touched at all');
select is((select count(*)::integer from public.managed_content_items where course_id = '92000000-0000-4000-8000-000000000001'
    and kind = 'theory_question' and published_revision is not null), 2, 'the course publishes its own question and the guide''s');
select is(private.study_guide('study_guide_rules_b', 'apply'), 'unchanged', 'a rerun is unchanged');

savepoint kept_gone_after;
update public.managed_content_items set published_revision = null, published_parent_revision = null, lock_version = lock_version + 1
  where id = '92000000-0000-4000-8000-000000000203';
select throws_ok($$select private.study_guide('study_guide_rules_b', 'rollback')$$, 'P0001',
  'Study guide RULES-B: the published notes, theory or overview are not the ones this import published',
  'after the import, a kept item unpublished since is refused by rollback');
rollback to savepoint kept_gone_after;

select is(private.study_guide('study_guide_rules_b', 'rollback'), 'rolled-back', 'rollback runs');
select is((select jsonb_build_array(published_revision, published_parent_revision) from public.managed_content_items
    where id = '92000000-0000-4000-8000-000000000201'), '[1, null]'::jsonb, 'the replaced note is published again at its revision');
select is(jsonb_build_array(pg_temp.pointers('92000000-0000-4000-8000-000000000202'), pg_temp.pointers('92000000-0000-4000-8000-000000000203')),
  (select jsonb_build_array(question, answer) from kept_start), 'the kept question and answer are still untouched');
select is((select count(*)::integer from public.managed_content_items where course_id = '92000000-0000-4000-8000-000000000001'), 7,
  'nothing was deleted: three of theirs, the guide''s three and its overview');

-- ---------------------------------------------------------------------------------------------------------------
-- A course the import creates and links to its catalogue course.
-- ---------------------------------------------------------------------------------------------------------------
-- A catalogue course with no repository course, whose code is used once, as it applies at one level.
create temporary table catalogue on commit drop as
  select c.id, c.course_code, c.display_title, l.key level_key, jsonb_agg(distinct p.key) semesters
  from public.institutional_courses c
  join public.course_applicability a on a.institutional_course_id = c.id
  join public.academic_levels l on l.id = a.academic_level_id
  join public.academic_periods p on p.id = a.academic_period_id
  where c.repository_course_id is null
    and (select count(*) from public.institutional_courses x where x.course_code = c.course_code) = 1
  group by c.id, c.course_code, c.display_title, l.key
  order by c.course_code, l.key limit 1;
select is((select count(*)::integer from catalogue), 1, 'an unlinked catalogue course to test with');
create function pg_temp.new_course(p_guide text, p_course uuid, p_key text, p_title text, p_level text) returns text language sql as $$
  select pg_temp.store(jsonb_build_object('guide', p_guide, 'code', (select course_code from catalogue),
    'courseId', p_course, 'actor', '00000000-0000-4000-8000-000000000045',
    'course', jsonb_build_object('contentKey', p_key, 'titles', jsonb_build_array(p_title), 'level', p_level,
      'semesters', (select semesters from catalogue)),
    'overview', pg_temp.overview(left(p_course::text, 34)), 'retire', '[]'::jsonb) || pg_temp.topic(left(p_course::text, 34))) $$;
create temporary table before_c on commit drop as select pg_temp.totals() totals;

select pg_temp.new_course('study_guide_rules_c1', '93000000-0000-4000-8000-000000000001', 'guide-rules-new',
  (select display_title from catalogue), '900-level');
select throws_ok($$select private.study_guide('study_guide_rules_c1', 'apply')$$, 'P0001',
  format('Study guide %s: the catalogue course does not apply at its level in every semester it is taught', (select course_code from catalogue)),
  'a level the catalogue does not offer the course at is refused');
select pg_temp.new_course('study_guide_rules_c2', '93000000-0000-4000-8000-000000000001', 'guide-rules-new',
  'Not the catalogue title', (select level_key from catalogue));
select throws_ok($$select private.study_guide('study_guide_rules_c2', 'apply')$$, 'P0001',
  format('Study guide %s: the catalogue course is not linked exactly once', (select course_code from catalogue)),
  'a title the catalogue does not use is refused');
select pg_temp.new_course('study_guide_rules_c3', '93000000-0000-4000-8000-000000000001', 'guide-rules-keep',
  (select display_title from catalogue), (select level_key from catalogue));
select throws_ok($$select private.study_guide('study_guide_rules_c3', 'apply')$$, 'P0001',
  format('Study guide %s: the repository identity is not this course''s', (select course_code from catalogue)),
  'a content key another course already holds is refused');
select is(pg_temp.totals(), (select totals from before_c), 'and none of the three refusals left a course, a link or an item behind');

select pg_temp.new_course('study_guide_rules_c', '93000000-0000-4000-8000-000000000001', 'guide-rules-new',
  (select display_title from catalogue), (select level_key from catalogue));
create temporary table applicability_start on commit drop as select * from public.course_applicability;
select is(private.study_guide('study_guide_rules_c', 'apply'), 'applied', 'the import creates the course');
select is((select jsonb_build_array(content_key, is_shared) from public.courses where id = '93000000-0000-4000-8000-000000000001'),
  '["guide-rules-new", null]'::jsonb, 'its repository identity, with its sharing unresolved');
select is((select repository_course_id from public.institutional_courses where id = (select id from catalogue)),
  '93000000-0000-4000-8000-000000000001'::uuid, 'its catalogue course is linked');
select is((select count(*)::integer from public.managed_content_items where course_id = '93000000-0000-4000-8000-000000000001'
    and published_revision = 1), 4, 'and its topic, theory question, answer and overview are published');
select is(private.study_guide('study_guide_rules_c', 'apply'), 'unchanged', 'a rerun is unchanged');
select is(private.study_guide('study_guide_rules_c', 'rollback'), 'rolled-back', 'rollback runs');
select is((select count(*)::integer from public.managed_content_items where course_id = '93000000-0000-4000-8000-000000000001'
    and published_revision is not null), 0, 'nothing is published');
select is((select repository_course_id from public.institutional_courses where id = (select id from catalogue)),
  '93000000-0000-4000-8000-000000000001'::uuid, 'the course and its link stay, as a rolled-back bank leaves them');
select is(private.study_guide('study_guide_rules_c', 'apply'), 'applied', 'and the guide applies again to the course it created');
select ok((select count(*) from applicability_start) = (select count(*) from public.course_applicability)
  and not exists (select * from applicability_start except select * from public.course_applicability),
  'no applicability row was added or removed');

select * from finish();
rollback;
