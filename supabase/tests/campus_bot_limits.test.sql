-- Payments part 2b: Campus Bot token limits and paid AI. Paid and Early Access funding by tokens with live tier limits,
-- the bound term, windows stored when they open, worst-case admission, charging from the provider's report for
-- delivered sets only, refills, the platform reserve, undelivered tries, late sets kept, no free pass after a paid
-- grant, the open free-pass exam kept, plan use from the read paths, the student's usage read and the boundary.
-- The provider is never called. Everything rolls back.
begin;
select no_plan();

-- The running First Semester began 100 days ago (it ends in about three weeks); nothing else is in the calendar.
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 100;

create function pg_temp.u(n int) returns uuid language sql immutable as
  $$select ('b8100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql immutable as
  $$select ('b8200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.c(code text) returns uuid language sql stable security definer as
  $$select id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.r(code text) returns uuid language sql stable security definer as
  $$select repository_course_id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.student(n int, email text default null) returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated',coalesce(email,'bot-'||n||'@example.test'),'fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
end$$;
-- A paid plan through part 1: order, checkout, verified payment.
create function pg_temp.paid(n int, plan text default 'standard_semester') returns uuid language plpgsql as $$
declare o uuid;
begin
  o := (public.create_payment_order(pg_temp.s(n),plan,(select revision from public.profiles where id=pg_temp.u(n)),
    gen_random_uuid(),'/access','fake')->'order'->>'id')::uuid;
  perform public.attach_payment_checkout(o,'fake','chk_'||replace(o::text,'-',''),'https://checkout.example.test/c/'||o,
    clock_timestamp()+interval '1 hour');
  perform public.fulfil_payment(o,'fake','ch_'||replace(o::text,'-',''),'succeeded',
    case plan when 'standard_session' then 700000 when 'plus_semester' then 600000 when 'plus_session' then 1100000
      else 400000 end,'NGN','card',clock_timestamp(),'webhook','test');
  -- This test is one transaction, so now() (which stamps usage reservations) is its start: begin the plan before it.
  update public.entitlement_grants set starts_at=now()-interval '1 hour' where order_id=o and plan_part=1;
  update private.payment_orders set paid_at=now()-interval '1 hour' where id=o;
  update private.payment_fulfilments set created_at=now()-interval '1 hour' where order_id=o;
  return o;
end$$;
create function pg_temp.early(n int) returns void language sql as $$
  insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,ai_units,created_by)
    values(pg_temp.u(n),'early_access',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','uncapped',
      null,'bot-test')$$;
-- A settled notes document through the A2 path: reservation, Storage object, extraction claim, settlement.
create function pg_temp.doc(n int, code text default 'BUA201') returns uuid language plpgsql as $$
declare r jsonb; d uuid; claim uuid;
begin
  r := public.create_ai_practice_document(pg_temp.s(n),pg_temp.c(code),'notes.txt','text/plain',10,
    array['trial','early_access','paid']);
  if r->>'status' <> 'created' then raise exception 'document not created: %', r; end if;
  d := (r->>'document_id')::uuid;
  insert into storage.objects(bucket_id,name) values('ai-practice-uploads',r->>'storage_path');
  claim := (public.claim_ai_practice_extraction(pg_temp.s(n),d)->>'claim_id')::uuid;
  perform public.settle_ai_practice_document(pg_temp.s(n),d,claim,null,'ready notes',
    encode(sha256(convert_to('ready notes','UTF8')),'hex'),2);
  return d;
end$$;
create function pg_temp.begin(n int, d uuid, req uuid default gen_random_uuid()) returns jsonb language sql as
  $$select public.begin_ai_practice_generation(pg_temp.s(n),req,d,array['trial','early_access','paid'])$$;
create function pg_temp.gen(j jsonb) returns uuid language sql immutable as $$select (j->>'generation_id')::uuid$$;
create function pg_temp.set() returns jsonb language sql immutable as
  $$select '{"formatVersion":1,"origin":"ai-generated","visibility":"personal","verification":"unverified","questions":[{"id":"q1"}]}'::jsonb$$;
-- 15,000 input + 1,000 cache read + 500 cache write = 16,500 read; 4,000 written: (16,500 + 5 x 4,000) x 1 = 36,500.
create function pg_temp.usage(input int default 15000, output int default 4000) returns jsonb language sql immutable as
  $$select jsonb_build_object('provider','anthropic','model','claude-haiku-5-5','inputTokens',input,'outputTokens',output,
    'cacheReadInputTokens',1000,'cacheCreationInputTokens',500)$$;
create function pg_temp.finish(n int, g uuid, status text default 'generated', usage jsonb default pg_temp.usage())
  returns jsonb language sql as
  $$select public.finish_ai_practice_generation(pg_temp.u(n),g,status,case when status='generated' then null else 'test' end,
    case when status='generated' then pg_temp.set() end,usage)$$;
create function pg_temp.event(g uuid) returns public.ai_usage_events language sql stable as
  $$select e.* from public.ai_usage_events e join public.ai_practice_generations g2 on g2.usage_event_id=e.id where g2.id=g$$;
-- The student's own usage read, through their session.
create function pg_temp.usage_of(n int) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),
    'role','authenticated')::text,true);
  set local role authenticated;
  v := public.get_my_campus_bot_usage();
  reset role;
  return v;
end$$;
grant execute on function pg_temp.usage_of(int) to authenticated;
create function pg_temp.hash(n int) returns jsonb language sql as
  $$select jsonb_build_array(jsonb_build_object('version',999,'hash',left(repeat(to_hex(n),64),64),'check',repeat('f',64)))$$;

select public.admin_set_sales_open(true,'Ops','2b test');

-- ---------------------------------------------------------------------------
-- Settings, and the retired per-semester set count.
-- ---------------------------------------------------------------------------
select is((select jsonb_build_array(writing_model,check_model,check_enabled) from private.campus_bot_settings),
  '["haiku",null,false]','Haiku writes; the check step is off until the Campus Bot test');
select is((select jsonb_build_array(global_daily_generations,paid_daily_reserve,undelivered_per_day) from private.ai_practice_policy),
  '[500,150,10]','platform: 500 a day, 150 kept for paying students, 10 undelivered tries a day');
select is((select provider_model from private.campus_bot_models where model='haiku'),'claude-haiku-5-5','each model names its provider id');
select is((select count(*)::int from private.plan_catalogue where ai_sets_per_term<>0),0,'no plan carries a per-semester set count');
select is((select set_max from private.campus_bot_writing(5)),60000::bigint,
  'a Haiku set costs at most (20,000 + 5 x 8,000) x 1 = 60,000');

-- ---------------------------------------------------------------------------
-- A paid Standard student: tokens, live limits, windows stored when they open.
-- ---------------------------------------------------------------------------
select pg_temp.student(20);
create temporary table o20 as select pg_temp.paid(20) id;
select is((select ai_sets from private.payment_orders where id=(select id from o20)),0,'a new order stores no set count');
select is((select jsonb_build_array(source,tier,session_hours,session_tokens,week_days,week_tokens)
  from private.campus_bot_plan(pg_temp.u(20),clock_timestamp(),array['paid','early_access'])),
  '["paid","standard",5,350000,7,700000]','paid Standard funds by tokens with the tier''s limits');
select is((select jsonb_build_array(a->>'mode',a->'total',a->>'source') from
  (select private.ai_allowance_admission(pg_temp.u(20),array['trial','early_access','paid']) a) x),
  '["tokens",null,"paid"]','no set count for a paid plan');
create temporary table d20 as select pg_temp.doc(20) id;
create temporary table g20 as select pg_temp.begin(20,(select id from d20)) j;
select is((select jsonb_build_array(j->>'state',j->>'model',j->'max_output_tokens') from g20),
  '["started","claude-haiku-5-5",8000]','admitted with the model and written-token cap it must use');
select is((select jsonb_build_array(funding_source,reserved_tokens,state) from pg_temp.event((select pg_temp.gen(j) from g20)) e),
  '["paid",60000,"reserved"]','the worst-case cost is reserved against paid funding');
select is((select count(*)::int from private.campus_bot_windows where user_id=pg_temp.u(20)),2,'the first request opens both windows');
select ok((select bool_and(case kind when 'session' then ends_at=starts_at+interval '5 hours' else ends_at=starts_at+interval '7 days' end)
  from private.campus_bot_windows where user_id=pg_temp.u(20)),'each window''s end is stored: 5 hours and a rolling 7 days');
select is((select jsonb_build_array(model,provider_model,price_weight,written_token_weight,read_tokens_max,written_tokens_max)
  from private.campus_bot_requests where generation_id=(select pg_temp.gen(j) from g20)),
  '["haiku","claude-haiku-5-5",1,5,20000,8000]','the request records the model and weights it will be charged at');
select is((select jsonb_build_array(v->'state',v->'tier',v->'session'->'in_flight',v->'session'->'left',v->'next_set_max',v->'can_start')
  from (select pg_temp.usage_of(20) v) x),'["tokens","standard",60000,290000,60000,true]',
  'the usage read shows the set in flight and what is left');
select is((select (v->'session'->>'resets_at')::timestamptz from (select pg_temp.usage_of(20) v) x),
  (select ends_at from private.campus_bot_windows where user_id=pg_temp.u(20) and kind='session'),'and when the session resets');
select is((pg_temp.begin(20,(select id from d20)))->>'state','busy','one generation in flight');
-- A weight changed mid-flight never changes what an admitted set is charged.
update private.campus_bot_models set price_weight=3 where model='haiku';
select is(pg_temp.finish(20,(select pg_temp.gen(j) from g20))->>'status','generated','the set is delivered');
update private.campus_bot_models set price_weight=1 where model='haiku';
select is((select jsonb_build_array(state,charged_tokens) from pg_temp.event((select pg_temp.gen(j) from g20)) e),
  '["consumed",36500]','charged from the provider''s report at the recorded weight: (16,500 + 5 x 4,000) x 1');
select is((select jsonb_build_array(read_tokens,written_tokens,charged_tokens) from private.campus_bot_requests
  where generation_id=(select pg_temp.gen(j) from g20)),'[16500,4000,36500]','every prompt token is read, cache included');
select is((select jsonb_build_array(v->'session'->'used',v->'session'->'in_flight',v->'session'->'left',v->'week'->'left')
  from (select pg_temp.usage_of(20) v) x),'[36500,0,313500,663500]','both windows show the charge');
select is((select count(*)::int from private.plan_use_events where order_id=(select id from o20) and kind='campus-bot-reply'),1,
  'a delivered set is plan use for refunds');
select is((select (e->'counts'->>'campus_bot_replies')::int from (select public.refund_eligibility((select id from o20),null,clock_timestamp()) e) x),1,
  'and refund_assessment sees it');

-- Failures, refusals and timeouts charge nothing.
create temporary table g20b as select pg_temp.begin(20,(select id from d20)) j;
select is(pg_temp.finish(20,(select pg_temp.gen(j) from g20b),'flagged_for_review')->>'status','flagged_for_review','a flagged result');
select is((select jsonb_build_array(state,charged_tokens) from pg_temp.event((select pg_temp.gen(j) from g20b)) e),
  '["released",0]','is released and charged 0');
create temporary table g20c as select pg_temp.begin(20,(select id from d20)) j;
select is(pg_temp.finish(20,(select pg_temp.gen(j) from g20c),'failed',null)->>'status','failed','a timeout (no usage report)');
select is((pg_temp.event((select pg_temp.gen(j) from g20c))).charged_tokens,0::bigint,'is charged 0');
select is((select v->'session'->'used' from (select pg_temp.usage_of(20) v) x),'36500','the windows are unchanged');

-- Limits are live from the tier: a team change applies at once; the stored reset time does not move.
update private.campus_bot_tiers set session_tokens=90000 where tier='standard';
create temporary table g20d as select pg_temp.begin(20,(select id from d20)) j;
select is((select j->>'state' from g20d),'session-limit','a set starts only if the session covers its worst case (53,500 left)');
select is((select (j->>'resets_at')::timestamptz from g20d),
  (select ends_at from private.campus_bot_windows where user_id=pg_temp.u(20) and kind='session'),'with the session''s reset time');
update private.campus_bot_tiers set session_tokens=350000, week_tokens=90000 where tier='standard';
select is((pg_temp.begin(20,(select id from d20)))->>'state','week-limit','and only if the week covers it');
update private.campus_bot_tiers set week_tokens=700000, session_hours=1 where tier='standard';
select is((select (v->'session'->>'resets_at')::timestamptz from (select pg_temp.usage_of(20) v) x),
  (select ends_at from private.campus_bot_windows where user_id=pg_temp.u(20) and kind='session'),
  'a reset time already shown never moves when the setting changes');
update private.campus_bot_tiers set session_hours=5 where tier='standard';

-- A started set always finishes: an overrun ends the window below zero.
create temporary table g20e as select pg_temp.begin(20,(select id from d20)) j;
select is((select j->>'state' from g20e),'started','admitted with 313,500 left');
select is(pg_temp.finish(20,(select pg_temp.gen(j) from g20e),'generated',pg_temp.usage(300000,8000))->>'status','generated',
  'a set that overran its estimate is still delivered');
select is((select jsonb_build_array((v->'session'->>'left')::int < 0,v->'can_start') from (select pg_temp.usage_of(20) v) x),
  '[true,false]','the session ends below zero and no new set can start');
select is((pg_temp.begin(20,(select id from d20)))->>'state','session-limit','refused until it resets');

-- A refill: the next request opens fresh windows; nothing is deleted.
select is(public.admin_campus_bot_refill(pg_temp.u(20),'Ops','support ticket 7')->>'state','refilled','one student is refilled');
select is((select jsonb_build_array(v->'session'->'used',v->'session'->'left',v->'session'->'resets_at')
  from (select pg_temp.usage_of(20) v) x),'[0,350000,null]','their windows start again at the next request');
create temporary table g20f as select pg_temp.begin(20,(select id from d20)) j;
select is((select j->>'state' from g20f),'started','and a set starts');
select is(pg_temp.finish(20,(select pg_temp.gen(j) from g20f))->>'status','generated','and is delivered');
select is((select count(*)::int from private.campus_bot_windows where user_id=pg_temp.u(20)),4,'new windows, old ones kept');
select is((select count(*)::int from private.entitlement_events where event='campus-bot.refilled' and user_id=pg_temp.u(20)),1,
  'the refill is audited');
select is(public.admin_campus_bot_refill(gen_random_uuid(),'Ops','support ticket 7')->>'state','not-found','an unknown student');
select throws_ok($$select public.admin_campus_bot_refill(null,'Ops','')$$,'22023',null,'a refill needs a reason');

-- ---------------------------------------------------------------------------
-- Early Access gets Plus limits; the higher tier funds; limits are never added.
-- ---------------------------------------------------------------------------
select pg_temp.student(21);
select pg_temp.early(21);
select is((select jsonb_build_array(source,tier,session_tokens,week_tokens)
  from private.campus_bot_plan(pg_temp.u(21),clock_timestamp(),array['paid','early_access'])),
  '["early_access","plus",700000,1400000]','Early Access members get Plus limits during the free month');
create temporary table o21 as select pg_temp.paid(21) id;
select is((select jsonb_build_array(source,tier,session_tokens)
  from private.campus_bot_plan(pg_temp.u(21),clock_timestamp(),array['paid','early_access'])),
  '["early_access","plus",700000]','Early Access Plus outranks paid Standard; the limits are not added');
select is((select (v->'session'->>'limit')::int from (select pg_temp.usage_of(21) v) x),700000,'the usage read shows one limit');
select pg_temp.student(22);
select pg_temp.early(22);
create temporary table o22 as select pg_temp.paid(22,'plus_semester') id;
select is((select source from private.campus_bot_plan(pg_temp.u(22),clock_timestamp(),array['paid','early_access'])),
  'early_access','between equal tiers Early Access funds');
update public.entitlement_grants set ends_at=clock_timestamp()-interval '1 second' where user_id=pg_temp.u(22) and source='early_access';
select is((select jsonb_build_array(source,tier) from private.campus_bot_plan(pg_temp.u(22),clock_timestamp(),array['paid','early_access'])),
  '["paid","plus"]','after the free month the paid plan funds');

-- ---------------------------------------------------------------------------
-- Paid funding follows the bound term: no slack, no rollover.
-- ---------------------------------------------------------------------------
select pg_temp.student(23);
create temporary table o23 as select pg_temp.paid(23) id;
select ok(exists(select 1 from private.campus_bot_plan(pg_temp.u(23),clock_timestamp(),array['paid'])),'bound to the current term: funds');
update public.entitlement_grants set course_term_id=null where order_id=(select id from o23);
select ok(not exists(select 1 from private.campus_bot_plan(pg_temp.u(23),clock_timestamp(),array['paid'])),
  'a grant not bound to the current term funds nothing');
select is(private.ai_allowance_admission(pg_temp.u(23),array['trial','early_access','paid'])->>'state','not-entitled',
  'and admits nothing');
update public.entitlement_grants set course_term_id=(select (private.current_course_scope(pg_temp.u(23),clock_timestamp())->>'term_id')::uuid)
  where order_id=(select id from o23);
select ok(private.grant_effective_end((select g from public.entitlement_grants g where order_id=(select id from o23)))
    < (select ends_at from public.entitlement_grants where order_id=(select id from o23)),
  'the stored end carries slack past the semester');
select ok(not exists(select 1 from private.campus_bot_plan(pg_temp.u(23),
    private.grant_effective_end((select g from public.entitlement_grants g where order_id=(select id from o23)))+interval '1 day',
    array['paid'])),'after the semester''s end the slack funds nothing');
select pg_temp.student(24);
create temporary table o24 as select pg_temp.paid(24,'standard_session') id;
select is((select count(*)::int from private.campus_bot_plan(pg_temp.u(24),clock_timestamp(),array['paid'])),1,
  'a Session plan funds the current half');
select is((select grant_id from private.campus_bot_plan(pg_temp.u(24),clock_timestamp(),array['paid'])),
  (select id from public.entitlement_grants where order_id=(select id from o24) and plan_part=1),'through its first half only');

-- ---------------------------------------------------------------------------
-- The platform's day and its reserve for paying students; undelivered tries.
-- ---------------------------------------------------------------------------
create temporary table d21 as select pg_temp.doc(21) id;
update private.ai_practice_policy set global_daily_generations=(select count(*)::int+1 from public.ai_usage_events
  where reserved_at>=date_trunc('day',clock_timestamp() at time zone 'utc') at time zone 'utc'), paid_daily_reserve=1;
select is((pg_temp.begin(21,(select id from d21)))->>'state','capacity','the last slot of the day is kept for paying students');
update private.campus_bot_settings set writing_model='haiku';
create temporary table d22 as select pg_temp.doc(22) id;
select is((pg_temp.begin(22,(select id from d22)))->>'state','started','a paid set still gets it');
update private.ai_practice_policy set global_daily_generations=500, paid_daily_reserve=150;
update private.ai_practice_policy set undelivered_per_day=2;
select is((pg_temp.begin(20,(select id from d20)))->>'state','undelivered-limit',
  'after two undelivered tries today, no more tries');
update private.ai_practice_policy set undelivered_per_day=10;

-- ---------------------------------------------------------------------------
-- A set admitted before access ends is delivered and charged; past sets stay with their owner.
-- ---------------------------------------------------------------------------
select pg_temp.student(25);
create temporary table o25 as select pg_temp.paid(25) id;
create temporary table d25 as select pg_temp.doc(25) id;
create temporary table g25 as select pg_temp.begin(25,(select id from d25)) j;
select is((select j->>'state' from g25),'started','admitted while the plan lasts');
select is(public.refund_order((select id from o25),'our-fault',gen_random_uuid(),array[repeat('a',64)],'Ops','wrong course')->>'state',
  'refund-pending','the plan is refunded while the set is running');
select is(pg_temp.finish(25,(select pg_temp.gen(j) from g25))->>'status','generated','the set is still delivered');
select is((pg_temp.event((select pg_temp.gen(j) from g25))).charged_tokens,36500::bigint,'and charged');
select is((pg_temp.begin(25,(select id from d25)))->>'state','not-entitled','no new set after the refund');

-- ---------------------------------------------------------------------------
-- The writing model is a team setting, recorded on each request.
-- ---------------------------------------------------------------------------
select is(public.admin_set_campus_bot_writing_model('sonnet','Ops','evaluation')->>'state','changed','the team switches models');
select is((select set_max from private.campus_bot_writing(5)),1200000::bigint,'a Sonnet set costs 20 times as much');
select is((pg_temp.begin(23,(select pg_temp.doc(23))))->>'state','session-limit','so a Standard student cannot start one');
select is(public.admin_set_campus_bot_writing_model('haiku','Ops','back to Haiku')->>'state','changed','and back');
select throws_ok($$select public.admin_set_campus_bot_writing_model('gpt','Ops','typo')$$,'22023',null,'only a known model');
select is(public.admin_set_ai_limits(800,200,null,'Ops','growth')->>'daily','800','the platform limit is a setting');
select is((select jsonb_build_array(global_daily_generations,paid_daily_reserve,undelivered_per_day) from private.ai_practice_policy),
  '[800,200,10]','unnamed settings are unchanged');
select is(public.admin_set_ai_limits(0,null,null,'Ops','emergency stop')->>'daily','0','0 a day stops everyone');
select public.admin_set_ai_limits(800,null,null,'Ops','resume');
select throws_ok($$select public.admin_set_ai_limits(null,null,null,'Ops','nothing')$$,'22023',null,'name at least one');
select is((select count(*)::int from private.entitlement_events where event='ai.limits-changed'),3,'limit changes are audited');

-- ---------------------------------------------------------------------------
-- No free pass after any paid grant; buying keeps an open free-pass exam.
-- ---------------------------------------------------------------------------
delete from private.discovery_pass_claims;
delete from private.discovery_claim_keys;
insert into private.discovery_claim_keys(key_version,key_check) values(999,repeat('f',64));
select pg_temp.student(26);
select is(public.discovery_pass_eligibility(pg_temp.s(26),pg_temp.hash(26))->>'eligible','true','a new student is offered the pass');
create temporary table o26 as select pg_temp.paid(26) id;
select public.refund_order((select id from o26),'our-fault',gen_random_uuid(),array[repeat('b',64)],'Ops','test refund');
select is(public.discovery_pass_eligibility(pg_temp.s(26),pg_temp.hash(26))->>'eligible','false','not after a paid grant, even refunded');
select is(public.activate_discovery_pass(pg_temp.s(26),pg_temp.hash(26),null)->>'state','trial-not-offered','and it cannot be activated');
select pg_temp.student(27);
select is(public.activate_discovery_pass(pg_temp.s(27),pg_temp.hash(27),null)->>'state','activated','a pass is activated');
select is(public.discovery_preview(pg_temp.s(27),pg_temp.r('BUA201'),'cbt',true,null,300)->>'state','ready','its exam opens');
create temporary table o27 as select pg_temp.paid(27) id;
select is(public.discovery_preview(pg_temp.s(27),pg_temp.r('BUA201'),'cbt',false,null,300)->>'state','ready',
  'after buying, the open exam is still there');
select is(public.submit_discovery_cbt(pg_temp.s(27),pg_temp.r('BUA201'),gen_random_uuid(),0,0,'{}')->'preview'->'questions',
  '[]'::jsonb,'and finishes score-only');
select is(public.discovery_preview(pg_temp.s(27),pg_temp.r('BUA201'),'study_guide',false)->>'state','full-access',
  'a preview never opened reads as full access');

-- ---------------------------------------------------------------------------
-- Plan use from the read paths: recorded with the allowed read; GST never counts.
-- ---------------------------------------------------------------------------
create temporary table items as
  select distinct on (i.course_id, i.kind) i.course_id, i.kind, i.id from public.managed_content_items i
  where i.published_revision is not null and i.kind in ('note','theory_question')
  order by i.course_id, i.kind, i.id;
create function pg_temp.item(code text, k text) returns text language sql stable as
  $$select id::text from items where course_id=pg_temp.r(code) and kind=k$$;
select ok(pg_temp.item('ACC-CM201','theory_question') is not null and pg_temp.item('ACC-CM201','note') is not null,
  'fixture: the course has published notes and theory');
select is(public.record_plan_use(pg_temp.s(20),'theory-reveal',pg_temp.r('ACC-CM201'),pg_temp.item('ACC-CM201','theory_question'))->>'state',
  'recorded','a theory reveal on the paid course is recorded');
select is(public.record_plan_use(pg_temp.s(20),'notes-topic',pg_temp.r('ACC-CM201'),pg_temp.item('ACC-CM201','note'))->>'state',
  'recorded','an opened notes topic is recorded');
select is(public.record_plan_use(pg_temp.s(20),'notes-topic',pg_temp.r('ACC-CM201'),pg_temp.item('ACC-CM201','note'))->>'state',
  'not-counted','once per order and topic');
select is((select jsonb_build_array(e->'counts'->'notes_topics',e->'counts'->'practice_answers')
  from (select public.refund_eligibility((select id from o20),null,clock_timestamp()) e) x),'[1,1]','refund_assessment counts them');
select is(public.record_plan_use(pg_temp.s(20),'theory-reveal',pg_temp.r('ACC-CM201'),pg_temp.item('ACC-CM201','note'))->>'state',
  'not-allowed','a reference of another kind is refused');
select is(public.record_plan_use(pg_temp.s(20),'notes-topic',pg_temp.r('ACC-CM201'),gen_random_uuid()::text)->>'state',
  'not-allowed','an unknown reference is refused');
select is(public.record_plan_use(pg_temp.s(20),'notes-topic',pg_temp.r('BUA202'),coalesce(pg_temp.item('BUA202','note'),
  gen_random_uuid()::text))->>'state','not-allowed','a course outside the list is refused');
select is(public.record_plan_use(gen_random_uuid(),'notes-topic',pg_temp.r('ACC-CM201'),pg_temp.item('ACC-CM201','note'))->>'state',
  'signed-out','a session that is not live records nothing');
select throws_ok($$select public.record_plan_use(pg_temp.s(20),'exam',pg_temp.r('BUA201'),gen_random_uuid()::text)$$,'22023',null,
  'only notes topics and theory reveals come this way');
select pg_temp.student(28);
select is(public.record_plan_use(pg_temp.s(28),'notes-topic',pg_temp.r('ACC-CM201'),pg_temp.item('ACC-CM201','note'))->>'state',
  'not-allowed','a student without access to the course records nothing');
select is((select count(*)::int from private.plan_use_events where course_id=pg_temp.r('GST111')),0,'GST never counts');

-- ---------------------------------------------------------------------------
-- Boundary.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['private.campus_bot_settings','private.campus_bot_windows',
    'private.campus_bot_refills','private.campus_bot_requests']) t, unnest(array['anon','authenticated','service_role']) r,
    unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,t,p)),0,'no API role reads or writes the new tables');
select ok(has_function_privilege('service_role',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE')
  and not has_function_privilege('anon',f,'EXECUTE'),'service role only: '||f) from unnest(array[
  'public.record_plan_use(uuid,text,uuid,text)','public.admin_campus_bot_refill(uuid,text,text)',
  'public.admin_set_ai_limits(integer,integer,integer,text,text)','public.admin_set_campus_bot_writing_model(text,text,text)']) f;
select ok(has_function_privilege('authenticated','public.get_my_campus_bot_usage()','EXECUTE')
  and not has_function_privilege('anon','public.get_my_campus_bot_usage()','EXECUTE'),'a student reads their own usage; anon cannot');
select ok(not has_function_privilege(r,f,'EXECUTE'),'private helper closed to '||r||': '||f)
  from unnest(array['anon','authenticated','service_role']) r, unnest(array[
  'private.campus_bot_plan(uuid,timestamptz,text[])','private.campus_bot_writing(integer)',
  'private.campus_bot_open_window(uuid,text,timestamptz)','private.campus_bot_window_use(uuid)',
  'private.campus_bot_window_view(private.campus_bot_windows,integer)','private.ai_funding_current(uuid,timestamptz)']) f;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.proname in ('campus_bot_plan','campus_bot_writing','campus_bot_open_window','campus_bot_window_use',
    'campus_bot_window_view','ai_funding_current','get_my_campus_bot_usage','record_plan_use','admin_campus_bot_refill',
    'admin_set_ai_limits','admin_set_campus_bot_writing_model','begin_ai_practice_generation','finish_ai_practice_generation')
    and n.nspname in ('public','private') and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])),0,
  'every 2b function is security definer with an empty search_path');
select throws_ok($$select pg_temp.usage_of(999)$$,'42501',null,'no usage read without a live session');

select * from finish();
rollback;
