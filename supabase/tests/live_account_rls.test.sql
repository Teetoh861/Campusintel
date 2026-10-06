-- supabase/tests/live_account_rls.test.sql — Live-session RLS, ACL and revocation regressions.
-- Role/JWT simulation exercises the policies directly; every fixture rolls back.
begin;
select no_plan();

select ok((select prosecdef and provolatile = 's' and pronargs = 0
    and prorettype = 'boolean'::regtype and proconfig = array['search_path=""']
  from pg_proc where oid = 'private.has_live_account_session()'::regprocedure),
  'predicate is stable, SECURITY DEFINER, argless, boolean, with an empty search_path');
select ok(has_function_privilege('authenticated', 'private.has_live_account_session()', 'EXECUTE')
  and not has_function_privilege('anon', 'private.has_live_account_session()', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.has_live_account_session()', 'EXECUTE'),
  'only authenticated policy evaluation receives predicate EXECUTE');
select ok(not has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('anon', 'private', 'USAGE'),
  'private schema name resolution stays unavailable to browser roles');
select ok(not has_table_privilege('authenticated', 'auth.sessions', 'SELECT')
  and not has_table_privilege('anon', 'auth.sessions', 'SELECT'),
  'Auth session rows remain private');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_live_account_session'),
  'predicate has no public RPC alias');
select ok(not has_function_privilege('authenticated', 'private.require_live_account()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.require_live_operator()', 'EXECUTE'),
  'existing live-account/operator guard ACLs remain unchanged');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'live-rls-a@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'live-rls-b@example.test', 'x', now(),
   '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', now(), now(), null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', now(), now(), null),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111', now(), now(), now() - interval '1 second'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111', now(), now(), now() + interval '1 hour');
insert into public.student_bookmarks (user_id, course_id) values
  ('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000001'),
  ('22222222-2222-4222-8222-222222222222', '40000000-0000-4000-8000-000000000001');

-- Immutable revision fixtures use existing published content, without edits.
create temporary table live_rls_question on commit drop as
select id item_id, course_id, question_id, published_revision content_revision
from public.managed_content_items where kind = 'cbt_question' and published_revision is not null
order by id limit 1;
select is((select count(*)::int from live_rls_question), 1, 'published question fixture exists');
insert into public.quiz_attempts (id, user_id, course_id, question_count)
select v.attempt_id, v.user_id, q.course_id, 1 from live_rls_question q cross join (values
  ('80000000-0000-4000-8000-000000000001'::uuid, '11111111-1111-4111-8111-111111111111'::uuid),
  ('80000000-0000-4000-8000-000000000002'::uuid, '22222222-2222-4222-8222-222222222222'::uuid)
) v(attempt_id, user_id);
insert into public.quiz_attempt_answers (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
select a.id, q.question_id, 0, 0, false, 'Fixture'
from public.quiz_attempts a cross join live_rls_question q
where a.id in ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002');
insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
select a.id, q.question_id, 0, q.item_id, q.content_revision
from public.quiz_attempts a cross join live_rls_question q
where a.id in ('80000000-0000-4000-8000-000000000001', '80000000-0000-4000-8000-000000000002');

-- SECURITY INVOKER: these assertions run as authenticated, never as fixture owner.
create function pg_temp.assert_session_denied(label text) returns setof text
language plpgsql as $$
begin
  return query select is((select count(*)::int from public.profiles), 0, label || ': profiles hidden');
  return query select is((select count(*)::int from public.student_bookmarks), 0, label || ': bookmarks hidden');
  return query select is((select count(*)::int from public.quiz_attempts), 0, label || ': attempts hidden');
  return query select is((select count(*)::int from public.quiz_attempt_answers), 0, label || ': answers hidden');
  return query select is((select count(*)::int from public.quiz_attempt_questions), 0, label || ': snapshots hidden');
  return query with changed as (
    update public.profiles set
      department_id = (select id from public.departments where is_active order by sort_order limit 1),
      academic_level_id = (select id from public.academic_levels where is_active order by sort_order limit 1),
      academic_period_id = (select id from public.academic_periods where is_active order by sort_order limit 1)
    where id = '11111111-1111-4111-8111-111111111111' returning id
  ) select is((select count(*)::int from changed), 0, label || ': profile update affects zero rows');
  return query with removed as (
    delete from public.student_bookmarks where user_id = '11111111-1111-4111-8111-111111111111' returning user_id
  ) select is((select count(*)::int from removed), 0, label || ': bookmark delete affects zero rows');
  return query select throws_ok($sql$ insert into public.student_bookmarks (user_id, course_id)
    values ('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000002') $sql$,
    '42501', null, label || ': bookmark insert denied');
  return query select throws_ok($sql$ select public.reconcile_student_bookmarks(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', array['40000000-0000-4000-8000-000000000002']::uuid[]) $sql$,
    '42501', null, label || ': SECURITY DEFINER reconciliation denied');
end;
$$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select throws_ok($$ select private.has_live_account_session() $$, '42501', null,
  'authenticated cannot resolve the private helper by name');
select throws_ok($$ select id from auth.sessions $$, '42501', null,
  'authenticated cannot inspect Auth sessions');
select is((select count(*)::int from public.profiles), 1, 'live owner reads their profile through private predicate');
select is((select count(*)::int from public.student_bookmarks), 1, 'live owner reads only their bookmarks');
select is((select count(*)::int from public.quiz_attempts), 1, 'live owner reads only their attempt');
select is((select count(*)::int from public.quiz_attempt_answers), 1, 'live owner reads only their answers');
select is((select count(*)::int from public.quiz_attempt_questions), 1, 'live owner reads only their snapshot');
with changed as (
  update public.profiles set
    department_id = (select id from public.departments where is_active order by sort_order limit 1),
    academic_level_id = (select id from public.academic_levels where is_active order by sort_order limit 1),
    academic_period_id = (select id from public.academic_periods where is_active order by sort_order limit 1)
  where id = auth.uid() returning id
) select is((select count(*)::int from changed), 1, 'live owner can update a complete active selection');
select throws_ok($$ update public.profiles set role = 'operator' where id = auth.uid() $$,
  '42501', null, 'live owner still cannot self-promote');
select throws_ok($$ update public.profiles set id = '22222222-2222-4222-8222-222222222222' where id = auth.uid() $$,
  '42501', null, 'live owner still cannot change identity');
with changed as (
  update public.profiles set
    department_id = (select id from public.departments where is_active order by sort_order limit 1),
    academic_level_id = (select id from public.academic_levels where is_active order by sort_order limit 1),
    academic_period_id = (select id from public.academic_periods where is_active order by sort_order limit 1)
  where id = '22222222-2222-4222-8222-222222222222' returning id
) select is((select count(*)::int from changed), 0, 'live owner cannot update another profile');
select throws_ok($$ insert into public.student_bookmarks (user_id, course_id)
  values ('22222222-2222-4222-8222-222222222222', '40000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'live owner cannot insert another owner bookmark');
with removed as (
  delete from public.student_bookmarks where user_id = '22222222-2222-4222-8222-222222222222' returning user_id
) select is((select count(*)::int from removed), 0, 'live owner cannot delete another owner bookmark');
insert into public.student_bookmarks (user_id, course_id)
values ('11111111-1111-4111-8111-111111111111', '40000000-0000-4000-8000-000000000002');
with removed as (
  delete from public.student_bookmarks where user_id = auth.uid() and course_id = '40000000-0000-4000-8000-000000000002' returning user_id
) select is((select count(*)::int from removed), 1, 'live owner can add/remove their bookmark');
select is(public.reconcile_student_bookmarks('ffffffff-ffff-4fff-8fff-ffffffffffff', '{}'::uuid[]), true,
  'live owner can reconcile bookmarks');
select is(public.reconcile_student_bookmarks('ffffffff-ffff-4fff-8fff-ffffffffffff', '{}'::uuid[]), false,
  'live owner reconciliation remains idempotent');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"}';
select is((select count(*)::int from public.profiles), 1, 'future not_after permits owner access');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}';
select * from pg_temp.assert_session_denied('no matching session row');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';
select * from pg_temp.assert_session_denied('session belongs to another account');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}';
select * from pg_temp.assert_session_denied('expired not_after');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select * from pg_temp.assert_session_denied('missing session claim');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"not-a-uuid"}';
select * from pg_temp.assert_session_denied('malformed session claim');
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":""}';
select * from pg_temp.assert_session_denied('empty session claim');
set local request.jwt.claims = '{"role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select * from pg_temp.assert_session_denied('missing actor');

-- Reusing the same claims in a later statement cannot retain cached access.
reset role;
delete from auth.sessions where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select * from pg_temp.assert_session_denied('retained JWT after session deletion');
select throws_ok($$ select public.reconcile_student_bookmarks('ffffffff-ffff-4fff-8fff-ffffffffffff', '{}'::uuid[]) $$,
  '42501', null, 'revoked session cannot even replay its existing receipt');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}';
select is((select count(*)::int from public.profiles), 1, 'other live account remains functional');
select is((select count(*)::int from public.profiles where id = '11111111-1111-4111-8111-111111111111'), 0,
  'other live account still cannot cross the owner boundary');
reset role;
select is((select count(*)::int from public.student_bookmarks where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2, 'denied writes preserve both owner bookmarks');
select is((select count(*)::int from public.student_bookmark_reconciliations where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 1, 'denied reconciliation creates no receipts');
select is((select count(*)::int from public.profiles where role <> 'student' and id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 0, 'profile roles were never changed');
select * from finish();
rollback;
