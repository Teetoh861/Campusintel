-- supabase/tests/student_bookmarks.test.sql — Bookmark ownership, RLS, and receipt replay.
begin;
select no_plan();

select has_table('public', 'student_bookmarks', 'account bookmark table exists');
select columns_are('public', 'student_bookmarks',
  array['user_id', 'course_id', 'saved_at'], 'bookmark records have only stable owner/course keys and a server timestamp');
select ok((select relrowsecurity from pg_class where oid = 'public.student_bookmarks'::regclass),
  'RLS is enabled in the creating migration');
select is((select pg_get_constraintdef(oid) from pg_constraint
  where conrelid = 'public.student_bookmarks'::regclass and contype = 'p'),
  'PRIMARY KEY (user_id, course_id)', 'duplicate account/course bookmarks are impossible');
select ok((select confrelid = 'auth.users'::regclass and confdeltype = 'c'
  from pg_constraint where conrelid = 'public.student_bookmarks'::regclass
    and conname = 'student_bookmarks_user_id_fkey'), 'owner is the permanent Auth identity');
select ok((select confrelid = 'public.courses'::regclass and confdeltype = 'r'
  from pg_constraint where conrelid = 'public.student_bookmarks'::regclass
    and conname = 'student_bookmarks_course_id_fkey'), 'course is a stable platform identity');
select is((select array_agg(cmd order by cmd) from pg_policies
  where schemaname = 'public' and tablename = 'student_bookmarks'),
  array['DELETE', 'INSERT', 'SELECT']::text[], 'only owner read/add/remove policies exist');
select ok(not has_table_privilege('anon', 'public.student_bookmarks', 'SELECT')
  and not has_table_privilege('anon', 'public.student_bookmarks', 'INSERT')
  and not has_table_privilege('anon', 'public.student_bookmarks', 'DELETE')
  and not has_table_privilege('authenticated', 'public.student_bookmarks', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.student_bookmarks', 'TRUNCATE'),
  'anonymous access and direct updates are unavailable');
select ok(not has_column_privilege('authenticated', 'public.student_bookmarks', 'saved_at', 'INSERT'),
  'browser-facing roles cannot supply saved_at');
select has_table('public', 'student_bookmark_reconciliations', 'durable import receipts exist');
select ok((select relrowsecurity from pg_class
  where oid = 'public.student_bookmark_reconciliations'::regclass),
  'receipt table has deny-by-default RLS');
select ok(not has_table_privilege('anon', 'public.student_bookmark_reconciliations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.student_bookmark_reconciliations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.student_bookmark_reconciliations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.student_bookmark_reconciliations', 'DELETE'),
  'browser-facing roles cannot read, preclaim, or erase import receipts');
select ok(has_function_privilege('authenticated',
  'public.reconcile_student_bookmarks(uuid,uuid[])', 'EXECUTE')
  and not has_function_privilege('anon',
  'public.reconcile_student_bookmarks(uuid,uuid[])', 'EXECUTE'),
  'only authenticated callers can invoke the narrow reconciliation function');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'bookmarks-a@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'bookmarks-b@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());

-- Model the live Auth sessions carried by legitimate browser JWTs.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', now(), now());

set local role anon;
select throws_ok($$ select count(*) from public.student_bookmarks $$, '42501', null,
  'anonymous users cannot read account bookmarks');
select throws_ok($$ insert into public.student_bookmarks (user_id, course_id)
  values ('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anonymous users cannot add account bookmarks');
select throws_ok($$ select public.reconcile_student_bookmarks(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['40000000-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', null, 'anonymous users cannot apply a reconciliation');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
insert into public.student_bookmarks (user_id, course_id)
values ('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000001');
insert into public.student_bookmarks (user_id, course_id)
values ('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000001')
on conflict do nothing;
select is((select count(*)::int from public.student_bookmarks), 1,
  'owner reads one bookmark after duplicate-safe creation');
select ok((select saved_at is not null from public.student_bookmarks
  where user_id = auth.uid()), 'bookmark timestamp is database-owned');
select throws_ok($$ insert into public.student_bookmarks (user_id, course_id)
  values ('22222222-2222-4222-8222-222222222222', '40000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'forged owner cannot add to another account');
select throws_ok($$ insert into public.student_bookmarks (user_id, course_id)
  values ('11111111-1111-4111-8111-111111111111', '90000000-0000-4000-8000-000000000001') $$,
  '23503', null, 'invalid course UUID cannot create a bookmark');
select throws_ok($$ update public.student_bookmarks set saved_at = now() $$,
  '42501', null, 'authenticated users cannot update bookmark rows');
select throws_ok($$ insert into public.student_bookmark_reconciliations
  (user_id, reconciliation_id, course_ids) values
  ('11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{}'::uuid[]) $$,
  '42501', null, 'authenticated users cannot forge an applied receipt');
select is(public.reconcile_student_bookmarks(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['40000000-0000-4000-8000-000000000002']::uuid[]), true,
  'first reconciliation atomically applies an import');
select is((select count(*)::int from public.student_bookmarks
  where course_id = '40000000-0000-4000-8000-000000000002'), 1,
  'the imported bookmark is durable');
delete from public.student_bookmarks
  where user_id = auth.uid() and course_id = '40000000-0000-4000-8000-000000000002';
select is(public.reconcile_student_bookmarks(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['40000000-0000-4000-8000-000000000002']::uuid[]), false,
  'a lost acknowledgement is recognized as already applied');
select is((select count(*)::int from public.student_bookmarks
  where course_id = '40000000-0000-4000-8000-000000000002'), 0,
  'replay does not resurrect a bookmark deleted on another device');
select throws_ok($$ select public.reconcile_student_bookmarks(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['40000000-0000-4000-8000-000000000001']::uuid[]) $$,
  '22023', null, 'a replay cannot change the import payload');
select throws_ok($$ select public.reconcile_student_bookmarks(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['90000000-0000-4000-8000-000000000001']::uuid[]) $$,
  '23503', null, 'a failed bookmark insert rolls back its receipt');
select is(public.reconcile_student_bookmarks(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  array['40000000-0000-4000-8000-000000000002']::uuid[]), true,
  'a genuinely unapplied import can retry with the same identity');
delete from public.student_bookmarks
  where user_id = auth.uid() and course_id = '40000000-0000-4000-8000-000000000002';
reset role;

-- More built courses than one reconciliation call may carry. The account
-- itself has no ceiling: each bounded receipt adds its own fixed slice.
insert into public.courses (id, content_key, is_shared)
select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'bookmark-scale-' || n, false
from generate_series(1, 40) as n;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select throws_ok($$ select public.reconcile_student_bookmarks(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  array(select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
    from generate_series(1, 33) as n)) $$,
  '22023', null, 'one call is bounded against oversized requests');
select is(public.reconcile_student_bookmarks(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  array(select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
    from generate_series(1, 32) as n)), true,
  'a full first receipt applies');
select is(public.reconcile_student_bookmarks(
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  array(select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
    from generate_series(33, 40) as n)), true,
  'a second receipt applies the remaining courses');
select is((select count(*)::int from public.student_bookmarks
  where course_id::text like '50000000-%'), 40,
  'one account holds more bookmarks than one reconciliation call carries');
select is(public.reconcile_student_bookmarks(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  array(select ('50000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
    from generate_series(1, 32) as n)), false,
  'an earlier receipt still replays without reapplying');
delete from public.student_bookmarks
  where user_id = auth.uid() and course_id::text like '50000000-%';
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';
select is((select count(*)::int from public.student_bookmarks), 0,
  'another account cannot read the first owner bookmark');
select is(public.reconcile_student_bookmarks(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  array['40000000-0000-4000-8000-000000000001']::uuid[]), true,
  'another owner cannot consume the first account reconciliation identity');
delete from public.student_bookmarks
  where user_id = auth.uid() and course_id = '40000000-0000-4000-8000-000000000001';
delete from public.student_bookmarks
where user_id = '11111111-1111-4111-8111-111111111111';
insert into public.student_bookmarks (user_id, course_id)
values ('22222222-2222-4222-8222-222222222222', '40000000-0000-4000-8000-000000000002');
select is((select count(*)::int from public.student_bookmarks), 1,
  'second account can add and read only its own bookmark');
reset role;

select is((select count(*)::int from public.student_bookmarks), 2,
  'cross-account delete did not affect the first owner');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
delete from public.student_bookmarks
where user_id = '11111111-1111-4111-8111-111111111111';
select is((select count(*)::int from public.student_bookmarks), 0,
  'the first owner can remove its own bookmark and cannot see the second account');
reset role;

select is((select count(*)::int from public.student_bookmarks), 1,
  'removing one account bookmark preserves the other account');

select * from finish();
rollback;
