-- A2: real owner, course, grant and session boundaries. Entire fixture rolls back.
begin;
select no_plan();
create function pg_temp.u(n int) returns uuid language sql as $$select ('a4200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql as $$select ('a4210000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.c(code text) returns uuid language sql security definer set search_path='' as $$select id from public.institutional_courses where course_code=code$$;
create function pg_temp.r(code text) returns uuid language sql security definer set search_path='' as $$select repository_course_id from public.institutional_courses where course_code=code$$;
create function pg_temp.hash(n int) returns jsonb language sql as $$select jsonb_build_array(jsonb_build_object('version',999,'hash',repeat(n::text,64),'check',repeat('f',64)))$$;
create function pg_temp.student(n int,email text,src text default 'trial') returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),'authenticated','authenticated',email,'fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001' where id=pg_temp.u(n);
  if src is not null then
    insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,ai_terms,ai_units,created_by)
      values(pg_temp.u(n),src,case when src='trial' then 'discovery' end,clock_timestamp()-interval '1 day',
      clock_timestamp()+interval '1 day',case when src='early_access' then 'uncapped' else 'capped' end,
      case when src='early_access' then null else 10 end,'a2-test');
  end if;
end$$;
create temporary table result(k text primary key,v jsonb);
create function pg_temp.choice(a uuid) returns jsonb language sql security definer set search_path='' as $$
  select jsonb_object_agg(q.question_id::text,r.payload->'correctOption') from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id=q.item_id and r.revision=q.content_revision where q.attempt_id=a;
$$;
grant all on result to service_role,authenticated;
select pg_temp.student(1,'a2-discovery@example.test');
select pg_temp.student(2,'a2-plan@example.test','early_access');
select pg_temp.student(3,'j.o.h.n+old@googlemail.com',null);
select pg_temp.student(4,'john+new@gmail.com',null);
select pg_temp.student(5,'a2@mailinator.com',null);
select pg_temp.student(6,'a2-ai@example.test');
select ok(private.discovery_course_allowed(pg_temp.u(1),pg_temp.r('BUA201'),clock_timestamp()),'own course is eligible for Discovery');
set local role service_role;
select is(public.discovery_preview(pg_temp.s(1),pg_temp.r('BUA202'),'cbt',true,null,300)->>'state','not-offered','outside-list exam is refused');
select is(public.discovery_preview(pg_temp.s(1),pg_temp.r('BUA202'),'study_guide',false)->>'state','not-offered','outside-list titles are refused');
select is(public.save_discovery_cbt(pg_temp.s(1),pg_temp.r('BUA202'),gen_random_uuid(),0,0,'{}')->>'state','not-offered','outside-list save is refused');
select is(public.submit_discovery_cbt(pg_temp.s(1),pg_temp.r('BUA202'),gen_random_uuid(),0,0,'{}')->>'state','not-offered','outside-list submit is refused');
insert into result values('open',public.discovery_preview(pg_temp.s(1),pg_temp.r('BUA201'),'cbt',true,null,300));
select is((select v->>'state' from result where k='open'),'ready','own-list exam opens');
insert into result values('submitted',public.submit_discovery_cbt(pg_temp.s(1),pg_temp.r('BUA201'),gen_random_uuid(),0,0,'{}'));
insert into result values('read',public.discovery_preview(pg_temp.s(1),pg_temp.r('BUA201'),'cbt',false,null,300));
insert into result values('save',public.save_discovery_cbt(pg_temp.s(1),pg_temp.r('BUA201'),gen_random_uuid(),0,0,'{}'));
select is(v->'preview'->'questions','[]'::jsonb,k||': completed free exam has no questions') from result where k<>'open';
select ok(not ((v->'preview'->'result') ? 'answers'),k||': completed free exam has no review') from result where k<>'open';
select ok(v::text !~ 'correct_option|explanation',k||': no answer or explanation anywhere') from result where k<>'open';
reset role;
-- Timed out free exam is score-only too.
update private.discovery_previews set deadline_at=clock_timestamp()-interval '1 second',submitted_at=null,score=null,answers=null,timed_out=false
  where user_id=pg_temp.u(1) and kind='cbt';
set local role service_role;
insert into result values('timeout',public.submit_discovery_cbt(pg_temp.s(1),pg_temp.r('BUA201'),gen_random_uuid(),0,0,'{}'));
select ok((select v->'preview'->'result'->>'timed_out' from result where k='timeout')::boolean,'timeout is graded');
select ok((select v::text !~ 'correct_option|explanation' from result where k='timeout'),'timeout never returns answers');
reset role;
-- A live linked old claim still matches a differently spelled canonical alias.
delete from private.discovery_pass_claims;
delete from private.discovery_claim_keys;
insert into private.discovery_claim_keys(key_version,key_check) values(999,repeat('f',64));
insert into private.discovery_pass_claims(claim_hash,key_version,user_id,expires_at) values(repeat('a',64),999,pg_temp.u(3),now()+interval '1 year');
select is(private.canonical_claim_email(' John.Doe+1@googlemail.com '),'johndoe@gmail.com','SQL canonicalization covers dots, tag and domain alias');
select is(private.canonical_claim_email('Jane.Doe+1@example.test'),'jane.doe@example.test','non-Gmail dots stay, tags go');
select ok(private.discovery_claim_matches(pg_temp.u(4),pg_temp.hash(4)),'old linked alias claim still matches');
select ok(private.discovery_claim_hashes_valid(jsonb_build_array(
  jsonb_build_object('version',999,'hash',repeat('1',64),'check',repeat('f',64)),
  jsonb_build_object('version',999,'hash',repeat('a',64),'check',repeat('f',64)))),'old and new forms can share the same key version');
set local role service_role;
select is(public.discovery_pass_eligibility(pg_temp.s(4),pg_temp.hash(4))->>'eligible','false','old alias claim has no offer');
select is(public.activate_discovery_pass(pg_temp.s(4),pg_temp.hash(4))->>'state','already-claimed','old alias cannot activate');
select is(public.discovery_pass_eligibility(pg_temp.s(5),pg_temp.hash(5))->>'eligible','false','throwaway domain has no offer');
select is(public.activate_discovery_pass(pg_temp.s(5),pg_temp.hash(5))->>'state','trial-not-offered','throwaway activation refuses through existing state');
-- Ordinary exam can still submit after its grant ended. Correctness-bearing reads all become score-only.
insert into result values('ordinary',public.practice_start(pg_temp.s(2),'a4220000-0000-4000-8000-000000000001',pg_temp.r('BUA201'),'new',null,1,300,'[]',1,300,false));
select is((select v->>'state' from result where k='ordinary'),'ready','full plan starts own exam');
reset role;
update public.entitlement_grants set ends_at=clock_timestamp() where user_id=pg_temp.u(2);
set local role service_role;
insert into result values('resume-after-plan',public.practice_attempt(pg_temp.s(2),'a4220000-0000-4000-8000-000000000001'));
select is((select v->>'state' from result where k='resume-after-plan'),'ready','an on-time own-list exam can resume after natural plan expiry');
select ok((select v::text !~ 'correct_option|explanation' from result where k='resume-after-plan'),'expired in-progress exam carries no answer key');
insert into result values('expired-submit',public.practice_submit(pg_temp.s(2),'a4220000-0000-4000-8000-000000000001',gen_random_uuid(),1,0,pg_temp.choice('a4220000-0000-4000-8000-000000000001')));
select is((select v->>'state' from result where k='expired-submit'),'graded','timely submit after plan expiry still scores');
select is((select v->'attempt'->'result'->>'score' from result where k='expired-submit'),'1','expired completion has a real score');
insert into result values('expired-review',public.practice_attempt(pg_temp.s(2),'a4220000-0000-4000-8000-000000000001'));
insert into result values('expired-replay',public.practice_start(pg_temp.s(2),'a4220000-0000-4000-8000-000000000001',pg_temp.r('BUA201'),'new',null,1,300,'[]',1,300,false));
select is(v->'attempt'->'questions','[]'::jsonb,k||': no material after plan expiry') from result where k like 'expired-%';
select is(v->'attempt'->>'review_available','false',k||': review disabled') from result where k like 'expired-%';
reset role;
select is((select count(*)::int from public.quiz_attempt_answers where attempt_id='a4220000-0000-4000-8000-000000000001'),1,'the scored answer is actually stored');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(2),'session_id',pg_temp.s(2),'role','authenticated')::text,true);
select is((select count(*)::int from public.quiz_attempts where user_id=pg_temp.u(2)),1,'score and history row survives');
select is((select count(*)::int from public.quiz_attempt_answers),0,'direct correctness read returns no rows after expiry');
reset role;
-- AI admission, source reads and extraction all require current-list scope plus an AI allowance.
insert into public.ai_practice_documents(id,user_id,institutional_course_id,storage_path,file_name,media_type,declared_bytes,expires_at)
 values('a4230000-0000-4000-8000-000000000001',pg_temp.u(6),pg_temp.c('BUA202'),pg_temp.u(6)::text||'/a4230000-0000-4000-8000-000000000001','notes.txt','text/plain',10,now()+interval '1 day');
set local role service_role;
select is(public.create_ai_practice_document(pg_temp.s(6),pg_temp.c('BUA202'),'notes.txt','text/plain',10,array['trial'])->>'status','not-entitled','outside-list AI admission refused');
select is(public.claim_ai_practice_extraction(pg_temp.s(6),'a4230000-0000-4000-8000-000000000001')->>'state','not-found','outside-list extraction refused');
select is(public.begin_ai_practice_generation(pg_temp.s(6),gen_random_uuid(),'a4230000-0000-4000-8000-000000000001',array['trial'])->>'state','not-entitled','outside-list generation refused');
reset role;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(6),'session_id',pg_temp.s(6),'role','authenticated')::text,true);
select is((select count(*)::int from public.ai_practice_documents),0,'outside-list AI source rows hidden by RLS');
reset role;
select is(private.ai_practice_upload_is_open(pg_temp.u(6)::text||'/a4230000-0000-4000-8000-000000000001'),false,'outside-list AI upload cannot be signed');
reset role;
-- The completed personal set is the owner's; its source and all new work still require current access.
select pg_temp.student(7,'a2-oldsets@example.test','early_access');
set local role service_role;
insert into result values('ai-own-doc',public.create_ai_practice_document(pg_temp.s(7),pg_temp.c('BUA201'),'notes.txt','text/plain',10,array['early_access']));
select lives_ok($q$insert into storage.objects(bucket_id,name) select 'ai-practice-uploads',v->>'storage_path' from result where k='ai-own-doc'$q$,'Storage service can write a valid own-list reserved slot');
insert into result values('ai-own-unused',public.create_ai_practice_document(pg_temp.s(7),pg_temp.c('BUA201'),'other.txt','text/plain',10,array['early_access']));
insert into result values('ai-own-claim',public.claim_ai_practice_extraction(pg_temp.s(7),(select (v->>'document_id')::uuid from result where k='ai-own-doc')));
select is(public.settle_ai_practice_document(pg_temp.s(7),(select (v->>'document_id')::uuid from result where k='ai-own-doc'),
  (select (v->>'claim_id')::uuid from result where k='ai-own-claim'),null,'ready notes',encode(sha256(convert_to('ready notes','UTF8')),'hex'),2),true,'own-list AI source can be settled');
insert into result values('ai-own-generation',public.begin_ai_practice_generation(pg_temp.s(7),'a4240000-0000-4000-8000-000000000001',
  (select (v->>'document_id')::uuid from result where k='ai-own-doc'),array['early_access']));
select is(public.finish_ai_practice_generation(pg_temp.u(7),(select (v->>'generation_id')::uuid from result where k='ai-own-generation'),
  'generated',null,'{"formatVersion":1,"origin":"ai-generated","visibility":"personal","verification":"unverified","questions":[{"id":"q1"}]}',null)->>'status','generated','own-list AI set is stored');
reset role;
update public.entitlement_grants set ends_at=clock_timestamp()-interval '1 second' where user_id=pg_temp.u(7);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(7),'session_id',pg_temp.s(7),'role','authenticated')::text,true);
select is((select count(*)::int from public.ai_practice_generations),1,'previously generated set remains owner-readable without an allowance');
select is((select count(*)::int from public.ai_practice_documents),0,'its source is hidden after AI allowance expiry');
reset role;
set local role service_role;
select throws_ok($q$insert into storage.objects(bucket_id,name) select 'ai-practice-uploads',v->>'storage_path' from result where k='ai-own-unused'$q$,'42501',null,'Storage service cannot use an old signed slot after allowance expiry');
select is(public.begin_ai_practice_generation(pg_temp.s(7),'a4240000-0000-4000-8000-000000000001',
  (select (v->>'document_id')::uuid from result where k='ai-own-doc'),array['early_access'])->>'state','existing','the completed set receipt can replay without reopening its source');
select is(public.begin_ai_practice_generation(pg_temp.s(7),gen_random_uuid(),
  (select (v->>'document_id')::uuid from result where k='ai-own-doc'),array['early_access'])->>'state','allowance-expired','new generation after AI expiry is refused');
reset role;
-- Bookmark ownership persists independently of access to the bookmarked course.
select pg_temp.student(8,'a2-bookmarks@example.test','early_access');
insert into public.student_bookmarks(user_id,course_id) values(pg_temp.u(8),pg_temp.r('BUA202'));
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(8),'session_id',pg_temp.s(8),'role','authenticated')::text,true);
select is((select count(*)::int from public.student_bookmarks),1,'outside-list bookmark remains owned and readable');
select is((select allowed from public.get_my_course_access(array[pg_temp.c('BUA202')])),false,'bookmark never opens outside-list course access');
select throws_ok($q$select * from public.read_published_managed_content(pg_temp.r('BUA202'))$q$,'CI403',null,'bookmark never opens outside-list material');
select throws_ok($q$select * from public.published_cbt_summary(array[pg_temp.r('BUA202')])$q$,'CI403',null,'bookmark never opens outside-list bank counts');
reset role;
select * from finish();
rollback;
