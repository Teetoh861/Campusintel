begin;
select no_plan();
select ok((select prosecdef and pronargs = 0 and proconfig = array['search_path=""']
  from pg_proc where oid = 'public.read_student_context()'::regprocedure), 'definer is argless with fixed empty search_path');
select ok(has_function_privilege('authenticated', 'public.read_student_context()', 'execute')
  and not has_function_privilege('anon', 'public.read_student_context()', 'execute')
  and not has_function_privilege('service_role', 'public.read_student_context()', 'execute'), 'authenticated callers only');

insert into auth.users(id, email_confirmed_at) values
  ('e9100000-0000-4000-8000-000000000001', now()), ('e9100000-0000-4000-8000-000000000002', now());
insert into auth.sessions(id, user_id, created_at, updated_at) values
  ('e9200000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000001', now(), now()),
  ('e9200000-0000-4000-8000-000000000002', 'e9100000-0000-4000-8000-000000000002', now(), now());
update public.profiles set first_name = case when id = 'e9100000-0000-4000-8000-000000000001' then 'Ada' else 'Bola' end,
  department_id = (select id from public.departments where is_active order by sort_order limit 1),
  academic_level_id = (select id from public.academic_levels where is_active order by sort_order limit 1),
  academic_period_id = (select id from public.academic_periods where is_active order by sort_order limit 1)
where id in ('e9100000-0000-4000-8000-000000000001', 'e9100000-0000-4000-8000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e9200000-0000-4000-8000-000000000001"}';
select is(public.read_student_context()->>'user_id', auth.uid()::text, 'caller identity only');
select is(public.read_student_context()->'profile'->>'first_name', 'Ada', 'A receives only A profile');
select ok(public.read_student_context()->'profile'->>'selection_confirmed_at' is not null, 'confirmation returned');
select is(public.read_student_context()->'lifecycle', public.read_account_lifecycle(), 'lifecycle preserves existing contract');
select ok(exists (select 1 from jsonb_array_elements(public.read_student_context()->'references'->'departments') d
  where d->>'id' = public.read_student_context()->'profile'->>'department_id'
    and d->>'display_name' is not null and d->>'is_active' = 'true'), 'selected department label and active flag returned');
select throws_ok($$select public.read_student_context('e9100000-0000-4000-8000-000000000002'::uuid)$$,
  '42883', null, 'no user-id overload');
set local request.jwt.claims = '{"sub":"e9100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e9200000-0000-4000-8000-000000000002"}';
select is(public.read_student_context()->'profile'->>'first_name', 'Bola', 'B receives only B profile');
set local request.jwt.claims = '{"sub":"e9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e9200000-0000-4000-8000-000000000002"}';
select throws_ok($$select public.read_student_context()$$, '42501', 'Account session required', 'cross-account session refused');
set local request.jwt.claims = '{}';
select throws_ok($$select public.read_student_context()$$, '42501', 'Account session required', 'missing session refused');
reset role;
delete from auth.sessions where id = 'e9200000-0000-4000-8000-000000000002';
set local role authenticated;
set local request.jwt.claims = '{"sub":"e9100000-0000-4000-8000-000000000002","role":"authenticated","session_id":"e9200000-0000-4000-8000-000000000002"}';
select throws_ok($$select public.read_student_context()$$, '42501', 'Account session required', 'revoked JWT refused');
reset role;
delete from auth.users where id = 'e9100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select public.read_student_context()$$, '42501', 'Account session required', 'deleted account refused');
reset role;

-- Restricted live sessions keep their decision-page lifecycle but receive no protected context.
insert into private.account_deletion_jobs(user_id, requested_at, deadline, retry_at)
values ('e9100000-0000-4000-8000-000000000001', now(), now() + interval '720 hours', now() + interval '720 hours');
set local role authenticated;
set local request.jwt.claims = '{"sub":"e9100000-0000-4000-8000-000000000001","role":"authenticated","session_id":"e9200000-0000-4000-8000-000000000001"}';
select is(public.read_student_context()->'lifecycle'->>'status', 'scheduled', 'scheduled lifecycle remains available');
select ok(public.read_student_context()->'profile' = 'null'::jsonb
  and public.read_student_context()->'references' = 'null'::jsonb, 'scheduled sessions have no protected context');
select throws_ok($$select public.read_published_managed_content('40000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'content read remains independently denied');
reset role;
update private.account_deletion_jobs set requested_at = now() - interval '721 hours',
  deadline = now() - interval '1 hour' where user_id = 'e9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.read_student_context()->'lifecycle'->>'status', 'expired', 'expired lifecycle remains available');
select is(public.read_student_context()->'profile', 'null'::jsonb, 'expired account has no profile context');
reset role;
delete from private.account_deletion_jobs where user_id = 'e9100000-0000-4000-8000-000000000001';
update public.profiles set role = 'operator' where id = 'e9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.read_student_context()->'lifecycle'->>'deletionAllowed', 'false', 'operator deletion rule unchanged');
reset role;
update public.profiles set department_id = null, academic_level_id = null, academic_period_id = null,
  first_name = null where id = 'e9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.read_student_context()->'profile'->'department_id', 'null'::jsonb, 'incomplete profile remains incomplete');
reset role;
delete from public.profiles where id = 'e9100000-0000-4000-8000-000000000001';
set local role authenticated;
select is(public.read_student_context()->'profile', 'null'::jsonb, 'missing profile remains distinct from a revoked session');
select * from finish();
rollback;
