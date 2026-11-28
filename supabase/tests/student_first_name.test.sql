-- supabase/tests/student_first_name.test.sql — Names retain owner/live-session and immutable identity boundaries.
begin;
select plan(20);

select has_column('public', 'profiles', 'first_name', 'profile stores a real first name');
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('12121212-1212-4212-8212-121212121212', 'first-name-a@example.test', now(), '{}', '{}', now(), now()),
       ('13131313-1313-4313-8313-131313131313', 'first-name-b@example.test', now(), '{}', '{}', now(), now());
select is((select first_name from public.profiles where id = '12121212-1212-4212-8212-121212121212'), null::text, 'no fabricated name at confirmation');
select ok(has_column_privilege('authenticated','public.profiles','first_name','UPDATE'), 'browser owner can update name');
select ok(not has_table_privilege('authenticated','public.profiles','UPDATE'), 'no broad profile update grant');
insert into auth.sessions (id,user_id,created_at,updated_at)
values ('14141414-1414-4414-8414-141414141414','12121212-1212-4212-8212-121212121212',now(),now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"12121212-1212-4212-8212-121212121212","role":"authenticated","session_id":"14141414-1414-4414-8414-141414141414"}';
select lives_ok($$update public.profiles set first_name = 'Ọlá Anne-Marie',
  department_id = (select id from public.departments where is_active order by sort_order limit 1),
  academic_level_id = (select id from public.academic_levels where is_active order by sort_order limit 1),
  academic_period_id = (select id from public.academic_periods where is_active order by sort_order limit 1)
  where id = '12121212-1212-4212-8212-121212121212'$$, 'live owner saves name and active selection atomically');
select is((select first_name from public.profiles), 'Ọlá Anne-Marie', 'Unicode, spaces and hyphens are preserved');
select throws_ok($$update public.profiles set first_name = ''$$, '23514', null, 'empty name rejected');
select throws_ok($$update public.profiles set first_name = '  '$$, '23514', null, 'whitespace-only name rejected');
select throws_ok($$update public.profiles set first_name = E'\tAda\t'$$, '23514', null, 'untrimmed name rejected at storage boundary');
select throws_ok($$update public.profiles set first_name = repeat('É',81)$$, '23514', null, 'more than eighty Unicode characters rejected');
select lives_ok($$update public.profiles set first_name = repeat('É',80)$$, 'eighty Unicode characters allowed');
select throws_ok($$update public.profiles set role = 'operator'$$, '42501', null, 'name capability does not allow role escalation');
select throws_ok($$update public.profiles set id = '15151515-1515-4515-8515-151515151515'$$, '42501', null, 'name capability does not allow identity changes');
select is((select count(*)::int from public.profiles where id = '13131313-1313-4313-8313-131313131313'), 0, 'another profile remains unreadable');
select lives_ok($$update public.profiles set first_name = 'Forged' where id = '13131313-1313-4313-8313-131313131313'$$, 'cross-owner write is a zero-row operation');
reset role;
select is((select first_name from public.profiles where id = '13131313-1313-4313-8313-131313131313'), null::text, 'other owner name remains unchanged');
delete from auth.sessions where id = '14141414-1414-4414-8414-141414141414';
set local role authenticated;
select is((select count(*)::int from public.profiles), 0, 'retained revoked JWT cannot read name or profile');
select lives_ok($$update public.profiles set first_name = 'Revoked'$$, 'retained revoked JWT matches no owner row');
reset role;
select is((select first_name from public.profiles where id = '12121212-1212-4212-8212-121212121212'), repeat('É',80), 'revoked write changed nothing');
select ok(not has_column_privilege('anon','public.profiles','first_name','UPDATE'), 'anonymous caller has no name update privilege');
select * from finish();
rollback;
