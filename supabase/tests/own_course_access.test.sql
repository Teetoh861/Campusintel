-- Part 1 authorization: real course identities and student selections; never a global grant as course membership.
begin;
select no_plan();
create function pg_temp.u(n integer) returns uuid language sql immutable as
  $$select ('a3100000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as
  $$select ('a3200000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.c(code text) returns uuid language sql stable security definer as
  $$select id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.r(code text) returns uuid language sql stable security definer as
  $$select repository_course_id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.student(n integer, src text default 'manual', mode text default 'active') returns void
language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated','scope-'||n||'@example.test','fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
  if src is not null then
    insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,ai_terms,ai_units,created_by,
      revoked_at,revoked_by,revoke_reason)
    values(pg_temp.u(n),src,case when src='trial' then 'seven-day' end,
      now()+case mode when 'future' then interval '1 day' when 'expired' then interval '-2 days' else interval '-1 day' end,
      now()+case mode when 'future' then interval '2 days' when 'expired' then interval '-1 day' else interval '1 day' end,
      case src when 'early_access' then 'uncapped' when 'trial' then 'capped' else 'none' end,
      case when src='trial' then 0 end,'scope-test',case when mode='revoked' then now() end,
      case when mode='revoked' then 'Ops' end,case when mode='revoked' then 'test' end);
  end if;
end$$;
create function pg_temp.allowed(n integer, code text) returns boolean language sql as
  $$select allowed from private.course_access_decision(pg_temp.u(n),pg_temp.c(code),clock_timestamp())$$;
create function pg_temp.start(n integer, code text, attempt uuid default gen_random_uuid(), intent text default 'new',
  redo uuid default null) returns jsonb language sql as
  $$select public.practice_start(pg_temp.s(n),attempt,pg_temp.r(code),intent,redo,1,300,'[]',1,300,false)$$;

select has_column('public','entitlement_grants','course_term_id','full grants have a semester binding');
select has_table('private','student_course_additions','team additions are separate from full grants');
select is((select count(*)::int from unnest(array['anon','authenticated','service_role']) r,
  unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,'private.student_course_additions',p)),
  0,'no API role can edit additions directly');
select ok(has_function_privilege('service_role',f,'EXECUTE')
  and not has_function_privilege('authenticated',f,'EXECUTE') and not has_function_privilege('anon',f,'EXECUTE'),
  'addition command is service-only: '||f) from unnest(array[
  'public.admin_add_student_course(uuid,uuid,uuid,bigint,uuid,text,text)',
  'public.admin_student_course_status(uuid)', 'public.admin_revoke_student_course(uuid,uuid,bigint,text,text)']) f;
select ok(not has_function_privilege(r,'private.course_access_decision(uuid,uuid,timestamptz)','EXECUTE'),
  'central explicit-time decision is private to '||r) from unnest(array['anon','authenticated','service_role']) r;

select pg_temp.student(n,src) from (values(1,'early_access'),(2,'manual'),(3,'paid'),(4,'trial')) x(n,src);
select is(pg_temp.allowed(n,code),expected,src||' / '||code||' permission')
from (values(1,'early_access'),(2,'manual'),(3,'paid'),(4,'legacy seven-day')) x(n,src)
cross join (values('BUA201',true),('ENT211',true),('GST111',true),('BUA202',false),('ACC101',false)) c(code,expected);
select ok(g.course_term_id is not null and g.course_department_id is not null
  and g.starts_at=now()-interval '1 day' and g.ends_at=now()+interval '1 day',
  'binding preserves dates for '||g.source) from public.entitlement_grants g where user_id in
  (pg_temp.u(1),pg_temp.u(2),pg_temp.u(3),pg_temp.u(4));

select pg_temp.student(n,src,mode) from (values(10,'early_access'),(20,'manual'),(30,'paid'),(40,'trial')) x(base,src)
cross join (values(1,'future'),(2,'expired'),(3,'revoked')) y(delta,mode)
cross join lateral (select base+delta n) q;
select is(pg_temp.allowed(base+delta,code),code='GST111',src||' '||mode||' / '||code)
from (values(10,'early_access'),(20,'manual'),(30,'paid'),(40,'trial')) x(base,src)
cross join (values(1,'future'),(2,'expired'),(3,'revoked')) y(delta,mode)
cross join (values('BUA201'),('ENT211'),('GST111'),('BUA202')) c(code);

-- Representative pre-migration holders: run the actual backfill helper on unbound grants and retain every
-- pre-existing grant value, including the originally recorded benefit window and AI allowance.
alter table public.entitlement_grants disable trigger entitlement_grants_bind_course;
select pg_temp.student(n,src) from (values(80,'early_access'),(81,'manual'),(82,'paid'),(83,'trial')) x(n,src);
alter table public.entitlement_grants enable trigger entitlement_grants_bind_course;
create temporary table holders_before as select id,to_jsonb(g)-'course_term_id'-'course_department_id' value
  from public.entitlement_grants g where user_id in (pg_temp.u(80),pg_temp.u(81),pg_temp.u(82),pg_temp.u(83));
do $$ declare n integer; begin
  for n in 80..83 loop
    perform private.lock_course_access_scope(pg_temp.u(n));
    perform private.bind_pending_course_grants(pg_temp.u(n));
  end loop;
end $$;
select is(to_jsonb(g)-'course_term_id'-'course_department_id',b.value,'backfill preserves the full '||g.source||' record')
  from public.entitlement_grants g join holders_before b using(id);
select is(pg_temp.allowed(n,'BUA201'),true,'backfilled holder keeps own course: '||n) from generate_series(80,83) n;
select is(pg_temp.allowed(n,'BUA202'),false,'backfilled holder immediately loses outside course: '||n) from generate_series(80,83) n;
select is((select count(*)::int from private.entitlement_events where user_id=pg_temp.u(n) and event='course.grant-bound'),
  1,'backfilled holder has a binding audit: '||n) from generate_series(80,83) n;

-- B has a different selection and no grant; neither A's full plan nor A's addition belongs to B.
select pg_temp.student(50,null);
update public.profiles set department_id='10000000-0000-4000-8000-000000000001',
  academic_level_id='20000000-0000-4000-8000-000000000001' where id=pg_temp.u(50);
select is(pg_temp.allowed(50,'BUA201'),false,'another account cannot use A''s grant');
insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
  values(pg_temp.u(50),'manual',now(),now()+interval '1 day','none','scope-test');
select is(pg_temp.allowed(50,'ACC101'),true,'B retains B''s own Accounting 100L course');
select pg_temp.student(51,null);
update public.profiles set department_id='10000000-0000-4000-8000-000000000001' where id=pg_temp.u(51);
insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
  values(pg_temp.u(51),'manual',now(),now()+interval '1 day','none','scope-test');
select is(pg_temp.allowed(51,'ENT211'),true,'a second department''s matching tuple opens the shared course');
select is(pg_temp.allowed(51,'BUA201'),false,'sharing ENT211 does not share A''s other courses');
select is(public.admin_add_student_course(pg_temp.u(2),pg_temp.c('BUA202'),
  (private.current_course_scope(pg_temp.u(2),clock_timestamp())->>'term_id')::uuid,-1,gen_random_uuid(),'Ops','test')->>'state',
  'conflict','an addition refuses a stale profile revision');
select is(public.admin_add_student_course(pg_temp.u(2),pg_temp.c('BUA202'),gen_random_uuid(),
  (select revision from public.profiles where id=pg_temp.u(2)),gen_random_uuid(),'Ops','test')->>'state',
  'invalid-term','an addition refuses another semester');
select is(public.admin_add_student_course(pg_temp.u(2),pg_temp.c(code),
  (private.current_course_scope(pg_temp.u(2),clock_timestamp())->>'term_id')::uuid,
  (select revision from public.profiles where id=pg_temp.u(2)),gen_random_uuid(),'Ops','test')->>'state',
  'already-included','an addition is unnecessary for '||code) from unnest(array['BUA201','GST111']) code;
create temporary table added as select public.admin_add_student_course(pg_temp.u(2),pg_temp.c('BUA202'),
  (private.current_course_scope(pg_temp.u(2),clock_timestamp())->>'term_id')::uuid,
  (select revision from public.profiles where id=pg_temp.u(2)),
  'a3300000-0000-4000-8000-000000000001','Ops','separately confirmed course') result;
select is((select result->>'state' from added),'added','the team adds exactly one course');
select is(pg_temp.allowed(2,'BUA202'),true,'addition plus full plan opens the course');
select is(pg_temp.allowed(50,'BUA202'),false,'A''s addition cannot expand B''s own full plan');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(2),'session_id',pg_temp.s(2),'role','authenticated')::text,true);
select ok((select count(*) from public.read_published_managed_content(pg_temp.r('BUA202')))>0,
  'a team-added course reads its published material');
select ok((select bank_size from public.published_cbt_summary(array[pg_temp.r('BUA202')]))>0,
  'a team-added course reads its bank count');
reset role;
set local role service_role;
select is(pg_temp.start(2,'BUA202')->>'state','ready','a team-added course starts ordinary practice');
reset role;
select public.practice_submit(pg_temp.s(2),(select id from public.quiz_attempts
  where user_id=pg_temp.u(2) and course_id=pg_temp.r('BUA202')),
  'a3400000-0000-4000-8000-000000000001',1,0,'{}');
update public.entitlement_grants set ends_at=clock_timestamp()-interval '1 second' where user_id=pg_temp.u(2);
select is(pg_temp.allowed(2,'BUA202'),false,'an addition is unusable without an active full plan');
-- All admissions must close together; existing attempt history remains a separate part 2 boundary.
create function pg_temp.refused(n integer, code text, label text) returns setof text language plpgsql as $$
declare origin uuid;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),
    'session_id',pg_temp.s(n),'role','authenticated')::text,true);
  return next throws_ok(format('select * from public.read_published_managed_content(%L::uuid)',pg_temp.r(code)),
    'CI403',null,label||': no material');
  return next throws_ok(format('select * from public.published_cbt_summary(array[%L::uuid])',pg_temp.r(code)),
    'CI403',null,label||': no count');
  return next is((select allowed from public.get_my_course_access(array[pg_temp.c(code)])),false,
    label||': projection denies');
  return next is(pg_temp.start(n,code)->>'state','locked',label||': no new practice');
  select id into origin from public.quiz_attempts where user_id=pg_temp.u(n) and course_id=pg_temp.r(code)
    and status<>'in_progress' order by created_at,id limit 1;
  if origin is not null then
    return next is(pg_temp.start(n,code,gen_random_uuid(),'redo',origin)->>'state','locked',label||': no Redo');
  end if;
end $$;
select * from pg_temp.refused(2,'BUA202','addition with ended plan');
update public.entitlement_grants set ends_at=now()+interval '1 day' where user_id=pg_temp.u(2);
select is((public.admin_add_student_course(pg_temp.u(2),pg_temp.c('BUA202'),
  (private.current_course_scope(pg_temp.u(2),clock_timestamp())->>'term_id')::uuid,0,
  'a3300000-0000-4000-8000-000000000001','Ops','separately confirmed course')->>'state'),'existing',
  'the same fulfillment is idempotent even after the profile revision moves');
select is((public.admin_add_student_course(pg_temp.u(50),pg_temp.c('BUA202'),
  (private.current_course_scope(pg_temp.u(50),clock_timestamp())->>'term_id')::uuid,0,
  'a3300000-0000-4000-8000-000000000001','Ops','separately confirmed course')->>'state'),'request-conflict',
  'a fulfillment key cannot be reused for another student');
select throws_ok($$select public.admin_add_student_course(pg_temp.u(2),pg_temp.c('BUA202'),
  gen_random_uuid(),0,gen_random_uuid(),'','x')$$,'22023',null,'actor is required');
select throws_ok($$select public.admin_add_student_course(pg_temp.u(2),pg_temp.c('BUA202'),
  gen_random_uuid(),0,gen_random_uuid(),'Ops','')$$,'22023',null,'reason is required');
update private.student_course_additions set starts_at=now()+interval '1 day' where user_id=pg_temp.u(2);
select * from pg_temp.refused(2,'BUA202','future addition');
update private.student_course_additions set starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'
  where user_id=pg_temp.u(2);
select is(pg_temp.allowed(2,'BUA202'),false,'expired addition is refused');
select * from pg_temp.refused(2,'BUA202','expired addition');
update private.student_course_additions set starts_at=now()-interval '1 day',ends_at=now()+interval '1 day'
  where user_id=pg_temp.u(2);
select is(public.admin_revoke_student_course(pg_temp.u(2),(select(result->>'id')::uuid from added),0,'Ops','test')->>'state',
  'conflict','revoke requires the displayed revision');
select is(public.admin_revoke_student_course(pg_temp.u(2),(select(result->>'id')::uuid from added),1,'Ops','test')->>'state',
  'revoked','revoke is audited');
select is(pg_temp.allowed(2,'BUA202'),false,'revoked addition is refused');
select * from pg_temp.refused(2,'BUA202','revoked addition');
select is((select count(*)::int from private.course_selection_events where user_id=pg_temp.u(2)
  and event in ('operator.course-added','operator.course-revoked')),2,'the add and revoke leave both audit records');
select is((select count(*)::int from private.student_course_additions where user_id=pg_temp.u(2)),1,'records are kept');

-- Exercise each public material/count boundary with each full source and grant lifecycle.
create function pg_temp.read_matrix() returns setof text language plpgsql as $$
declare x record; c text; permitted boolean;
begin
  for x in select * from (values(1,'early_access','active'),(2,'manual','active'),(3,'paid','active'),(4,'seven-day','active'),
      (11,'early_access','future'),(12,'early_access','expired'),(13,'early_access','revoked'),
      (21,'manual','future'),(22,'manual','expired'),(23,'manual','revoked'),
      (31,'paid','future'),(32,'paid','expired'),(33,'paid','revoked'),
      (41,'seven-day','future'),(42,'seven-day','expired'),(43,'seven-day','revoked')) a(n,src,mode) loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(x.n),
      'session_id',pg_temp.s(x.n),'role','authenticated')::text,true);
    foreach c in array array['BUA201','ENT211','GST111','BUA202'] loop
      permitted := c='GST111' or (x.mode='active' and c<>'BUA202');
      if permitted then
        return next ok((select count(*)>0 from public.read_published_managed_content(pg_temp.r(c))),
          'material: '||x.src||' '||x.mode||' / '||c);
        return next ok((select bank_size>0 from public.published_cbt_summary(array[pg_temp.r(c)])),
          'count: '||x.src||' '||x.mode||' / '||c);
      else
        return next throws_ok(format('select * from public.read_published_managed_content(%L::uuid)',pg_temp.r(c)),
          'CI403',null,'material refused: '||x.src||' '||x.mode||' / '||c);
        return next throws_ok(format('select * from public.published_cbt_summary(array[%L::uuid])',pg_temp.r(c)),
          'CI403',null,'count refused: '||x.src||' '||x.mode||' / '||c);
      end if;
    end loop;
  end loop;
end $$;
set local role authenticated;
select * from pg_temp.read_matrix();
reset role;

-- Real student-callable material/count/projection boundaries, not just helper booleans.
select throws_ok($$select public.admin_change_course_selection(pg_temp.u(1),'business-administration','200-level',
  'second-semester',(select revision from public.profiles where id=pg_temp.u(1)),false,'Ops','semester correction')$$,
  'CI423',null,'an operator correction cannot transfer a full plan to a different semester');
select is((select academic_period_id from public.profiles where id=pg_temp.u(1)),
  '30000000-0000-4000-8000-000000000001'::uuid,'the refused correction preserves the selection');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(1),'session_id',pg_temp.s(1),'role','authenticated')::text,true);
select ok((select count(*) from public.read_published_managed_content(pg_temp.r('BUA201')))>0,'own course material opens');
select ok((select bank_size from public.published_cbt_summary(array[pg_temp.r('BUA201')]))>0,'own bank count opens');
select throws_ok($$select * from public.read_published_managed_content(pg_temp.r('BUA202'))$$,'CI403',null,'outside material denied');
select throws_ok($$select * from public.published_cbt_summary(array[pg_temp.r('BUA202')])$$,'CI403',null,'outside count denied');
select throws_ok($$select * from public.published_cbt_summary(array[pg_temp.r('GST111'),pg_temp.r('BUA202')])$$,
  'CI403',null,'a mixed list does not leak a forbidden count');
select is((select reason from public.get_my_course_access(array[pg_temp.c('BUA202')])),'outside-list','projection explains outside membership');
select throws_ok($$select * from public.get_my_course_access(array_fill(pg_temp.c('BUA201'),array[201]))$$,
  '22023',null,'projection is bounded');
select throws_ok($$select public.admin_student_course_status(pg_temp.u(1))$$,'42501',null,'student cannot call operator status');
reset role;
set local role service_role;
select is(pg_temp.start(n,code)->>'state',expected,'practice: '||src||' / '||code)
from (values(1,'early_access'),(2,'manual'),(3,'paid'),(4,'legacy seven-day')) x(n,src)
cross join (values('BUA201','ready'),('ENT211','ready'),('GST111','ready'),('BUA202','locked')) c(code,expected);
reset role;
select is((select count(*)::int from public.quiz_attempts where user_id=pg_temp.u(1) and course_id=pg_temp.r('BUA202')),0,
  'denied start pins no attempt');

-- Redo is a fresh admission, including historical attempts whose old broad access has been removed.
create function pg_temp.attempt_for(n integer, code text) returns uuid language sql stable security definer as
  $$select id from public.quiz_attempts where user_id=pg_temp.u(n) and course_id=pg_temp.r(code)
    and status='in_progress' order by created_at desc limit 1$$;
set local role service_role;
select is(public.practice_submit(pg_temp.s(n),pg_temp.attempt_for(n,'BUA201'),
  'a3400000-0000-4000-8000-000000000001',1,0,'{}')->>'state','graded','own attempt finishes for source '||n)
  from generate_series(1,4) n;
reset role;
create temporary table redo_origins as select n,id from public.quiz_attempts a
  join generate_series(1,4) n on a.user_id=pg_temp.u(n) where a.course_id=pg_temp.r('BUA201');
grant select on redo_origins to service_role;
set local role service_role;
select is(pg_temp.start(n,'BUA201',gen_random_uuid(),'redo',id)->>'state','ready','own Redo opens for source '||n)
  from redo_origins;
select is(pg_temp.start(n,'BUA202',gen_random_uuid(),'redo',id)->>'state','locked','outside Redo denied for source '||n)
  from redo_origins;
select is(pg_temp.start(base+delta,'BUA201')->>'state','locked',src||' '||mode||' cannot start own practice')
from (values(10,'early_access'),(20,'manual'),(30,'paid'),(40,'trial')) x(base,src)
cross join (values(1,'future'),(2,'expired'),(3,'revoked')) y(delta,mode);
reset role;

-- Fresh starts and Redo share the same matrix. Seed a graded historical attempt through the operator
-- exception, then remove that exception before admission, including courses that used to open broadly.
create function pg_temp.practice_matrix() returns setof text language plpgsql as $$
declare src text; mode text; code text; n integer := 100; origin uuid; fresh uuid; redo uuid;
  result jsonb; permitted boolean; label text;
begin
  foreach src in array array['early_access','manual','paid','trial'] loop
    foreach mode in array array['active','future','expired','revoked'] loop
      foreach code in array array['BUA201','ENT211','GST111','BUA202'] loop
        n := n+1; origin := gen_random_uuid(); fresh := gen_random_uuid(); redo := gen_random_uuid();
        perform pg_temp.student(n,src,mode);
        update public.profiles set role='operator' where id=pg_temp.u(n);
        result := pg_temp.start(n,code,origin);
        if result->>'state' <> 'ready' then raise exception 'Historical fixture failed: %',result; end if;
        perform public.practice_submit(pg_temp.s(n),origin,gen_random_uuid(),1,0,'{}');
        update public.profiles set role='student' where id=pg_temp.u(n);
        permitted := code='GST111' or (mode='active' and code<>'BUA202');
        label := src||' '||mode||' / '||code;
        return next is(pg_temp.start(n,code,fresh)->>'state',case when permitted then 'ready' else 'locked' end,
          'new practice: '||label);
        if permitted then perform public.practice_submit(pg_temp.s(n),fresh,gen_random_uuid(),1,0,'{}'); end if;
        return next is(pg_temp.start(n,code,redo,'redo',origin)->>'state',case when permitted then 'ready' else 'locked' end,
          'Redo: '||label);
        if permitted then perform public.practice_submit(pg_temp.s(n),redo,gen_random_uuid(),1,0,'{}'); end if;
        return next is((select count(*)::int from public.quiz_attempts where user_id=pg_temp.u(n)),
          case when permitted then 3 else 1 end,'admission retains history and creates only allowed attempts: '||label);
      end loop;
    end loop;
  end loop;
end $$;
select * from pg_temp.practice_matrix();

-- A source-independent representative exercises every admission after rollover and missing calendar.
select pg_temp.student(90,'manual');
update public.entitlement_grants set ends_at=now()+interval '300 days' where user_id=pg_temp.u(90);
select pg_temp.start(90,'BUA201');
select public.practice_submit(pg_temp.s(90),(select id from public.quiz_attempts where user_id=pg_temp.u(90)),
  gen_random_uuid(),1,0,'{}');

-- Missing selection/calendar and operators are independent of grant source.
select pg_temp.student(60,null);
update public.profiles set department_id=null,academic_level_id=null,academic_period_id=null where id=pg_temp.u(60);
insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
  values(pg_temp.u(60),'manual',now(),now()+interval '1 day','none','scope-test');
select is(pg_temp.allowed(60,'BUA201'),false,'a full grant invents no missing selection');
select * from pg_temp.refused(60,'BUA201','missing selection');
select is(pg_temp.allowed(60,'GST111'),true,'GST remains free without a selection');
update public.profiles set role='operator' where id=pg_temp.u(60);
select is(pg_temp.allowed(60,'BUA201'),true,'current database operator needs no grant/list');
update public.profiles set role='student' where id=pg_temp.u(60);
select is(pg_temp.allowed(60,'BUA201'),false,'demotion immediately removes operator access');
select is((select allowed from private.course_access_decision(pg_temp.u(1),null,clock_timestamp())),false,
  'a repository without an institutional owner is not a student course');

-- Move the fixture calendar, keeping its ID/bound history; it cannot erase the grant's semester.
update public.entitlement_grants set ends_at=now()+interval '300 days' where user_id=pg_temp.u(2);
select is((select allowed from private.course_access_decision(pg_temp.u(2),pg_temp.c('BUA201'),
  (select ends_at-interval '1 microsecond' from private.academic_term_ends('10000000-0000-4000-8000-000000000002')
    where term_id=(select course_term_id from public.entitlement_grants where user_id=pg_temp.u(2))))),true,
  'a long grant covers its own list immediately before the semester end');
select is((select allowed from private.course_access_decision(pg_temp.u(2),pg_temp.c('BUA201'),
  (select ends_at from private.academic_term_ends('10000000-0000-4000-8000-000000000002')
    where term_id=(select course_term_id from public.entitlement_grants where user_id=pg_temp.u(2))))),false,
  'the same grant stops exactly at the effective semester end');
update private.academic_terms set resumes_on=(now() at time zone 'Africa/Lagos')::date-interval '5 months';
insert into private.academic_terms(session_label,academic_period_id,resumes_on,created_by,updated_by)
  values('2027/2028','30000000-0000-4000-8000-000000000001',(now() at time zone 'Africa/Lagos')::date,'test','test');
select is(pg_temp.allowed(2,'BUA201'),false,'old selection expires at term end even with a long grant');
select * from pg_temp.refused(90,'BUA201','semester rollover');
update public.profiles set department_id=department_id where id=pg_temp.u(2);
select is(private.current_course_scope(pg_temp.u(2),clock_timestamp())->>'state','ready','student reconfirms for the next semester');
select is(pg_temp.allowed(2,'BUA201'),false,'reconfirmation cannot carry the old full grant into a new semester');
select is(private.course_selection_state(pg_temp.u(2))->>'state','open','an old-semester full grant cannot lock the new selection');
update private.academic_terms set resumes_on=resumes_on-interval '2 years';
select is(private.current_course_scope(pg_temp.u(1),clock_timestamp())->>'state','missing-calendar','no future semester is known');
select is(pg_temp.allowed(1,'BUA201'),false,'missing calendar fails closed');
select * from pg_temp.refused(90,'BUA201','missing calendar');
select is(pg_temp.allowed(1,'GST111'),true,'missing calendar does not close GST');
select * from finish();
rollback;
