-- supabase/tests/managed_content.test.sql — Operator writes and published-only account reads.
begin;
select no_plan();

select has_table('public', 'managed_content_items', 'managed items exist');
select has_table('public', 'managed_content_revisions', 'immutable revision storage exists');
select has_table('public', 'managed_content_reviews', 'review history exists');
select has_table('public', 'managed_content_publications', 'publication history exists');
select ok((select bool_and(relrowsecurity) from pg_class
  where oid in ('public.managed_content_items'::regclass,
                'public.managed_content_revisions'::regclass,
                'public.managed_content_reviews'::regclass,
                'public.managed_content_publications'::regclass)),
  'every managed table has RLS');
select is((select count(*)::int from pg_policies where schemaname = 'public'
  and tablename like 'managed_content_%'), 0, 'managed tables deny direct browser access by default');
select ok(not has_table_privilege('authenticated', 'public.managed_content_items', 'SELECT')
  and not has_table_privilege('authenticated', 'public.managed_content_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.managed_content_revisions', 'UPDATE')
  and not has_table_privilege('anon', 'public.managed_content_items', 'SELECT')
  and not has_table_privilege('service_role', 'public.managed_content_items', 'SELECT'),
  'API roles have no direct managed-table access');
select ok((select confrelid = 'public.courses'::regclass
  from pg_constraint where conrelid = 'public.managed_content_items'::regclass
    and conname = 'managed_content_items_course_id_fkey'),
  'content uses the stable repository course UUID as its foreign key');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE'),
  'students cannot update their own role through profile capabilities');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'content-operator@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'content-student@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());
update public.profiles set role = 'operator'
where id = '11111111-1111-4111-8111-111111111111';
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', now(), now());

set local role anon;
select throws_ok($sql$ select * from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007') $sql$, '42501', null,
  'signed-out callers cannot use the published read boundary');
select throws_ok($sql$ select public.create_managed_content(
  '40000000-0000-4000-8000-000000000007', 'note', '{"title":"x","body":"x"}'::jsonb) $sql$,
  '42501', null, 'anonymous callers cannot write');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select set_config('test.managed_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000007', 'cbt_question',
  '{"prompt":"Original wording","options":["A","B"],"correctOption":1}'::jsonb,
  'df67ccc9-5d16-4ab5-be67-4ff195cf39c8', 'legacy-cbt-1')::text, true);
select is((select count(*)::int from public.list_managed_content(
  '40000000-0000-4000-8000-000000000007')), 1,
  'operator can read a draft through the operator-only boundary');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 0,
  'drafts do not appear in the student published read boundary');
select throws_ok($sql$ select count(*) from public.managed_content_items $sql$,
  '42501', null, 'even operators cannot bypass validated RPCs with direct table reads');
select throws_ok($sql$ select public.create_managed_content(
  '90000000-0000-4000-8000-000000000001', 'note', '{"title":"x","body":"x"}'::jsonb) $sql$,
  '23503', null, 'unknown repository course UUID cannot own content');
select throws_ok($sql$ select public.create_managed_content(
  '40000000-0000-4000-8000-000000000007', 'cbt_question',
  '{"prompt":"Bad","options":["A","B"],"correctOption":8}'::jsonb,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') $sql$,
  '22023', null, 'the server validates mutable CBT payloads');
select throws_ok($sql$ select public.publish_managed_content(
  current_setting('test.managed_item')::uuid, 1, 1) $sql$,
  '22023', null, 'a draft cannot be published before review');
select is(public.review_managed_content(current_setting('test.managed_item')::uuid, 1, 1, 'approved'),
  2::bigint, 'operator can approve a specific revision');
select is(public.publish_managed_content(current_setting('test.managed_item')::uuid, 2, 1),
  3::bigint, 'operator can publish the approved revision');

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 1,
  'student can read published content through the dedicated boundary');
select is((select payload->>'prompt' from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 'Original wording',
  'student sees the published revision');
select throws_ok($sql$ select * from public.list_managed_content(
  '40000000-0000-4000-8000-000000000007') $sql$,
  '42501', null, 'student cannot read operator drafts');
select throws_ok($sql$ select public.revise_managed_content(
  current_setting('test.managed_item')::uuid, 3,
  '{"prompt":"Forged","options":["A","B"],"correctOption":0}'::jsonb) $sql$,
  '42501', null, 'student direct write attempt is denied');
select throws_ok($sql$ update public.profiles set role = 'operator'
  where id = '22222222-2222-4222-8222-222222222222' $sql$,
  '42501', null, 'student cannot self-promote through the profile table');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select is(public.revise_managed_content(current_setting('test.managed_item')::uuid, 3,
  '{"prompt":"Revised wording","options":["A","B"],"correctOption":0}'::jsonb),
  4::bigint, 'operator edit creates a new immutable revision');
select throws_ok($sql$ select public.revise_managed_content(
  current_setting('test.managed_item')::uuid, 3,
  '{"prompt":"Stale overwrite","options":["A","B"],"correctOption":0}'::jsonb) $sql$,
  '40001', null, 'stale concurrent edit cannot overwrite newer operator work');
select is((select payload->>'prompt' from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 'Original wording',
  'editing does not leak a draft over the published revision');
select is((select question_id::text from public.list_managed_content(
  '40000000-0000-4000-8000-000000000007')),
  'df67ccc9-5d16-4ab5-be67-4ff195cf39c8',
  'existing attempt-history question ID survives wording changes');
select is(public.review_managed_content(current_setting('test.managed_item')::uuid, 4, 2, 'approved'),
  5::bigint, 'new revision can be reviewed');
select is(public.publish_managed_content(current_setting('test.managed_item')::uuid, 5, 2),
  6::bigint, 'new approved revision can replace publication');
select is((select payload->>'prompt' from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 'Revised wording',
  'published updates become readable without a deployment');
select is(public.review_managed_content(current_setting('test.managed_item')::uuid, 6, 1, 'approved'),
  7::bigint, 'an earlier immutable revision can be reapproved for rollback');
select is(public.publish_managed_content(current_setting('test.managed_item')::uuid, 7, 1),
  8::bigint, 'rollback republishes the earlier revision');
select is((select payload->>'prompt' from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 'Original wording',
  'rollback changes only the publication pointer');
select is(public.unpublish_managed_content(current_setting('test.managed_item')::uuid, 8),
  9::bigint, 'operator can unpublish');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007')), 0,
  'unpublished content is absent from student reads');

-- Shared/general content still has one repository item despite many applicability rows.
select ok((select count(*) from public.course_applicability applicability
  join public.institutional_courses catalogue on catalogue.id = applicability.institutional_course_id
  where catalogue.repository_course_id = '40000000-0000-4000-8000-000000000001') > 1,
  'shared course has multiple institutional applicability rows');
select set_config('test.theory_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000001', 'theory_question',
  '{"prompt":"Explain the idea"}'::jsonb, null, 'legacy-theory-1')::text, true);
select set_config('test.answer_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000001', 'model_answer',
  '{"body":"An explanatory model answer."}'::jsonb, null, null,
  current_setting('test.theory_item')::uuid)::text, true);
select set_config('test.rubric_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000001', 'rubric',
  '{"body":"Award two marks for the definition."}'::jsonb, null, null,
  current_setting('test.theory_item')::uuid)::text, true);
select is((select count(*)::int from public.list_managed_content(
  '40000000-0000-4000-8000-000000000001')), 3,
  'theory questions, model answers and rubrics are representable as separate linked items');
select is(public.review_managed_content(current_setting('test.answer_item')::uuid, 1, 1, 'approved'),
  2::bigint, 'model answer can be reviewed');
select is(public.publish_managed_content(current_setting('test.answer_item')::uuid, 2, 1),
  3::bigint, 'model answer can be published');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 0,
  'published answer stays hidden while its parent theory question is a draft');
select is(public.review_managed_content(current_setting('test.theory_item')::uuid, 1, 1, 'approved'),
  2::bigint, 'theory question can be reviewed');
select is(public.publish_managed_content(current_setting('test.theory_item')::uuid, 2, 1),
  3::bigint, 'theory question can be published');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 2,
  'one shared question and its published answer appear through one course identity');
select is((select source_key from public.list_managed_content(
  '40000000-0000-4000-8000-000000000001') where kind = 'theory_question'),
  'legacy-theory-1', 'course-local legacy theory identity can be retained for migration');
select is(public.unpublish_managed_content(current_setting('test.theory_item')::uuid, 3),
  4::bigint, 'a parent question can be unpublished');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 0,
  'unpublishing a parent also hides linked published answer content');

-- Both dependent families are pinned to the reviewed theory revision.
select is(public.publish_managed_content(current_setting('test.theory_item')::uuid, 4, 1),
  5::bigint, 'theory revision one can be republished');
select is(public.review_managed_content(current_setting('test.rubric_item')::uuid, 1, 1, 'approved'),
  2::bigint, 'rubric review records theory revision one');
select is(public.publish_managed_content(current_setting('test.rubric_item')::uuid, 2, 1),
  3::bigint, 'rubric can be published for theory revision one');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 3,
  'theory revision one exposes its reviewed answer and rubric');
select is(public.revise_managed_content(current_setting('test.theory_item')::uuid, 5,
  '{"prompt":"Explain the revised idea"}'::jsonb),
  6::bigint, 'theory edit creates revision two without changing publication');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 3,
  'a draft theory revision does not hide still-valid revision-one dependencies');
select is(public.review_managed_content(current_setting('test.theory_item')::uuid, 6, 2, 'approved'),
  7::bigint, 'theory revision two can be reviewed');
select is(public.publish_managed_content(current_setting('test.theory_item')::uuid, 7, 2),
  8::bigint, 'theory revision two becomes the published wording');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')
  where kind in ('model_answer', 'rubric')), 0,
  'answer and rubric reviewed for revision one do not accompany theory revision two');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 1,
  'the revised theory question remains visible without stale dependencies');
select is(public.review_managed_content(current_setting('test.answer_item')::uuid, 3, 1,
  'approved', null, 2), 4::bigint,
  'operator deliberately revalidates the existing answer for theory revision two');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001') where kind = 'model_answer'), 0,
  'review alone does not silently change the answer publication binding');
select is(public.publish_managed_content(current_setting('test.answer_item')::uuid, 4, 1),
  5::bigint, 'operator republishes the same answer revision with a new theory binding');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001') where kind = 'model_answer'), 1,
  'revalidated answer is visible beside theory revision two');
select is(public.review_managed_content(current_setting('test.rubric_item')::uuid, 3, 1,
  'approved', null, 2), 4::bigint,
  'operator deliberately revalidates the rubric for theory revision two');
select is(public.publish_managed_content(current_setting('test.rubric_item')::uuid, 4, 1),
  5::bigint, 'rubric is republished with its new theory binding');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000001')), 3,
  'theory revision two exposes only deliberately revalidated dependencies');
select is((select published_parent_revision from public.list_managed_content(
  '40000000-0000-4000-8000-000000000001') where kind = 'rubric'), 2,
  'operator list records the rubric publication binding');

-- Singular families are protected by unique indexes, including drafts.
select set_config('test.overview_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000002', 'course_overview',
  '{"title":"Overview","body":"Course summary"}'::jsonb)::text, true);
select throws_ok($sql$ select public.create_managed_content(
  '40000000-0000-4000-8000-000000000002', 'course_overview',
  '{"title":"Competing overview","body":"Different summary"}'::jsonb) $sql$,
  '23505', null, 'a course cannot acquire a competing overview');
select throws_ok($sql$ select public.create_managed_content(
  '40000000-0000-4000-8000-000000000001', 'model_answer',
  '{"body":"Competing answer"}'::jsonb, null, null,
  current_setting('test.theory_item')::uuid) $sql$,
  '23505', null, 'a theory question cannot acquire a competing model answer');
select throws_ok($sql$ select public.create_managed_content(
  '40000000-0000-4000-8000-000000000001', 'rubric',
  '{"body":"Competing rubric"}'::jsonb, null, null,
  current_setting('test.theory_item')::uuid) $sql$,
  '23505', null, 'a theory question cannot acquire a competing rubric');
select set_config('test.second_theory_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000001', 'theory_question',
  '{"prompt":"Another theory question"}'::jsonb)::text, true);
select is((select count(*)::int from public.list_managed_content(
  '40000000-0000-4000-8000-000000000001') where kind = 'theory_question'), 2,
  'multiple theory questions remain valid');
select set_config('test.second_cbt_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000007', 'cbt_question',
  '{"prompt":"Another CBT question","options":["A","B"],"correctOption":0}'::jsonb,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')::text, true);
select is((select count(*)::int from public.list_managed_content(
  '40000000-0000-4000-8000-000000000007') where kind = 'cbt_question'), 2,
  'multiple CBT questions remain valid');
select set_config('test.note_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000002', 'note',
  '{"title":"Note one","body":"Original note"}'::jsonb)::text, true);
select set_config('test.second_note_item', public.create_managed_content(
  '40000000-0000-4000-8000-000000000002', 'note',
  '{"title":"Note two","body":"Another note"}'::jsonb)::text, true);
select is((select count(*)::int from public.list_managed_content(
  '40000000-0000-4000-8000-000000000002') where kind = 'note'), 2,
  'multiple notes remain valid');

-- Rejection of the currently published revision is an audited unpublish.
select is(public.review_managed_content(current_setting('test.note_item')::uuid, 1, 1, 'approved'),
  2::bigint, 'note revision can be approved');
select is(public.publish_managed_content(current_setting('test.note_item')::uuid, 2, 1),
  3::bigint, 'approved note becomes published');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000002')), 1,
  'published note appears before rejection');
select is(public.review_managed_content(current_setting('test.note_item')::uuid, 3, 1, 'rejected'),
  4::bigint, 'rejection atomically advances the version and withdraws publication');
select is((select count(*)::int from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000002')), 0,
  'a rejected revision is absent from the student boundary');
select ok((select published_revision from public.list_managed_content(
  '40000000-0000-4000-8000-000000000002')
  where item_id = current_setting('test.note_item')::uuid) is null,
  'rejected note no longer has a publication pointer');
select throws_ok($sql$ select public.publish_managed_content(
  current_setting('test.note_item')::uuid, 4, 1) $sql$,
  '22023', null, 'rejected revision cannot be republished without a new approval');
reset role;

select is((select string_agg(action || ':' || coalesce(revision::text, '-'), ',' order by lock_version)
  from public.managed_content_publications
  where item_id = current_setting('test.managed_item')::uuid),
  'publish:1,publish:2,publish:1,unpublish:-',
  'publication events retain update, rollback and unpublish history');
select is((select count(*)::int from public.managed_content_revisions
  where item_id = current_setting('test.managed_item')::uuid), 2,
  'revision history retains both wordings');
select is((select count(*)::int from public.managed_content_reviews
  where item_id = current_setting('test.managed_item')::uuid), 3,
  'review history retains decisions by revision');
select is((select string_agg(parent_revision::text, ',' order by lock_version)
  from public.managed_content_publications
  where item_id = current_setting('test.answer_item')::uuid and action = 'publish'),
  '1,2', 'answer publication history records the reviewed theory revisions');
select is((select string_agg(parent_revision::text, ',' order by lock_version)
  from public.managed_content_publications
  where item_id = current_setting('test.rubric_item')::uuid and action = 'publish'),
  '1,2', 'rubric publication history records the reviewed theory revisions');
select is((select count(*)::int from public.managed_content_revisions
  where item_id = current_setting('test.answer_item')::uuid), 1,
  'revalidation preserves the immutable dependent-content revision');
select is((select action from public.managed_content_publications
  where item_id = current_setting('test.note_item')::uuid and lock_version = 4),
  'unpublish', 'rejection records an explicit unpublish event');
select is((select decision from public.managed_content_reviews
  where item_id = current_setting('test.note_item')::uuid and lock_version = 4),
  'rejected', 'rejection and automatic unpublish share one atomic version');

-- A valid JWT whose Auth session was removed must not keep operator powers.
delete from auth.sessions where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select throws_ok($sql$ select * from public.list_managed_content(
  '40000000-0000-4000-8000-000000000007') $sql$,
  '42501', null, 'revoked Auth session cannot read operator drafts');
select throws_ok($sql$ select public.revise_managed_content(
  current_setting('test.managed_item')::uuid, 9,
  '{"prompt":"Invalid session","options":["A","B"],"correctOption":0}'::jsonb) $sql$,
  '42501', null, 'revoked Auth session cannot write');
select throws_ok($sql$ select * from public.read_published_managed_content(
  '40000000-0000-4000-8000-000000000007') $sql$,
  '42501', null, 'revoked Auth session cannot use published read');
reset role;

select * from finish();
rollback;
