begin;
select no_plan();
insert into auth.users(id, email_confirmed_at) values
  ('b1000000-0000-4000-8000-000000000001', now()),
  ('b1000000-0000-4000-8000-000000000002', now()),
  ('b1000000-0000-4000-8000-000000000003', now());
update public.profiles set role = 'operator' where id = 'b1000000-0000-4000-8000-000000000003';

create temporary table deletion_content_snapshot as
select (select count(*) from public.managed_content_items) items,
  (select count(*) from public.managed_content_revisions) revisions,
  (select count(*) from public.managed_content_reviews) reviews,
  (select count(*) from public.managed_content_publications) publications,
  (select md5(string_agg(question_id::text, ',' order by question_id)) from public.managed_content_items) identities;
create temporary table deletion_question as select id item_id, course_id, question_id, published_revision revision
  from public.managed_content_items where kind = 'cbt_question' and published_revision is not null order by id limit 1;
select is((select count(*)::integer from deletion_question), 1, 'immutable published question fixture exists');
insert into public.quiz_attempts(id,user_id,course_id,question_count)
select v.id,v.actor,q.course_id,1 from deletion_question q cross join (values
  ('b2000000-0000-4000-8000-000000000001'::uuid,'b1000000-0000-4000-8000-000000000001'::uuid),
  ('b2000000-0000-4000-8000-000000000002'::uuid,'b1000000-0000-4000-8000-000000000002'::uuid)
) v(id,actor);
insert into public.quiz_attempt_questions(attempt_id,question_id,ordinal,item_id,content_revision)
select a.id,q.question_id,0,q.item_id,q.revision from public.quiz_attempts a cross join deletion_question q
  where a.id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
insert into public.quiz_attempt_answers(attempt_id,question_id,ordinal,option_index,is_correct,section_label)
select a.id,q.question_id,0,0,false,'Fixture' from public.quiz_attempts a cross join deletion_question q
  where a.id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
insert into public.question_reports(reporter_id,course_id,item_id,content_revision,kind,question_id,attempt_id,note)
select a.user_id,q.course_id,q.item_id,q.revision,'cbt_question',q.question_id,a.id,'Identifying student fixture note'
  from public.quiz_attempts a cross join deletion_question q
  where a.id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
update public.question_reports set status = 'resolved', reviewed_by = 'b1000000-0000-4000-8000-000000000003', reviewed_at = clock_timestamp()
  where reporter_id = 'b1000000-0000-4000-8000-000000000002';
insert into public.student_bookmarks(user_id,course_id) values ('b1000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001');
insert into public.student_bookmark_reconciliations(user_id,reconciliation_id,course_ids)
  values ('b1000000-0000-4000-8000-000000000001',gen_random_uuid(),'{}');
insert into public.auth_recovery_grants values (repeat('a',64),'b1000000-0000-4000-8000-000000000001',repeat('b',64),now(),now()+interval '10 minutes');
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at) values
  ('b1000000-0000-4000-8000-000000000001',statement_timestamp()-interval '746 hours',statement_timestamp()-interval '26 hours',statement_timestamp()-interval '26 hours');

-- Inject a late failure, after report deletion, to prove per-account rollback.
create function pg_temp.fail_deletion_fixture() returns trigger language plpgsql as $$
begin raise exception 'Sensitive identifying failure fixture'; end; $$;
create trigger fail_deletion_fixture before delete on public.profiles
  for each row execute function pg_temp.fail_deletion_fixture();
set local role service_role;
select is((public.account_deletion_monitor()->>'overdue')::integer, 1, 'monitor identifies requests pending 24h after deadline');
select is((public.run_account_deletion_jobs()->>'failedThisRun')::integer, 1, 'failed purge is recorded without losing the request');
reset role;
select is((select attempts from private.account_deletion_jobs where user_id = 'b1000000-0000-4000-8000-000000000001'), 1, 'failure advances attempt counter');
select is((select last_error_code from private.account_deletion_jobs where user_id = 'b1000000-0000-4000-8000-000000000001'), 'P0001', 'only SQLSTATE retained, no identifying exception message');
select ok((select retry_at > clock_timestamp() and retry_at <= clock_timestamp()+interval '61 seconds' and escalated_at is not null
  from private.account_deletion_jobs where user_id = 'b1000000-0000-4000-8000-000000000001'), 'bounded retry backoff and durable overdue escalation set');
select is((select count(*)::integer from auth.users where id = 'b1000000-0000-4000-8000-000000000001'), 1, 'late failure rolls back Auth deletion');
select is((select count(*)::integer from public.question_reports where reporter_id = 'b1000000-0000-4000-8000-000000000001'), 1, 'late failure rolls back earlier report deletion');
select is((select count(*)::integer from public.quiz_attempt_answers where attempt_id = 'b2000000-0000-4000-8000-000000000001'), 1, 'late failure rolls back attempt cascade');
set local role service_role;
select is((public.run_account_deletion_jobs()->>'failedThisRun')::integer, 0, 'immediate retry honors backoff');
reset role;
drop trigger fail_deletion_fixture on public.profiles;
update private.account_deletion_jobs set retry_at = clock_timestamp() - interval '1 second';
set local role service_role;
select is((public.run_account_deletion_jobs()->>'completed')::integer, 1, 'retry recovers after the underlying failure is fixed');
select is((public.run_account_deletion_jobs()->>'completed')::integer, 0, 'repeated worker execution changes nothing');
select is((public.account_deletion_monitor()->>'overdue')::integer, 0, 'resolved job leaves the overdue queue');
reset role;
select is((select count(*)::integer from public.question_reports where reporter_id = 'b1000000-0000-4000-8000-000000000001'), 0, 'identifying report note, identity and attempt link removed');
select is((select count(*)::integer from public.quiz_attempts where user_id = 'b1000000-0000-4000-8000-000000000001'), 0, 'deleted student attempt history removed');
select is((select count(*)::integer from public.quiz_attempt_questions where attempt_id = 'b2000000-0000-4000-8000-000000000001'), 0, 'deleted student snapshots removed');
select is((select count(*)::integer from public.student_bookmarks where user_id = 'b1000000-0000-4000-8000-000000000001'), 0, 'deleted student bookmarks removed');
select is((select count(*)::integer from public.student_bookmark_reconciliations where user_id = 'b1000000-0000-4000-8000-000000000001'), 0, 'deleted student import receipts removed');
select is((select count(*)::integer from public.auth_recovery_grants where user_id = 'b1000000-0000-4000-8000-000000000001'), 0, 'deleted student recovery records removed');
select is((select count(*)::integer from public.quiz_attempt_questions where attempt_id = 'b2000000-0000-4000-8000-000000000002'), 1, 'other student historical attempt snapshot preserved');
select is((select count(*)::integer from public.quiz_attempt_answers where attempt_id = 'b2000000-0000-4000-8000-000000000002'), 1, 'other student historical answers preserved');
select is((select count(*)::integer from public.question_reports where reporter_id = 'b1000000-0000-4000-8000-000000000002' and reviewed_by = 'b1000000-0000-4000-8000-000000000003'), 1, 'unrelated governed operator review preserved');
select ok((select s.items = (select count(*) from public.managed_content_items)
  and s.revisions = (select count(*) from public.managed_content_revisions)
  and s.reviews = (select count(*) from public.managed_content_reviews)
  and s.publications = (select count(*) from public.managed_content_publications)
  and s.identities = (select md5(string_agg(question_id::text, ',' order by question_id)) from public.managed_content_items)
  from deletion_content_snapshot s), 'question IDs, revisions, operator history and publications unchanged');

-- Even a role changed AFTER scheduling cannot enter the ordinary student purge.
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at) values
  ('b1000000-0000-4000-8000-000000000003',statement_timestamp()-interval '746 hours',statement_timestamp()-interval '26 hours',statement_timestamp()-interval '26 hours');
set local role service_role;
select is((public.run_account_deletion_jobs()->>'failedThisRun')::integer, 1, 'operator discovered at purge is blocked for governed handling');
reset role;
select is((select count(*)::integer from auth.users where id = 'b1000000-0000-4000-8000-000000000003'), 1, 'governed operator identity preserved');
select ok((select escalated_at is not null from private.account_deletion_jobs where user_id = 'b1000000-0000-4000-8000-000000000003'), 'blocked operator job remains monitored and escalated');
update public.profiles set role = 'student' where id = 'b1000000-0000-4000-8000-000000000003';
select ok(private.is_governed_account('b1000000-0000-4000-8000-000000000003'), 'demotion does not erase governed review history');
insert into auth.users(id,email_confirmed_at) values ('b1000000-0000-4000-8000-000000000004',now());
-- Metadata-only fixture: no real provider object is uploaded or deleted.
insert into storage.buckets(id,name,owner_id) values ('account-deletion-fixture','account-deletion-fixture','b1000000-0000-4000-8000-000000000004');
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at) values
  ('b1000000-0000-4000-8000-000000000004',statement_timestamp()-interval '721 hours',statement_timestamp()-interval '1 hour',statement_timestamp()-interval '1 hour');
set local role service_role;
select is((public.run_account_deletion_jobs()->>'failedThisRun')::integer, 1, 'owned provider storage requires operator handling');
reset role;
select is((select last_error_code from private.account_deletion_jobs where user_id='b1000000-0000-4000-8000-000000000004'), 'P0002', 'storage blocker has a safe distinct code');
select is((select count(*)::integer from storage.buckets where id='account-deletion-fixture'), 1, 'worker never deletes provider Storage metadata');
select is((select count(*)::integer from auth.users where id='b1000000-0000-4000-8000-000000000004'), 1, 'storage blocker preserves identity for safe retry');
select ok((public.account_deletion_monitor()->>'lastRunAt') is not null
  and not (public.account_deletion_monitor()->>'workerStale')::boolean, 'monitor records a fresh worker heartbeat');
select throws_ok($$ select public.run_account_deletion_jobs(101) $$, '22023', null, 'unbounded batches rejected');
select * from finish();
rollback;
