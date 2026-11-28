-- supabase/tests/owner_tester_access_safeupdate.test.sql — The tester operator function names its rows, so grant, renew
-- and revoke work under pg-safeupdate as the hosted API runs it (20261125200000_owner_tester_access.sql).
-- Local Supabase's postgres role cannot LOAD shared libraries: reconnect as the local bootstrap role only to load it.
\connect - supabase_admin
load 'safeupdate';
begin;
select no_plan();

create temporary table safeupdate_probe (id integer primary key, value integer not null);
insert into safeupdate_probe values (1, 1);
select throws_ok($$update safeupdate_probe set value = 2$$, '21000', 'UPDATE requires a WHERE clause',
  'safeupdate is enforced in this session');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '7e500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'tester-safeupdate@example.test', 'x', now(), '{}', '{}', now(), now());
insert into private.tester_site (project_ref, enabled_by, reason) values ('znwluaiylogqapansuht', 'test', 'test site');
create temporary table outcome (step text primary key, result jsonb);
grant insert, select on outcome to service_role;

set local role service_role;
insert into outcome values ('grant', public.admin_set_tester_access('7e500000-0000-4000-8000-000000000001', 'grant', 7,
  null, 'safeupdate-test', 'owner testing'));
insert into outcome values ('renew', public.admin_set_tester_access('7e500000-0000-4000-8000-000000000001', 'grant', 30,
  4000000, 'safeupdate-test', 'renew'));
insert into outcome values ('revoke', public.admin_set_tester_access('7e500000-0000-4000-8000-000000000001', 'revoke',
  null, null, 'safeupdate-test', 'done'));
insert into outcome values ('status', public.admin_tester_status(null));
reset role;

select is((select array_agg(result ->> 'state' order by step) from outcome where step <> 'status'),
  array['granted', 'renewed', 'revoked'], 'grant, renew and revoke all succeed under safeupdate');
select is((select (result -> 'testers' -> 0 ->> 'state') from outcome where step = 'status'), 'revoked',
  'and the status read reports the result');

select * from finish();
rollback;
