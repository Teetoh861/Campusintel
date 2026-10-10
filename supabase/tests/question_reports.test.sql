-- Private report boundaries, historical evidence, optional attempts and quality counts.
begin;
select no_plan();

select ok((select relrowsecurity from pg_class where oid = 'public.question_reports'::regclass),
  'reports have RLS enabled');
select ok(not has_table_privilege('authenticated', 'public.question_reports', 'SELECT')
  and not has_table_privilege('authenticated', 'public.question_reports', 'INSERT')
  and not has_table_privilege('authenticated', 'public.question_reports', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.question_reports', 'DELETE')
  and not has_table_privilege('anon', 'public.question_reports', 'SELECT')
  and not has_table_privilege('service_role', 'public.question_reports', 'INSERT'),
  'API roles cannot directly read or mutate reports');
select ok(bool_and(prosecdef and proconfig @> array['search_path=""']),
  'report RPCs use definer privileges with an empty search path')
from pg_proc where oid in (
  'public.submit_question_report(uuid,uuid,integer,uuid,uuid,text)'::regprocedure,
  'public.list_question_reports(text,uuid,integer,integer)'::regprocedure,
  'public.disposition_question_report(uuid,text)'::regprocedure,
  'public.question_report_metrics(uuid)'::regprocedure);

insert into auth.users(instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  'reports-' || id::text || '@example.test', 'x', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array['b1000000-0000-4000-8000-000000000001'::uuid,
  'b1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000003']) id;
insert into auth.sessions(id, user_id, created_at, updated_at, not_after) values
  ('b2000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', now(), now(), null),
  ('b2000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', now(), now(), null),
  ('b2000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', now(), now(), null),
  ('b2000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000001', now(), now(), now() - interval '1 second');
update public.profiles set role = 'operator' where id = 'b1000000-0000-4000-8000-000000000003';

create temporary table report_fixture as
select i.id item_id, i.course_id, i.question_id, i.published_revision revision,
  (select id from public.managed_content_items where kind = 'theory_question'
    and course_id = i.course_id and published_revision = 1 order by id limit 1) theory_id,
  (select id from public.managed_content_items where kind = 'note'
    and course_id = i.course_id order by id limit 1) note_id,
  (select id from public.managed_content_items where kind = 'cbt_question'
    and course_id = i.course_id and id <> i.id and published_revision = 1 order by id limit 1) other_item,
  (select id from public.courses where id <> i.course_id order by id limit 1) other_course
from public.managed_content_items i join public.courses c on c.id = i.course_id
where c.content_key = 'financial-accounting-1' and i.kind = 'cbt_question'
  and i.published_revision = 1 order by i.id limit 1;
grant select on report_fixture to authenticated, anon;
select ok((select item_id is not null and theory_id is not null and note_id is not null
  and other_item is not null and other_course is not null from report_fixture), 'seed fixtures exist');

-- Invoker-only shorthand; all associations are still validated by the real RPC.
create function pg_temp.report(p_override jsonb default '{}') returns jsonb
language sql as $$
  select public.submit_question_report((j->>'courseId')::uuid, (j->>'itemId')::uuid,
    (j->>'revision')::integer, (j->>'questionId')::uuid, (j->>'attemptId')::uuid, j->>'note')
  from (select jsonb_build_object('courseId', course_id, 'itemId', item_id,
    'revision', revision, 'questionId', question_id) || p_override j from report_fixture) context;
$$;

set local role anon;
select throws_ok($$select pg_temp.report()$$, '42501', null, 'signed-out caller cannot report');
select throws_ok($$select public.list_question_reports()$$, '42501', null, 'signed-out caller cannot list');
select throws_ok($$select public.question_report_metrics()$$, '42501', null, 'signed-out caller cannot query metrics');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","session_id":"b2000000-0000-4000-8000-000000000004"}';
select throws_ok($$select pg_temp.report()$$, '42501', null, 'expired live session cannot report');
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000002","session_id":"b2000000-0000-4000-8000-000000000001"}';
select throws_ok($$select pg_temp.report()$$, '42501', null, 'session cannot assert another reporter');
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","session_id":"b2000000-0000-4000-8000-000000000001"}';
select throws_ok($$select pg_temp.report('{"courseId":"ffffffff-ffff-4fff-8fff-ffffffffffff"}')$$,
  '22023', null, 'invalid course rejected');
select throws_ok($$select pg_temp.report('{"itemId":"ffffffff-ffff-4fff-8fff-ffffffffffff"}')$$,
  '22023', null, 'invalid item rejected');
select throws_ok($$select pg_temp.report(jsonb_build_object('courseId', other_course)) from report_fixture$$,
  '22023', null, 'item from another course rejected');
select throws_ok($$select pg_temp.report(jsonb_build_object('itemId', note_id, 'questionId', null)) from report_fixture$$,
  '22023', null, 'unsupported note kind rejected');
select throws_ok($$select pg_temp.report('{"revision":999999}')$$, '22023', null, 'nonexistent revision rejected');
select throws_ok($$select pg_temp.report('{"questionId":"ffffffff-ffff-4fff-8fff-ffffffffffff"}')$$,
  '22023', null, 'CBT UUID mismatch rejected');
select throws_ok($$select pg_temp.report('{"questionId":null}')$$, '22023', null, 'CBT requires question UUID');
select throws_ok($$select pg_temp.report(jsonb_build_object('itemId', theory_id)) from report_fixture$$,
  '22023', null, 'theory cannot fabricate CBT UUID');
select throws_ok($$select pg_temp.report(jsonb_build_object('note', repeat('x', 1001)))$$,
  '22023', null, 'oversize note rejected');
select throws_ok($$select pg_temp.report('{"attemptId":"ffffffff-ffff-4fff-8fff-ffffffffffff"}')$$,
  '22023', null, 'supplied nonexistent attempt rejected');
select throws_ok($$select * from public.question_reports$$, '42501', null, 'student cannot list report table');
select throws_ok($$select public.list_question_reports()$$, '42501', null, 'non-operator cannot use report queue');
select throws_ok($$select public.disposition_question_report(gen_random_uuid(), 'resolved')$$,
  '42501', null, 'student cannot resolve');
select throws_ok($$select public.disposition_question_report(gen_random_uuid(), 'dismissed')$$,
  '42501', null, 'student cannot dismiss');
select throws_ok($$select public.question_report_metrics()$$, '42501', null, 'student cannot read metrics');
reset role;

-- A real revision without publication evidence must remain ineligible.
insert into public.managed_content_revisions(item_id, revision, payload, authored_by)
select r.item_id, 2, r.payload, r.authored_by from public.managed_content_revisions r
join report_fixture f on f.item_id = r.item_id and r.revision = 1;
update public.managed_content_items set current_revision = 2 where id = (select item_id from report_fixture);
set local role authenticated;
select throws_ok($$select pg_temp.report('{"revision":2}')$$, '22023', null, 'never-published revision rejected');
reset role;

-- Persist real immutable snapshots through the established attempt write boundary.
select public.write_quiz_attempt('b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', course_id, 1, 'start', null, 'in_progress',
  jsonb_build_array(jsonb_build_object('question_id', question_id, 'ordinal', 0, 'content_revision', 1)))
from report_fixture;
select public.write_quiz_attempt('b2000000-0000-4000-8000-000000000002',
  'b3000000-0000-4000-8000-000000000002', course_id, 1, 'start', null, 'in_progress',
  jsonb_build_array(jsonb_build_object('question_id', question_id, 'ordinal', 0, 'content_revision', 1)))
from report_fixture;
select public.write_quiz_attempt('b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000003', i.course_id, 1, 'start', null, 'in_progress',
  jsonb_build_array(jsonb_build_object('question_id', i.question_id, 'ordinal', 0, 'content_revision', 1)))
from public.managed_content_items i join report_fixture f on i.id = f.other_item;
select public.write_quiz_attempt('b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000004', course_id, 1, 'start', null, 'in_progress',
  jsonb_build_array(jsonb_build_object('question_id', question_id, 'ordinal', 0, 'content_revision', 1)))
from (select i.* from public.managed_content_items i join report_fixture f on i.course_id = f.other_course
  where i.kind = 'cbt_question' and i.published_revision = 1 order by i.id limit 1) other;
select public.write_quiz_attempt('b2000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', course_id, 0, 'record', 0, 'in_progress',
  jsonb_build_array(jsonb_build_object('question_id', question_id, 'ordinal', 0, 'option_index', 0)))
from report_fixture;
create temporary table report_attempts_before as select to_jsonb(a) evidence from public.quiz_attempts a;
create temporary table report_snapshots_before as select to_jsonb(q) evidence from public.quiz_attempt_questions q;
create temporary table report_answers_before as select to_jsonb(a) evidence from public.quiz_attempt_answers a;

set local role authenticated;
select throws_ok($$select pg_temp.report('{"attemptId":"b3000000-0000-4000-8000-000000000002"}')$$,
  '22023', null, 'another student attempt rejected');
select throws_ok($$select pg_temp.report('{"attemptId":"b3000000-0000-4000-8000-000000000003"}')$$,
  '22023', null, 'attempt question mismatch rejected');
select throws_ok($$select pg_temp.report('{"attemptId":"b3000000-0000-4000-8000-000000000004"}')$$,
  '22023', null, 'attempt course mismatch rejected');
select is(pg_temp.report('{"attemptId":"b3000000-0000-4000-8000-000000000001","note":"Original evidence"}')->>'status',
  'reported', 'valid owned attempt creates first report');
select is(pg_temp.report('{"note":"Replacement note"}')->>'status', 'already-reported', 'duplicate returns predictable result');
select throws_ok($$select pg_temp.report('{"attemptId":"b3000000-0000-4000-8000-000000000002"}')$$,
  '22023', null, 'duplicate does not silently discard inconsistent supplied attempt');
select throws_ok($$select pg_temp.report(jsonb_build_object('itemId', theory_id, 'questionId', null,
  'attemptId', 'b3000000-0000-4000-8000-000000000001')) from report_fixture$$,
  '22023', null, 'theory cannot claim CBT attempt context');
reset role;
select is((select count(*)::int from public.question_reports), 1, 'duplicate creates no second row');
select is((select note from public.question_reports), 'Original evidence', 'duplicate does not overwrite note');
select is((select reporter_id from public.question_reports), 'b1000000-0000-4000-8000-000000000001'::uuid,
  'reporter identity is derived from session');
select is((select attempt_id from public.question_reports), 'b3000000-0000-4000-8000-000000000001'::uuid,
  'valid attempt reference retained');
create temporary table report_original as select * from public.question_reports;
grant select on report_original to authenticated;
set local role authenticated;
select is((pg_temp.report()->>'reportId')::uuid, (select id from report_original), 'duplicate returns existing report identity');
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000002","session_id":"b2000000-0000-4000-8000-000000000002"}';
select is(pg_temp.report('{"note":" v "}')->>'status', 'reported', 'different student can report same item/revision without attempt');
select is(pg_temp.report(jsonb_build_object('itemId', theory_id, 'questionId', null,
  'note', E' \t\n' || U&'\000B\00A0\FEFF'))->>'status', 'reported', 'theory report accepted without attempt') from report_fixture;
reset role;
select is((select note from public.question_reports where kind = 'cbt_question'
  and reporter_id = 'b1000000-0000-4000-8000-000000000002'), 'v',
  'trim preserves ordinary v characters while removing whitespace');
select ok((select note is null and question_id is null and attempt_id is null
  from public.question_reports where kind = 'theory_question'), 'Unicode whitespace note normalizes to null');

-- Replacement/withdrawal does not erase historical eligibility.
insert into public.managed_content_publications(item_id, lock_version, action, revision, acted_by)
select item_id, 100, 'publish', 2, 'b1000000-0000-4000-8000-000000000003' from report_fixture;
update public.managed_content_items set approved_revision = 2, published_revision = null
where id = (select item_id from report_fixture);
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","session_id":"b2000000-0000-4000-8000-000000000001"}';
select throws_ok($$select pg_temp.report('{"revision":2,"attemptId":"b3000000-0000-4000-8000-000000000001"}')$$,
  '22023', null, 'attempt revision mismatch rejected even for formerly published revision');
select is(pg_temp.report('{"revision":2}')->>'status', 'reported', 'same student can report newer historical published revision');
select is(pg_temp.report()->>'status', 'already-reported', 'old historical publication still valid after withdrawal');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000003","session_id":"b2000000-0000-4000-8000-000000000003"}';
select is((select count(*)::int from public.list_question_reports()), 4, 'operator can list reports');
select ok((select bool_and(not (to_jsonb(r) ?| array['reporter_id','email','phone','profile','payload','reviewed_by']))
  from public.list_question_reports() r), 'operator queue omits reporter PII and answer payloads');
select throws_ok($$select public.list_question_reports('arbitrary')$$, '22023', null, 'invalid queue filter rejected');
select is(public.disposition_question_report((select id from report_original), 'resolved')->>'status',
  'updated', 'operator resolves open report');
select is(public.disposition_question_report((select id from report_original), 'resolved')->>'status',
  'unchanged', 'same terminal disposition is idempotent');
select is(public.disposition_question_report((select id from report_original), 'dismissed')->>'status',
  'conflict', 'terminal report cannot change terminal status');
select throws_ok($$select public.disposition_question_report((select id from report_original), 'open')$$,
  '22023', null, 'reopening is rejected');
select throws_ok($$select public.disposition_question_report((select id from report_original), 'arbitrary')$$,
  '22023', null, 'arbitrary terminal status rejected');
select is(public.disposition_question_report(gen_random_uuid(), 'dismissed')->>'status',
  'not-found', 'unknown report fails safely');
reset role;
create temporary table report_theory as select id from public.question_reports where kind = 'theory_question';
grant select on report_theory to authenticated;
set local role authenticated;
select is(public.disposition_question_report((select id from report_theory), 'dismissed')->>'status',
  'updated', 'operator dismisses open theory report');
select is(public.question_report_metrics()->>'cbtReportCount', '3', 'metric counts deduplicated CBT reports including resolved');
select is(public.question_report_metrics()->>'theoryReportCount', '1', 'metric counts theory separately including dismissed');
select is(public.question_report_metrics()->>'attemptCount', '4', 'denominator uses all durable starts including unfinished');
select is((public.question_report_metrics()->>'cbtReportsPer1000Attempts')::numeric, 750::numeric, 'per-1000 metric correct');
select is(public.question_report_metrics((select course_id from report_fixture))->>'attemptCount', '3',
  'course-scoped denominator includes only that course');
select ok(public.question_report_metrics('ffffffff-ffff-4fff-8fff-ffffffffffff')->'cbtReportsPer1000Attempts' = 'null'::jsonb,
  'zero denominator returns null rather than zero');
reset role;
select ok((select r.reviewed_by = 'b1000000-0000-4000-8000-000000000003'::uuid
  and r.reviewed_at >= r.created_at and r.status = 'resolved'
  and (to_jsonb(r) - array['status','reviewed_by','reviewed_at']) =
    (to_jsonb(o) - array['status','reviewed_by','reviewed_at'])
  from public.question_reports r join report_original o on r.id = o.id), 'terminal report preserves all original evidence and records operator/time');
select ok((select reviewed_by is not null and reviewed_at is not null and status = 'dismissed'
  from public.question_reports where kind = 'theory_question'), 'dismissal records operator and terminal time');
select results_eq('select to_jsonb(a) from public.quiz_attempts a order by id',
  'select evidence from report_attempts_before order by evidence->>''id''', 'reporting leaves attempts untouched');
select results_eq('select to_jsonb(q) from public.quiz_attempt_questions q order by attempt_id, question_id',
  'select evidence from report_snapshots_before order by evidence->>''attempt_id'', evidence->>''question_id''',
  'reporting leaves immutable snapshots untouched');
select results_eq('select to_jsonb(a) from public.quiz_attempt_answers a',
  'select evidence from report_answers_before', 'reporting leaves scoring and answers untouched');

set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","session_id":"b2000000-0000-4000-8000-000000000001"}';
select is(pg_temp.report()->>'status', 'already-reported', 'dedupe survives resolution');
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000002","session_id":"b2000000-0000-4000-8000-000000000002"}';
select is(pg_temp.report(jsonb_build_object('itemId', theory_id, 'questionId', null))->>'status',
  'already-reported', 'dedupe survives dismissal') from report_fixture;
reset role;

-- Exercise the bounded rolling cap without adding or changing auth limiter tables.
insert into public.question_reports(reporter_id, course_id, item_id, content_revision, kind, question_id)
select 'b1000000-0000-4000-8000-000000000001', i.course_id, i.id, 1, i.kind, i.question_id
from public.managed_content_items i where i.kind = 'cbt_question' and i.published_revision = 1
  and i.id not in (select item_id from public.question_reports) order by i.id limit 18;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000001","session_id":"b2000000-0000-4000-8000-000000000001"}';
select is(pg_temp.report(jsonb_build_object('itemId', theory_id, 'questionId', null))->>'status',
  'limited', 'rolling cap bounds new report submissions') from report_fixture;
select is(pg_temp.report()->>'status', 'already-reported', 'duplicates remain safe after rolling cap');
reset role;

update auth.sessions set not_after = clock_timestamp() - interval '1 second'
where id = 'b2000000-0000-4000-8000-000000000003';
set local role authenticated;
set local request.jwt.claims = '{"sub":"b1000000-0000-4000-8000-000000000003","session_id":"b2000000-0000-4000-8000-000000000003"}';
select throws_ok($$select public.list_question_reports()$$, '42501', null, 'expired operator cannot read reports');
select throws_ok($$select public.question_report_metrics()$$, '42501', null, 'expired operator cannot read metrics');
select throws_ok($$select public.disposition_question_report((select id from report_original), 'resolved')$$,
  '42501', null, 'expired operator cannot disposition reports');
reset role;

select * from finish();
rollback;
