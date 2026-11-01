-- Payments part 1: orders, verified fulfilment, term-key binding for Session plans, refunds judged when the student
-- asked, settings copied onto rows, and the deny-by-default boundary. The provider is never called (fake ids only).
begin;
select no_plan();

-- The running First Semester began 100 days ago (it ends in about three weeks); nothing else is in the calendar.
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 100;

create function pg_temp.u(n int) returns uuid language sql immutable as
  $$select ('b7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql immutable as
  $$select ('b7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.req(n int) returns uuid language sql immutable as
  $$select ('b7300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.c(code text) returns uuid language sql stable security definer as
  $$select id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.r(code text) returns uuid language sql stable security definer as
  $$select repository_course_id from public.institutional_courses where course_code=code limit 1$$;
create function pg_temp.student(n int) returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated','pay-'||n||'@example.test','fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
end$$;
create function pg_temp.rev(n int) returns bigint language sql stable as
  $$select revision from public.profiles where id=pg_temp.u(n)$$;
create function pg_temp.buy(n int, plan text, req uuid, path text default '/access') returns jsonb language sql as
  $$select public.create_payment_order(pg_temp.s(n),plan,pg_temp.rev(n),req,path,'fake')$$;
create function pg_temp.oid(j jsonb) returns uuid language sql immutable as $$select (j->'order'->>'id')::uuid$$;
create function pg_temp.attach(o uuid) returns jsonb language sql as
  $$select public.attach_payment_checkout(o,'fake','chk_'||replace(o::text,'-',''),
    'https://checkout.example.test/c/'||o,clock_timestamp()+interval '1 hour')$$;
create function pg_temp.pay(o uuid, pay text, amount bigint default 400000, src text default 'webhook',
  status text default 'succeeded', currency text default 'NGN', method text default 'card') returns jsonb language sql as
  $$select public.fulfil_payment(o,'fake',pay,status,amount,currency,method,clock_timestamp(),src,'test')$$;
create function pg_temp.order_row(o uuid) returns private.payment_orders language sql stable as
  $$select * from private.payment_orders where id=o$$;
create function pg_temp.grants(o uuid) returns int language sql stable as
  $$select count(*)::int from public.entitlement_grants where order_id=o$$;
create function pg_temp.allowed(n int, code text, at timestamptz default clock_timestamp()) returns boolean language sql as
  $$select allowed from private.course_access_decision(pg_temp.u(n),pg_temp.c(code),at)$$;
create function pg_temp.ids(n int) returns text[] language sql immutable as
  $$select array[encode(sha256(('identity-'||n)::bytea),'hex')]$$;
-- Move a payment back in time, as if it had been confirmed `ago` before now.
create function pg_temp.paid_ago(o uuid, ago interval) returns void language sql as $$
  update private.payment_orders set paid_at=paid_at-ago where id=o;
  update private.payment_fulfilments set created_at=created_at-ago where order_id=o;
$$;
create function pg_temp.paid(n int, plan text default 'plus_semester', req uuid default gen_random_uuid(),
  amount bigint default null) returns uuid language plpgsql as $$
declare o uuid;
begin
  o := pg_temp.oid(pg_temp.buy(n,plan,req));
  perform pg_temp.attach(o);
  perform pg_temp.pay(o,'ch_'||replace(o::text,'-',''),coalesce(amount,case plan when 'plus_session' then 700000 else 400000 end));
  return o;
end$$;
create function pg_temp.refund(o uuid, cls text, req uuid, ids text[], at timestamptz default clock_timestamp())
  returns jsonb language sql as
  $$select public.refund_order(o,cls,req,ids,'Ops','student asked',at)$$;
create function pg_temp.claims(n int) returns text language sql as
  $$select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),
    'role','authenticated')::text,true)$$;
-- Judged now on the wall clock (the default, now(), is this test transaction's start).
create function pg_temp.elig(o uuid, ids text[] default null, at timestamptz default clock_timestamp()) returns jsonb
  language sql as $$select public.refund_eligibility(o,ids,at)$$;

-- ---------------------------------------------------------------------------
-- Boundary (must-hold 3) and the guarantees held by keys (must-hold 1, 2).
-- ---------------------------------------------------------------------------
select is((select count(*)::int from unnest(array['private.campus_bot_tiers','private.campus_bot_models','private.campus_bot_request_caps','private.plan_catalogue','private.payment_policy',
    'private.payment_orders','private.payment_events','private.payment_fulfilments','private.payment_refunds',
    'private.plan_use_events']) t, unnest(array['anon','authenticated','service_role']) r,
    unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where has_table_privilege(r,t,p)),
  0,'no API role reads or writes any payment table');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.campus_bot_tiers'::regclass,
  'private.campus_bot_models'::regclass,'private.campus_bot_request_caps'::regclass,'private.plan_catalogue'::regclass,
  'private.payment_policy'::regclass,'private.payment_orders'::regclass,'private.payment_events'::regclass,
  'private.payment_fulfilments'::regclass,'private.payment_refunds'::regclass,'private.plan_use_events'::regclass)),
  'RLS is on for every payment table');
select ok(has_function_privilege('service_role',f,'EXECUTE') and not has_function_privilege('authenticated',f,'EXECUTE')
  and not has_function_privilege('anon',f,'EXECUTE'),'service role only: '||f) from unnest(array[
  'public.create_payment_order(uuid,text,bigint,uuid,text,text)',
  'public.attach_payment_checkout(uuid,text,text,text,timestamptz)',
  'public.record_payment_event(text,text,text,uuid,text)',
  'public.fulfil_payment(uuid,text,text,text,bigint,text,text,timestamptz,text,text)',
  'public.record_payment_outcome(uuid,text,text,text)','public.payment_orders_to_check(integer)',
  'public.refund_eligibility(uuid,text[],timestamptz,uuid)',
  'public.refund_order(uuid,text,uuid,text[],text,text,timestamptz,uuid)',
  'public.record_refund_result(uuid,text,text,text,text)','public.admin_set_sales_open(boolean,text,text)',
  'public.admin_set_plan(text,integer,integer,boolean,text,text)',
  'public.admin_set_campus_bot_tier(text,integer,integer,integer,integer,integer,text,text)',
  'public.admin_set_campus_bot_model(text,integer,text,text)',
  'public.admin_set_campus_bot_request_cap(text,integer,integer,text,text)','public.admin_payment_status(uuid,uuid)',
  'public.admin_payments_health()']) f;
select ok(has_function_privilege('authenticated','public.get_my_payment_order(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.get_my_payment_order(uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.get_my_payment_order(uuid)','EXECUTE'),
  'a student reads their order through one function; anon cannot');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and p.proname ~ '(payment|refund|plan_use|fulfil)'),1,'get_my_payment_order is the only payment function a student can call');
select ok(not has_function_privilege(r,f,'EXECUTE'),'private helper closed to '||r||': '||f)
  from unnest(array['anon','authenticated','service_role']) r, unnest(array[
  'private.mark_plan_use(uuid,text,uuid,text,timestamptz)','private.grant_effective_end(public.entitlement_grants)',
  'private.refund_assessment(private.payment_orders,private.payment_fulfilments,text[],timestamptz)',
  'private.log_payment_event(uuid,text,text,jsonb)']) f;
select ok(obj_description('public.fulfil_payment(uuid,text,text,text,bigint,text,text,timestamptz,text,text)'::regprocedure)
  ~ 'cannot call Bachs','fulfil_payment says the database cannot call the provider');
select ok(exists(select 1 from pg_indexes where indexname=i),'unique key exists: '||i) from unnest(array[
  'payment_fulfilments_payment_unique','payment_fulfilments_one_per_order','entitlement_grants_order_part_idx',
  'payment_orders_request_id_key','payment_refunds_one_per_payment','payment_refunds_request_id_key',
  'payment_events_delivery_idx','plan_use_events_once']) i;

-- ---------------------------------------------------------------------------
-- Settings and their defaults.
-- ---------------------------------------------------------------------------
select is((select jsonb_agg(jsonb_build_array(plan_key,tier,period,price_kobo,currency,ai_sets_per_term,active)
  order by plan_key) from private.plan_catalogue),
  '[["plus_semester","plus","semester",400000,"NGN",10,true],["plus_session","plus","session",700000,"NGN",10,true],
    ["pro_semester","pro","semester",600000,"NGN",10,true],["pro_session","pro","session",1100000,"NGN",10,true]]'::jsonb,
  'catalogue defaults: four plans, tier and period separate');
select is((select jsonb_agg(jsonb_build_array(tier,session_hours,session_tokens,week_days,week_tokens,written_token_weight)
  order by tier) from private.campus_bot_tiers),
  '[["plus",5,350000,7,700000,5],["pro",5,700000,7,1400000,5]]'::jsonb,
  'Campus Bot budgets: 7-day week, 5-hour session half of it, written tokens weighted 5');
select is((select jsonb_agg(jsonb_build_array(model,price_weight) order by model) from private.campus_bot_models),
  '[["haiku",1],["sonnet",20]]'::jsonb,'model price weights, Haiku = 1');
select is((select jsonb_agg(jsonb_build_array(step,read_tokens_max,written_tokens_max) order by step) from private.campus_bot_request_caps),
  '[["check",3000,1500],["writing",20000,8000]]'::jsonb,'per-request caps: writing 20,000/8,000, check 3,000/1,500');
select is((select jsonb_build_array(sales_open,checkout_minutes,sales_close_days,refund_window_hours,refunds_per_student,
  refund_campus_bot_replies_allowed,refund_exams_allowed,refund_practice_answers_allowed,refund_notes_topics_allowed)
  from private.payment_policy),'[false,60,3,48,1,0,0,10,3]'::jsonb,'policy defaults: sales closed, 60-minute checkout, 48 h');
select pg_temp.student(1);
select is(pg_temp.buy(1,'plus_semester',pg_temp.req(1))->>'state','sales-closed','nothing is sold while sales are closed');
select is(public.admin_set_sales_open(true,'Ops','launch test')->>'state','changed','an operator opens sales');
select is((select count(*)::int from private.entitlement_events where event='payment.sales-opened'),1,'opening is audited');

-- Return paths (change 3).
select is(private.payment_return_path_ok(p),true,'return path accepted: '||coalesce(p,'null'))
  from unnest(array['/access','/courses/bua-201?tab=notes',null]) p;
select is(private.payment_return_path_ok(p),false,'return path refused: '||p) from unnest(array['https://evil.test',
  '//evil.test','/\evil.test','javascript:alert(1)','/a//b','relative','','/a b','/x:y',repeat('/a',101)]) p;
select throws_ok($$select pg_temp.buy(1,'plus_semester',pg_temp.req(2),'//evil.test')$$,'22023',null,
  'create_payment_order refuses an unsafe return path');

-- ---------------------------------------------------------------------------
-- §7 row 11: a double tap reuses the order; row 1: a verified success grants the semester.
-- ---------------------------------------------------------------------------
create temporary table t1 as select pg_temp.buy(1,'plus_semester',pg_temp.req(1)) a, pg_temp.buy(1,'plus_semester',pg_temp.req(1)) b;
select is((select a->>'state' from t1),'created','first tap creates the order');
select is((select b->>'state' from t1),'existing','the same request id returns it');
select is((select pg_temp.oid(a)=pg_temp.oid(b) from t1),true,'one order for a double tap');
select is(pg_temp.buy(1,'plus_session',pg_temp.req(1))->>'state','request-conflict','a request id cannot change plan');
select is(pg_temp.oid(pg_temp.buy(1,'plus_semester',pg_temp.req(3))),(select pg_temp.oid(a) from t1),
  'another request reuses the open order for the same plan, semester and selection');
select is((select count(*)::int from private.payment_orders where user_id=pg_temp.u(1)),1,'still one order');
select is((select jsonb_build_array(amount_kobo,currency,ai_sets,campus_bot_session_tokens,campus_bot_week_tokens,status,return_path,
  expires_at>created_at+interval '59 minutes' and expires_at<=created_at+interval '60 minutes')
  from private.payment_orders where user_id=pg_temp.u(1)),'[400000,"NGN",10,350000,700000,"created","/access",true]'::jsonb,
  'price, allowances, path and a 60-minute expiry are copied onto the order');
select is(pg_temp.attach((select pg_temp.oid(a) from t1))->>'state','pending','checkout attached');
select is(pg_temp.attach((select pg_temp.oid(a) from t1))->>'state','unchanged','same checkout again is unchanged');
select is(public.attach_payment_checkout((select pg_temp.oid(a) from t1),'fake','chk_other','https://x.test/c',
  clock_timestamp()+interval '1 hour')->>'state','conflict','one checkout per order');

create temporary table r1 as select pg_temp.pay((select pg_temp.oid(a) from t1),'ch_one') res;
select is((select res->>'outcome' from r1),'fulfilled','row 1: verified success fulfils');
select is((pg_temp.order_row((select pg_temp.oid(a) from t1))).status,'paid','order paid');
select is((select jsonb_build_array(g.source,g.paid_plan,g.plan_part,g.ai_terms,g.ai_units,g.campus_bot_tier,
  g.campus_bot_session_tokens,g.campus_bot_week_tokens,
  g.course_term_id=(select id from private.academic_terms where session_label='2026/2027'),g.starts_at<=clock_timestamp())
  from public.entitlement_grants g where g.user_id=pg_temp.u(1)),
  '["paid","plus_semester",1,"capped",10,"plus",350000,700000,true,true]'::jsonb,
  'one Semester grant bound to the bought semester, with 10 AI sets and the plus Campus Bot budget');
select is(pg_temp.allowed(1,'BUA201'),true,'own course opens');
select is(pg_temp.allowed(1,'BUA202'),false,'outside course stays closed');
select is(private.course_selection_state(pg_temp.u(1))->>'state','locked','paying locks the courses');
select is((select private.grant_effective_end(g) from public.entitlement_grants g where user_id=pg_temp.u(1)),
  (select ends_at from private.academic_term_ends('10000000-0000-4000-8000-000000000002') limit 1),
  'the effective end is the department''s semester end, never the stored slack');

-- Rows 2 and 7, must-hold 1: replays from every source return the first answer, one grant set.
select is(pg_temp.pay((select pg_temp.oid(a) from t1),'ch_one',400000,s),(select res from r1),'replay from '||s||' is identical')
  from unnest(array['return','reconcile','operator','webhook','webhook']) s;
select is(pg_temp.grants((select pg_temp.oid(a) from t1)),1,'still one grant');
select is((select count(*)::int from private.payment_fulfilments where order_id=(select pg_temp.oid(a) from t1)),1,
  'one fulfilment');
select pg_temp.student(2);
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))),'ch_one')->>'state','payment-conflict',
  'one provider payment never fulfils two orders');
-- Row 12: no checkout for a paid semester.
select is(pg_temp.buy(1,'plus_semester',gen_random_uuid())->>'state','already-paid','already paid');
select is(pg_temp.buy(1,'plus_session',gen_random_uuid())->>'state','already-paid','a Session plan over a paid semester is refused');

-- Must-hold 2: only a verified success of the order's amount and currency grants.
select throws_ok($$select pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))),'ch_x',400000,'webhook','failed')$$,
  '22023',null,'a failed status is not fulfilled');
select throws_ok($$select pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))),'ch_x',400000,'webhook','open')$$,
  '22023',null,'an open status is not fulfilled');
select throws_ok($$select pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))),'ch_x',400000,'webhook',
  'succeeded','NGN','mobile_money')$$,'22023',null,'card or bank transfer only');
-- Row 9: less than the order, or another currency: amount-mismatch, no grant.
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))),'ch_short',4000)->>'outcome','amount-mismatch',
  'row 9: ₦40 for a ₦4,000 order');
select is(pg_temp.grants(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20)))),0,'no grant on a mismatch');
select is((pg_temp.order_row(pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))))).status,'amount-mismatch','order flagged');
select pg_temp.student(3);
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(3,'plus_semester',pg_temp.req(30))),'ch_usd',400000,'webhook','succeeded','USD')
  ->>'outcome','amount-mismatch','another currency is a mismatch');
select pg_temp.student(4);
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(4,'plus_semester',pg_temp.req(40))),'ch_over',500000,'webhook','overpaid')
  ->>'outcome','fulfilled','overpaid: granted');
select ok('overpaid'=any((pg_temp.order_row(pg_temp.oid(pg_temp.buy(4,'plus_semester',pg_temp.req(40))))).flags),
  'and flagged for support');
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(4,'plus_semester',pg_temp.req(40))),'ch_over2',400000,'webhook','accepted')
  ->>'outcome','extra-payment','a second payment on a paid order is recorded, not granted');
select is(pg_temp.grants(pg_temp.oid(pg_temp.buy(4,'plus_semester',pg_temp.req(40)))),1,'still one grant set');
select is((pg_temp.order_row(pg_temp.oid(pg_temp.buy(4,'plus_semester',pg_temp.req(40))))).status,'paid','order stays paid');

-- ---------------------------------------------------------------------------
-- Rows 3-6: decline, abandon, a late transfer, and success after expiry.
-- ---------------------------------------------------------------------------
select pg_temp.student(5);
create temporary table o5 as select pg_temp.oid(pg_temp.buy(5,'plus_semester',pg_temp.req(50))) id;
select pg_temp.attach(id) from o5;
select is(public.record_payment_outcome((select id from o5),'failed','declined','webhook')->>'order_status','failed','row 3: decline');
select is(pg_temp.grants((select id from o5)),0,'no grant');
select isnt(pg_temp.oid(pg_temp.buy(5,'plus_semester',pg_temp.req(51))),(select id from o5),'a retry makes a new order');
select is(public.record_payment_outcome((select pg_temp.oid(a) from t1),'failed',null,'webhook')->>'state','already-final',
  'a late failure never overrides a payment');
select pg_temp.student(6);
create temporary table o6 as select pg_temp.oid(pg_temp.buy(6,'plus_semester',pg_temp.req(60))) id;
select pg_temp.attach(id) from o6;
select is(public.record_payment_outcome((select id from o6),'cancelled','abandoned','return')->>'order_status','cancelled',
  'row 4: abandoned');
select is(private.course_selection_state(pg_temp.u(6))->>'state','open','selection stays open');
select is(public.record_payment_outcome((select id from o6),'expired',null,'reconcile')->>'state','already-final',
  'an ended order is not ended again');
select pg_temp.student(7);
create temporary table o7 as select pg_temp.oid(pg_temp.buy(7,'plus_semester',pg_temp.req(70))) id;
select pg_temp.attach(id) from o7;
select is(public.record_payment_outcome((select id from o7),'expired',null,'reconcile')->>'state','not-expired',
  'an order is not expired before its checkout');
update private.payment_orders set created_at=created_at-interval '10 minutes' where id=(select id from o7);
select is((select action from public.payment_orders_to_check(500) where order_id=(select id from o7)),'check',
  'row 5: a pending transfer is checked by the catch-up job');
select is(pg_temp.pay((select id from o7),'ch_late_transfer',400000,'reconcile','succeeded','NGN','bank_transfer')->>'outcome',
  'fulfilled','the catch-up check fulfils it');
select pg_temp.student(8);
create temporary table o8 as select pg_temp.oid(pg_temp.buy(8,'plus_semester',pg_temp.req(80))) id;
select pg_temp.attach(id) from o8;
update private.payment_orders set created_at=created_at-interval '3 days',expires_at=expires_at-interval '3 days',
  checkout_expires_at=checkout_expires_at-interval '3 days' where id=(select id from o8);
select is((select action from public.payment_orders_to_check(500) where order_id=(select id from o8)),'expire','old open order expires');
select is(public.record_payment_outcome((select id from o8),'expired',null,'reconcile')->>'order_status','expired','row 6: expired');
select is((select action from public.payment_orders_to_check(500) where order_id=(select id from o8)),'late-check',
  'an expired order is still checked');
select is(pg_temp.pay((select id from o8),'ch_day3',400000,'reconcile','succeeded','NGN','bank_transfer')->>'outcome',
  'fulfilled','a checkout paid after it expired is fulfilled');
select is(pg_temp.allowed(8,'BUA201'),true,'and opens the courses');

-- Row 10: two orders for one semester, both paid. The second grants nothing and may be refunded as a duplicate.
select pg_temp.student(9);
create temporary table o9 as select pg_temp.oid(pg_temp.buy(9,'plus_semester',pg_temp.req(90))) a,
  pg_temp.oid(pg_temp.buy(9,'plus_semester',pg_temp.req(91),'/courses')) b;
select isnt((select a from o9),(select b from o9),'a second tab with another return path made a second order');
select is(pg_temp.pay((select a from o9),'ch_tab1')->>'outcome','fulfilled','first payment fulfils');
select is(pg_temp.pay((select b from o9),'ch_tab2')->>'outcome','paid-duplicate','second is a duplicate');
select is(pg_temp.grants((select b from o9)),0,'no second grant');
select is(pg_temp.elig((select b from o9))->'classes_allowed','["our-fault","duplicate"]'::jsonb,
  'a duplicate is refunded as duplicate or our-fault, never standard');
select is(pg_temp.refund((select b from o9),'standard',gen_random_uuid(),pg_temp.ids(9))->>'state','class-not-allowed',
  'standard refused for a duplicate');

-- Row 13 and must-hold 7: selection.
select pg_temp.student(10);
update public.profiles set department_id=null,academic_level_id=null,academic_period_id=null where id=pg_temp.u(10);
select is(pg_temp.buy(10,'plus_semester',gen_random_uuid())->>'state','needs-selection','courses must be confirmed first');
select pg_temp.student(11);
select is(public.create_payment_order(pg_temp.s(11),'plus_semester',pg_temp.rev(11)-1,gen_random_uuid(),null,'fake')->>'state',
  'selection-changed','the confirm screen''s revision must match');
create temporary table o11 as select pg_temp.oid(pg_temp.buy(11,'plus_semester',pg_temp.req(110))) id;
update public.profiles set academic_level_id='20000000-0000-4000-8000-000000000001' where id=pg_temp.u(11);
select is(pg_temp.pay((select id from o11),'ch_changed')->>'outcome','fulfilled','a changed selection never refuses a payment');
select ok('selection-changed'=any((pg_temp.order_row((select id from o11))).flags),'it is flagged for support');

-- Row 29: the current semester is not sold within sales_close_days of its end.
update private.payment_policy set sales_close_days=30;
select pg_temp.student(12);
select is(pg_temp.buy(12,'plus_semester',gen_random_uuid())->>'state','sales-closed','not sold near the semester end');
update private.payment_policy set sales_close_days=3;

-- Row 32: deletion scheduled. No checkout; an open order still fulfils, flagged.
select pg_temp.student(13);
create temporary table o13 as select pg_temp.oid(pg_temp.buy(13,'plus_semester',pg_temp.req(130))) id;
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at)
  values(pg_temp.u(13),now(),now()+interval '720 hours',now()+interval '720 hours');
select is(pg_temp.buy(13,'plus_semester',gen_random_uuid())->>'state','signed-out','no checkout once deletion is scheduled');
select is(pg_temp.pay((select id from o13),'ch_deleting')->>'outcome','fulfilled','money taken is still granted');
select ok('account-deletion'=any((pg_temp.order_row((select id from o13))).flags),'and flagged for refund');

-- Row 30: an operator-sourced verification, then the real webhook: one grant set.
select pg_temp.student(14);
create temporary table o14 as select pg_temp.oid(pg_temp.buy(14,'plus_semester',pg_temp.req(140))) id;
select is(pg_temp.pay((select id from o14),'ch_op',400000,'operator')->>'outcome','fulfilled','operator verification fulfils');
select is(pg_temp.pay((select id from o14),'ch_op',400000,'webhook')->>'outcome','fulfilled','webhook replays it');
select is(pg_temp.grants((select id from o14)),1,'one grant set');

-- ---------------------------------------------------------------------------
-- Session plans (rows 14-17, must-hold 9).
-- ---------------------------------------------------------------------------
-- Row 15: no Second Semester yet. The second half is pending by term key and binds only to that semester.
select pg_temp.student(20);
create temporary table o20 as select pg_temp.oid(pg_temp.buy(20,'plus_session',pg_temp.req(200))) id;
select is(pg_temp.pay((select id from o20),'ch_session1',700000)->>'outcome','fulfilled','Session plan fulfilled');
select is(pg_temp.grants((select id from o20)),2,'two grants');
select is((select jsonb_build_array(g.course_term_id is null,g.term_session_label,
  g.term_period_id='30000000-0000-4000-8000-000000000002',g.starts_at>clock_timestamp(),g.ai_units,g.campus_bot_week_tokens)
  from public.entitlement_grants g where order_id=(select id from o20) and plan_part=2),
  '[true,"2026/2027",true,true,10,700000]'::jsonb,'second half pending, keyed to Second Semester 2026/2027, not started');
select is((select g2.starts_at from public.entitlement_grants g2 where order_id=(select id from o20) and plan_part=2),
  (select private.grant_effective_end(g1) from public.entitlement_grants g1 where order_id=(select id from o20) and plan_part=1),
  'the second half starts where the first ends');
select is(public.admin_set_academic_term('2026/2027','second-semester',
  (select last_day+14 from private.academic_terms where session_label='2026/2027'),'Ops','second semester dates')->>'state',
  'created','the team enters the Second Semester');
select is((select course_term_id from public.entitlement_grants where order_id=(select id from o20) and plan_part=2),
  null::uuid,'term-set binds nothing itself (calendar writers take no account lock)');
select is((select count(*)::int from private.pending_course_grant_bindings(pg_temp.u(20),clock_timestamp())),1,
  'the next read sees the binding to make');
do $$begin perform private.lock_course_access_scope(pg_temp.u(20)); perform private.bind_pending_course_grants(pg_temp.u(20)); end$$;
select is((select course_term_id from public.entitlement_grants where order_id=(select id from o20) and plan_part=2),
  (select t.id from private.academic_terms t join public.academic_periods p on p.id=t.academic_period_id
    where t.session_label='2026/2027' and p.key='second-semester'),'and binds it to the Second Semester only');

-- Row 14: Second Semester already entered: bound at insert, inactive until it starts, no lock of its own.
select pg_temp.student(21);
create temporary table o21 as select pg_temp.oid(pg_temp.buy(21,'plus_session',pg_temp.req(210))) id;
select pg_temp.pay(id,'ch_session2',700000) from o21;
select is((select course_term_id from public.entitlement_grants where order_id=(select id from o21) and plan_part=2),
  (select t.id from private.academic_terms t join public.academic_periods p on p.id=t.academic_period_id
    where t.session_label='2026/2027' and p.key='second-semester'),'bound at insert');
select is((select ends_at > starts_at + interval '4 months' from public.entitlement_grants
  where order_id=(select id from o21) and plan_part=2),true,'stored end covers the semester (slack)');

-- Row 16: First Semester extended after payment. The second half stays on the Second Semester.
select is(public.admin_set_department_end('2026/2027','first-semester','business-administration',
  (select last_day+7 from private.academic_terms t join public.academic_periods p on p.id=t.academic_period_id
    where t.session_label='2026/2027' and p.key='first-semester'),'Ops','strike week')->>'state','changed',
  'First Semester extended for the department');
do $$begin perform private.lock_course_access_scope(pg_temp.u(21)); perform private.bind_pending_course_grants(pg_temp.u(21)); end$$;
select is((select course_term_id from public.entitlement_grants where order_id=(select id from o21) and plan_part=2),
  (select t.id from private.academic_terms t join public.academic_periods p on p.id=t.academic_period_id
    where t.session_label='2026/2027' and p.key='second-semester'),'row 16: still the Second Semester');
select is((select private.grant_effective_end(g) from public.entitlement_grants g where order_id=(select id from o21) and plan_part=1),
  (select e.ends_at from private.academic_term_ends('10000000-0000-4000-8000-000000000002') e
    join private.academic_terms t on t.id=e.term_id join public.academic_periods p on p.id=t.academic_period_id
    where p.key='first-semester'),'the first half follows the extension');

-- Row 17: at the Second Semester the student confirms again; then the second half opens the new list.
create temporary table second_at as select (select e.ends_at from private.academic_term_ends('10000000-0000-4000-8000-000000000002') e
  join private.academic_terms t on t.id=e.term_id join public.academic_periods p on p.id=t.academic_period_id
  where p.key='first-semester')+interval '20 days' at;
select is((select reason from private.course_access_decision(pg_temp.u(21),pg_temp.c('BUA202'),(select at from second_at))),
  'needs-selection','row 17: Second Semester asks the Session holder to confirm their courses');
alter table public.profiles disable trigger profiles_guard_course_selection;
update public.profiles set academic_period_id='30000000-0000-4000-8000-000000000002',
  selection_confirmed_at=(select at from second_at)-interval '1 hour' where id=pg_temp.u(21);
alter table public.profiles enable trigger profiles_guard_course_selection;
select is((select reason from private.course_access_decision(pg_temp.u(21),pg_temp.c('BUA202'),(select at from second_at))),
  'own-list','confirming opens the Second Semester courses with the second half');
select is((select reason from private.course_access_decision(pg_temp.u(21),pg_temp.c('BUA201'),(select at from second_at))),
  'outside-list','the first semester''s list does not carry over');
-- Must-hold 9: the second half never opens before it starts.
update public.entitlement_grants set starts_at=(select at from second_at)+interval '1 day'
  where order_id=(select id from o21) and plan_part=2;
select is((select reason from private.course_access_decision(pg_temp.u(21),pg_temp.c('BUA202'),(select at from second_at))),
  'needs-plan','a second half that has not started opens nothing');

-- ---------------------------------------------------------------------------
-- Refunds (rows 21-25; owner rule of 1 Nov: 48 h, judged when the student asked, use thresholds).
-- ---------------------------------------------------------------------------
-- Row 21 and must-hold 6.
select pg_temp.student(30);
create temporary table o30 as select pg_temp.paid(30) id;
select pg_temp.paid_ago(id,interval '23 hours') from o30;
select is((select jsonb_build_array(e->'standard_allowed',e->'counts',e->'refunds_used') from
  (select pg_temp.elig((select id from o30),pg_temp.ids(30)) e) x),
  '[true,{"campus_bot_replies":0,"exams_started":0,"practice_answers":0,"notes_topics":0},0]'::jsonb,
  'unused at 23 h: a standard refund is allowed, with every count shown');
create temporary table rf30 as select pg_temp.refund((select id from o30),'standard',pg_temp.req(300),pg_temp.ids(30)) res;
select is((select res->>'state' from rf30),'refund-pending','row 21: recorded');
select is((select count(*)::int from public.entitlement_grants where order_id=(select id from o30) and revoked_at is not null),1,
  'every grant revoked in the same transaction');
select is(pg_temp.allowed(30,'BUA201'),false,'access gone at once');
select is(private.course_selection_state(pg_temp.u(30))->>'state','open','a revoked plan no longer locks');
select is((pg_temp.order_row((select id from o30))).status,'refund-pending','order refund-pending');
select is(pg_temp.refund((select id from o30),'standard',pg_temp.req(300),pg_temp.ids(30)),(select res from rf30)||
  '{"refund_status":"pending"}','row 25: the same request id returns the same record');
select is((select count(*)::int from private.payment_refunds where order_id=(select id from o30)),1,'one refund');
select is(pg_temp.refund((select id from o30),'our-fault',gen_random_uuid(),pg_temp.ids(30))->>'state','already-refunding',
  'one refund per payment');
select throws_ok($$select public.record_refund_result((select (res->>'refund_id')::uuid from rf30),'refunded',null,null,'Ops')$$,
  '22023',null,'a refund is settled only with a provider id or our bank reference');
select is(public.record_refund_result((select (res->>'refund_id')::uuid from rf30),'failed',null,null,'Ops')->>'refund_status',
  'failed','provider refund failed');
select is((pg_temp.order_row((select id from o30))).status,'refund-failed','order refund-failed');
create temporary table rf30b as select pg_temp.refund((select id from o30),'standard',pg_temp.req(301),pg_temp.ids(30)) res;
select is((select res->>'state' from rf30b),'refund-pending','a failed refund does not count: retry with a new request');
select is(public.record_refund_result((select (res->>'refund_id')::uuid from rf30b),'refunded',null,'GTB-REF-0001','Ops')
  ->>'refund_status','refunded','settled manually with our bank reference');
select is(public.record_refund_result((select (res->>'refund_id')::uuid from rf30b),'refunded',null,'GTB-REF-0001','Ops')
  ->>'state','unchanged','settling again is unchanged');
select is((pg_temp.order_row((select id from o30))).status,'refunded','order refunded');

-- Row 22: each use above its allowance blocks a standard refund; at the allowance it does not; free courses never count.
select pg_temp.student(n) from generate_series(31,36) n;
create temporary table o3x as select n, pg_temp.paid(n) id from generate_series(31,36) n;
select pg_temp.paid_ago(id,interval '1 hour') from o3x;
-- 31: one Campus Bot set.
select is(private.mark_plan_use(pg_temp.u(31),'campus-bot-reply',null,'reply-1'),1,'a Campus Bot reply is recorded');
-- 32: one exam started.
insert into public.quiz_attempts(id,user_id,course_id,question_count,status,mode,deadline_at,duration_seconds,intent,bank_size)
  values(gen_random_uuid(),pg_temp.u(32),pg_temp.r('BUA201'),5,'in_progress','exam',clock_timestamp()+interval '30 minutes',
    1800,'new',5);
-- 33: 11 practice answers; 34: 10 answers + 1 theory reveal; 35: exactly 10 answers and 3 topics (allowed).
create function pg_temp.answers(n int, k int, code text default 'BUA201') returns void language plpgsql as $$
declare a uuid := gen_random_uuid();
begin
  insert into public.quiz_attempts(id,user_id,course_id,question_count,status,finished_at)
    values(a,pg_temp.u(n),pg_temp.r(code),k,'submitted',clock_timestamp());
  insert into public.quiz_attempt_answers(attempt_id,question_id,ordinal,option_index,is_correct,section_label)
    select a,gen_random_uuid(),i,0,true,'A' from generate_series(0,k-1) i;
end$$;
select pg_temp.answers(33,11);
select pg_temp.answers(34,10);
select private.mark_plan_use(pg_temp.u(34),'theory-reveal',pg_temp.r('BUA201'),'q-1');
select pg_temp.answers(35,10);
select pg_temp.answers(35,30,'GST111');
select private.mark_plan_use(pg_temp.u(35),'notes-topic',pg_temp.r('BUA201'),t) from unnest(array['t1','t2','t3','t1']) t;
select is(private.mark_plan_use(pg_temp.u(35),'notes-topic',pg_temp.r('GST111'),'t9'),0,'free course reads are never recorded');
select private.mark_plan_use(pg_temp.u(36),'notes-topic',pg_temp.r('BUA201'),t) from unnest(array['t1','t2','t3']) t;
select private.mark_plan_use(pg_temp.u(36),'notes-topic',pg_temp.r('ENT211'),'notes');
select is((select count(*)::int from private.plan_use_events where user_id=pg_temp.u(35) and kind='notes-topic'),3,
  'a topic is recorded once per order');
select is((select jsonb_build_array(e->'standard_allowed',e->'standard_refused',e->'counts') from
  (select pg_temp.elig(id,pg_temp.ids(n)) e from o3x where o3x.n=x.n) y),expected,label)
from (values
  (31,'[false,["campus-bot"],{"campus_bot_replies":1,"exams_started":0,"practice_answers":0,"notes_topics":0}]'::jsonb,'one Campus Bot reply blocks'),
  (32,'[false,["exam"],{"campus_bot_replies":0,"exams_started":1,"practice_answers":0,"notes_topics":0}]','one exam started blocks'),
  (33,'[false,["practice"],{"campus_bot_replies":0,"exams_started":0,"practice_answers":11,"notes_topics":0}]','11 practice answers block'),
  (34,'[false,["practice"],{"campus_bot_replies":0,"exams_started":0,"practice_answers":11,"notes_topics":0}]','10 answers + a theory reveal block'),
  (35,'[true,[],{"campus_bot_replies":0,"exams_started":0,"practice_answers":10,"notes_topics":3}]','10 answers, 3 topics and GST use are allowed'),
  (36,'[false,["notes"],{"campus_bot_replies":0,"exams_started":0,"practice_answers":0,"notes_topics":4}]','4 topics block (a notes page counts as one)')
) x(n,expected,label);
select is(pg_temp.refund((select id from o3x where n=33),'standard',gen_random_uuid(),pg_temp.ids(33))->>'state','refused',
  'a refused standard refund changes nothing');
select is(pg_temp.grants((select id from o3x where n=33)),1,'grant kept');
select is((select count(*)::int from public.entitlement_grants where order_id=(select id from o3x where n=33) and revoked_at is null),1,
  'and still active');
select is(pg_temp.refund((select id from o3x where n=33),'our-fault',gen_random_uuid(),pg_temp.ids(33))->>'state','refund-pending',
  'our-fault: any use, any time');
-- Each threshold is a setting.
update private.payment_policy set refund_practice_answers_allowed=11;
select is((pg_temp.elig((select id from o3x where n=34),pg_temp.ids(34))->>'standard_allowed')::boolean,true,
  'raising the practice allowance allows 11');
update private.payment_policy set refund_practice_answers_allowed=10;

-- Change 4: judged at the time the student asked.
select pg_temp.student(37);
create temporary table o37 as select pg_temp.paid(37) id;
select pg_temp.paid_ago(id,interval '50 hours') from o37;
select is((pg_temp.elig((select id from o37),pg_temp.ids(37))->>'standard_allowed')::boolean,false,
  'row 23: at 50 h a standard refund is refused');
select is(pg_temp.elig((select id from o37),pg_temp.ids(37))->'standard_refused','["window"]','because of the window');
select pg_temp.answers(37,20);
select is((select jsonb_build_array(e->'standard_allowed',e->'counts'->'practice_answers') from (select public.refund_eligibility(
  (select id from o37),pg_temp.ids(37),(select paid_at+interval '47 hours' from private.payment_orders where id=(select id from o37))) e) x),
  '[true,0]','asked at 47 h: in the window, and later use does not count');
select is(pg_temp.refund((select id from o37),'standard',gen_random_uuid(),pg_temp.ids(37),
  (select paid_at+interval '47 hours' from private.payment_orders where id=(select id from o37)))->>'state','refund-pending',
  'refunded as asked at 47 h');
select throws_ok($$select public.refund_eligibility((select id from o3x where n=31),null,
  (select paid_at-interval '1 minute' from private.payment_orders where id=(select id from o3x where n=31)))$$,'22023',null,
  'the request time cannot be before payment');
select throws_ok($$select public.refund_eligibility((select id from o3x where n=31),null,clock_timestamp()+interval '1 hour')$$,
  '22023',null,'or in the future');

-- Row 24: one standard refund per identity, across accounts; our-fault and duplicate never count.
create temporary table o37b as select pg_temp.paid(37) id;
select is(pg_temp.elig((select id from o37b),pg_temp.ids(37))->'standard_refused','["limit"]',
  'a second standard refund on the same account is refused');
select pg_temp.student(38);
create temporary table o38 as select pg_temp.paid(38) id;
select is(pg_temp.refund((select id from o38),'standard',gen_random_uuid(),pg_temp.ids(37))->>'state','refused',
  'the same identity on a new account is refused');
select is(pg_temp.elig((select id from o38),pg_temp.ids(38))->>'standard_allowed','true',
  'another identity is allowed');
-- 33 had an our-fault refund: it does not count.
create temporary table o33b as select pg_temp.paid(33) id;
select is((pg_temp.elig((select id from o33b),pg_temp.ids(33))->>'refunds_used')::int,0,
  'an our-fault refund does not count');
-- Session plans are refunded whole.
select pg_temp.student(39);
create temporary table o39 as select pg_temp.paid(39,'plus_session') id;
select pg_temp.paid_ago(id,interval '1 hour') from o39;
select is(jsonb_array_length(pg_temp.refund((select id from o39),'standard',gen_random_uuid(),pg_temp.ids(39))->'revoked_grant_ids'),2,
  'both halves of a Session plan are revoked');
select is((select count(*)::int from private.entitlement_events e join public.entitlement_grants g on g.id=e.grant_id
  where g.order_id=(select id from o39) and e.event='payment.refund-revoked'),2,'each revocation is audited');

-- ---------------------------------------------------------------------------
-- Must-hold 4: settings changes never touch existing rows.
-- ---------------------------------------------------------------------------
select is(public.admin_set_plan('plus_semester',450000,6,null,'Ops','price test')->>'state','changed','price changed');
select is(public.admin_set_campus_bot_tier('plus',null,50000,null,130000,null,'Ops','budget test')->>'state','changed',
  'Campus Bot budget changed');
select is(jsonb_build_array(public.admin_set_campus_bot_model('sonnet',15,'Ops','weight test')->'model'->'price_weight',
    public.admin_set_campus_bot_request_cap('check',2500,1200,'Ops','cap test')->'cap'->'read_tokens_max',
    public.admin_set_campus_bot_model('opus',5,'Ops','unknown')->>'state'),
  '[15,2500,"not-found"]'::jsonb,'model weights and per-request caps are settings');
select public.admin_set_campus_bot_model('sonnet',20,'Ops','restore');
select public.admin_set_campus_bot_request_cap('check',3000,1500,'Ops','restore');
select is((select jsonb_build_array(amount_kobo,ai_sets,campus_bot_session_tokens,campus_bot_week_tokens)
  from private.payment_orders where id=(select pg_temp.oid(a) from t1)),'[400000,10,350000,700000]','existing order keeps its price and allowances');
select is((select jsonb_build_array(ai_units,campus_bot_session_tokens,campus_bot_week_tokens) from public.entitlement_grants
  where order_id=(select pg_temp.oid(a) from t1)),'[10,350000,700000]','existing grant keeps its allowances');
select pg_temp.student(40);
select is((select jsonb_build_array(amount_kobo,ai_sets,campus_bot_session_tokens,campus_bot_week_tokens) from private.payment_orders
  where id=pg_temp.oid(pg_temp.buy(40,'plus_semester',pg_temp.req(400)))),'[450000,6,50000,130000]','a new order takes the new values');
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(40,'plus_semester',pg_temp.req(400))),'ch_newprice',400000)->>'outcome','amount-mismatch',
  'and must be paid at its own price');
select public.admin_set_plan('plus_semester',400000,10,null,'Ops','restore');
select public.admin_set_campus_bot_tier('plus',null,350000,null,700000,null,'Ops','restore');
-- A pro plan copies the pro price and budget.
select pg_temp.student(41);
select is((select jsonb_build_array(plan_key,tier,period,amount_kobo,campus_bot_session_tokens,campus_bot_week_tokens)
  from private.payment_orders where id=pg_temp.oid(pg_temp.buy(41,'pro_session',pg_temp.req(410)))),
  '["pro_session","pro","session",1100000,700000,1400000]','a pro Session order: ₦11,000 and the pro budget');
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(41,'pro_session',pg_temp.req(410))),'ch_pro',1100000)->>'outcome','fulfilled',
  'pro Session fulfilled');
select is((select jsonb_agg(jsonb_build_array(paid_plan,plan_part,campus_bot_tier,campus_bot_week_tokens) order by plan_part)
  from public.entitlement_grants where order_id=pg_temp.oid(pg_temp.buy(41,'pro_session',pg_temp.req(410)))),
  '[["pro_session",1,"pro",1400000],["pro_session",2,"pro",1400000]]','both halves carry the pro budget');
select is(pg_temp.buy(41,'plus_semester',gen_random_uuid())->>'state','already-paid','one paid plan per semester, whatever the tier');

-- ---------------------------------------------------------------------------
-- Must-hold 8: events hold amounts, references and states only, and are append-only.
-- ---------------------------------------------------------------------------
select is(public.record_payment_event('fake','evt_1','collection.succeeded',(select pg_temp.oid(a) from t1),repeat('a',64))->>'state',
  'recorded','a delivery is recorded');
select is(public.record_payment_event('fake','evt_1','collection.succeeded',(select pg_temp.oid(a) from t1),repeat('a',64))->>'state',
  'duplicate','a replayed delivery is a duplicate');
select throws_ok($$insert into private.payment_events(event,actor,detail) values('x.y','test','{"reason_code":"a@b.test"}')$$,
  '23514',null,'no email address');
select throws_ok($$insert into private.payment_events(event,actor,detail) values('x.y','test','{"reason_code":"5399831234567890"}')$$,
  '23514',null,'no card or account number');
select throws_ok($$insert into private.payment_events(event,actor,detail) values('x.y','test','{"payment_id":"ch 1"}')$$,
  '23514',null,'a reference is an opaque id');
select lives_ok($$select private.log_payment_event(null,'x.y','test','{"payment_id":"ch_1234567890123456"}')$$,
  'a provider id may hold long digit runs');
select throws_ok($$insert into private.payment_events(event,actor,detail) values('x.y','test','{"email":"x"}')$$,
  '23514',null,'no field outside the allowed list');
select throws_ok($$update private.payment_events set actor='x'$$,'42501',null,'events cannot be changed');
select throws_ok($$delete from private.payment_events$$,'42501',null,'or deleted');
select is((select count(*)::int from private.payment_events where not private.payment_detail_ok(detail)),0,
  'every recorded event passes the check');

-- ---------------------------------------------------------------------------
-- Must-hold 3: a student reads only their own order, through the live session.
-- ---------------------------------------------------------------------------
create temporary table o2 as select pg_temp.oid(pg_temp.buy(2,'plus_semester',pg_temp.req(20))) id;
select set_config('pay.own',(select pg_temp.oid(a) from t1)::text,true), set_config('pay.other',(select id from o5)::text,true),
  set_config('pay.mismatch',(select id from o2)::text,true);
select pg_temp.claims(1);
set local role authenticated;
select is(public.get_my_payment_order(current_setting('pay.own')::uuid)->>'state','paid','own paid order');
select is(public.get_my_payment_order(current_setting('pay.other')::uuid)->>'state','not-found',
  'another student''s order looks unknown');
select is(public.get_my_payment_order(current_setting('pay.mismatch')::uuid)->>'state','not-found','not visible across students');
select is(public.get_my_payment_order(gen_random_uuid())->>'state','not-found','an unknown order');
select throws_ok($$select count(*) from private.payment_orders$$,'42501',null,'no direct table read');
select throws_ok($$select public.create_payment_order(gen_random_uuid(),'plus_semester',1,gen_random_uuid(),null,'fake')$$,'42501',null,
  'a student cannot create orders directly');
reset role;
select pg_temp.claims(2);
set local role authenticated;
select is(public.get_my_payment_order(current_setting('pay.mismatch')::uuid)->>'state','confirming',
  'a mismatch is never shown as paid');
reset role;
update auth.sessions set not_after=clock_timestamp() where id=pg_temp.s(1);
select pg_temp.claims(1);
set local role authenticated;
select throws_ok($$select public.get_my_payment_order(current_setting('pay.own')::uuid)$$,'42501',null,
  'an ended session reads nothing');
reset role;

-- ---------------------------------------------------------------------------
-- Must-hold 10: what exists behaves as before.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from private.effective_ai_window(pg_temp.u(4),array['trial','early_access','test'])),0,
  'a paid plan funds no AI until part 2 accepts it');
select pg_temp.student(50);
insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
  values(pg_temp.u(50),'paid',now()-interval '1 day',now()+interval '1 day','none','legacy');
select is((select course_term_id is not null and term_session_label is null from public.entitlement_grants where user_id=pg_temp.u(50)),
  true,'a paid row without an order keeps A1''s anchor binding');
select throws_ok($$insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by,paid_plan)
  values(pg_temp.u(50),'manual',now(),now()+interval '1 day','none','x','plus_semester')$$,'23514',null,
  'plan columns belong to paid orders only');
select is((select count(*)::int from public.ai_usage_events where funding_source not in ('trial','early_access','test','paid')),0,
  'funding sources accept paid');

select * from finish();
rollback;
