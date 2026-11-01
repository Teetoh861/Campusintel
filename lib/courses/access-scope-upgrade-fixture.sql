begin; set local statement_timeout='60s'; set local search_path=public,extensions,pg_temp; create extension if not exists pgtap with schema extensions; select no_plan();
insert into private.academic_terms(session_label,academic_period_id,resumes_on,created_by,updated_by) values('2025/2026','30000000-0000-4000-8000-000000000001',current_date-interval '1 year','upgrade-test','upgrade-test');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000001','authenticated','authenticated','upgrade-1@example.test','fixture-only',now(),'{}','{}',now(),now());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('a1200000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000001',now(),now());
      update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='a1100000-0000-4000-8000-000000000001';
      insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,created_at,ai_terms,ai_units,created_by)
      values('a1100000-0000-4000-8000-000000000001','early_access',null,now()-interval '1 day',now()+interval '30 days',now()-interval '1 day','uncapped',null,'upgrade-test');
select public.practice_start('a1200000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','new',null,1,300,'[]',1,300,false);
          select public.practice_submit('a1200000-0000-4000-8000-000000000001','a1300000-0000-4000-8000-000000000001',gen_random_uuid(),1,0,jsonb_build_object((select question_id::text from public.quiz_attempt_questions where attempt_id='a1300000-0000-4000-8000-000000000001' limit 1),0));
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000002','authenticated','authenticated','upgrade-2@example.test','fixture-only',now(),'{}','{}',now(),now());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('a1200000-0000-4000-8000-000000000002','a1100000-0000-4000-8000-000000000002',now(),now());
      update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='a1100000-0000-4000-8000-000000000002';
      insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,created_at,ai_terms,ai_units,created_by)
      values('a1100000-0000-4000-8000-000000000002','manual',null,now()-interval '1 day',now()+interval '30 days',now()-interval '1 day','none',null,'upgrade-test');
select public.practice_start('a1200000-0000-4000-8000-000000000002','a1300000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000002','new',null,1,300,'[]',1,300,false);
          select public.practice_submit('a1200000-0000-4000-8000-000000000002','a1300000-0000-4000-8000-000000000002',gen_random_uuid(),1,0,jsonb_build_object((select question_id::text from public.quiz_attempt_questions where attempt_id='a1300000-0000-4000-8000-000000000002' limit 1),0));
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000003','authenticated','authenticated','upgrade-3@example.test','fixture-only',now(),'{}','{}',now(),now());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('a1200000-0000-4000-8000-000000000003','a1100000-0000-4000-8000-000000000003',now(),now());
      update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='a1100000-0000-4000-8000-000000000003';
      insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,created_at,ai_terms,ai_units,created_by)
      values('a1100000-0000-4000-8000-000000000003','paid',null,now()-interval '1 day',now()+interval '30 days',now()-interval '1 day','none',null,'upgrade-test');
select public.practice_start('a1200000-0000-4000-8000-000000000003','a1300000-0000-4000-8000-000000000003','40000000-0000-4000-8000-000000000002','new',null,1,300,'[]',1,300,false);
          select public.practice_submit('a1200000-0000-4000-8000-000000000003','a1300000-0000-4000-8000-000000000003',gen_random_uuid(),1,0,jsonb_build_object((select question_id::text from public.quiz_attempt_questions where attempt_id='a1300000-0000-4000-8000-000000000003' limit 1),0));
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000004','authenticated','authenticated','upgrade-4@example.test','fixture-only',now(),'{}','{}',now(),now());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('a1200000-0000-4000-8000-000000000004','a1100000-0000-4000-8000-000000000004',now(),now());
      update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='a1100000-0000-4000-8000-000000000004';
      insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,created_at,ai_terms,ai_units,created_by)
      values('a1100000-0000-4000-8000-000000000004','trial','seven-day',now()-interval '1 day',now()+interval '30 days',now()-interval '1 day','capped',7,'upgrade-test');
select public.practice_start('a1200000-0000-4000-8000-000000000004','a1300000-0000-4000-8000-000000000004','40000000-0000-4000-8000-000000000002','new',null,1,300,'[]',1,300,false);
          select public.practice_submit('a1200000-0000-4000-8000-000000000004','a1300000-0000-4000-8000-000000000004',gen_random_uuid(),1,0,jsonb_build_object((select question_id::text from public.quiz_attempt_questions where attempt_id='a1300000-0000-4000-8000-000000000004' limit 1),0));
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000005','authenticated','authenticated','upgrade-5@example.test','fixture-only',now(),'{}','{}',now(),now());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('a1200000-0000-4000-8000-000000000005','a1100000-0000-4000-8000-000000000005',now(),now());
      update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='a1100000-0000-4000-8000-000000000005';
      insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,created_at,ai_terms,ai_units,created_by)
      values('a1100000-0000-4000-8000-000000000005','trial','discovery',now()-interval '1 day',now()+interval '30 days',now()-interval '1 day','capped',7,'upgrade-test');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values('00000000-0000-0000-0000-000000000000','a1100000-0000-4000-8000-000000000006','authenticated','authenticated','upgrade-6@example.test','fixture-only',now(),'{}','{}',now(),now());
      insert into auth.sessions(id,user_id,created_at,updated_at) values('a1200000-0000-4000-8000-000000000006','a1100000-0000-4000-8000-000000000006',now(),now());
      update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id='a1100000-0000-4000-8000-000000000006';
      insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,created_at,ai_terms,ai_units,created_by)
      values('a1100000-0000-4000-8000-000000000006','manual',null,now()-interval '1 year',now()+interval '30 days',now()-interval '1 year','none',null,'upgrade-test');
alter table public.profiles disable trigger profiles_guard_course_selection; update public.profiles set selection_confirmed_at=now()-interval '1 year' where id='a1100000-0000-4000-8000-000000000006'; alter table public.profiles enable trigger profiles_guard_course_selection;
insert into private.early_access_members(email,full_name,joined_at,source,batch,added_by,claimed_at,claimed_by)
 values('upgrade-1@example.test','Ada',now()-interval '2 days','manual','upgrade','upgrade-test',now()-interval '1 day','a1100000-0000-4000-8000-000000000001'),
 ('upgrade-unclaimed@example.test','Tobi',now()-interval '2 days','manual','upgrade','upgrade-test',null,null);
 update public.entitlement_grants set reference=jsonb_build_object('member_id',(select id from private.early_access_members where email='upgrade-1@example.test')) where user_id='a1100000-0000-4000-8000-000000000001';
 create temporary table before_grants as select id,to_jsonb(g) value from public.entitlement_grants g;
 create temporary table before_profiles as select id,to_jsonb(p) value from public.profiles p;
 create temporary table before_members as select id,to_jsonb(m) value from private.early_access_members m;
 create temporary table before_attempts as select id,to_jsonb(a) value from public.quiz_attempts a;
 create temporary table before_questions as select attempt_id,question_id,to_jsonb(q) value from public.quiz_attempt_questions q;
 create temporary table before_answers as select attempt_id,question_id,to_jsonb(a) value from public.quiz_attempt_answers a;
 select ok(private.can_read_course_content('a1100000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000011'),'before upgrade: existing full holder can read outside list');

-- ACCESS_SCOPE_MIGRATION

 select is((select jsonb_agg(to_jsonb(g)-'course_term_id'-'course_department_id' order by id) from public.entitlement_grants g),
   (select jsonb_agg(value order by id) from before_grants),'upgrade preserves every original grant value: all dates, allowances, history and provenance');
 select is((select jsonb_agg(to_jsonb(p) order by id) from public.profiles p),(select jsonb_agg(value order by id) from before_profiles),'upgrade preserves current and previous semester selections');
 select is((select jsonb_agg(to_jsonb(m) order by id) from private.early_access_members m),(select jsonb_agg(value order by id) from before_members),'claimed and unclaimed Early Access members survive unchanged');
 select is((select jsonb_agg(to_jsonb(a) order by id) from public.quiz_attempts a),(select jsonb_agg(value order by id) from before_attempts),'attempts, scores and timing survive unchanged');
 select is((select jsonb_agg(to_jsonb(q) order by attempt_id,question_id) from public.quiz_attempt_questions q),(select jsonb_agg(value order by attempt_id,question_id) from before_questions),'pinned review question revisions survive unchanged');
 select ok((select count(*) from before_answers)>=4,'upgrade fixture contains actual saved review answers');
 select is((select jsonb_agg(to_jsonb(a) order by attempt_id,question_id) from public.quiz_attempt_answers a),(select jsonb_agg(value order by attempt_id,question_id) from before_answers),'saved review answers survive unchanged');
 select ok(g.course_term_id=(select term_id from private.access_term_at(p.department_id,greatest(g.created_at,g.starts_at))) and g.course_department_id=p.department_id,
    'grant binds to issuance term: '||g.source||coalesce('/'||g.trial_policy,'')) from public.entitlement_grants g join public.profiles p on p.id=g.user_id
    where g.source<>'trial' or g.trial_policy='seven-day';
 select ok(course_term_id is null and course_department_id is null,'Discovery remains outside full-plan binding') from public.entitlement_grants where trial_policy='discovery';
 select ok(private.can_read_course_content(user_id,'40000000-0000-4000-8000-000000000002'),'own-list access kept: '||source||coalesce('/'||trial_policy,''))
    from public.entitlement_grants where user_id between 'a1100000-0000-4000-8000-000000000001'::uuid and 'a1100000-0000-4000-8000-000000000004'::uuid;
 select ok(not private.can_read_course_content(user_id,'40000000-0000-4000-8000-000000000011'),'outside-list access removed: '||source||coalesce('/'||trial_policy,''))
    from public.entitlement_grants where user_id between 'a1100000-0000-4000-8000-000000000001'::uuid and 'a1100000-0000-4000-8000-000000000004'::uuid;
 select ok((select course_term_id from public.entitlement_grants where user_id='a1100000-0000-4000-8000-000000000006')
   <> (select course_term_id from public.entitlement_grants where user_id='a1100000-0000-4000-8000-000000000002'),'long old grant stays in previous semester');
 select * from finish();
rollback;
