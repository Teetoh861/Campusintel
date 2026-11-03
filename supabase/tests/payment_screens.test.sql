-- Payments part 3 (20261104100000): what the plan and payment screens read from get_my_entitlement() — the copy switch,
-- the plans on sale with catalogue prices, the student's semester, their paid plan and receipts — and plans_on_sale().
-- A paid grant counts only within its semester, never in the stored slack. The provider is never called (fake ids only).
begin;
select no_plan();

-- The running First Semester began 100 days ago; nothing else is in the calendar.
delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on = (now() at time zone 'Africa/Lagos')::date - 100;

create function pg_temp.u(n int) returns uuid language sql immutable as
  $$select ('b7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql immutable as
  $$select ('b7500000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.student(n int) returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated','screens-'||n||'@example.test','fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
end$$;
create function pg_temp.paid(n int, plan text, amount bigint) returns uuid language plpgsql as $$
declare o uuid;
begin
  o := (public.create_payment_order(pg_temp.s(n),plan,(select revision from public.profiles where id=pg_temp.u(n)),
    gen_random_uuid(),'/access','fake')->'order'->>'id')::uuid;
  perform public.attach_payment_checkout(o,'fake','chk_'||replace(o::text,'-',''),'https://checkout.example.test/c/'||o,
    clock_timestamp()+interval '1 hour');
  perform public.fulfil_payment(o,'fake','ch_'||replace(o::text,'-',''),'succeeded',amount,'NGN','card',clock_timestamp(),
    'webhook','test');
  return o;
end$$;
-- get_my_entitlement() as student n, through their live session.
create function pg_temp.ent(n int) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),
    'role','authenticated')::text,true);
  set local role authenticated;
  v := public.get_my_entitlement();
  reset role;
  return v;
end$$;
create function pg_temp.on_sale(n int) returns boolean language plpgsql as $$
declare v boolean;
begin
  perform set_config('request.jwt.claims',json_build_object('sub',pg_temp.u(n),'session_id',pg_temp.s(n),
    'role','authenticated')::text,true);
  set local role authenticated;
  v := public.plans_on_sale();
  reset role;
  return v;
end$$;

-- ---------------------------------------------------------------------------
-- The switch alone: who may read it, and its default.
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated','public.plans_on_sale()','EXECUTE')
  and has_function_privilege('service_role','public.plans_on_sale()','EXECUTE')
  and not has_function_privilege('anon','public.plans_on_sale()','EXECUTE'),'plans_on_sale(): students and the server, not anon');
select is((select provolatile from pg_proc where oid='public.plans_on_sale()'::regprocedure),'s'::"char",'plans_on_sale() is stable');

select pg_temp.student(1);
select pg_temp.student(2);
select is(pg_temp.on_sale(1),false,'closed by default');
select is(pg_temp.ent(1)->'plans_on_sale','false'::jsonb,'the summary says closed');
select is(pg_temp.ent(1)->'plans','[]'::jsonb,'no plans or prices while sales are closed');
select is(pg_temp.ent(1)->'paid','null'::jsonb,'nothing paid');
select is(pg_temp.ent(1)->'receipts','[]'::jsonb,'no receipts');
select is(pg_temp.ent(1)->'term'->>'session_label','2026/2027','the semester the student is in');
select is(pg_temp.ent(1)->'term'->>'period_key','first-semester','a First Semester');
select ok((pg_temp.ent(1)->'term'->>'ends_at')::timestamptz > clock_timestamp(),'the semester has not ended');

-- ---------------------------------------------------------------------------
-- Sales open: the catalogue, Session plans only in a First Semester.
-- ---------------------------------------------------------------------------
select is(public.admin_set_sales_open(true,'Ops','screens test')->>'state','changed','an operator opens sales');
select is(pg_temp.on_sale(1),true,'open');
select is(pg_temp.ent(1)->'plans',
  '[{"plan":"standard_session","tier":"standard","period":"session","price_kobo":700000},
    {"plan":"standard_semester","tier":"standard","period":"semester","price_kobo":400000},
    {"plan":"plus_session","tier":"plus","period":"session","price_kobo":1100000},
    {"plan":"plus_semester","tier":"plus","period":"semester","price_kobo":600000}]'::jsonb,
  'four plans with catalogue prices during a First Semester');
select is(public.admin_set_plan('plus_session',1200000,0,true,'Ops','price test')->>'state','changed','an operator changes a price');
select is((select e->>'price_kobo' from jsonb_array_elements(pg_temp.ent(1)->'plans') e where e->>'plan'='plus_session'),
  '1200000','the summary shows the catalogue price, never a stored copy');
select is(public.admin_set_plan('plus_session',1100000,0,false,'Ops','retire test')->>'state','changed','an operator retires a plan');
select is((select count(*)::int from jsonb_array_elements(pg_temp.ent(1)->'plans') e where e->>'plan'='plus_session'),0,
  'a retired plan is not offered');
select public.admin_set_plan('plus_session',1100000,0,true,'Ops','restore');

-- ---------------------------------------------------------------------------
-- A paid plan: the access, the plan with its effective end, and the receipt.
-- ---------------------------------------------------------------------------
create temporary table o1 as select pg_temp.paid(1,'standard_semester',400000) id;
select is(pg_temp.ent(1)->'paid'->>'plan','standard_semester','the paid plan');
select is(pg_temp.ent(1)->'paid'->>'order_id',(select id::text from o1),'its order');
select is(pg_temp.ent(1)->'paid'->>'amount_kobo','400000','its amount');
select is(pg_temp.ent(1)->'paid'->>'term_session_label','2026/2027','its session');
select is(pg_temp.ent(1)->'paid'->'second_starts_at','null'::jsonb,'a Semester plan has no second half');
select is((pg_temp.ent(1)->'paid'->>'first_ends_at')::timestamptz,(pg_temp.ent(1)->'term'->>'ends_at')::timestamptz,
  'it ends with the semester, not at the stored slack');
select is(pg_temp.ent(1)->'access'->>'source','paid','full access from the plan');
select is((pg_temp.ent(1)->'access'->>'ends_at')::timestamptz,(pg_temp.ent(1)->'term'->>'ends_at')::timestamptz,
  'access ends with the semester');
select ok((select ends_at from public.entitlement_grants where order_id=(select id from o1))
  > (pg_temp.ent(1)->'term'->>'ends_at')::timestamptz,'the stored grant runs past the semester (the slack)');
select is(jsonb_array_length(pg_temp.ent(1)->'receipts'),1,'one receipt');
select is(pg_temp.ent(1)->'receipts'->0->>'status','paid','it is paid');
select is(pg_temp.ent(1)->'receipts'->0->>'order_id',(select id::text from o1),'for that order');

-- Another student sees none of it.
select is(pg_temp.ent(2)->'paid','null'::jsonb,'another student has no plan');
select is(pg_temp.ent(2)->'receipts','[]'::jsonb,'and no receipts');
select is(pg_temp.ent(2)->'access','null'::jsonb,'and no access');

-- A refund that failed is still in progress for the student.
update private.payment_orders set status='refund-failed' where id=(select id from o1);
select is(pg_temp.ent(1)->'receipts'->0->>'status','refund-pending','a failed refund reads as in progress');
select is(pg_temp.ent(1)->'paid','null'::jsonb,'a refunding order is not a paid plan');
update private.payment_orders set status='paid' where id=(select id from o1);

-- Once the semester has ended, the slack never counts: no access, no paid plan; the receipt stays.
-- (last_day is generated: resumes_on + 4 months - 1 day, so this ends the semester two days ago.)
update private.academic_terms set resumes_on = ((now() at time zone 'Africa/Lagos')::date - interval '4 months')::date - 1
  where session_label='2026/2027';
select ok((select ends_at from public.entitlement_grants where order_id=(select id from o1)) > clock_timestamp(),
  'the stored grant is still running');
select is(pg_temp.ent(1)->'access','null'::jsonb,'no access in the slack');
select is(pg_temp.ent(1)->'paid','null'::jsonb,'no paid plan in the slack');
select is(jsonb_array_length(pg_temp.ent(1)->'receipts'),1,'the receipt is kept');

-- Closing sales hides plans and prices again.
select public.admin_set_sales_open(false,'Ops','screens test');
select is(pg_temp.ent(2)->'plans','[]'::jsonb,'closed again: no plans');
select is(pg_temp.on_sale(2),false,'and the switch says so');

select * from finish();
rollback;
