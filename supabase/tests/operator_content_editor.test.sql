-- supabase/tests/operator_content_editor.test.sql — Provisioning, history, and complete operator workflow regression coverage.
begin;
select no_plan();

select has_function('public', 'provision_repository_content', array['uuid'], 'provisioning RPC exists');
select has_function('public', 'get_managed_content_history', array['uuid'], 'operator history RPC exists');
select ok(not has_function_privilege('anon', 'public.provision_repository_content(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_managed_content_history(uuid)', 'EXECUTE'),
  'signed-out API role has no editor RPC grant');
select ok(has_function_privilege('authenticated', 'public.provision_repository_content(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_managed_content_history(uuid)', 'EXECUTE'),
  'authenticated API role reaches live-operator checks');
select ok(pg_get_functiondef('public.provision_repository_content(uuid)'::regprocedure) ilike '%for update%'
  and exists (select 1 from pg_constraint where conrelid = 'public.institutional_courses'::regclass
    and conname = 'institutional_courses_repository_course_id_unique'),
  'row locking and unique links protect concurrent provisioning');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'editor-operator@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444',
   'authenticated', 'authenticated', 'editor-student@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());
update public.profiles set role = 'operator'
where id = '33333333-3333-4333-8333-333333333333';
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '33333333-3333-4333-8333-333333333333', now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '44444444-4444-4444-8444-444444444444', now(), now());

set local role anon;
select throws_ok($sql$ select * from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000001') $sql$, '42501', null,
  'signed-out caller cannot provision');
select throws_ok($sql$ select public.get_managed_content_history(
  '11111111-1111-4111-8111-111111111111') $sql$, '42501', null,
  'signed-out caller cannot read history');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","session_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}';
select throws_ok($sql$ select * from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000001') $sql$, '42501', null,
  'student cannot provision by direct RPC');
select throws_ok($sql$ select public.get_managed_content_history(
  '11111111-1111-4111-8111-111111111111') $sql$, '42501', null,
  'student cannot read editor history');
select throws_ok($sql$ update public.institutional_courses set repository_course_id =
  '40000000-0000-4000-8000-000000000001' where id =
  '50000000-0000-4000-8000-000000000001' $sql$, '42501', null,
  'student cannot link catalogue rows directly');

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}';
select is((select repository_course_id::text from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000005')),
  '40000000-0000-4000-8000-000000000008',
  'already-linked institutional course retains its repository identity');
select is((select created from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000005')), false,
  'already-linked course is not silently relinked');
select set_config('test.editor_created', (select created::text from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000001')), true);
select is(current_setting('test.editor_created'), 'true', 'operator provisions an unlinked institutional course');
select set_config('test.editor_course', (select repository_course_id::text from public.institutional_courses
  where id = '50000000-0000-4000-8000-000000000001'), true);
select ok(current_setting('test.editor_course')::uuid is not null,
  'new content identity is linked to the requested institutional row');
select is((select created from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000001')), false,
  'repeated provisioning reuses the existing identity');
select is((select repository_course_id::text from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000001')), current_setting('test.editor_course'),
  'repeated provisioning returns the same repository UUID');
select is((select count(*)::int from public.courses), 16,
  'one new repository identity was created and existing identities remain');
select is((select content_key from public.courses where id = current_setting('test.editor_course')::uuid),
  'managed-' || replace(current_setting('test.editor_course'), '-', ''),
  'content key is generated from durable identity rather than catalogue title or code');
select is((select content_key from public.courses where id =
  '40000000-0000-4000-8000-000000000008'), 'use-of-english',
  'existing repository content identity remains unchanged');
select is((select count(*)::int from public.institutional_courses
  where repository_course_id = current_setting('test.editor_course')::uuid), 1,
  'unresolved aliases were not merged or automatically linked');
select throws_ok($sql$ select * from public.provision_repository_content(
  '99999999-9999-4999-8999-999999999999') $sql$, '22023', null,
  'unknown institutional course cannot be provisioned');
select throws_ok($sql$ update public.courses set content_key = 'changed-key'
  where id = current_setting('test.editor_course')::uuid $sql$, '42501', null,
  'operator browser role cannot mutate permanent content keys');

select set_config('test.editor_overview', public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'course_overview', '{"title":"Overview","body":"Course introduction"}'::jsonb, gen_random_uuid())::text, true);
select set_config('test.editor_note', public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'note', '{"title":"First note","body":"Original note"}'::jsonb, gen_random_uuid())::text, true);
select set_config('test.editor_cbt', public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'cbt_question', '{"prompt":"Choose one","options":["A","B"],"correctOption":1}'::jsonb, gen_random_uuid())::text, true);
select set_config('test.editor_question', (select question_id::text from public.list_managed_content(
  current_setting('test.editor_course')::uuid) where item_id = current_setting('test.editor_cbt')::uuid), true);
select set_config('test.editor_theory', public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'theory_question', '{"prompt":"Explain the course"}'::jsonb, gen_random_uuid())::text, true);
select set_config('test.editor_answer', public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'model_answer', '{"body":"A reasoned answer"}'::jsonb, gen_random_uuid(), current_setting('test.editor_theory')::uuid)::text, true);
select set_config('test.editor_rubric', public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'rubric', '{"body":"Award marks for reasoning"}'::jsonb, gen_random_uuid(), current_setting('test.editor_theory')::uuid)::text, true);
select is((select count(*)::int from public.list_managed_content(
  current_setting('test.editor_course')::uuid)), 6,
  'operator creates all six supported content families');
select is((select count(*)::int from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid)), 0,
  'new drafts are invisible to published student reads');
select throws_ok($sql$ select public.create_managed_content_once(
  current_setting('test.editor_course')::uuid, 'cbt_question', '{"prompt":"Invalid","options":["A"],"correctOption":0}'::jsonb, gen_random_uuid()) $sql$, '22023', null,
  'invalid content is rejected by the server payload boundary');

select is(public.revise_managed_content(current_setting('test.editor_note')::uuid, 1,
  '{"title":"First note","body":"Revised note"}'::jsonb), 2::bigint,
  'editing appends revision two');
select is((public.get_managed_content_history(current_setting('test.editor_note')::uuid)
  ->'revisions'->0->'payload'->>'body'), 'Original note',
  'history retains revision one unchanged');
select is(jsonb_array_length(public.get_managed_content_history(
  current_setting('test.editor_note')::uuid)->'revisions'), 2,
  'history exposes both immutable revisions');
select throws_ok($sql$ select public.revise_managed_content(
  current_setting('test.editor_note')::uuid, 1,
  '{"title":"Overwrite","body":"Stale"}'::jsonb) $sql$, '40001', null,
  'stale optimistic-lock edit cannot overwrite newer work');
select is((select payload->>'body' from public.list_managed_content(
  current_setting('test.editor_course')::uuid)
  where item_id = current_setting('test.editor_note')::uuid), 'Revised note',
  'stale write left current content intact');
select throws_ok($sql$ select public.publish_managed_content(
  current_setting('test.editor_note')::uuid, 2, 2) $sql$, '22023', null,
  'unapproved revision cannot be published');
select is(public.review_managed_content(current_setting('test.editor_note')::uuid, 2, 2,
  'rejected', 'Needs correction'), 3::bigint, 'operator can reject a revision with a note');
select throws_ok($sql$ select public.publish_managed_content(
  current_setting('test.editor_note')::uuid, 3, 2) $sql$, '22023', null,
  'rejected revision cannot be published');
select is(public.review_managed_content(current_setting('test.editor_note')::uuid, 3, 2,
  'approved', 'Corrected'), 4::bigint, 'operator can deliberately approve after review');
select is(public.publish_managed_content(current_setting('test.editor_note')::uuid, 4, 2),
  5::bigint, 'approved revision becomes published');
select is((select payload->>'body' from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid)
  where item_id = current_setting('test.editor_note')::uuid), 'Revised note',
  'published revision is readable through the student boundary');
select is(public.unpublish_managed_content(current_setting('test.editor_note')::uuid, 5),
  6::bigint, 'operator unpublishes without deleting history');
select is((select count(*)::int from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid)
  where item_id = current_setting('test.editor_note')::uuid), 0,
  'unpublished note is absent from student reads');
select is(public.review_managed_content(current_setting('test.editor_note')::uuid, 6, 1,
  'approved'), 7::bigint, 'earlier revision can be approved for restore');
select is(public.publish_managed_content(current_setting('test.editor_note')::uuid, 7, 1),
  8::bigint, 'restore republishes the earlier revision');
select is((select payload->>'body' from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid)
  where item_id = current_setting('test.editor_note')::uuid), 'Original note',
  'restore changes the publication pointer without rewriting later revisions');
select is(public.review_managed_content(current_setting('test.editor_note')::uuid, 8, 1,
  'rejected'), 9::bigint, 'rejecting a published revision records a decision');
select is((select count(*)::int from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid)
  where item_id = current_setting('test.editor_note')::uuid), 0,
  'published rejection atomically withdraws student-visible content');
select is((public.get_managed_content_history(current_setting('test.editor_note')::uuid)
  ->'publications'->-1->>'action'), 'unpublish',
  'rejection withdrawal is preserved in publication history');
select is(jsonb_array_length(public.get_managed_content_history(
  current_setting('test.editor_note')::uuid)->'reviews'), 4,
  'operator history exposes all review decisions');

select is(public.review_managed_content(current_setting('test.editor_theory')::uuid, 1, 1,
  'approved'), 2::bigint, 'theory revision one approved');
select is(public.publish_managed_content(current_setting('test.editor_theory')::uuid, 2, 1),
  3::bigint, 'theory revision one published');
select is(public.review_managed_content(current_setting('test.editor_answer')::uuid, 1, 1,
  'approved', null, 1), 2::bigint, 'answer reviewed against theory revision one');
select is(public.publish_managed_content(current_setting('test.editor_answer')::uuid, 2, 1),
  3::bigint, 'answer published for theory revision one');
select is(public.review_managed_content(current_setting('test.editor_rubric')::uuid, 1, 1,
  'approved', null, 1), 2::bigint, 'rubric reviewed against theory revision one');
select is(public.publish_managed_content(current_setting('test.editor_rubric')::uuid, 2, 1),
  3::bigint, 'rubric published for theory revision one');
select is((select count(*)::int from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid) where kind in ('model_answer','rubric')), 2,
  'reviewed answer and rubric accompany theory revision one');
select is(public.revise_managed_content(current_setting('test.editor_theory')::uuid, 3,
  '{"prompt":"Explain the revised course"}'::jsonb), 4::bigint,
  'theory wording change creates immutable revision two');
select is(public.review_managed_content(current_setting('test.editor_theory')::uuid, 4, 2,
  'approved'), 5::bigint, 'theory revision two approved');
select is(public.publish_managed_content(current_setting('test.editor_theory')::uuid, 5, 2),
  6::bigint, 'theory revision two published');
select is((select count(*)::int from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid) where kind in ('model_answer','rubric')), 0,
  'old answer and rubric are hidden beside new theory wording');
select is(public.review_managed_content(current_setting('test.editor_answer')::uuid, 3, 1,
  'approved', null, 2), 4::bigint, 'answer deliberately revalidated for theory revision two');
select is(public.publish_managed_content(current_setting('test.editor_answer')::uuid, 4, 1),
  5::bigint, 'answer republished for exact new theory revision');
select is(public.review_managed_content(current_setting('test.editor_rubric')::uuid, 3, 1,
  'approved', null, 2), 4::bigint, 'rubric deliberately revalidated for theory revision two');
select is(public.publish_managed_content(current_setting('test.editor_rubric')::uuid, 4, 1),
  5::bigint, 'rubric republished for exact new theory revision');
select is((select count(*)::int from public.read_published_managed_content(
  current_setting('test.editor_course')::uuid) where kind in ('model_answer','rubric')), 2,
  'revalidated answer and rubric become visible again');
select is(public.revise_managed_content(current_setting('test.editor_cbt')::uuid, 1,
  '{"prompt":"Choose again","options":["A","B"],"correctOption":0}'::jsonb),
  2::bigint, 'CBT wording edit appends a revision');
select is((select question_id::text from public.list_managed_content(
  current_setting('test.editor_course')::uuid) where item_id =
  current_setting('test.editor_cbt')::uuid), current_setting('test.editor_question'),
  'CBT permanent question identity survives revision');
select ok((select count(*) from public.course_applicability applicability
  join public.institutional_courses catalogue on catalogue.id = applicability.institutional_course_id
  where catalogue.repository_course_id = '40000000-0000-4000-8000-000000000001') > 1,
  'shared/general applicability still points to one repository identity');

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","session_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}';
select throws_ok($sql$ select public.get_managed_content_history(
  current_setting('test.editor_note')::uuid) $sql$, '42501', null,
  'student cannot inspect revision, review, or publication history');
select throws_ok($sql$ select public.review_managed_content(
  current_setting('test.editor_note')::uuid, 9, 2, 'approved') $sql$, '42501', null,
  'student cannot review directly');
select throws_ok($sql$ select public.unpublish_managed_content(
  current_setting('test.editor_answer')::uuid, 5) $sql$, '42501', null,
  'student cannot mutate publication directly');
reset role;

delete from auth.sessions where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}';
select throws_ok($sql$ select public.get_managed_content_history(
  current_setting('test.editor_note')::uuid) $sql$, '42501', null,
  'stale operator session cannot read history');
select throws_ok($sql$ select * from public.provision_repository_content(
  '50000000-0000-4000-8000-000000000002') $sql$, '42501', null,
  'stale operator session cannot provision');
reset role;

select * from finish();
rollback;
