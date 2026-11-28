-- supabase/tests/auth_rate_limits.test.sql — Grants, rolling windows and independent auth buckets.
begin;
select plan(25);
select ok((select relrowsecurity from pg_class where oid = 'public.auth_rate_limit_events'::regclass), 'RLS enabled');
set local role anon;
select throws_ok($$select * from public.auth_rate_limit_events$$, '42501', null, 'anon cannot select');
select throws_ok($$insert into public.auth_rate_limit_events(action,kind,bucket) values('LOGIN','account',repeat('a',64))$$, '42501', null, 'anon cannot insert');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),repeat('b',64),20,900,30,300)$$, '42501', null, 'anon cannot invoke consume');
reset role;
set local role authenticated;
select throws_ok($$select * from public.auth_rate_limit_events$$, '42501', null, 'authenticated cannot select');
select throws_ok($$insert into public.auth_rate_limit_events(action,kind,bucket) values('LOGIN','account',repeat('a',64))$$, '42501', null, 'authenticated cannot insert');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),repeat('b',64),20,900,30,300)$$, '42501', null, 'authenticated cannot invoke consume');
reset role;
set local role service_role;
select ok(public.consume_auth_rate_limit('REGISTER',repeat('a',64),repeat('b',64),3,3600,20,3600), 'privileged role can consume');
select ok(public.consume_auth_rate_limit('REGISTER',repeat('a',64),repeat('b',64),3,3600,20,3600), 'second attempt accepted');
select ok(public.consume_auth_rate_limit('REGISTER',repeat('a',64),repeat('b',64),3,3600,20,3600), 'third attempt accepted');
select ok(not public.consume_auth_rate_limit('REGISTER',repeat('a',64),repeat('b',64),3,3600,20,3600), 'account threshold enforced');
select ok(public.consume_auth_rate_limit('REGISTER',repeat('c',64),repeat('b',64),3,3600,20,3600), 'different account independent');
reset role;
insert into public.auth_rate_limit_events(action,kind,bucket)
select 'LOGIN','origin',repeat('d',64) from generate_series(1,30);
set local role service_role;
select ok(not public.consume_auth_rate_limit('LOGIN',repeat('e',64),repeat('d',64),20,900,30,300), 'origin threshold enforced');
select ok(public.consume_auth_rate_limit('LOGIN',repeat('e',64),repeat('f',64),20,900,30,300), 'different origin independent');
reset role;
insert into public.auth_rate_limit_events(action,kind,bucket,created_at)
select 'CONFIRM_EMAIL','account',repeat('1',64),clock_timestamp() - interval '16 minutes' from generate_series(1,5);
insert into public.auth_rate_limit_events(action,kind,bucket,created_at)
select 'CONFIRM_EMAIL','origin',repeat('2',64),clock_timestamp() - interval '16 minutes' from generate_series(1,20);
insert into public.auth_rate_limit_events(action,kind,bucket,created_at)
values('LOGIN','account',repeat('3',64),clock_timestamp() - interval '2 hours');
set local role service_role;
select ok(public.consume_auth_rate_limit('CONFIRM_EMAIL',repeat('1',64),repeat('2',64),5,900,20,900), 'expired windows do not count');
reset role;
select is((select count(*)::int from public.auth_rate_limit_events where created_at < clock_timestamp() - interval '1 hour'),0,'old records cleaned');
set local role service_role;
select throws_ok($$select public.consume_auth_rate_limit('BOGUS',repeat('a',64),repeat('b',64),20,900,30,300)$$,'22023',null,'unknown action rejected');
select throws_ok($$select public.consume_auth_rate_limit(null,repeat('a',64),repeat('b',64),20,900,30,300)$$,'22023',null,'null action rejected');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN','raw@example.test',repeat('b',64),20,900,30,300)$$,'22023',null,'raw account rejected');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),'127.0.0.1',20,900,30,300)$$,'22023',null,'raw origin rejected');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),repeat('b',64),0,900,30,300)$$,'22023',null,'zero limit rejected');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),repeat('b',64),20,-1,30,300)$$,'22023',null,'negative window rejected');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),repeat('b',64),null,900,30,300)$$,'22023',null,'null limit rejected');
select throws_ok($$select public.consume_auth_rate_limit('LOGIN',repeat('a',64),repeat('b',64),200,900,30,300)$$,'22023',null,'policy widening rejected');
select throws_ok($$select * from public.auth_rate_limit_events$$,'42501',null,'privileged role only has RPC access');
reset role;
select * from finish();
rollback;
