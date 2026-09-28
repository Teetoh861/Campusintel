-- Storage and ownership only. Fixtures use the database owner, never a
-- browser-writable path. Role/JWT simulation follows profiles_rls.test.sql.
begin;
select no_plan();

select has_table('public', 'quiz_attempts', 'attempt storage exists');
select has_table('public', 'quiz_attempt_answers', 'answer storage exists');
select columns_are('public', 'quiz_attempts', array[
  'id', 'user_id', 'course_id', 'question_count', 'status', 'revision',
  'created_at', 'updated_at', 'finished_at'
], 'attempts contain exactly the required columns');
select columns_are('public', 'quiz_attempt_answers', array[
  'attempt_id', 'question_id', 'ordinal', 'option_index', 'is_correct',
  'section_label', 'answered_at'
], 'answers contain exactly the required columns');

select is(
  (select array_agg(column_name || ':' || data_type || ':' || is_nullable
                   order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'quiz_attempts'),
  array[
    'id:uuid:NO', 'user_id:uuid:NO', 'course_id:uuid:NO',
    'question_count:integer:NO', 'status:text:NO', 'revision:integer:NO',
    'created_at:timestamp with time zone:NO',
    'updated_at:timestamp with time zone:NO',
    'finished_at:timestamp with time zone:YES'
  ]::text[],
  'attempt column types and nullability match the contract'
);
select is(
  (select array_agg(column_name || ':' || data_type || ':' || is_nullable
                   order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'quiz_attempt_answers'),
  array[
    'attempt_id:uuid:NO', 'question_id:uuid:NO', 'ordinal:integer:NO',
    'option_index:integer:NO', 'is_correct:boolean:NO', 'section_label:text:NO',
    'answered_at:timestamp with time zone:NO'
  ]::text[],
  'answer column types and nullability match the contract'
);
select is(
  (select jsonb_object_agg(column_name, column_default)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'quiz_attempts'
     and column_default is not null),
  jsonb_build_object('status', '''in_progress''::text', 'revision', '0',
                    'created_at', 'now()', 'updated_at', 'now()'),
  'only status, revision and server timestamps have attempt defaults'
);
select is(
  (select jsonb_object_agg(column_name, column_default)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'quiz_attempt_answers'
     and column_default is not null),
  jsonb_build_object('answered_at', 'now()'),
  'only the server answer timestamp has an answer default'
);
select is(
  (select array_agg(conname::text order by conname) from pg_constraint
   where conrelid = 'public.quiz_attempts'::regclass),
  array[
    'quiz_attempts_course_id_fkey', 'quiz_attempts_finished_at_order_check',
    'quiz_attempts_finished_at_status_check', 'quiz_attempts_pkey',
    'quiz_attempts_question_count_check', 'quiz_attempts_revision_check',
    'quiz_attempts_status_check', 'quiz_attempts_user_id_fkey'
  ]::text[],
  'all required attempt keys and checks exist'
);
select is(
  (select array_agg(conname::text order by conname) from pg_constraint
   where conrelid = 'public.quiz_attempt_answers'::regclass),
  array[
    'quiz_attempt_answers_attempt_id_fkey',
    'quiz_attempt_answers_attempt_ordinal_unique',
    'quiz_attempt_answers_option_index_check',
    'quiz_attempt_answers_ordinal_check', 'quiz_attempt_answers_pkey'
  ]::text[],
  'all required answer keys and checks exist'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.quiz_attempts'::regclass and contype = 'p'),
  'PRIMARY KEY (id)', 'attempt ID is the primary key'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.quiz_attempt_answers'::regclass and contype = 'p'),
  'PRIMARY KEY (attempt_id, question_id)', 'answers are keyed by immutable question ID'
);
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.quiz_attempt_answers'::regclass and contype = 'u'),
  'UNIQUE (attempt_id, ordinal)', 'attempt positions are unique within an attempt'
);
select ok(
  (select confrelid = 'auth.users'::regclass and confdeltype = 'c'
   from pg_constraint where conrelid = 'public.quiz_attempts'::regclass
     and conname = 'quiz_attempts_user_id_fkey'),
  'attempt owner references auth.users with delete cascade'
);
select ok(
  (select confrelid = 'public.courses'::regclass and confdeltype = 'r'
   from pg_constraint where conrelid = 'public.quiz_attempts'::regclass
     and conname = 'quiz_attempts_course_id_fkey'),
  'attempt course references the course registry with delete restrict'
);
select ok(
  (select confrelid = 'public.quiz_attempts'::regclass and confdeltype = 'c'
   from pg_constraint where conrelid = 'public.quiz_attempt_answers'::regclass
     and conname = 'quiz_attempt_answers_attempt_id_fkey'),
  'answers reference their attempt with delete cascade'
);
select is(
  (select indexdef from pg_indexes where schemaname = 'public'
     and indexname = 'quiz_attempts_user_created_idx'),
  'CREATE INDEX quiz_attempts_user_created_idx ON public.quiz_attempts USING btree (user_id, created_at DESC, id)',
  'owner history index has the required keys and descending timestamp'
);
select is(
  (select indexdef from pg_indexes where schemaname = 'public'
     and indexname = 'quiz_attempts_user_course_created_idx'),
  'CREATE INDEX quiz_attempts_user_course_created_idx ON public.quiz_attempts USING btree (user_id, course_id, created_at DESC, id)',
  'owner course history index has the required keys and descending timestamp'
);
select is(
  (select indexdef from pg_indexes where schemaname = 'public'
     and indexname = 'quiz_attempts_course_id_idx'),
  'CREATE INDEX quiz_attempts_course_id_idx ON public.quiz_attempts USING btree (course_id)',
  'course foreign key has a leading-course index'
);
select ok((select relrowsecurity from pg_class
           where oid = 'public.quiz_attempts'::regclass), 'attempt RLS is enabled');
select ok((select relrowsecurity from pg_class
           where oid = 'public.quiz_attempt_answers'::regclass), 'answer RLS is enabled');
select is(
  (select array_agg(tablename || ':' || cmd || ':' || roles::text order by tablename)
   from pg_policies where schemaname = 'public'
     and tablename in ('quiz_attempts', 'quiz_attempt_answers')),
  array['quiz_attempt_answers:SELECT:{authenticated}',
        'quiz_attempts:SELECT:{authenticated}']::text[],
  'each table has only one authenticated SELECT policy; no write or anon policies'
);
select ok(
  not exists (
    select 1 from pg_class
    cross join lateral aclexplode(relacl) acl
    where oid in ('public.quiz_attempts'::regclass,
                  'public.quiz_attempt_answers'::regclass)
      and acl.grantee = 0
  ), 'PUBLIC has no table privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.quiz_attempts', 'SELECT')
  and has_table_privilege('authenticated', 'public.quiz_attempt_answers', 'SELECT'),
  'authenticated has SELECT on both tables'
);
select ok(
  bool_and(not has_table_privilege(role_name, table_name, privilege_name)),
  role_name || ' has no direct mutation, truncate, reference or trigger privileges'
)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name)
cross join (values ('public.quiz_attempts'),
                   ('public.quiz_attempt_answers')) tables(table_name)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                   ('REFERENCES'), ('TRIGGER')) privileges(privilege_name)
group by role_name order by role_name;

-- Three confirmed accounts and an isolated course avoid dependence on seed
-- content or other catalogue foreign keys in the deletion restriction test.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'quiz-a@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'quiz-b@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'quiz-c@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.courses (id, content_key, is_shared)
values ('70000000-0000-4000-8000-000000000010', 'quiz-history-fixture', null);

insert into public.quiz_attempts (id, user_id, course_id, question_count) values
  ('80000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '70000000-0000-4000-8000-000000000010', 2),
  ('80000000-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111',
   '70000000-0000-4000-8000-000000000010', 1);
insert into public.quiz_attempts
  (id, user_id, course_id, question_count, status, created_at, finished_at) values
  ('80000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
   '70000000-0000-4000-8000-000000000010', 1, 'submitted', now() - interval '1 day', now()),
  ('80000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   '70000000-0000-4000-8000-000000000010', 1, 'timed_out', now() - interval '1 day', now());
insert into public.quiz_attempt_answers
  (attempt_id, question_id, ordinal, option_index, is_correct, section_label) values
  ('80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 0, 0, true, 'Accounting'),
  ('80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000002', 1, 7, false, 'Accounting'),
  ('80000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', 0, 1, false, 'Accounting'),
  ('80000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000001', 0, 0, true, 'Accounting'),
  ('80000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000001', 0, 0, true, 'Accounting');

select ok(
  (select status = 'in_progress' and revision = 0 and finished_at is null
          and created_at = now() and updated_at = now()
   from public.quiz_attempts where id = '80000000-0000-4000-8000-000000000001'),
  'new attempts use the required initial state and server timestamp defaults'
);
select ok((select bool_and(answered_at = now()) from public.quiz_attempt_answers),
          'answers receive server timestamps by default');
select is((select option_index from public.quiz_attempt_answers
           where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 1),
          7, 'option indices are not capped at a fixed option count');
select is((select count(*)::int from public.quiz_attempt_answers
           where question_id = '90000000-0000-4000-8000-000000000001'),
          4, 'the same immutable question may appear in different attempts');

select throws_ok($$insert into public.quiz_attempts (user_id, course_id, question_count)
  values ('11111111-1111-4111-8111-111111111111', '70000000-0000-4000-8000-000000000010', 1)$$,
  '23502', null, 'attempt ID must be supplied; no generated default exists');
select throws_ok($$update public.quiz_attempts set user_id = '55555555-5555-4555-8555-555555555555'
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'attempts require an existing auth account');
select throws_ok($$update public.quiz_attempts set course_id = '70000000-0000-4000-8000-000000000099'
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23503', null, 'attempts require an existing repository course identity');
select throws_ok($$insert into public.quiz_attempt_answers
  (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
  values ('80000000-0000-4000-8000-000000000099', '90000000-0000-4000-8000-000000000003', 0, 0, true, 'Accounting')$$,
  '23503', null, 'answers require an existing attempt');
select throws_ok($$insert into public.quiz_attempt_answers
  (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
  values ('80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 2, 0, true, 'Accounting')$$,
  '23505', null, 'a duplicate question within an attempt is rejected');
select throws_ok($$insert into public.quiz_attempt_answers
  (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
  values ('80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', 0, 0, true, 'Accounting')$$,
  '23505', null, 'a duplicate ordinal within an attempt is rejected');
select throws_ok($$update public.quiz_attempts set question_count = 0
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'zero question count is rejected');
select throws_ok($$update public.quiz_attempts set question_count = -1
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'negative question count is rejected');
select throws_ok($$update public.quiz_attempts set revision = -1
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'negative revision is rejected');
select throws_ok($$update public.quiz_attempts set status = 'abandoned'
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'unsupported status is rejected');
select throws_ok($$update public.quiz_attempts set status = 'submitted'
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'submitted requires finished_at');
select throws_ok($$update public.quiz_attempts set status = 'timed_out'
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'timed_out requires finished_at');
select throws_ok($$update public.quiz_attempts set finished_at = now()
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'in_progress forbids finished_at');
select throws_ok($$update public.quiz_attempts set finished_at = created_at - interval '1 second'
  where id = '80000000-0000-4000-8000-000000000002'$$,
  '23514', null, 'finished_at cannot precede created_at');
select lives_ok($$update public.quiz_attempts set finished_at = created_at
  where id = '80000000-0000-4000-8000-000000000002'$$,
  'finished_at may equal created_at');
select throws_ok($$update public.quiz_attempt_answers set ordinal = -1
  where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 0$$,
  '23514', null, 'negative ordinal is rejected');
select throws_ok($$update public.quiz_attempt_answers set option_index = -1
  where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 0$$,
  '23514', null, 'negative option index is rejected');
update public.quiz_attempts set updated_at = timestamptz '2000-01-01 00:00:00+00'
where id = '80000000-0000-4000-8000-000000000001';
select is((select updated_at from public.quiz_attempts
           where id = '80000000-0000-4000-8000-000000000001'),
          now(), 'the existing internal trigger maintains updated_at');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.quiz_attempts
           where id = '80000000-0000-4000-8000-000000000001'),
          1, 'owner A can read their attempt');
select is((select count(*)::int from public.quiz_attempt_answers
           where attempt_id = '80000000-0000-4000-8000-000000000001'),
          2, 'owner A can read their answer children');
select is((select count(*)::int from public.quiz_attempts),
          2, 'A sees only their two attempts');
select is((select count(*)::int from public.quiz_attempt_answers),
          3, 'A sees only the children of their two attempts');
select throws_ok($$insert into public.quiz_attempts (id, user_id, course_id, question_count)
  values ('80000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '70000000-0000-4000-8000-000000000010', 1)$$,
  '42501', null, 'authenticated cannot directly INSERT an otherwise valid own attempt');
select throws_ok($$update public.quiz_attempts set revision = revision + 1
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot directly UPDATE an own attempt');
select throws_ok($$delete from public.quiz_attempts
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated cannot directly DELETE an own attempt');
select throws_ok($$insert into public.quiz_attempt_answers
  (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
  values ('80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', 2, 0, true, 'Accounting')$$,
  '42501', null, 'authenticated cannot directly INSERT an otherwise valid own answer');
select throws_ok($$update public.quiz_attempt_answers set option_index = 1
  where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 0$$,
  '42501', null, 'authenticated cannot directly UPDATE an own answer');
select throws_ok($$delete from public.quiz_attempt_answers
  where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 0$$,
  '42501', null, 'authenticated cannot directly DELETE an own answer');

set local request.jwt.claims =
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.quiz_attempts
           where id = '80000000-0000-4000-8000-000000000001'),
          0, 'B cannot read A''s attempt');
select is((select count(*)::int from public.quiz_attempt_answers
           where attempt_id = '80000000-0000-4000-8000-000000000001'),
          0, 'B cannot read A''s answer children');
select is((select count(*)::int from public.quiz_attempts),
          1, 'B sees only their own attempt');
select is((select count(*)::int from public.quiz_attempt_answers),
          1, 'B sees only their own answer');
set local request.jwt.claims = '{"role":"authenticated"}';
select is((select count(*)::int from public.quiz_attempts),
          0, 'authenticated without a user identity sees no attempts');
select is((select count(*)::int from public.quiz_attempt_answers),
          0, 'authenticated without a user identity sees no answers');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.quiz_attempts$$,
  '42501', null, 'anon cannot read attempts');
select throws_ok($$select * from public.quiz_attempt_answers$$,
  '42501', null, 'anon cannot read answers');

reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select * from public.quiz_attempts$$,
  '42501', null, 'service_role cannot directly read attempts despite its RLS bypass');
select throws_ok($$select * from public.quiz_attempt_answers$$,
  '42501', null, 'service_role cannot directly read answers despite its RLS bypass');
select throws_ok($$insert into public.quiz_attempts (id, user_id, course_id, question_count)
  values ('80000000-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111', '70000000-0000-4000-8000-000000000010', 1)$$,
  '42501', null, 'service_role cannot directly INSERT attempts');
select throws_ok($$update public.quiz_attempts set revision = revision + 1
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'service_role cannot directly UPDATE attempts');
select throws_ok($$delete from public.quiz_attempts
  where id = '80000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'service_role cannot directly DELETE attempts');
select throws_ok($$insert into public.quiz_attempt_answers
  (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
  values ('80000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003', 2, 0, true, 'Accounting')$$,
  '42501', null, 'service_role cannot directly INSERT answers');
select throws_ok($$update public.quiz_attempt_answers set option_index = 1
  where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 0$$,
  '42501', null, 'service_role cannot directly UPDATE answers');
select throws_ok($$delete from public.quiz_attempt_answers
  where attempt_id = '80000000-0000-4000-8000-000000000001' and ordinal = 0$$,
  '42501', null, 'service_role cannot directly DELETE answers');

reset role;
select throws_ok($$delete from public.courses
  where id = '70000000-0000-4000-8000-000000000010'$$,
  '23503', null, 'a course referenced only by quiz history cannot be deleted');
select is((select count(*)::int from public.quiz_attempt_answers
           where attempt_id = '80000000-0000-4000-8000-000000000004'),
          1, 'attempt deletion fixture has an answer before deletion');
delete from public.quiz_attempts where id = '80000000-0000-4000-8000-000000000004';
select is((select count(*)::int from public.quiz_attempt_answers
           where attempt_id = '80000000-0000-4000-8000-000000000004'),
          0, 'deleting an attempt removes its answer children');
select is((select count(*)::int from public.quiz_attempts
           where user_id = '33333333-3333-4333-8333-333333333333'),
          1, 'user deletion fixture has an attempt before deletion');
delete from auth.users where id = '33333333-3333-4333-8333-333333333333';
select is((select count(*)::int from public.quiz_attempts
           where user_id = '33333333-3333-4333-8333-333333333333'),
          0, 'deleting a user removes their attempts');
select is((select count(*)::int from public.quiz_attempt_answers
           where attempt_id = '80000000-0000-4000-8000-000000000003'),
          0, 'deleting a user also removes the attempts'' answer children');
select is((select count(*)::int from public.quiz_attempts),
          2, 'deletion cascades preserve other users'' attempts');
select is((select count(*)::int from public.quiz_attempt_answers),
          3, 'deletion cascades preserve other attempts'' answers');

select * from finish();
rollback;
