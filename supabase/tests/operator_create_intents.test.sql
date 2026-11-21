-- Runtime CREATE replay, request binding, atomicity and authorization.
begin;
select no_plan();

select has_table('private', 'managed_content_create_intents', 'durable create receipts exist');
select ok((select relrowsecurity from pg_class where oid = 'private.managed_content_create_intents'::regclass), 'receipt RLS enabled');
select ok(not has_table_privilege('authenticated', 'private.managed_content_create_intents', 'SELECT')
  and not has_table_privilege('authenticated', 'private.managed_content_create_intents', 'INSERT'), 'browser cannot read or write receipts');
select ok(not has_function_privilege('authenticated', 'public.create_managed_content(uuid,text,jsonb,uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.create_managed_content(uuid,text,jsonb,uuid,text,uuid)', 'EXECUTE'), 'old unsafe create RPC is owner-only');
select ok(has_function_privilege('authenticated', 'public.create_managed_content_once(uuid,text,jsonb,uuid,uuid)', 'EXECUTE'), 'runtime create reaches live operator authorization');

insert into public.courses(id, content_key) values
  ('72000000-0000-4000-8000-000000000001', 'create-intents-primary'),
  ('72000000-0000-4000-8000-000000000002', 'create-intents-secondary');
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  id::text || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from (values ('72000000-0000-4000-8000-000000000010'::uuid),
             ('72000000-0000-4000-8000-000000000011'::uuid),
             ('72000000-0000-4000-8000-000000000012'::uuid)) users(id);
update public.profiles set role = 'operator' where id in
  ('72000000-0000-4000-8000-000000000010', '72000000-0000-4000-8000-000000000011');
insert into auth.sessions(id,user_id,created_at,updated_at) values
  ('72000000-0000-4000-8000-000000000020','72000000-0000-4000-8000-000000000010',now(),now()),
  ('72000000-0000-4000-8000-000000000021','72000000-0000-4000-8000-000000000011',now(),now()),
  ('72000000-0000-4000-8000-000000000022','72000000-0000-4000-8000-000000000012',now(),now());

set local role anon;
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{"title":"T","body":"B"}',gen_random_uuid()) $sql$, '42501', null, 'anonymous create denied');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"72000000-0000-4000-8000-000000000012","session_id":"72000000-0000-4000-8000-000000000022"}';
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{"title":"T","body":"B"}',gen_random_uuid()) $sql$, '42501', null, 'student create denied');
reset role;
set local request.jwt.claims = '{"sub":"72000000-0000-4000-8000-000000000010","session_id":"72000000-0000-4000-8000-000000000020"}';

create temporary table cases(kind text, payload jsonb, intent uuid default gen_random_uuid(), item uuid, question uuid, parent uuid);
insert into cases(kind,payload) values
  ('theory_question','{"prompt":"Explain"}'), ('note','{"title":"T","body":"B"}'),
  ('cbt_question','{"prompt":"Choose","options":["A","B"],"correctOption":0}'),
  ('course_overview','{"title":"Overview","body":"Body"}');
update cases set item = public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent);
insert into cases(kind,payload,parent) values
  ('model_answer','{"body":"Answer"}',(select item from cases where kind='theory_question')),
  ('rubric','{"body":"Rubric"}',(select item from cases where kind='theory_question'));
update cases set item = public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent,parent) where item is null;
update cases c set question = i.question_id from public.managed_content_items i where i.id=c.item;

-- Invoke the replay as an authenticated browser role, not as database owner.
grant select on cases to authenticated;
set local role authenticated;
select is(public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent,parent),item,
  kind || ' exact replay recovers original item') from cases;
reset role;
select is((select count(*)::int from public.managed_content_items i where i.id=c.item),1,kind || ' has one item') from cases c;
select is((select count(*)::int from public.managed_content_revisions r where r.item_id=c.item),1,kind || ' has one initial revision') from cases c;
select is((select question_id from public.managed_content_items where id=c.item),question,'CBT UUID survives replay') from cases c where kind='cbt_question';
select is((select count(*)::int from private.managed_content_create_intents where actor_id='72000000-0000-4000-8000-000000000010'),6,'one receipt per created item');
select is(public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{ "body": "B", "title": "T" }'::jsonb,intent),item,'JSON key order and formatting normalize to exact replay') from cases where kind='note';

select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{"title":"T","body":"Changed"}',(select intent from cases where kind='note')) $sql$,'40001',null,'changed payload conflicts');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000002',kind,payload,intent,parent)
  from cases where kind='note' $sql$,'40001',null,'changed course conflicts');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','course_overview',payload,intent,parent)
  from cases where kind='note' $sql$,'40001',null,'changed kind conflicts');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent,
  (select item from cases where kind='theory_question')) from cases where kind='note' $sql$,'40001',null,'changed parent conflicts');
select is((select r.payload from public.managed_content_revisions r join cases c on c.item=r.item_id where c.kind='note'),
  '{"title":"T","body":"B"}'::jsonb,'mismatches leave original evidence unchanged');
select is((select count(*)::int from public.managed_content_items where course_id='72000000-0000-4000-8000-000000000001'),6,'mismatches create no extra item');

select isnt(public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,gen_random_uuid()),item,
  kind || ' distinct intent permits identical content') from cases where kind in ('note','cbt_question','theory_question');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,gen_random_uuid(),parent)
  from cases where kind='course_overview' $sql$,'23505',null,'distinct overview preserves singleton rule');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,gen_random_uuid(),parent)
  from cases where kind='model_answer' $sql$,'23505',null,'distinct answer preserves singleton rule');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,gen_random_uuid(),parent)
  from cases where kind='rubric' $sql$,'23505',null,'distinct rubric preserves singleton rule');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{"title":"T","body":"B"}',null) $sql$,'22023',null,'missing intent rejected');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{"title":"T","body":"B"}','malformed') $sql$,'22P02',null,'malformed UUID rejected');
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001','note',
  '{"title":"","body":"Invalid"}',gen_random_uuid()) $sql$,'22023',null,'invalid create rolls back receipt');
select is((select count(*)::int from private.managed_content_create_intents where actor_id='72000000-0000-4000-8000-000000000010'),9,'failed creates leave no receipt');

set local request.jwt.claims = '{"sub":"72000000-0000-4000-8000-000000000011","session_id":"72000000-0000-4000-8000-000000000021"}';
select isnt(public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent),item,
  'same key is scoped to another operator') from cases where kind='note';
set local request.jwt.claims = '{"sub":"72000000-0000-4000-8000-000000000010","session_id":"72000000-0000-4000-8000-000000000020"}';
select is(public.revise_managed_content(item,1,'{"title":"T","body":"Revised"}'),2::bigint,'created item revises normally') from cases where kind='note';
select is(public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent),item,
  'replay remains bound to initial request after revision') from cases where kind='note';
update auth.sessions set not_after = now() - interval '1 second' where id='72000000-0000-4000-8000-000000000020';
set local role authenticated;
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent)
  from cases where kind='note' $sql$,'42501',null,'expired operator cannot replay receipt');
reset role;
delete from auth.sessions where id='72000000-0000-4000-8000-000000000020';
set local role authenticated;
select throws_ok($sql$ select public.create_managed_content_once('72000000-0000-4000-8000-000000000001',kind,payload,intent)
  from cases where kind='note' $sql$,'42501',null,'revoked operator cannot replay receipt');
reset role;
select * from finish();
rollback;
