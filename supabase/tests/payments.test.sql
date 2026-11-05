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
create function pg_temp.paid(n int, plan text default 'standard_semester', req uuid default gen_random_uuid(),
  amount bigint default null) returns uuid language plpgsql as $$
declare o uuid;
begin
  o := pg_temp.oid(pg_temp.buy(n,plan,req));
  perform pg_temp.attach(o);
  perform pg_temp.pay(o,'ch_'||replace(o::text,'-',''),coalesce(amount,case plan when 'standard_session' then 700000 else 400000 end));
  return o;
end$$;
create function pg_temp.refund(o uuid, cls text, req uuid, ids text[], at timestamptz default clock_timestamp())
  returns jsonb language sql as
  $$select public.refund_order(o,cls,req,ids,'Ops','student asked',at)$$;
create function pg_temp.claims(n int) returns text language sql as
  $$select set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),
    'role','authenticated')::text,true)$$;
-- What the catch-up job would do with an order now (null: not due), and the orders a claim would take, released again.
create function pg_temp.due_action(o uuid) returns text language sql stable as $$
  select case when not private.payment_check_due(x, clock_timestamp()) then null
    when x.status in ('created','pending') and x.created_at > clock_timestamp() - make_interval(hours => p.reconcile_hours)
      then 'check' when x.status in ('created','pending') then 'expire' else 'late-check' end
  from private.payment_orders x cross join private.payment_policy p where x.id = o $$;
create function pg_temp.peek(n int, late boolean default true) returns table(order_id uuid, action text) language plpgsql as $$
declare t uuid := gen_random_uuid();
begin
  return query select c.order_id, c.action from public.claim_payment_checks(n, late, t) c;
  update private.payment_orders set check_lease_token=null, check_lease_until=null where check_lease_token=t;
end$$;
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
  'public.record_payment_outcome(uuid,text,text,text)',
  'public.record_payment_check(uuid,text,uuid)','public.claim_payment_checks(integer,boolean,uuid)',
  'public.refund_eligibility(uuid,text[],timestamptz,uuid)',
  'public.refund_order(uuid,text,uuid,text[],text,text,timestamptz,uuid)',
  'public.record_refund_result(uuid,text,text,text,text,text)','public.admin_set_sales_open(boolean,text,text)',
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
  '[["plus_semester","plus","semester",600000,"NGN",0,true],["plus_session","plus","session",1100000,"NGN",0,true],
    ["standard_semester","standard","semester",400000,"NGN",0,true],["standard_session","standard","session",700000,"NGN",0,true]]'::jsonb,
  'catalogue defaults: four plans, tier and period separate (no per-semester set count since part 2b)');
select is((select jsonb_agg(jsonb_build_array(tier,session_hours,session_tokens,week_days,week_tokens,written_token_weight)
  order by tier) from private.campus_bot_tiers),
  '[["plus",5,700000,7,1400000,5],["standard",5,350000,7,700000,5]]'::jsonb,
  'Campus Bot budgets: 7-day week, 5-hour session half of it, written tokens weighted 5');
select is((select jsonb_agg(jsonb_build_array(model,price_weight) order by model) from private.campus_bot_models),
  '[["haiku",1],["sonnet",20]]'::jsonb,'model price weights, Haiku = 1');
select is((select jsonb_agg(jsonb_build_array(step,read_tokens_max,written_tokens_max) order by step) from private.campus_bot_request_caps),
  '[["check",3000,1500],["writing",20000,8000]]'::jsonb,'per-request caps: writing 20,000/8,000, check 3,000/1,500');
select is((select jsonb_build_array(sales_open,checkout_minutes,sales_close_days,refund_window_hours,refunds_per_student,
  refund_campus_bot_replies_allowed,refund_exams_allowed,refund_practice_answers_allowed,refund_notes_topics_allowed)
  from private.payment_policy),'[false,60,3,48,1,0,0,10,3]'::jsonb,'policy defaults: sales closed, 60-minute checkout, 48 h');
select pg_temp.student(1);
select is(pg_temp.buy(1,'standard_semester',pg_temp.req(1))->>'state','sales-closed','nothing is sold while sales are closed');
select is(public.admin_set_sales_open(true,'Ops','launch test')->>'state','changed','an operator opens sales');
select is((select count(*)::int from private.entitlement_events where event='payment.sales-opened' and occurred_at>=now()),1,
  'opening is audited');

-- Return paths (change 3).
select is(private.payment_return_path_ok(p),true,'return path accepted: '||coalesce(p,'null'))
  from unnest(array['/access','/courses/bua-201?tab=notes',null]) p;
select is(private.payment_return_path_ok(p),false,'return path refused: '||p) from unnest(array['https://evil.test',
  '//evil.test','/\evil.test','javascript:alert(1)','/a//b','relative','','/a b','/x:y',repeat('/a',101)]) p;
select throws_ok($$select pg_temp.buy(1,'standard_semester',pg_temp.req(2),'//evil.test')$$,'22023',null,
  'create_payment_order refuses an unsafe return path');

-- ---------------------------------------------------------------------------
-- §7 row 11: a double tap reuses the order; row 1: a verified success grants the semester.
-- ---------------------------------------------------------------------------
create temporary table t1 as select pg_temp.buy(1,'standard_semester',pg_temp.req(1)) a, pg_temp.buy(1,'standard_semester',pg_temp.req(1)) b;
select is((select a->>'state' from t1),'created','first tap creates the order');
select is((select b->>'state' from t1),'existing','the same request id returns it');
select is((select pg_temp.oid(a)=pg_temp.oid(b) from t1),true,'one order for a double tap');
select is(pg_temp.buy(1,'standard_session',pg_temp.req(1))->>'state','request-conflict','a request id cannot change plan');
select is(pg_temp.oid(pg_temp.buy(1,'standard_semester',pg_temp.req(3))),(select pg_temp.oid(a) from t1),
  'another request reuses the open order for the same plan, semester and selection');
select is((select count(*)::int from private.payment_orders where user_id=pg_temp.u(1)),1,'still one order');
select is((select jsonb_build_array(amount_kobo,currency,ai_sets,campus_bot_session_tokens,campus_bot_week_tokens,status,return_path,
  expires_at>created_at+interval '59 minutes' and expires_at<=created_at+interval '60 minutes')
  from private.payment_orders where user_id=pg_temp.u(1)),'[400000,"NGN",0,350000,700000,"created","/access",true]'::jsonb,
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
  '["paid","standard_semester",1,"capped",0,"standard",350000,700000,true,true]'::jsonb,
  'one Semester grant bound to the bought semester, with the standard Campus Bot budget and no set count');
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
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))),'ch_one')->>'state','payment-conflict',
  'one provider payment never fulfils two orders');
-- Row 12: no checkout for a paid semester.
select is(pg_temp.buy(1,'standard_semester',gen_random_uuid())->>'state','already-paid','already paid');
select is(pg_temp.buy(1,'standard_session',gen_random_uuid())->>'state','already-paid','a Session plan over a paid semester is refused');

-- Must-hold 2: only a verified success of the order's amount and currency grants.
select throws_ok($$select pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))),'ch_x',400000,'webhook','failed')$$,
  '22023',null,'a failed status is not fulfilled');
select throws_ok($$select pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))),'ch_x',400000,'webhook','open')$$,
  '22023',null,'an open status is not fulfilled');
select throws_ok($$select pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))),'ch_x',400000,'webhook',
  'succeeded','NGN','mobile_money')$$,'22023',null,'card or bank transfer only');
-- Row 9: less than the order, or another currency: amount-mismatch, no grant.
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))),'ch_short',4000)->>'outcome','amount-mismatch',
  'row 9: ₦40 for a ₦4,000 order');
select is(pg_temp.grants(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20)))),0,'no grant on a mismatch');
select is((pg_temp.order_row(pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))))).status,'amount-mismatch','order flagged');
select pg_temp.student(3);
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(3,'standard_semester',pg_temp.req(30))),'ch_usd',400000,'webhook','succeeded','USD')
  ->>'outcome','amount-mismatch','another currency is a mismatch');
select pg_temp.student(4);
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(4,'standard_semester',pg_temp.req(40))),'ch_over',500000,'webhook','overpaid')
  ->>'outcome','fulfilled','overpaid: granted');
select ok('overpaid'=any((pg_temp.order_row(pg_temp.oid(pg_temp.buy(4,'standard_semester',pg_temp.req(40))))).flags),
  'and flagged for support');
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(4,'standard_semester',pg_temp.req(40))),'ch_over2',400000,'webhook','accepted')
  ->>'outcome','extra-payment','a second payment on a paid order is recorded, not granted');
select is(pg_temp.grants(pg_temp.oid(pg_temp.buy(4,'standard_semester',pg_temp.req(40)))),1,'still one grant set');
select is((pg_temp.order_row(pg_temp.oid(pg_temp.buy(4,'standard_semester',pg_temp.req(40))))).status,'paid','order stays paid');

-- ---------------------------------------------------------------------------
-- Rows 3-6: decline, abandon, a late transfer, and success after expiry.
-- ---------------------------------------------------------------------------
select pg_temp.student(5);
create temporary table o5 as select pg_temp.oid(pg_temp.buy(5,'standard_semester',pg_temp.req(50))) id;
select pg_temp.attach(id) from o5;
select is(public.record_payment_outcome((select id from o5),'failed','declined','webhook')->>'order_status','failed','row 3: decline');
select is(pg_temp.grants((select id from o5)),0,'no grant');
select isnt(pg_temp.oid(pg_temp.buy(5,'standard_semester',pg_temp.req(51))),(select id from o5),'a retry makes a new order');
select is(public.record_payment_outcome((select pg_temp.oid(a) from t1),'failed',null,'webhook')->>'state','already-final',
  'a late failure never overrides a payment');
select pg_temp.student(6);
create temporary table o6 as select pg_temp.oid(pg_temp.buy(6,'standard_semester',pg_temp.req(60))) id;
select pg_temp.attach(id) from o6;
select is(public.record_payment_outcome((select id from o6),'cancelled','abandoned','return')->>'order_status','cancelled',
  'row 4: abandoned');
select is(private.course_selection_state(pg_temp.u(6))->>'state','open','selection stays open');
select is(public.record_payment_outcome((select id from o6),'expired',null,'reconcile')->>'state','already-final',
  'an ended order is not ended again');
select pg_temp.student(7);
create temporary table o7 as select pg_temp.oid(pg_temp.buy(7,'standard_semester',pg_temp.req(70))) id;
select pg_temp.attach(id) from o7;
select is(public.record_payment_outcome((select id from o7),'expired',null,'reconcile')->>'state','not-expired',
  'an order is not expired before its checkout');
update private.payment_orders set created_at=created_at-interval '10 minutes' where id=(select id from o7);
select is(pg_temp.due_action((select id from o7)),'check',
  'row 5: a pending transfer is checked by the catch-up job');
select is(pg_temp.pay((select id from o7),'ch_late_transfer',400000,'reconcile','succeeded','NGN','bank_transfer')->>'outcome',
  'fulfilled','the catch-up check fulfils it');
select pg_temp.student(8);
create temporary table o8 as select pg_temp.oid(pg_temp.buy(8,'standard_semester',pg_temp.req(80))) id;
select pg_temp.attach(id) from o8;
update private.payment_orders set created_at=created_at-interval '3 days',expires_at=expires_at-interval '3 days',
  checkout_expires_at=checkout_expires_at-interval '3 days' where id=(select id from o8);
select is(pg_temp.due_action((select id from o8)),'expire','old open order expires');
select is(public.record_payment_outcome((select id from o8),'expired',null,'reconcile')->>'order_status','expired','row 6: expired');
select is(pg_temp.due_action((select id from o8)),'late-check',
  'an expired order is still checked');
select is(pg_temp.pay((select id from o8),'ch_day3',400000,'reconcile','succeeded','NGN','bank_transfer')->>'outcome',
  'fulfilled','a checkout paid after it expired is fulfilled');
select is(pg_temp.allowed(8,'BUA201'),true,'and opens the courses');

-- Row 10: two orders for one semester, both paid. The second grants nothing and may be refunded as a duplicate.
select pg_temp.student(9);
create temporary table o9 as select pg_temp.oid(pg_temp.buy(9,'standard_semester',pg_temp.req(90))) a,
  pg_temp.oid(pg_temp.buy(9,'standard_semester',pg_temp.req(91),'/courses')) b;
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
select is(pg_temp.buy(10,'standard_semester',gen_random_uuid())->>'state','needs-selection','courses must be confirmed first');
select pg_temp.student(11);
select is(public.create_payment_order(pg_temp.s(11),'standard_semester',pg_temp.rev(11)-1,gen_random_uuid(),null,'fake')->>'state',
  'selection-changed','the confirm screen''s revision must match');
create temporary table o11 as select pg_temp.oid(pg_temp.buy(11,'standard_semester',pg_temp.req(110))) id;
update public.profiles set academic_level_id='20000000-0000-4000-8000-000000000001' where id=pg_temp.u(11);
select is(pg_temp.pay((select id from o11),'ch_changed')->>'outcome','fulfilled','a changed selection never refuses a payment');
select ok('selection-changed'=any((pg_temp.order_row((select id from o11))).flags),'it is flagged for support');

-- Row 29: the current semester is not sold within sales_close_days of its end.
update private.payment_policy set sales_close_days=30;
select pg_temp.student(12);
select is(pg_temp.buy(12,'standard_semester',gen_random_uuid())->>'state','sales-closed','not sold near the semester end');
update private.payment_policy set sales_close_days=3;

-- Row 32: deletion scheduled. No checkout; an open order still fulfils, flagged.
select pg_temp.student(13);
create temporary table o13 as select pg_temp.oid(pg_temp.buy(13,'standard_semester',pg_temp.req(130))) id;
insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at)
  values(pg_temp.u(13),now(),now()+interval '720 hours',now()+interval '720 hours');
select is(pg_temp.buy(13,'standard_semester',gen_random_uuid())->>'state','signed-out','no checkout once deletion is scheduled');
select is(pg_temp.pay((select id from o13),'ch_deleting')->>'outcome','fulfilled','money taken is still granted');
select ok('account-deletion'=any((pg_temp.order_row((select id from o13))).flags),'and flagged for refund');

-- Row 30: an operator-sourced verification, then the real webhook: one grant set.
select pg_temp.student(14);
create temporary table o14 as select pg_temp.oid(pg_temp.buy(14,'standard_semester',pg_temp.req(140))) id;
select is(pg_temp.pay((select id from o14),'ch_op',400000,'operator')->>'outcome','fulfilled','operator verification fulfils');
select is(pg_temp.pay((select id from o14),'ch_op',400000,'webhook')->>'outcome','fulfilled','webhook replays it');
select is(pg_temp.grants((select id from o14)),1,'one grant set');

-- ---------------------------------------------------------------------------
-- Session plans (rows 14-17, must-hold 9).
-- ---------------------------------------------------------------------------
-- Row 15: no Second Semester yet. The second half is pending by term key and binds only to that semester.
select pg_temp.student(20);
create temporary table o20 as select pg_temp.oid(pg_temp.buy(20,'standard_session',pg_temp.req(200))) id;
select is(pg_temp.pay((select id from o20),'ch_session1',700000)->>'outcome','fulfilled','Session plan fulfilled');
select is(pg_temp.grants((select id from o20)),2,'two grants');
select is((select jsonb_build_array(g.course_term_id is null,g.term_session_label,
  g.term_period_id='30000000-0000-4000-8000-000000000002',g.starts_at>clock_timestamp(),g.ai_units,g.campus_bot_week_tokens)
  from public.entitlement_grants g where order_id=(select id from o20) and plan_part=2),
  '[true,"2026/2027",true,true,0,700000]'::jsonb,'second half pending, keyed to Second Semester 2026/2027, not started');
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
create temporary table o21 as select pg_temp.oid(pg_temp.buy(21,'standard_session',pg_temp.req(210))) id;
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
  where p.key='first-semester')+interval '20 days' as at;
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
select throws_ok($$select public.record_refund_result((select (res->>'refund_id')::uuid from rf30b),'refunded',null,
  'GTB-REF-0001','Ops','1234')$$,'22023',null,'a card refund is never settled manually');
select is(public.record_refund_result((select (res->>'refund_id')::uuid from rf30b),'refunded','fref_30b',null,'Ops')
  ->>'refund_status','refunded','settled by the provider');
select is(public.record_refund_result((select (res->>'refund_id')::uuid from rf30b),'refunded','fref_30b',null,'Ops')
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
select is((select jsonb_build_array(e->'standard_allowed',e->'standard_refused') from (select public.refund_eligibility(
  (select id from o37),pg_temp.ids(37),(select paid_at+interval '47 hours' from private.payment_orders where id=(select id from o37))) e) x),
  '[true,[]]','asked at 47 h with no use: in the window, judged at the request time');
select pg_temp.answers(37,20);
select is((select jsonb_build_array(e->'standard_allowed',e->'standard_refused',e->'counts'->'practice_answers')
  from (select public.refund_eligibility((select id from o37),pg_temp.ids(37),
    (select paid_at+interval '47 hours' from private.payment_orders where id=(select id from o37))) e) x),
  '[false,["practice"],20]','use after asking counts until the refund is processed');
select is(pg_temp.refund((select id from o37),'standard',gen_random_uuid(),pg_temp.ids(37),
  (select paid_at+interval '47 hours' from private.payment_orders where id=(select id from o37)))->>'state','refused',
  'so a student who keeps using the plan while it is processed is refused');
select is(pg_temp.refund((select id from o37),'our-fault',gen_random_uuid(),pg_temp.ids(37))->>'state','refund-pending',
  'our-fault is still any use, any time');
create temporary table o37a as select pg_temp.paid(37) id;
select is(pg_temp.refund((select id from o37a),'standard',gen_random_uuid(),pg_temp.ids(37))->>'state','refund-pending',
  'a new payment with no use since it is refundable (earlier use came before it)');
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
create temporary table o39 as select pg_temp.paid(39,'standard_session') id;
select pg_temp.paid_ago(id,interval '1 hour') from o39;
select is(jsonb_array_length(pg_temp.refund((select id from o39),'standard',gen_random_uuid(),pg_temp.ids(39))->'revoked_grant_ids'),2,
  'both halves of a Session plan are revoked');
select is((select count(*)::int from private.entitlement_events e join public.entitlement_grants g on g.id=e.grant_id
  where g.order_id=(select id from o39) and e.event='payment.refund-revoked'),2,'each revocation is audited');

-- ---------------------------------------------------------------------------
-- Must-hold 4: settings changes never touch existing rows.
-- ---------------------------------------------------------------------------
select is(public.admin_set_plan('standard_semester',450000,null,null,'Ops','price test')->>'state','changed','price changed');
select throws_ok($$select public.admin_set_plan('standard_semester',null,6,null,'Ops','sets test')$$,'23514',null,
  'the per-semester set count is retired');
select is(public.admin_set_campus_bot_tier('standard',null,50000,null,130000,null,'Ops','budget test')->>'state','changed',
  'Campus Bot budget changed');
select is(jsonb_build_array(public.admin_set_campus_bot_model('sonnet',15,'Ops','weight test')->'model'->'price_weight',
    public.admin_set_campus_bot_request_cap('check',2500,1200,'Ops','cap test')->'cap'->'read_tokens_max',
    public.admin_set_campus_bot_model('opus',5,'Ops','unknown')->>'state'),
  '[15,2500,"not-found"]'::jsonb,'model weights and per-request caps are settings');
select public.admin_set_campus_bot_model('sonnet',20,'Ops','restore');
select public.admin_set_campus_bot_request_cap('check',3000,1500,'Ops','restore');
select is((select jsonb_build_array(amount_kobo,ai_sets,campus_bot_session_tokens,campus_bot_week_tokens)
  from private.payment_orders where id=(select pg_temp.oid(a) from t1)),'[400000,0,350000,700000]','existing order keeps its price and allowances');
select is((select jsonb_build_array(ai_units,campus_bot_session_tokens,campus_bot_week_tokens) from public.entitlement_grants
  where order_id=(select pg_temp.oid(a) from t1)),'[0,350000,700000]','existing grant keeps its allowances');
select pg_temp.student(40);
create temporary table o40 as select pg_temp.oid(pg_temp.buy(40,'standard_semester',pg_temp.req(400))) id;
select is((select jsonb_build_array(amount_kobo,ai_sets,campus_bot_session_tokens,campus_bot_week_tokens) from private.payment_orders
  where id=(select id from o40)),'[450000,0,50000,130000]','a new order takes the new values');
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(40,'standard_semester',pg_temp.req(400))),'ch_newprice',400000)->>'outcome','amount-mismatch',
  'and must be paid at its own price');
select public.admin_set_plan('standard_semester',400000,null,null,'Ops','restore');
select public.admin_set_campus_bot_tier('standard',null,350000,null,700000,null,'Ops','restore');
-- A plus plan copies the plus price and budget.
select pg_temp.student(41);
create temporary table o41 as select pg_temp.oid(pg_temp.buy(41,'plus_session',pg_temp.req(410))) id;
select is((select jsonb_build_array(plan_key,tier,period,amount_kobo,campus_bot_session_tokens,campus_bot_week_tokens)
  from private.payment_orders where id=(select id from o41)),
  '["plus_session","plus","session",1100000,700000,1400000]','a plus Session order: ₦11,000 and the plus budget');
select is(pg_temp.pay(pg_temp.oid(pg_temp.buy(41,'plus_session',pg_temp.req(410))),'ch_plus',1100000)->>'outcome','fulfilled',
  'plus Session fulfilled');
select is((select jsonb_agg(jsonb_build_array(paid_plan,plan_part,campus_bot_tier,campus_bot_week_tokens) order by plan_part)
  from public.entitlement_grants where order_id=pg_temp.oid(pg_temp.buy(41,'plus_session',pg_temp.req(410)))),
  '[["plus_session",1,"plus",1400000],["plus_session",2,"plus",1400000]]','both halves carry the plus budget');
select is(pg_temp.buy(41,'standard_semester',gen_random_uuid())->>'state','already-paid','one paid plan per semester, whatever the tier');

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
create temporary table o2 as select pg_temp.oid(pg_temp.buy(2,'standard_semester',pg_temp.req(20))) id;
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
select throws_ok($$select public.create_payment_order(gen_random_uuid(),'standard_semester',1,gen_random_uuid(),null,'fake')$$,'42501',null,
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
  values(pg_temp.u(50),'manual',now(),now()+interval '1 day','none','x','standard_semester')$$,'23514',null,
  'plan columns belong to paid orders only');
select is((select count(*)::int from public.ai_usage_events where funding_source not in ('trial','early_access','test','paid')),0,
  'funding sources accept paid');


-- ---------------------------------------------------------------------------
-- Overpayment: the plan is granted; the amount above the price is refunded on its own, any time, never counted, with
-- access unchanged, to the account that paid. Health lists the order until the excess is refunded.
-- ---------------------------------------------------------------------------
select pg_temp.student(62);
create temporary table o62 as select pg_temp.oid(pg_temp.buy(62,'standard_semester',pg_temp.req(620))) id;
select pg_temp.attach(id) from o62;
select is(pg_temp.pay((select id from o62),'ch_over62',450000,'webhook','overpaid','NGN','bank_transfer')->>'outcome',
  'fulfilled','an overpaid bank transfer is granted');
select pg_temp.paid_ago(id,interval '30 days') from o62;
create function pg_temp.excess_due(o uuid) returns boolean language sql stable as
  $$select exists(select 1 from jsonb_array_elements(public.admin_payments_health()->'overpaid_excess_due') e
    where e->>'order_id'=o::text)$$;
select is((select jsonb_build_array(e->'classes_allowed',e->'excess_kobo') from
  (select pg_temp.elig((select id from o62),pg_temp.ids(62)) e) x),'[["standard","our-fault","excess"],50000]',
  'the excess can be refunded, 30 days on');
select ok(pg_temp.excess_due((select id from o62)),'payments-health lists the overpaid order');
select ok(not exists(select 1 from jsonb_array_elements(public.admin_payments_health()->'needs_support') e
  where e->>'order_id'=(select id from o62)::text),'the overpaid flag alone is not a support case');
create temporary table rf62 as select pg_temp.refund((select id from o62),'excess',pg_temp.req(621),pg_temp.ids(62)) res;
select is((select jsonb_build_array(res->>'state',res->'amount_kobo',res->'revoked_grant_ids') from rf62),
  '["refund-pending",50000,[]]','an excess refund is the amount above the price, and revokes nothing');
select is((pg_temp.order_row((select id from o62))).status,'paid','the order stays paid');
select is(pg_temp.allowed(62,'BUA201'),true,'access is unchanged');
select is(pg_temp.refund((select id from o62),'excess',gen_random_uuid(),pg_temp.ids(62))->>'state','already-refunding',
  'one excess refund per payment');
select ok(pg_temp.excess_due((select id from o62)),'still listed while the refund is pending');
select throws_ok($$select public.record_refund_result((select (res->>'refund_id')::uuid from rf62),'refunded',null,
  'GTB-EX-62','Ops')$$,'22023',null,'a manual settlement names the paying account''s last four digits');
select is(public.record_refund_result((select (res->>'refund_id')::uuid from rf62),'refunded',null,'GTB-EX-62','Ops','4321')
  ->>'refund_status','refunded','settled by bank transfer to the account that paid');
select is((select manual_account_last4 from private.payment_refunds where id=(select (res->>'refund_id')::uuid from rf62)),
  '4321','only the transfer reference and the last four digits are kept');
select is((pg_temp.order_row((select id from o62))).status,'paid','still paid');
select ok(not pg_temp.excess_due((select id from o62)),'no longer listed once the excess is refunded');
select is((pg_temp.elig((select id from o62),pg_temp.ids(62))->>'refunds_used')::int,0,'an excess refund never counts');
create temporary table rf62b as select pg_temp.refund((select id from o62),'our-fault',pg_temp.req(622),pg_temp.ids(62)) res;
select is((select jsonb_build_array(res->>'state',res->'amount_kobo') from rf62b),'["refund-pending",400000]',
  'a plan refund after the excess returns the rest');
select is(pg_temp.allowed(62,'BUA201'),false,'and ends access');
select is(pg_temp.refund((select id from o3x where n=35),'excess',gen_random_uuid(),pg_temp.ids(35))->>'state',
  'card-excess-support','card excess always goes through Bachs support');
-- Cards keep their one Bachs refund for the plan; an excess goes through Bachs support without a record.
select pg_temp.student(63);
create temporary table o63 as select pg_temp.oid(pg_temp.buy(63,'standard_semester',pg_temp.req(630))) id;
select pg_temp.attach(id) from o63;
select pg_temp.pay((select id from o63),'ch_over63',450000,'webhook','overpaid');
select is(pg_temp.refund((select id from o63),'excess',gen_random_uuid(),pg_temp.ids(63))->>'state','card-excess-support',
  'a card excess refund is refused');
select is((select count(*)::int from private.payment_refunds where order_id=(select id from o63)),0,
  'nothing is recorded for card excess');
select is((pg_temp.order_row((select id from o63))).status,'paid','the card order stays paid');
select is(pg_temp.elig((select id from o63),pg_temp.ids(63))->'classes_allowed','["standard","our-fault"]'::jsonb,
  'excess is not offered for a card payment');
select ok(exists(select 1 from jsonb_array_elements(public.admin_payments_health()->'card_excess_contact_bachs_support') e
    where e->>'order_id'=(select id::text from o63) and e->>'action'='contact Bachs support')
  and not exists(select 1 from jsonb_array_elements(public.admin_payments_health()->'overpaid_excess_due') e
    where e->>'order_id'=(select id::text from o63)),'card excess has its own health line: contact Bachs support');
select is(pg_temp.allowed(63,'BUA201'),true,'the card grant stays live');
select is(pg_temp.refund((select id from o63),'standard',gen_random_uuid(),pg_temp.ids(63))->>'state','refund-pending',
  'a qualifying plan refund can still use the card refund');
-- Health: a card payment refunded in full has no excess left to raise with Bachs (20261102210000).
create function pg_temp.card_excess_listed(o uuid) returns boolean language sql stable as
  $$select exists(select 1 from jsonb_array_elements(public.admin_payments_health()->'card_excess_contact_bachs_support') e
    where e->>'order_id'=o::text)$$;
select ok(pg_temp.card_excess_listed((select id from o63)),'the card excess stays listed while the plan refund is pending');
select is((select amount_kobo from private.payment_refunds where order_id=(select id from o63)),450000::bigint,
  'the card plan refund returns the whole payment');
select is(public.record_refund_result((select id from private.payment_refunds where order_id=(select id from o63)),
  'refunded','fref_63',null,'Ops')->>'refund_status','refunded','the card refund settles');
select ok(not pg_temp.card_excess_listed((select id from o63)),
  'a card payment refunded in full leaves the card excess list, like the bank-transfer queue');
select pg_temp.student(66);
create temporary table o66 as select pg_temp.oid(pg_temp.buy(66,'standard_semester',pg_temp.req(660))) id;
select pg_temp.attach(id) from o66;
select pg_temp.pay((select id from o66),'ch_over66',450000,'webhook','overpaid');
select ok(pg_temp.card_excess_listed((select id from o66)),'an unrefunded card excess is still listed');

-- A plan refund waits for either a pending or a failed excess. Retry the excess first, then return the rest.
select pg_temp.student(65);
create temporary table o65 as select pg_temp.oid(pg_temp.buy(65,'standard_semester',pg_temp.req(650))) id;
select pg_temp.attach(id) from o65;
select pg_temp.pay((select id from o65),'ch_over65',450000,'webhook','overpaid','NGN','bank_transfer');
create temporary table rf65 as select pg_temp.refund((select id from o65),'excess',pg_temp.req(651),pg_temp.ids(65)) res;
select is(pg_temp.refund((select id from o65),'our-fault',pg_temp.req(652),pg_temp.ids(65))->>'state','excess-unsettled',
  'a plan refund is refused while the excess is pending');
select is((select count(*)::int from private.payment_refunds where order_id=(select id from o65)),1,
  'the refused plan refund records nothing');
select is(pg_temp.allowed(65,'BUA201'),true,'the refusal changes no access');
select public.record_refund_result((select (res->>'refund_id')::uuid from rf65),'failed',null,null,'Ops');
select is(pg_temp.refund((select id from o65),'our-fault',pg_temp.req(652),pg_temp.ids(65))->>'state','excess-unsettled',
  'a failed excess still has to be settled first');
create temporary table rf65retry as select pg_temp.refund((select id from o65),'excess',pg_temp.req(653),pg_temp.ids(65)) res;
select is((select res->>'state' from rf65retry),'refund-pending','the failed excess can be retried');
select public.record_refund_result((select (res->>'refund_id')::uuid from rf65retry),'refunded',null,'BANK-65','Ops','4321');
select is(pg_temp.refund((select id from o65),'our-fault',pg_temp.req(652),pg_temp.ids(65))->'amount_kobo','400000',
  'after the retried excess settles the plan refund returns exactly the rest');

-- ---------------------------------------------------------------------------
-- A failed refund of an extra payment is re-requested for that same payment, in either class.
-- ---------------------------------------------------------------------------
select pg_temp.student(64);
create temporary table o64 as select pg_temp.paid(64) id;
select is(pg_temp.pay((select id from o64),'ch_extra64')->>'outcome','extra-payment','a second payment on the order');
create temporary table x64 as select id from private.payment_fulfilments where provider_payment_id='ch_extra64';
create function pg_temp.refund_extra(cls text, req uuid) returns jsonb language sql as
  $$select public.refund_order((select id from o64),cls,req,pg_temp.ids(64),'Ops','second payment',clock_timestamp(),
    (select id from x64))$$;
-- One result per line, as pg_prove reads them.
create function pg_temp.extra_retry(cls text, req uuid, retry uuid) returns setof text language plpgsql as $$
begin
  return next is(pg_temp.refund_extra(cls,req)->>'state','refund-pending','extra payment, '||cls||': recorded');
  return next is(public.record_refund_result((pg_temp.refund_extra(cls,req)->>'refund_id')::uuid,'failed',null,null,'Ops')
    ->>'refund_status','failed',cls||': the provider refused');
  return next is(pg_temp.refund_extra(cls,retry)->>'payment_id',(select id::text from x64),
    cls||': the retry refunds the same extra payment');
  return next is(public.record_refund_result((pg_temp.refund_extra(cls,retry)->>'refund_id')::uuid,'failed',null,null,'Ops')
    ->>'refund_status','failed',cls||': a second failure is recorded the same way');
end$$;
select pg_temp.extra_retry('duplicate',pg_temp.req(640),pg_temp.req(641));
select pg_temp.extra_retry('our-fault',pg_temp.req(642),pg_temp.req(643));
select is((select count(*)::int from public.entitlement_grants where order_id=(select id from o64) and revoked_at is null),1,
  'refunding the extra payment never touches the plan');

-- ---------------------------------------------------------------------------
-- Catch-up: reserved longest waiters first, then newest open orders; leased batches, fenced completion, failures backing off, refusals
-- stopped for review, and a final check after day 14.
-- ---------------------------------------------------------------------------
create temporary table bulk as select gen_random_uuid() id, g from generate_series(1,620) g;
insert into private.payment_orders (id,user_id,request_id,plan_key,tier,period,amount_kobo,currency,ai_sets,
    campus_bot_session_tokens,campus_bot_week_tokens,term_id,term_session_label,term_period_id,second_period_id,
    department_id,profile_revision,provider,status,expires_at,created_at)
  select b.id,null,gen_random_uuid(),t.plan_key,t.tier,t.period,t.amount_kobo,t.currency,t.ai_sets,
    t.campus_bot_session_tokens,t.campus_bot_week_tokens,t.term_id,t.term_session_label,t.term_period_id,
    t.second_period_id,t.department_id,t.profile_revision,'fake','created',clock_timestamp()+interval '1 hour',
    clock_timestamp()-make_interval(mins=>10+b.g)
  from bulk b, private.payment_orders t where t.id=(select id from o30);
select is((select count(*)::int from bulk b join private.payment_orders o on o.id=b.id
  where private.payment_check_due(o,clock_timestamp())),620,'more due orders than one claim (50) and the old query (500)');
select is((select array_agg(b.g order by b.g) from pg_temp.peek(50) c join bulk b on b.id=c.order_id),
  (select array_agg(g order by g) from (select generate_series(1,40) g union all select generate_series(611,620)) x),
  'the first batch is the 40 newest open orders plus the 10 that have waited longest');
create temporary table bulk_order_lease as select gen_random_uuid() token;
select is((select array_agg(b.g order by c.ordinality)
    from public.claim_payment_checks(50,true,(select token from bulk_order_lease)) with ordinality c
    join bulk b on b.id=c.order_id),
  array(select generate_series(620,611,-1)) || array(select generate_series(1,40)),
  'reserved longest-waiting checks are returned first, then fresh orders newest first');
update private.payment_orders set check_lease_token=null, check_lease_until=null
  where check_lease_token=(select token from bulk_order_lease);
do $$
declare n int := 0; lease uuid;
begin
  loop
    lease := gen_random_uuid();
    perform public.record_payment_check(c.order_id,'waiting',lease) from public.claim_payment_checks(50,true,lease) c;
    n := n + 1;
    exit when not exists (select 1 from pg_temp.peek(1)) or n > 40;
  end loop;
  perform set_config('test.batches', n::text, true);
end $$;
select ok(current_setting('test.batches')::int between 13 and 20,'batches of 50 walk the whole queue: '
  ||current_setting('test.batches'));
select is((select count(*)::int from private.payment_orders o join bulk b on b.id=o.id
  where o.check_count=1 and o.last_check_result='waiting' and o.next_check_at between clock_timestamp()+interval '1 minute'
    and clock_timestamp()+interval '3 minutes'),620,'every candidate was checked once and is next due in 2 minutes');
select is(public.record_payment_check(gen_random_uuid(),'waiting',gen_random_uuid())->>'state','not-found','an unknown order');
select throws_ok($$select public.record_payment_check((select id from bulk where g=1),'fine',gen_random_uuid())$$,'22023',null,
  'only known results are recorded');
-- Give a fixture a lease to test completion and back-off independently of other fixtures' due times.
create function pg_temp.checked(o uuid, result text) returns jsonb language plpgsql as $$
declare lease uuid := gen_random_uuid();
begin
  update private.payment_orders set check_lease_token=lease, check_lease_until=clock_timestamp()+interval '1 minute' where id=o;
  return public.record_payment_check(o,result,lease);
end$$;
-- Ended orders back off until the final due check is completed.
update private.payment_orders set status='expired', check_count=k
  from (values (1,0),(2,3),(3,10)) v(g,k), bulk b where b.g=v.g and payment_orders.id=b.id;
select is((select array_agg(round(extract(epoch from (pg_temp.checked(b.id,'waiting')->>'next_check_at')::timestamptz
    - clock_timestamp())/3600) order by b.g) from bulk b where b.g<=3),array[1,8,48]::numeric[],
  'late checks back off: 1 h, then doubling, at most 48 h');
select is((select last_check_result from private.payment_orders where id=(select id from bulk where g=2)),'waiting',
  'a completed check is recorded');
update private.payment_orders set next_check_at=clock_timestamp()-interval '2 days' where id=(select id from bulk where g=3);
select is((select order_id from pg_temp.peek(1)),(select id from bulk where g=3),
  'with no open order due, the most overdue goes first, even a late check');
select ok(not exists(select 1 from pg_temp.peek(50,false) where order_id=(select id from bulk where g=3)),
  'without the late check, ended orders are not asked');
update private.payment_orders set created_at=clock_timestamp()-interval '15 days' where id=(select id from bulk where g=3);
select ok(pg_temp.due_action((select id from bulk where g=3)) is not null,'an overdue late check survives day 14');
select ok((public.admin_payments_health()->>'checks_overdue_6h')::int >= 1,'health counts checks over six hours late');
create temporary table final_lease as select gen_random_uuid() token;
select * from public.claim_payment_checks(1,true,(select token from final_lease));
select is((select count(*)::int from public.claim_payment_checks(1,true,gen_random_uuid())),0,
  'a live lease cannot be claimed by another run');
select is(public.record_payment_check((select id from bulk where g=3),'waiting',gen_random_uuid())->>'state','lease-lost',
  'another run cannot complete the claim');
update private.payment_orders set check_lease_until=clock_timestamp()-interval '1 second' where id=(select id from bulk where g=3);
select is(public.record_payment_check((select id from bulk where g=3),'waiting',(select token from final_lease))->>'state',
  'lease-lost','an expired owner cannot complete the check');
create temporary table retry_lease as select gen_random_uuid() token;
select is((select order_id from public.claim_payment_checks(1,true,(select token from retry_lease))),
  (select id from bulk where g=3),'an unfinished check is due again when its lease expires');
select is(public.record_payment_check((select id from bulk where g=3),'waiting',(select token from final_lease))->>'state',
  'lease-lost','a replaced lease is fenced out');
select is(public.record_payment_check((select id from bulk where g=3),'provider-unavailable',
  (select token from retry_lease))->>'state','failed','a provider outage is recorded as a failed check');
select is((select jsonb_build_array(last_check_result,check_failures,late_check_finished_at is null,
    round(extract(epoch from next_check_at-clock_timestamp())/60)) from private.payment_orders where id=(select id from bulk where g=3)),
  '["provider-unavailable",1,true,5]','it does not consume the final check, and is tried again in 5 minutes');
select ok((public.admin_payments_health()->>'checks_overdue_6h')::int >= 1,'and stays counted as overdue while it backs off');
create function pg_temp.fail_again(o uuid) returns numeric language plpgsql as $$
declare lease uuid := gen_random_uuid();
begin
  update private.payment_orders set check_lease_token=lease, check_lease_until=clock_timestamp()+interval '1 minute' where id=o;
  return round(extract(epoch from (public.record_payment_check(o,'error',lease)->>'next_check_at')::timestamptz
    - clock_timestamp())/60);
end$$;
select is(array[pg_temp.fail_again((select id from bulk where g=3)),pg_temp.fail_again((select id from bulk where g=3)),
  pg_temp.fail_again((select id from bulk where g=3))],array[15,60,60]::numeric[],'failures back off 5, then 15, then 60 minutes');
update private.payment_orders set next_check_at=clock_timestamp()-interval '1 second' where id=(select id from bulk where g=3);
create temporary table final_retry as select gen_random_uuid() token;
select is((select order_id from public.claim_payment_checks(1,true,(select token from final_retry))),
  (select id from bulk where g=3),'when its back-off ends, the final check is due again');
select is(public.record_payment_check((select id from bulk where g=3),'waiting',(select token from final_retry))->>'state',
  'recorded','the final due check is completed by the current lease');
select is((select jsonb_build_array(check_failures,check_failing_since,late_check_finished_at is not null)
  from private.payment_orders where id=(select id from bulk where g=3)),'[0,null,true]',
  'a completed check clears the failures; only then does the old order leave late checks');
select is(pg_temp.due_action((select id from bulk where g=3)),null,'it is not checked again');
select is((public.admin_payments_health()->>'checks_overdue_6h')::int,0,'the overdue health count clears on completion');
-- A permanent refusal stops checks for review, so late checks can finish.
update private.payment_orders set status='created', next_check_at=clock_timestamp()-interval '1 second'
  where id=(select id from bulk where g=4);
select is(pg_temp.checked((select id from bulk where g=4),'review')->>'state','stopped','a permanent refusal stops checks');
select is(pg_temp.due_action((select id from bulk where g=4)),null,'it is not checked again');
select ok(exists(select 1 from jsonb_array_elements(public.admin_payments_health()->'checks_stopped_for_review') e
  where e->>'order_id'=(select id::text from bulk where g=4)),'and is listed for review');
-- A single-order claim always reserves its slot for the longest-waiting due check.
update private.payment_orders set next_check_at=clock_timestamp()-interval '3 days', status='expired'
  where id=(select id from bulk where g=5);
update private.payment_orders set next_check_at=clock_timestamp()-interval '1 minute', status='created',
  created_at=clock_timestamp()-interval '5 minutes' where id=(select id from bulk where g=6);
update private.payment_orders set next_check_at=clock_timestamp()-interval '1 minute', status='created',
  created_at=clock_timestamp()-interval '20 minutes' where id=(select id from bulk where g=7);
create temporary table order_lease as select gen_random_uuid() token;
create function pg_temp.next_claimed() returns int language sql as
  $$select b.g from public.claim_payment_checks(1,true,(select token from order_lease)) c join bulk b on b.id=c.order_id$$;
select is(array[pg_temp.next_claimed(),pg_temp.next_claimed(),pg_temp.next_claimed()],array[5,6,7],
  'a single-order claim reserves its slot for the longest-waiting due check');
update private.payment_orders set check_lease_token=null, check_lease_until=null
  where check_lease_token=(select token from order_lease);
update private.payment_orders set status='cancelled' where id in (select id from bulk);

-- New orders keep arriving faster than one claim can take them, yet an overdue check still gets its turn: every claim
-- reserves a fifth of its slots for the checks that have waited longest (20261102210000).
create temporary table parked as select o.id, o.next_check_at from private.payment_orders o
  where private.payment_check_due(o, clock_timestamp());
update private.payment_orders set next_check_at=clock_timestamp()+interval '1 day' where id in (select id from parked);
create function pg_temp.order_like(p_status text, p_created timestamptz, p_next timestamptz) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into private.payment_orders (id,user_id,request_id,plan_key,tier,period,amount_kobo,currency,ai_sets,
      campus_bot_session_tokens,campus_bot_week_tokens,term_id,term_session_label,term_period_id,second_period_id,
      department_id,profile_revision,provider,status,expires_at,created_at,next_check_at)
    select v,null,gen_random_uuid(),t.plan_key,t.tier,t.period,t.amount_kobo,t.currency,t.ai_sets,
      t.campus_bot_session_tokens,t.campus_bot_week_tokens,t.term_id,t.term_session_label,t.term_period_id,
      t.second_period_id,t.department_id,t.profile_revision,'fake',p_status,clock_timestamp()+interval '1 hour',p_created,p_next
    from private.payment_orders t where t.id=(select id from o30);
  return v;
end$$;
-- 25 late checks that have waited two days, then the one under test, overdue by a day.
create temporary table starved as select pg_temp.order_like('expired',clock_timestamp()-interval '5 days',
  clock_timestamp()-interval '2 days'+make_interval(mins=>g)) id from generate_series(1,25) g;
create temporary table target as select pg_temp.order_like('expired',clock_timestamp()-interval '5 days',
  clock_timestamp()-interval '1 day') id;
create temporary table arrivals (run int, id uuid);
create temporary table runs (run int, claimed_target boolean, old_order_had_target boolean, new_claimed int, claimed int);
do $$
declare r int; lease uuid; v_now timestamptz; v_old boolean;
begin
  for r in 1..5 loop
    -- 60 new open orders arrive before each run, all due now.
    insert into arrivals select r, pg_temp.order_like('created',clock_timestamp()-make_interval(secs=>i),
      clock_timestamp()-interval '1 second') from generate_series(1,60) i;
    -- The order before this fix, on the same due orders: open orders newest first, then by due time, 50 at most.
    v_now := clock_timestamp();
    v_old := (select id from target) in (select o.id from private.payment_orders o
      where private.payment_check_due(o,v_now) and (o.check_lease_until is null or o.check_lease_until<=v_now)
      order by (o.status in ('created','pending')
          and o.created_at>v_now-make_interval(hours=>(select reconcile_hours from private.payment_policy))) desc,
        case when o.status in ('created','pending') then o.created_at end desc nulls last,
        coalesce(o.next_check_at,o.created_at+interval '2 minutes'), o.id limit 50);
    lease := gen_random_uuid();
    create temporary table this_claim as select * from public.claim_payment_checks(50,true,lease);
    insert into runs select r, exists(select 1 from this_claim where order_id=(select id from target)), v_old,
      (select count(*) from this_claim c join arrivals a on a.id=c.order_id and a.run=r), (select count(*) from this_claim);
    perform public.record_payment_check(c.order_id,'waiting',lease) from this_claim c;
    drop table this_claim;
  end loop;
end $$;
select is((select min(run) from runs where claimed_target),3,
  'an overdue check behind 25 longer waiters is claimed in the third run, though 60 new orders arrive before every run');
select is((select count(*)::int from runs where old_order_had_target),0,
  'with the earlier newest-first order it would not have been claimed in any of the five runs');
select is((select array_agg(new_claimed order by run) from runs),array[40,40,40,40,40],
  'new open orders still get the other 40 slots of every run');
select is((select array_agg(claimed order by run) from runs),array[50,50,50,50,50],'every run claims a full batch');
select is((select jsonb_build_array(check_count,last_check_result) from private.payment_orders where id=(select id from target)),
  '[1,"waiting"]'::jsonb,'its check was completed');
update private.payment_orders set late_check_finished_at=clock_timestamp(), status='cancelled'
  where id in (select id from starved union all select id from target union all select id from arrivals);
update private.payment_orders o set next_check_at=p.next_check_at from parked p where o.id=p.id;

-- ---------------------------------------------------------------------------
-- The sales switch through its operator function, and account deletion with payment records. (safeupdate, which the
-- API applies, cannot be loaded by this runner's role; the server database test covers the switch through the API.)
-- ---------------------------------------------------------------------------
select is(public.admin_set_sales_open(false,'Ops','switch test')->>'sales_open','false','sales close');
select is(public.admin_set_sales_open(true,'Ops','switch test')->>'sales_open','true','and open again');
select pg_temp.student(60);
create temporary table o60 as select pg_temp.paid(60) id;
select private.mark_plan_use(pg_temp.u(60),'campus-bot-reply',null,'reply-1');
select is(pg_temp.refund((select id from o60),'our-fault',pg_temp.req(600),pg_temp.ids(60))->>'state','refund-pending',
  'the student has an order, a payment, grants, plan use and a refund');
select lives_ok($$delete from auth.users where id=pg_temp.u(60)$$,'a student with payment records can be deleted');
select is((select jsonb_build_array(o.user_id,(select count(*) from private.payment_fulfilments f where f.order_id=o.id),
    (select count(*) from private.payment_refunds r where r.order_id=o.id and r.user_id is null),
    (select count(*) from private.plan_use_events u where u.order_id=o.id and u.user_id is null))
  from private.payment_orders o where o.id=(select id from o60)),'[null,1,1,1]'::jsonb,
  'the order, payment, refund and plan use remain, with the student link cleared');
select throws_ok($$update private.plan_use_events set ref='changed' where order_id=(select id from o60)$$,'42501',null,
  'a deleted student''s plan use still cannot be changed');
select pg_temp.student(61);
create temporary table o61 as select pg_temp.paid(61) id;
select private.mark_plan_use(pg_temp.u(61),'campus-bot-reply',null,'reply-1');
select throws_ok($$update private.plan_use_events set user_id=null where user_id=pg_temp.u(61)$$,'42501',null,
  'a live student''s plan use cannot be unlinked');
select throws_ok($$delete from private.plan_use_events where user_id=pg_temp.u(61)$$,'42501',null,'or deleted');
select throws_ok($$update private.plan_use_events set occurred_at=occurred_at-interval '1 day' where user_id=pg_temp.u(61)$$,
  '42501',null,'or changed in any other column');
select throws_ok($$update private.plan_use_events set user_id=null, ref='x' where user_id=pg_temp.u(61)$$,'42501',null,
  'nor unlinked together with another change');
select is((select count(*)::int from private.plan_use_events where user_id=pg_temp.u(61)),1,'the live student''s use is intact');

select * from finish();
rollback;
