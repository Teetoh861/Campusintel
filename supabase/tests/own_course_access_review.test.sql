-- A1 review: running-semester saves, pending-plan locks, recovery and every operator outcome.
begin;
select no_plan();
insert into private.academic_terms(session_label,academic_period_id,resumes_on,created_by,updated_by)
 values('2025/2026','30000000-0000-4000-8000-000000000001',current_date-interval '1 year','review-test','review-test');
create function pg_temp.u(n int) returns uuid language sql immutable as
  $$select ('a9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql immutable as
  $$select ('a9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.c(code text) returns uuid language sql stable security definer as
  $$select id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.student(n int, plan boolean default false) returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated','review-'||n||'@example.test','fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
  if plan then perform public.admin_grant_access(pg_temp.u(n),30,'Ops','review fixture'); end if;
end$$;
create function pg_temp.claims(n int) returns text language sql as
  $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),'role','authenticated')::text,true)$$;
create function pg_temp.rev(n int) returns bigint language sql stable security definer as
  $$select revision from public.profiles where id=pg_temp.u(n)$$;
create function pg_temp.term(n int) returns uuid language sql stable as
  $$select (private.current_course_scope(pg_temp.u(n),clock_timestamp())->>'term_id')::uuid$$;
create function pg_temp.add(n int, code text default 'BUA202', request uuid default gen_random_uuid()) returns jsonb
language sql as $$select public.admin_add_student_course(pg_temp.u(n),pg_temp.c(code),pg_temp.term(n),
  (select revision from public.profiles where id=pg_temp.u(n)),request,'Ops','review addition')$$;

-- Reproduce item 8 first without automatic insert binding, then verify the formerly open list now locks.
select pg_temp.student(1);
alter table public.entitlement_grants disable trigger entitlement_grants_bind_course;
insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
  values(pg_temp.u(1),'manual',now(),now()+interval '30 days','none','pending fixture');
alter table public.entitlement_grants enable trigger entitlement_grants_bind_course;
select is(private.course_selection_state(pg_temp.u(1))->>'state','locked','an active unbound full plan locks the current list');
set local role authenticated;
select pg_temp.claims(1);
select throws_ok($$update public.profiles set department_id='10000000-0000-4000-8000-000000000001'
  where id=pg_temp.u(1)$$,'CI423',null,'a student cannot change the list before a pending grant binds');
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA201')])),'own-list','first read binds the pending plan and preserves own access');
reset role;
select is((select count(*)::int from private.entitlement_events where user_id=pg_temp.u(1) and event='course.grant-bound'),1,'pending plan binds exactly once');
select private.bind_pending_course_grants(pg_temp.u(1));
select is((select count(*)::int from private.entitlement_events where user_id=pg_temp.u(1) and event='course.grant-bound'),1,'repeated binding writes no second audit');

-- A legacy mismatch stays locked for the student, and is repaired only by the normal audited team command.
select pg_temp.student(2);
update public.profiles set academic_period_id='30000000-0000-4000-8000-000000000002' where id=pg_temp.u(2);
select public.admin_grant_access(pg_temp.u(2),30,'Ops','legacy mismatch fixture');
create temporary table grant_before as select id,to_jsonb(g) value from public.entitlement_grants g where user_id=pg_temp.u(2);
set local role authenticated;
select pg_temp.claims(2);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA201')])),'needs-selection','mismatch asks for a selection recovery');
select is(public.get_my_course_selection()->>'state','locked','the mismatch selection is locked');
select throws_ok($$update public.profiles set academic_period_id='30000000-0000-4000-8000-000000000001'
  where id=pg_temp.u(2)$$,'CI423',null,'locked students cannot self-correct even to the running semester');
reset role;
set local role service_role;
select is(public.admin_change_course_selection(pg_temp.u(2),'business-administration','200-level','first-semester',
  pg_temp.rev(2),false,'Ops','correct saved semester')->>'state',
  'changed','the audited team correction to the running semester succeeds without CI423');
reset role;
select is((select to_jsonb(g) from public.entitlement_grants g join grant_before b using(id)),
  (select value from grant_before),'team correction preserves the plan, all its dates and allowances');
select is((select count(*)::int from private.course_selection_events where user_id=pg_temp.u(2)
  and event='operator.selection-changed'),1,'team recovery is audited');
set local role authenticated;
select pg_temp.claims(2);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA201')])),'own-list','corrected own courses open');
select ok((select count(*)>0 from public.read_published_managed_content('40000000-0000-4000-8000-000000000002')),'corrected student can read actual material');
reset role;

-- Re-confirming a legacy wrong choice while open is still a student selection save.
select pg_temp.student(13);
update public.profiles set academic_period_id='30000000-0000-4000-8000-000000000002' where id=pg_temp.u(13);
set local role authenticated;
select pg_temp.claims(13);
select throws_ok($$update public.profiles set academic_period_id=academic_period_id where id=pg_temp.u(13)$$,
  'CI422',null,'an open same-choice save cannot confirm a non-running semester');
reset role;

-- First pick, normal change, rollover re-pick. The dedicated code leaves every saved profile value intact.
select pg_temp.student(3);
update public.profiles set department_id=null,academic_level_id=null,academic_period_id=null where id=pg_temp.u(3);
select pg_temp.student(4);
select pg_temp.student(5);
alter table public.profiles disable trigger profiles_guard_course_selection;
update public.profiles set selection_confirmed_at=now()-interval '1 year',academic_period_id='30000000-0000-4000-8000-000000000002'
  where id=pg_temp.u(5);
alter table public.profiles enable trigger profiles_guard_course_selection;
create temporary table selections_before as select id,to_jsonb(p) value from public.profiles p where id in(pg_temp.u(3),pg_temp.u(4),pg_temp.u(5));
set local role authenticated;
select pg_temp.claims(3);
select throws_ok($$update public.profiles set department_id='10000000-0000-4000-8000-000000000002',
  academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000002'
  where id=pg_temp.u(3)$$,'CI422',null,'wrong running semester is refused on the first pick');
select pg_temp.claims(4);
select throws_ok($$update public.profiles set academic_period_id='30000000-0000-4000-8000-000000000002'
  where id=pg_temp.u(4)$$,'CI422',null,'wrong running semester is refused on a change');
select pg_temp.claims(5);
select throws_ok($$update public.profiles set academic_period_id=academic_period_id where id=pg_temp.u(5)$$,
  'CI422',null,'wrong running semester is refused on a same-choice rollover re-pick');
reset role;
select is(to_jsonb(p),b.value,'refused semester save changes nothing: '||p.id) from public.profiles p join selections_before b using(id);
set local role authenticated;
select pg_temp.claims(3);
select lives_ok($$update public.profiles set department_id='10000000-0000-4000-8000-000000000002',
  academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
  where id=pg_temp.u(3)$$,'the current-semester first pick succeeds');
select pg_temp.claims(5);
select lives_ok($$update public.profiles set academic_period_id='30000000-0000-4000-8000-000000000001'
  where id=pg_temp.u(5)$$,'the current-semester rollover re-pick succeeds');
reset role;

-- Truthful operator outcomes, request replay and no-plan admission.
select pg_temp.student(6);
select is(pg_temp.add(6)->>'state','needs-plan','an addition requires an active full semester plan');
select is((select count(*)::int from private.student_course_additions where user_id=pg_temp.u(6)),0,'no-plan add writes no addition');
select is((select count(*)::int from private.course_selection_events where user_id=pg_temp.u(6) and event='operator.course-added'),0,'no-plan add writes no audit of an addition');
select pg_temp.student(7,true);
create temporary table added as select pg_temp.add(7,'BUA202','a9300000-0000-4000-8000-000000000001') result;
select is((select result->>'state' from added),'added','full-plan addition succeeds');
select is(pg_temp.add(7,'BUA202','a9300000-0000-4000-8000-000000000001')->>'state','existing','same request returns existing while unrevoked');
select is(pg_temp.add(7)->>'state','already-added','another key cannot create a second active row');
select is(public.admin_revoke_student_course(pg_temp.u(7),(select(result->>'id')::uuid from added),0,'Ops','test')->>'state','conflict','stale addition revision refuses revoke');
select is(public.admin_revoke_student_course(pg_temp.u(7),gen_random_uuid(),1,'Ops','test')->>'state','not-found','unknown addition refuses revoke');
select is(public.admin_revoke_student_course(pg_temp.u(6),(select(result->>'id')::uuid from added),1,'Ops','test')->>'state','not-found','another account cannot revoke an addition');
select is(public.admin_revoke_student_course(pg_temp.u(7),(select(result->>'id')::uuid from added),1,'Ops','test')->>'state','revoked','addition revoke succeeds');
select is(public.admin_revoke_student_course(pg_temp.u(7),(select(result->>'id')::uuid from added),1,'Ops','test')->>'state','already-revoked','repeat revoke reports already-revoked');
create temporary table replay as select pg_temp.add(7,'BUA202','a9300000-0000-4000-8000-000000000001') result;
select is((select result->>'state' from replay),'revoked','replaying a revoked fulfillment never reports existing');
select is((select(result->>'revoked_at')::timestamptz from replay),(select revoked_at from private.student_course_additions where user_id=pg_temp.u(7)),'revoked fulfillment reports its real revoked_at');
select is(public.admin_add_student_course(pg_temp.u(7),gen_random_uuid(),pg_temp.term(7),
  (select revision from public.profiles where id=pg_temp.u(7)),gen_random_uuid(),'Ops','test')->>'state','invalid-course','an unknown institutional course is refused');
select is(public.admin_add_student_course(gen_random_uuid(),pg_temp.c('BUA202'),pg_temp.term(7),0,gen_random_uuid(),'Ops','test')->>'state','not-found','unknown student is refused');
select pg_temp.student(8,true);
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at)
 values(pg_temp.u(8),now(),now()+interval '720 hours',now());
select is(pg_temp.add(8)->>'state','account-restricted','an account pending deletion is refused');

-- Pending grants bind before the team command decides whether there is an active full plan.
select pg_temp.student(9,true);
update public.entitlement_grants set course_term_id=null,course_department_id=null where user_id=pg_temp.u(9);
select is(pg_temp.add(9)->>'state','added','team add binds a pending active full plan before checking it');
select ok((select course_term_id is not null from public.entitlement_grants where user_id=pg_temp.u(9)), 'team add leaves the plan bound');
select pg_temp.student(10,true);
update public.entitlement_grants set starts_at=now()+interval '1 day',ends_at=now()+interval '2 days' where user_id=pg_temp.u(10);
select is(pg_temp.add(10)->>'state','needs-plan','future plan cannot fund an addition');
select pg_temp.student(11,true);
update public.entitlement_grants set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' where user_id=pg_temp.u(11);
select is(pg_temp.add(11)->>'state','needs-plan','expired plan cannot fund an addition');
select pg_temp.student(12,true);
update public.entitlement_grants set revoked_at=clock_timestamp(),revoked_by='Ops',revoke_reason='fixture' where user_id=pg_temp.u(12);
select is(pg_temp.add(12)->>'state','needs-plan','revoked plan cannot fund an addition');
select is((select count(*)::int from private.student_course_additions where user_id in(pg_temp.u(10),pg_temp.u(11),pg_temp.u(12))),0,
  'refused lifecycle additions write no rows');

-- Every reachable projection reason; unavailable is the private decision's invalid-input guard.
set local role authenticated;
select pg_temp.claims(7);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA201')])),'own-list','projection: own-list');
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA202')])),'outside-list','projection: outside-list after revoke');
select is((select reason from public.get_my_course_access(array[pg_temp.c('GST111')])),'free','projection: free');
select pg_temp.claims(6);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA201')])),'needs-plan','projection: needs-plan');
reset role;
select pg_temp.add(7);
set local role authenticated;
select pg_temp.claims(7);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA202')])),'team-added','projection: team-added');
reset role;
update public.profiles set role='operator' where id=pg_temp.u(6);
set local role authenticated;
select pg_temp.claims(6);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA202')])),'operator','projection: current operator');
reset role;
select is((select reason from private.course_access_decision(null,pg_temp.c('BUA201'),clock_timestamp())),'unavailable','invalid private decision input fails closed');
update private.academic_terms set resumes_on=resumes_on-interval '2 years';
set local role authenticated;
select pg_temp.claims(7);
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA201')])),'missing-calendar','projection: missing-calendar');
reset role;
select * from finish();
rollback;
