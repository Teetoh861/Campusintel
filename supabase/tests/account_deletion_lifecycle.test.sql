begin;
select no_plan();

select ok(not has_table_privilege('authenticated', 'private.account_deletion_jobs', 'SELECT'), 'jobs are never student-readable');
select ok(not has_table_privilege('service_role', 'private.account_deletion_jobs', 'DELETE'), 'service has narrow RPCs, no job table writes');
select ok(not has_function_privilege('authenticated', 'public.schedule_student_deletion(uuid,uuid)', 'EXECUTE'), 'student cannot bypass password verification via schedule RPC');
select ok(not has_function_privilege('anon', 'public.cancel_student_deletion(uuid)', 'EXECUTE'), 'anonymous cannot restore');
select ok(not has_function_privilege('authenticated', 'public.run_account_deletion_jobs(integer)', 'EXECUTE'), 'student cannot purge');
select ok(not has_table_privilege('authenticated', 'private.account_deletion_worker_health', 'UPDATE'), 'student cannot forge worker health');
select ok(not has_function_privilege('authenticated', 'private.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)', 'EXECUTE'), 'old scoring implementation is private and uncallable');
select is((select count(*)::integer from pg_policies where schemaname = 'public'
  and policyname like 'Scheduled accounts cannot read%' and permissive = 'RESTRICTIVE'), 6, 'all authenticated catalogues have lifecycle restrictions');
select is((select count(*)::integer from cron.job where jobname like '%account-deletion%'), 0, 'migration activates no deletion schedule');

insert into auth.users(id, email_confirmed_at) values
  ('a1000000-0000-4000-8000-000000000001', now()),
  ('a1000000-0000-4000-8000-000000000002', now()),
  ('a1000000-0000-4000-8000-000000000003', now());
update public.profiles set role = 'operator' where id = 'a1000000-0000-4000-8000-000000000003';
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('a2000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', now(), now()),
  ('a2000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', now(), now()),
  ('a2000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000002', now(), now()),
  ('a2000000-0000-4000-8000-000000000004', 'a1000000-0000-4000-8000-000000000003', now(), now()),
  ('a2000000-0000-4000-8000-000000000005', 'a1000000-0000-4000-8000-000000000003', now(), now());
insert into public.student_bookmarks(user_id, course_id) values
  ('a1000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001');
select public.issue_recovery_grant(repeat('1',64), 'a1000000-0000-4000-8000-000000000001', repeat('2',64));

set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select is(public.read_account_lifecycle()->>'status', 'active', 'live student starts active');
select throws_ok($$ select public.schedule_student_deletion('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'authenticated scheduling bypass denied');
reset role;
set local role service_role;
select is(public.consume_auth_rate_limit('ACCOUNT_DELETION',repeat('7',64),repeat('8',64),5,900,20,900), true, 'deletion rate policy exists in the database');
select throws_ok($$ select public.consume_auth_rate_limit('ACCOUNT_DELETION',repeat('7',64),repeat('8',64),500,900,20,900) $$,
  '22023', null, 'caller cannot weaken the deletion rate policy');
select throws_ok($$ select public.schedule_student_deletion('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'existing login is not a new password verification');
select throws_ok($$ select public.schedule_student_deletion('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'proof from another student cannot schedule');
select is(public.schedule_student_deletion('a2000000-0000-4000-8000-000000000004','a2000000-0000-4000-8000-000000000005')->>'status',
  'operator-excluded', 'operator is excluded from ordinary deletion');
select is(public.schedule_student_deletion('a2000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002')->>'status',
  'scheduled', 'password-bound server scheduling succeeds');
reset role;
select is((select count(*)::integer from auth.sessions where user_id = 'a1000000-0000-4000-8000-000000000001'), 0, 'every device and proof session revoked atomically');
select is((select count(*)::integer from public.auth_recovery_grants where user_id = 'a1000000-0000-4000-8000-000000000001'), 0, 'outstanding recovery authorization invalidated');
select ok((select deadline = requested_at + interval '720 hours' and requested_at between statement_timestamp() - interval '5 seconds' and clock_timestamp()
  from private.account_deletion_jobs where user_id = 'a1000000-0000-4000-8000-000000000001'), '30-day deadline uses database time');
create temporary table original_deletion as select id, deadline from private.account_deletion_jobs where user_id = 'a1000000-0000-4000-8000-000000000001';
grant select on original_deletion to authenticated;

set local role authenticated;
select is(public.read_account_lifecycle()->>'status', 'signed-out', 'retained JWT is not a live session');
select is((select count(*)::integer from public.profiles), 0, 'retained JWT cannot read profile');
reset role;
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('a2000000-0000-4000-8000-000000000006', 'a1000000-0000-4000-8000-000000000001', now(), now()),
  ('a2000000-0000-4000-8000-000000000007', 'a1000000-0000-4000-8000-000000000001', now(), now());
set local role service_role;
select is(public.schedule_student_deletion('a2000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000007')->>'status', 'scheduled', 'retry reuses the existing request');
reset role;
select ok((select j.deadline = o.deadline and j.id = o.id from private.account_deletion_jobs j cross join original_deletion o
  where j.user_id = 'a1000000-0000-4000-8000-000000000001'), 'repeated scheduling never extends deadline or replaces job identity');
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('a2000000-0000-4000-8000-000000000008', 'a1000000-0000-4000-8000-000000000001', now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000008"}';
select is(public.read_account_lifecycle()->>'status', 'scheduled', 'later login exposes only the decision state');
select is(public.read_account_lifecycle()->>'status', 'scheduled', 'reading and login never cancel');
select is((select count(*)::integer from public.profiles), 0, 'scheduled live session cannot read profile');
select is((select count(*)::integer from public.student_bookmarks), 0, 'scheduled live session cannot read bookmarks');
select is((select count(*)::integer from public.quiz_attempts), 0, 'scheduled live session cannot read attempts');
select is((select count(*)::integer from public.departments), 0, 'scheduled session cannot read reference catalogue');
select is((select count(*)::integer from public.courses), 0, 'scheduled session cannot read course catalogue');
select is((select count(*)::integer from public.institutional_courses), 0, 'scheduled session cannot read institutional catalogue');
select throws_ok($$ select public.reconcile_student_bookmarks(gen_random_uuid(), '{}'::uuid[]) $$, '42501', null, 'bookmark definer RPC bypass denied');
select throws_ok($$ select public.read_published_managed_content('40000000-0000-4000-8000-000000000001') $$, '42501', null, 'published content RPC bypass denied');
select throws_ok($$ select public.submit_question_report(null,null,null) $$, '42501', null, 'report RPC bypass denied before payload work');
select throws_ok($$ insert into public.student_bookmarks(user_id,course_id) values
  ('a1000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002') $$, '42501', null, 'direct bookmark mutation bypass denied');
select is(public.cancel_student_deletion('a3000000-0000-4000-8000-000000000001')->>'status', 'conflict', 'stale request id cannot cancel');
reset role;
set local role service_role;
select is(public.write_quiz_attempt('a2000000-0000-4000-8000-000000000008',gen_random_uuid(),null,0,'finish',0,'submitted','[]')->>'status',
  'signed-out', 'service attempt writer also denies a scheduled live session');
reset role;
set local role authenticated;
select is(public.cancel_student_deletion((select id from original_deletion))->>'status', 'active', 'explicit authorized Yes restores access');
select is(public.cancel_student_deletion((select id from original_deletion))->>'status', 'active', 'cancellation retry is harmless');
select is((select count(*)::integer from public.profiles), 1, 'normal profile access restored');
select is((select count(*)::integer from public.student_bookmarks), 1, 'normal bookmark access restored');
reset role;

-- Expiry is enforced before purge, including already-issued recovery grants.
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at)
values ('a1000000-0000-4000-8000-000000000001', statement_timestamp() - interval '720 hours' + interval '1 hour',
  statement_timestamp() + interval '1 hour', statement_timestamp() + interval '1 hour');
select public.issue_recovery_grant(repeat('3',64), 'a1000000-0000-4000-8000-000000000001', repeat('4',64));
update private.account_deletion_jobs set requested_at = deadline - interval '720 hours' - interval '2 hours',
  deadline = deadline - interval '2 hours', retry_at = deadline - interval '2 hours';
set local role authenticated;
select is(public.read_account_lifecycle()->>'status', 'expired', 'deadline makes account expired before worker execution');
select is(public.cancel_student_deletion((public.read_account_lifecycle()->>'requestId')::uuid)->>'status', 'expired', 'late cancellation denied');
reset role;
select throws_ok($$ insert into auth.sessions(id,user_id) values(gen_random_uuid(),'a1000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'provider session creation denied at expiry');
select throws_ok($$ update auth.users set encrypted_password = 'expired-fixture' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'password replacement denied at expiry');
set local role service_role;
select throws_ok($$ select public.issue_recovery_grant(repeat('5',64),'a1000000-0000-4000-8000-000000000001',repeat('6',64)) $$,
  '42501', null, 'recovery issuance denied at expiry');
select is(public.consume_recovery_grant(repeat('3',64),repeat('4',64)), null, 'pre-expiry grant cannot recover after deadline');
select is((public.run_account_deletion_jobs()->>'completed')::integer, 1, 'due student is purged');
select is((public.run_account_deletion_jobs()->>'completed')::integer, 0, 'repeated purge is idempotent');
reset role;
select is((select count(*)::integer from auth.users where id = 'a1000000-0000-4000-8000-000000000001'), 0, 'student Auth identity removed');
select is((select count(*)::integer from private.account_deletion_jobs), 0, 'no identifying job receipt retained');
select is((select count(*)::integer from auth.users where id in ('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000003')), 2, 'other student and operator preserved');
select * from finish();
rollback;
