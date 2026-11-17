-- "Quiz me on this topic" (20261117110000_campus_bot_topic_sets.sql): the switch, the topic a student may use (a
-- readable note, or the free pass's pinned topic), funding by plan windows or the pass's one set, the reservation with
-- and without the calculation check, each call's input and output caps, settlement from the provider's reports for a
-- delivered set only (never past the reservation), delivery re-checking the topic and the funding, retries answered only
-- after every check, the student's last questions, the shared limits, read-back through the student's own session, and
-- the boundary.
-- The provider is never called. Everything rolls back.
begin;
select no_plan();

-- The running First Semester began 100 days ago; nothing else is in the calendar.
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 100;

create function pg_temp.u(n int) returns uuid language sql immutable as
  $$select ('b9100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql immutable as
  $$select ('b9200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.r(code text) returns uuid language sql stable security definer as
  $$select repository_course_id from public.institutional_courses where course_code=code limit 1$$;
-- A course's first published notes topic, as students see it first.
create function pg_temp.topic(code text) returns uuid language sql stable security definer as
  $$select i.id from public.managed_content_items i where i.course_id = pg_temp.r(code) and i.kind = 'note'
      and i.published_revision is not null order by i.position nulls last, i.created_at, i.id limit 1$$;
create function pg_temp.student(n int) returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated','quiz-'||n||'@example.test','fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
end$$;
create function pg_temp.paid(n int, plan text default 'standard_semester') returns uuid language plpgsql as $$
declare o uuid;
begin
  o := (public.create_payment_order(pg_temp.s(n),plan,(select revision from public.profiles where id=pg_temp.u(n)),
    gen_random_uuid(),'/access','fake')->'order'->>'id')::uuid;
  perform public.attach_payment_checkout(o,'fake','chk_'||replace(o::text,'-',''),'https://checkout.example.test/c/'||o,
    clock_timestamp()+interval '1 hour');
  perform public.fulfil_payment(o,'fake','ch_'||replace(o::text,'-',''),'succeeded',
    case plan when 'plus_semester' then 600000 else 400000 end,'NGN','card',clock_timestamp(),'webhook','test');
  return o;
end$$;
create function pg_temp.hash(n int) returns jsonb language sql as
  $$select jsonb_build_array(jsonb_build_object('version',999,'hash',left(repeat(to_hex(n),64),64),'check',repeat('f',64)))$$;
create function pg_temp.quiz(n int, code text, item uuid, req uuid default gen_random_uuid()) returns jsonb language sql as
  $$select public.begin_campus_bot_topic_set(pg_temp.s(n),req,pg_temp.r(code),item,array['trial','early_access','paid'])$$;
create function pg_temp.gen(j jsonb) returns uuid language sql immutable as $$select (j->>'generation_id')::uuid$$;
-- A set in the stored format for a generation's topic and revision, with q questions.
create function pg_temp.topic_set(g uuid, q int default 5) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('formatVersion',1,'origin','ai-generated','visibility','personal','verification','unverified',
    'course',jsonb_build_object('code','BUA201','title','Principles'),
    'source',jsonb_build_object('kind','notes-topic','courseId',x.source_course_id,'itemId',x.source_item_id,
      'revision',x.source_revision,'title','A topic','number',1,'pinned',false,'sha256',repeat('a',64),'charCount',100,
      'passageCount',2),
    'questions',(select jsonb_agg(jsonb_build_object('id','ai_'||lpad(to_hex(n),24,'0'),'prompt','Question '||n||'?',
      'options',jsonb_build_array('Right','Wrong one','Wrong two','Wrong three'),'correctOption',0,'explanation','Because.',
      'section','Topic','grounding',jsonb_build_object('documentId',x.source_item_id,'sourceSha256',repeat('a',64),
        'passageId','N1','passageStart',0,'passageEnd',10,'quote','a quote here')) order by n)
      from generate_series(1,q) n))
  from public.ai_practice_generations x where x.id = g$$;
-- 15,000 input + 1,000 cache read + 500 cache write = 16,500 read; 4,000 written: (16,500 + 5 x 4,000) x 1 = 36,500.
create function pg_temp.usage(model text default 'claude-haiku-5-5', input int default 15000, output int default 4000)
  returns jsonb language sql immutable as
  $$select jsonb_build_object('provider','anthropic','model',model,'inputTokens',input,'outputTokens',output,
    'cacheReadInputTokens',1000,'cacheCreationInputTokens',500,'estimatedCostUsd',0.004,'durationMs',9000)$$;
create function pg_temp.done(n int, g uuid, status text default 'generated', q int default 5,
  check_usage jsonb default null) returns jsonb language sql as
  $$select public.finish_campus_bot_topic_set(pg_temp.u(n),g,status,case when status='generated' then null else 'test' end,
    case when status='generated' then pg_temp.topic_set(g,q) end,pg_temp.usage(),check_usage)$$;
create function pg_temp.event(g uuid) returns public.ai_usage_events language sql stable as
  $$select e.* from public.ai_usage_events e join public.ai_practice_generations g2 on g2.usage_event_id=e.id where g2.id=g$$;
-- A student's own read of a set, through their session.
create function pg_temp.read_as(n int, g uuid) returns integer language plpgsql as $$
declare v integer;
begin
  perform set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),
    'role','authenticated')::text,true);
  set local role authenticated;
  select count(*)::int into v from public.ai_practice_generations where id = g;
  reset role;
  return v;
end$$;
grant execute on function pg_temp.read_as(int, uuid) to authenticated;

select public.admin_set_sales_open(true,'Ops','topic set test');
create temporary table t as select pg_temp.topic('BUA201') bua, pg_temp.topic('GST111') gst;
select isnt((select bua from t),null,'BUA201 has a published notes topic');
select isnt((select gst from t),null,'GST111 has a published notes topic');

-- ---------------------------------------------------------------------------
-- Settings and storage.
-- ---------------------------------------------------------------------------
select is((select jsonb_build_array(check_model,check_enabled,topic_sets_enabled) from private.campus_bot_settings),
  '["sonnet",false,false]','the sets'' checker is Sonnet; upload sets stay unchecked; quizzes are off until switched on');
select is((select jsonb_build_array(read_tokens_max,written_tokens_max) from private.campus_bot_request_caps where step='check'),
  '[10000,3000]','a check reads a whole set and the passages it cites');
select is((select global_daily_generations from private.ai_practice_policy),2000,'2,000 newly written sets a day');
select col_default_is('public','ai_practice_generations','source_kind','upload','existing sets are uploads');

-- ---------------------------------------------------------------------------
-- The switch, the topic and access.
-- ---------------------------------------------------------------------------
select pg_temp.student(1);
select throws_ok($$insert into public.ai_practice_generations (user_id,request_id,institutional_course_id,usage_event_id,
    expires_at,source_kind) values (pg_temp.u(1),gen_random_uuid(),(select id from public.institutional_courses limit 1),
    gen_random_uuid(),now(),'notes-topic')$$,'23514',null,'a topic set names its topic and revision');
create temporary table o1 as select pg_temp.paid(1) id;
select is(pg_temp.quiz(1,'BUA201',(select bua from t))->>'state','disabled','off by default: nothing is admitted');
select is((select count(*)::int from public.ai_usage_events where user_id=pg_temp.u(1)),0,'and nothing is reserved');
select public.admin_set_campus_bot_feature('topic-sets',true,'Ops','topic set test');

select is(pg_temp.quiz(1,'BUA201',gen_random_uuid())->>'state','not-found','an unknown topic');
select is(pg_temp.quiz(1,'BUA201',(select gst from t))->>'state','not-found','another course''s topic');
select pg_temp.student(2);
select is(pg_temp.quiz(2,'BUA201',(select bua from t))->>'state','locked','a course the student cannot read');
select is(pg_temp.quiz(2,'GST111',(select gst from t))->>'state','not-entitled','a free course, but no Campus Bot');

-- A published note too short for five fair questions: the item, its revision, then publishing it, which keeps its
-- passages (the revision must exist when published_revision is set).
create temporary table short_note as select gen_random_uuid() id;
insert into public.managed_content_items (id, course_id, kind, current_revision, created_by)
  select id, pg_temp.r('GST111'), 'note', 1, pg_temp.u(1) from short_note;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select id, 1, '{"title":"A short note","body":"Only a few words here, far too few for a quiz."}', pg_temp.u(1) from short_note;
update public.managed_content_items set published_revision = 1 where id = (select id from short_note);
select ok((select count(*) from private.note_passages where item_id = (select id from short_note)) > 0,
  'the short note is published with its passages');
select is(pg_temp.quiz(1,'GST111',(select id from short_note))->>'state','too-short','under 150 words: no set');

-- ---------------------------------------------------------------------------
-- A paid student: admission, the reservation, settlement and read-back.
-- ---------------------------------------------------------------------------
create temporary table r1 as select gen_random_uuid() req;
create temporary table q1 as select pg_temp.quiz(1,'BUA201',(select bua from t),(select req from r1)) j;
select is((select j->>'state' from q1),'started','a paid student''s quiz starts');
select is((select jsonb_build_array(j->>'model',j->'max_input_tokens',j->'max_output_tokens',j->'check') from q1),
  '["claude-haiku-5-5",20000,8000,null]',
  'the writing model and its input and output caps, and no check on a course that is not a calculation course');
select ok((select jsonb_array_length(j->'passages') > 0 and j->'passages'->0 ? 'heading' and j->'passages'->0 ? 'body'
  from q1),'the topic''s passages, in reading order');
select is((select jsonb_build_array(j->'topic'->'number',j->'topic'->'pinned',j->'previous') from q1),'[1,false,[]]',
  'the topic''s place on the notes page, and no earlier questions yet');
select is((select jsonb_build_array(e.feature,e.funding_source,e.reserved_tokens) from pg_temp.event(pg_temp.gen((select j from q1))) e),
  '["topic_practice","paid",60000]','reserved at the writing step''s worst case: (20,000 + 5 x 8,000) x 1');
select is((select jsonb_build_array(g.source_kind,g.source_item_id,g.source_revision is not null,g.document_id is null)
  from public.ai_practice_generations g where g.id=pg_temp.gen((select j from q1))),
  jsonb_build_array('notes-topic',(select bua from t),true,true),'stored as a topic set, not an upload');
select is((select array_agg(step) from private.campus_bot_requests where generation_id=pg_temp.gen((select j from q1))),
  array['writing'],'one provider call reserved');
select is(pg_temp.quiz(1,'BUA201',(select bua from t))->>'state','busy','one set in flight per student');
select is(pg_temp.quiz(1,'BUA201',(select bua from t),(select req from r1))->>'status','running',
  'the same request is the same set');
select is(pg_temp.quiz(1,'GST111',(select gst from t),(select req from r1))->>'state','request-conflict',
  'a request id is for one topic');

select throws_ok($$select public.finish_campus_bot_topic_set(pg_temp.u(1),pg_temp.gen((select j from q1)),'generated',null,
    pg_temp.topic_set(pg_temp.gen((select j from q1))) || '{"source":{"kind":"upload","fileName":"x.pdf"}}',null,null)$$,
  '22023',null,'a topic set names its topic');
select throws_ok($$select public.finish_campus_bot_topic_set(pg_temp.u(1),pg_temp.gen((select j from q1)),'generated',null,
    jsonb_set(pg_temp.topic_set(pg_temp.gen((select j from q1))),'{source,itemId}',to_jsonb(gen_random_uuid()::text)),null,null)$$,
  '22023',null,'and the topic it was admitted for');
select throws_ok($$select public.finish_campus_bot_topic_set(pg_temp.u(1),pg_temp.gen((select j from q1)),'generated',null,
    pg_temp.topic_set(pg_temp.gen((select j from q1)),6),null,null)$$,'22023',null,'five questions at most');
select throws_ok($$select public.finish_campus_bot_topic_set(pg_temp.u(1),pg_temp.gen((select j from q1)),'failed',null,
    pg_temp.topic_set(pg_temp.gen((select j from q1))),null,null)$$,'22023',null,'only a delivered set has a set');

select is(pg_temp.done(1,pg_temp.gen((select j from q1)))->>'status','generated','delivered');
select is((select jsonb_build_array(e.state,e.charged_tokens) from pg_temp.event(pg_temp.gen((select j from q1))) e),
  '["consumed",36500]','charged from the provider''s report: (16,500 + 5 x 4,000) x 1');
select is((select charged_tokens from private.campus_bot_requests where generation_id=pg_temp.gen((select j from q1))),
  36500::bigint,'the writing step settled');
select is(pg_temp.done(1,pg_temp.gen((select j from q1)))->>'state','already-finished','settled once');
select is((select count(*)::int from private.plan_use_events where user_id=pg_temp.u(1) and kind='campus-bot-reply'),1,
  'a delivered set on a paid course is plan use');
select is(pg_temp.quiz(1,'BUA201',(select bua from t),(select req from r1)),
  jsonb_build_object('state','existing','generation_id',pg_temp.gen((select j from q1)),'status','generated'),
  'a retry of the same request gets the delivered set, free');
select is(pg_temp.read_as(1,pg_temp.gen((select j from q1))),1,'the student reads their own set');
select pg_temp.student(6);
select is(pg_temp.read_as(6,pg_temp.gen((select j from q1))),0,'and nobody else does');

create temporary table q1b as select pg_temp.quiz(1,'BUA201',(select bua from t)) j;
select is((select jsonb_array_length(j->'previous') from q1b),5,'the last questions on the topic go with the next set');
select is((select j->'previous'->>0 from q1b),'Question 1?','newest set first, in question order');
select is(pg_temp.done(1,pg_temp.gen((select j from q1b)),'failed')->>'status','failed','an undelivered set');
select is((select jsonb_build_array(e.state,e.charged_tokens) from pg_temp.event(pg_temp.gen((select j from q1b))) e),
  '["released",0]','is charged nothing');

-- ---------------------------------------------------------------------------
-- A calculation course: the check is reserved and charged at the writer's weight.
-- ---------------------------------------------------------------------------
insert into private.campus_bot_courses (course_id, calculation, updated_by) values (pg_temp.r('BUA201'), true, 'test')
  on conflict (course_id) do update set calculation = true;
create temporary table q2 as select pg_temp.quiz(1,'BUA201',(select bua from t)) j;
select is((select j->'check' from q2),
  '{"model":"claude-sonnet-5-5","max_input_tokens":10000,"max_output_tokens":3000}'::jsonb,
  'the checking model and its input and output caps');
select is((select reserved_tokens from pg_temp.event(pg_temp.gen((select j from q2)))),85000::bigint,
  'reserved: 60,000 to write plus (10,000 + 5 x 3,000) x 1 to check');
select is((select jsonb_agg(jsonb_build_array(step,model,provider_model,price_weight) order by step)
  from private.campus_bot_requests where generation_id=pg_temp.gen((select j from q2))),
  '[["check","sonnet","claude-sonnet-5-5",1],["writing","haiku","claude-haiku-5-5",1]]',
  'the check runs on Sonnet at the writer''s weight');
select is(pg_temp.done(1,pg_temp.gen((select j from q2)),'generated',4,pg_temp.usage('claude-sonnet-5-5',4000,1500))->>'status',
  'generated','four confirmed questions are a set');
select is((select charged_tokens from pg_temp.event(pg_temp.gen((select j from q2)))),36500::bigint + (5500 + 5 * 1500),
  'both steps charged: 36,500 + (5,500 + 5 x 1,500) x 1');
update private.campus_bot_courses set calculation = false where course_id = pg_temp.r('BUA201');

-- ---------------------------------------------------------------------------
-- Delivery re-checks the topic and the funding; a retry is answered only after every check a new quiz passes; no step
-- is charged past what was reserved for it.
-- ---------------------------------------------------------------------------
select pg_temp.student(5);
create temporary table o5 as select pg_temp.paid(5) id;
create temporary table q5a as select pg_temp.quiz(5,'BUA201',(select bua from t)) j;
select is(public.finish_campus_bot_topic_set(pg_temp.u(5),pg_temp.gen((select j from q5a)),'generated',null,
    pg_temp.topic_set(pg_temp.gen((select j from q5a))),pg_temp.usage('claude-haiku-5-5',90000,9000),null)->>'status',
  'generated','a provider report past the caps is still delivered');
select is((select charged_tokens from pg_temp.event(pg_temp.gen((select j from q5a)))),60000::bigint,
  'but charged no more than was reserved: (20,000 + 5 x 8,000) x 1');

-- Funding that ends while a set is written. A GST topic stays readable, so only the funding fails.
create temporary table r5 as select gen_random_uuid() req;
create temporary table q5b as select pg_temp.quiz(5,'GST111',(select gst from t),(select req from r5)) j;
select is((select j->>'state' from q5b),'started','a quiz on a GST topic, funded by the plan');
update public.entitlement_grants set revoked_at = clock_timestamp(), revoked_by = 'refund:test', revoke_reason = 'refunded'
  where user_id = pg_temp.u(5) and source = 'paid';
select is(pg_temp.done(5,pg_temp.gen((select j from q5b)))->>'status','failed','refunded while it was written: not delivered');
select is((select jsonb_build_array(g.outcome_reason,g.question_set is null,e.state,e.charged_tokens)
    from public.ai_practice_generations g join public.ai_usage_events e on e.id = g.usage_event_id
    where g.id = pg_temp.gen((select j from q5b))),
  '["access-ended",true,"released",0]'::jsonb,'not stored, its reservation released, nothing charged');
select is(pg_temp.quiz(5,'GST111',(select gst from t),(select req from r5))->>'state','not-entitled',
  'a retry of that request is told what a new quiz would be told');

-- A topic withdrawn while its set is written.
create temporary table gone_note as select gen_random_uuid() id;
insert into public.managed_content_items (id, course_id, kind, current_revision, created_by)
  select id, pg_temp.r('BUA201'), 'note', 1, pg_temp.u(1) from gone_note;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select id, 1, jsonb_build_object('title','A withdrawn topic',
    'body',repeat('Demand and supply set the market price together. ', 40)), pg_temp.u(1) from gone_note;
update public.managed_content_items set published_revision = 1 where id = (select id from gone_note);
select pg_temp.student(7);
create temporary table o7 as select pg_temp.paid(7) id;
create temporary table r7 as select gen_random_uuid() req;
create temporary table q7 as select pg_temp.quiz(7,'BUA201',(select id from gone_note),(select req from r7)) j;
select is((select j->>'state' from q7),'started','a quiz on a newly published topic starts');
update public.managed_content_items set published_revision = null where id = (select id from gone_note);
select is(pg_temp.done(7,pg_temp.gen((select j from q7)))->>'status','failed','withdrawn before delivery: not delivered');
select is((select outcome_reason from public.ai_practice_generations where id = pg_temp.gen((select j from q7))),
  'access-ended','for the same reason');
select is(pg_temp.quiz(7,'BUA201',(select id from gone_note),(select req from r7))->>'state','locked',
  'and a retry is told the topic is no longer open to them');

-- ---------------------------------------------------------------------------
-- Shared limits: the windows, undelivered tries and the platform's day.
-- ---------------------------------------------------------------------------
select pg_temp.student(4);
create temporary table o4 as select pg_temp.paid(4) id;
update private.campus_bot_tiers set session_tokens=50000 where tier='standard';
select is(pg_temp.quiz(4,'BUA201',(select bua from t))->>'state','session-limit','a window without the worst case left');
update private.campus_bot_tiers set session_tokens=350000, week_tokens=50000 where tier='standard';
select is(pg_temp.quiz(4,'BUA201',(select bua from t))->>'state','week-limit','the week too');
update private.campus_bot_tiers set week_tokens=700000 where tier='standard';
update private.ai_practice_policy set undelivered_per_day=1;
create temporary table q4 as select pg_temp.quiz(4,'BUA201',(select bua from t)) j;
select pg_temp.done(4,pg_temp.gen((select j from q4)),'failed');
select is(pg_temp.quiz(4,'BUA201',(select bua from t))->>'state','undelivered-limit','undelivered tries a day, shared with uploads');
update private.ai_practice_policy set undelivered_per_day=10, global_daily_generations=(select count(*)::int from public.ai_usage_events
  where reserved_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'), paid_daily_reserve=0;
select is(pg_temp.quiz(4,'BUA201',(select bua from t))->>'state','capacity','the platform''s day, shared with uploads');
update private.ai_practice_policy set global_daily_generations=2000, paid_daily_reserve=150;

-- ---------------------------------------------------------------------------
-- A free pass: GST topics and its pinned topic, and one set in total.
-- ---------------------------------------------------------------------------
delete from private.discovery_pass_claims;
delete from private.discovery_claim_keys;
insert into private.discovery_claim_keys(key_version,key_check) values(999,repeat('f',64));
select pg_temp.student(3);
select is(public.activate_discovery_pass(pg_temp.s(3),pg_temp.hash(3),null)->>'state','activated','a pass is activated');
select is(pg_temp.quiz(3,'BUA201',(select bua from t))->>'state','locked','a department topic not pinned by the pass');
select is(public.discovery_preview(pg_temp.s(3),pg_temp.r('BUA201'),'study_guide',true,(select bua from t))->>'state','ready',
  'the pass pins a topic');
create temporary table q3 as select pg_temp.quiz(3,'BUA201',(select bua from t)) j;
select is((select jsonb_build_array(j->>'state',j->'topic'->'pinned',j->'topic'->'number',j->>'model') from q3),
  '["started",true,null,"claude-haiku-5-5"]','the pinned topic is the pass''s, written by the writing model');
select is((select jsonb_build_array(e.funding_source,e.reserved_tokens,e.session_window_id) from pg_temp.event(pg_temp.gen((select j from q3))) e),
  '["trial",null,null]','counted, not metered');
select is(pg_temp.done(3,pg_temp.gen((select j from q3)),'generated',4)->>'status','failed',
  'a pass''s one set is never spent on four questions');
select is((select outcome_reason from public.ai_practice_generations where id=pg_temp.gen((select j from q3))),'incomplete-set',
  'recorded as incomplete');
create temporary table q3b as select pg_temp.quiz(3,'GST111',(select gst from t)) j;
select is((select j->>'state' from q3b),'started','a GST topic on the pass');
select is(pg_temp.done(3,pg_temp.gen((select j from q3b)))->>'status','generated','its one set');
select is(pg_temp.quiz(3,'GST111',(select gst from t))->>'state','pass-used','one set in total');
select is((select count(*)::int from private.plan_use_events where user_id=pg_temp.u(3)),0,'a free course is never plan use');

-- ---------------------------------------------------------------------------
-- The free pass's set check, the operator setting and the boundary.
-- ---------------------------------------------------------------------------
select ok(private.discovery_ai_set_complete(pg_temp.topic_set(pg_temp.gen((select j from q3b)))),'a notes topic set can be complete');
select ok(not private.discovery_ai_set_complete(pg_temp.topic_set(pg_temp.gen((select j from q3b))) #- '{source,title}'),
  'it names its topic');
select is(public.admin_set_campus_bot_set_checker('haiku','Ops','cheaper check')->>'state','changed','the checker is a setting');
select is((select check_model from private.campus_bot_settings),'haiku','and is changed');
select is(public.admin_set_campus_bot_set_checker('haiku','Ops','again')->>'state','unchanged','a repeat changes nothing');
select throws_ok($$select public.admin_set_campus_bot_set_checker('gpt','Ops','typo')$$,'22023',null,'only a known model');
select ok(not has_function_privilege('authenticated','public.begin_campus_bot_topic_set(uuid,uuid,uuid,uuid,text[])','execute'),
  'students cannot admit themselves');
select ok(not has_function_privilege('authenticated','public.finish_campus_bot_topic_set(uuid,uuid,text,text,jsonb,jsonb,jsonb)',
  'execute'),'or settle');
select ok(not has_function_privilege('authenticated','public.admin_set_campus_bot_set_checker(text,text,text)','execute'),
  'or change the checker');
select ok(has_function_privilege('service_role','public.begin_campus_bot_topic_set(uuid,uuid,uuid,uuid,text[])','execute'),
  'the server admits');

select * from finish();
rollback;
