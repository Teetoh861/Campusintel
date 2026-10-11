-- Local-only profile revision, CAS, and unchanged browser privilege boundary.
begin;
select plan(21);

insert into auth.users (instance_id,id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','a0611111-1111-4111-8111-111111111111','authenticated','authenticated','f06-a@example.test',now(),now(),now()),
  ('00000000-0000-0000-0000-000000000000','a0622222-2222-4222-8222-222222222222','authenticated','authenticated','f06-b@example.test',now(),now(),now());
insert into auth.sessions (id,user_id,created_at,updated_at) values
  ('a06aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','a0611111-1111-4111-8111-111111111111',now(),now());

select is((select revision from public.profiles where id='a0611111-1111-4111-8111-111111111111'),0::bigint,'new profile starts at revision zero');
select is((select column_default from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='revision'),'0','existing-row ADD COLUMN default is zero');
select ok(not has_column_privilege('authenticated','public.profiles','revision','UPDATE'),'revision is not browser-writable');
select ok(not has_table_privilege('authenticated','public.profiles','INSERT'),'no student INSERT');
select ok(not has_table_privilege('authenticated','public.profiles','DELETE'),'no student DELETE');
select ok(not has_column_privilege('authenticated','public.profiles','role','UPDATE'),'no role update');
select ok(not has_column_privilege('authenticated','public.profiles','id','UPDATE'),'no identity update');
select ok(not has_column_privilege('authenticated','public.profiles','created_at','UPDATE'),'no created_at update');
select ok(not has_column_privilege('authenticated','public.profiles','updated_at','UPDATE'),'no updated_at update');
select ok((select relrowsecurity from pg_class where oid='public.profiles'::regclass),'RLS remains enabled');

set local role authenticated;
set local request.jwt.claims='{"sub":"a0611111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a06aaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}';
select throws_ok($$update public.profiles set revision=99 where id='a0611111-1111-4111-8111-111111111111'$$,'42501',null,'direct revision update denied');
with saved as (
  update public.profiles set first_name='Ada',
    department_id=(select id from public.departments where is_active order by sort_order limit 1),
    academic_level_id=(select id from public.academic_levels where is_active order by sort_order limit 1),
    academic_period_id=(select id from public.academic_periods where is_active order by sort_order limit 1)
  where id='a0611111-1111-4111-8111-111111111111' and revision=0 returning revision
) select is((select revision from saved),1::bigint,'accepted CAS increments exactly once');
with stale as (
  update public.profiles set first_name='Stale' where id='a0611111-1111-4111-8111-111111111111' and revision=0 returning id
) select is((select count(*)::int from stale),0,'stale CAS affects zero rows');
select is((select first_name from public.profiles where id='a0611111-1111-4111-8111-111111111111'),'Ada','stale write leaves winner intact');
update public.profiles set first_name='Amara' where id='a0611111-1111-4111-8111-111111111111' and revision=1;
select is((select revision from public.profiles where id='a0611111-1111-4111-8111-111111111111'),2::bigint,'second update increments again');
select is((select count(*)::int from public.profiles where id='a0622222-2222-4222-8222-222222222222'),0,'other owner cannot be read');
with denied as (
  update public.profiles set first_name='Intruder' where id='a0622222-2222-4222-8222-222222222222' returning id
) select is((select count(*)::int from denied),0,'other owner cannot be updated');
select throws_ok($$update public.profiles set academic_period_id=null where id='a0611111-1111-4111-8111-111111111111'$$,'42501',null,'active complete-selection policy remains enforced');

reset role;
update public.profiles set updated_at='2000-01-01' where id='a0611111-1111-4111-8111-111111111111';
select is((select updated_at from public.profiles where id='a0611111-1111-4111-8111-111111111111'),now(),'timestamp trigger retains established now() behavior');
select is((select revision from public.profiles where id='a0611111-1111-4111-8111-111111111111'),3::bigint,'every successful profile update advances revision');
set local role anon;
select throws_ok($$select revision from public.profiles$$,'42501',null,'anon cannot read profile or revision');
reset role;
select * from finish();
rollback;
