-- Launch limits, plan-derived memory, recovery safeguards, publication insert order and missing-only backfill.
-- No provider call. Every fixture and setting rolls back.
begin;
select no_plan();

select is((select jsonb_agg(jsonb_build_array(tier,session_hours,session_tokens,week_days,week_tokens) order by tier)
  from private.campus_bot_tiers),
  '[["plus",5,210000,7,2100000],["standard",5,105000,7,1050000]]'::jsonb, 'owner-approved tier values');
select is((select jsonb_build_array(read_tokens_max,written_tokens_max) from private.campus_bot_request_caps
  where step='chat'), '[18000,1500]'::jsonb, 'the same read and written caps on every database');

delete from private.academic_term_extensions;
delete from private.academic_terms where session_label <> '2026/2027';
update private.academic_terms set resumes_on=(now() at time zone 'Africa/Lagos')::date - 10;
update private.payment_policy set sales_open=true;
update private.campus_bot_settings set ask_enabled=true, writing_model='haiku';

create function pg_temp.u(n int) returns uuid language sql immutable as
  $$select ('b2a10000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.s(n int) returns uuid language sql immutable as
  $$select ('b2a20000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.student(n int, email text default null) returns void language plpgsql as $$begin
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000',pg_temp.u(n),
    'authenticated','authenticated',coalesce(email,'batch2-'||n||'@example.test'),'fixture-only',now(),'{}','{}',now(),now());
  insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.s(n),pg_temp.u(n),now(),now());
  update public.profiles set first_name='Ada',department_id='10000000-0000-4000-8000-000000000002',
    academic_level_id='20000000-0000-4000-8000-000000000002',academic_period_id='30000000-0000-4000-8000-000000000001'
    where id=pg_temp.u(n);
end$$;
create function pg_temp.paid(n int, plan text default 'standard_semester') returns uuid language plpgsql as $$
declare o uuid; amount bigint;
begin
  o := (public.create_payment_order(pg_temp.s(n),plan,(select revision from public.profiles where id=pg_temp.u(n)),
    gen_random_uuid(),'/access','fake')->'order'->>'id')::uuid;
  select amount_kobo into amount from private.payment_orders where id=o;
  perform public.attach_payment_checkout(o,'fake','chk_'||replace(o::text,'-',''),'https://checkout.example.test/c/'||o,
    clock_timestamp()+interval '1 hour');
  perform public.fulfil_payment(o,'fake','ch_'||replace(o::text,'-',''),'succeeded',amount,'NGN','card',
    clock_timestamp(),'webhook','batch2-test');
  return o;
end$$;
create function pg_temp.early(n int, revoked boolean default false) returns uuid language plpgsql as $$
declare g uuid;
begin
  insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by,revoked_at,revoked_by,revoke_reason)
    values(pg_temp.u(n),'early_access',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days',
      'uncapped','batch2-test',case when revoked then clock_timestamp() end,
      case when revoked then 'operator:fixture' end,case when revoked then 'fixture recovery' end) returning id into g;
  return g;
end$$;
create function pg_temp.change(g uuid, action text default 'restore', until_at timestamptz default null) returns text
  language sql as $$select public.admin_change_grant(g,action,until_at,null,'Ops','batch 2 regression')->>'state'$$;
create function pg_temp.chat(n int) returns jsonb language sql as $$
  select public.begin_campus_bot_chat(pg_temp.s(n),gen_random_uuid(),'40000000-0000-4000-8000-000000000008',
    (select id from public.managed_content_items where course_id='40000000-0000-4000-8000-000000000008'
      and kind='note' and published_revision is not null order by position,id limit 1),true)$$;

select pg_temp.student(n) from generate_series(1,8) n;
create temporary table orders(n int, id uuid);
insert into orders values(1,pg_temp.paid(1)),(2,pg_temp.paid(2,'plus_semester')),
  (6,pg_temp.paid(6)),(7,pg_temp.paid(7)),(8,pg_temp.paid(8));
select pg_temp.early(4);
insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,ai_terms,ai_units,created_by)
  values(pg_temp.u(5),'trial','discovery',now(),now()+interval '3 days','capped',1,'batch2-test');
insert into private.tester_site(project_ref,enabled_by,reason)
  values('znwluaiylogqapansuht','batch2-test','local rollback fixture') on conflict do nothing;
select is(public.admin_set_tester_access(pg_temp.u(3),'grant',7,null,'Ops','local test')->>'state','granted','tester fixture');

create temporary table chats as select n,pg_temp.chat(n) as answer from generate_series(1,5) n;
select is((select answer->>'state' from chats where n=1),'started','Standard chat admitted');
select is((select answer->>'history_messages' from chats where n=1),'6','Standard memory is six');
select is((select answer->>'history_messages' from chats where n=2),'12','Plus memory is twelve');
select is((select answer->>'history_messages' from chats where n=3),'12','tester memory is twelve');
select is((select answer->>'history_messages' from chats where n=4),'6','free access memory is six');
select is((select answer->>'history_messages' from chats where n=5),'6','free pass memory is six');
select is((select reserved_tokens::int from private.campus_bot_replies where user_id=pg_temp.u(1)),25500,
  'Haiku chat reserves 18000 + 5 * 1500');

-- Real settlement counts actual use, in both windows. The local Node database test also replays the
-- migration from the host: Supabase's pgTAP container mounts tests, but not migration files.
select is(public.finish_campus_bot_chat(pg_temp.u(1),(select (answer->>'reply_id')::uuid from chats where n=1),'answered',
  '{"text":"Listening means attending to the speaker.","in_notes":true,"verdict":"none","check":null,"memory_trick":null}',
  '{"provider":"anthropic","model":"claude-haiku-5-5","inputTokens":1000,"outputTokens":100,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}'
  )->>'outcome','answered','delivered chat settles');
\if :{?launch_batch_2_replay}
create temporary table kept_usage as select * from private.campus_bot_replies where user_id=pg_temp.u(1);
create temporary table kept_windows as select * from private.campus_bot_windows where user_id=pg_temp.u(1);
\ir ../migrations/20261127300000_campus_bot_launch_limits.sql
\endif
select is((select charged_tokens::int from private.campus_bot_replies where user_id=pg_temp.u(1)),1500,'actual use, not reservation, is charged');
select is((select u.used::int from private.campus_bot_windows w cross join lateral private.campus_bot_window_use(w.id) u
  where w.user_id=pg_temp.u(1) and w.kind='week'),1500,'the week counts actual use');
\if :{?launch_batch_2_replay}
select ok(not exists((select * from private.campus_bot_replies where user_id=pg_temp.u(1)) except table kept_usage)
  and not exists(table kept_usage except (select * from private.campus_bot_replies where user_id=pg_temp.u(1))),
  'recorded usage is byte-for-byte unchanged by the migration');
select ok(not exists((select * from private.campus_bot_windows where user_id=pg_temp.u(1)) except table kept_windows)
  and not exists(table kept_windows except (select * from private.campus_bot_windows where user_id=pg_temp.u(1))),
  'existing windows are unchanged');
\endif

update public.entitlement_grants set revoked_at=now(),revoked_by='operator:fixture',revoke_reason='fixture recovery'
  where user_id in(pg_temp.u(6),pg_temp.u(7),pg_temp.u(8));
update private.payment_orders set status='pending',paid_at=null where id=(select id from orders where n=6);
update private.payment_orders set status='refunded' where id=(select id from orders where n=7);
select is(pg_temp.change((select id from public.entitlement_grants where user_id=pg_temp.u(6))),'order-not-paid','unpaid order cannot restore paid access');
select is(pg_temp.change((select id from public.entitlement_grants where user_id=pg_temp.u(7))),'order-not-paid','refunded order cannot restore paid access');
select is(pg_temp.change((select id from public.entitlement_grants where user_id=pg_temp.u(7)),'extend',now()+interval '30 days'),
  'order-not-paid','extend does not bypass the paid-order check');
select is(pg_temp.change((select id from public.entitlement_grants where user_id=pg_temp.u(8))),'changed','a still-paid order may restore its grant');
select ok((select bool_and(revoked_at is not null) from public.entitlement_grants where user_id in(pg_temp.u(6),pg_temp.u(7))),
  'refusals leave the paid grants revoked');

select pg_temp.student(9,'batch.2+first@gmail.com');
select pg_temp.student(10,'batch2+second@googlemail.com');
create temporary table free_grants(n int,id uuid);
insert into free_grants values(9,pg_temp.early(9)),(10,pg_temp.early(10,true));
-- Site claims use no retired member_id. The restore locks the site ledger, then compares confirmed canonical email.
insert into private.early_access_claims(claim_hash,key_version,user_id,grant_id,claimed_at,expires_at)
  select repeat('b',64),999,pg_temp.u(10),id,now(),now()+interval '5 years' from free_grants where n=10;
select is(pg_temp.change((select id from free_grants where n=10)),'duplicate-identity','same confirmed email on another account already has active free access');
update public.entitlement_grants set revoked_at=null,revoked_by=null,revoke_reason=null,ends_at=now()-interval '1 second'
  where id=(select id from free_grants where n=10);
select is(pg_temp.change((select id from free_grants where n=10),'extend',now()+interval '10 days'),'duplicate-identity',
  'extend cannot revive an expired duplicate free-access grant');
update public.entitlement_grants set revoked_at=now(),revoked_by='operator:fixture',revoke_reason='fixture recovery'
  where id=(select id from free_grants where n=9);
select is(pg_temp.change((select id from free_grants where n=10)),'changed','restore is allowed once the other grant is inactive');

-- Publish item first, revision second, exactly as a content migration does in a single transaction.
create function pg_temp.note(n int, published boolean default true) returns uuid language plpgsql as $$
declare i uuid := ('b2a30000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
begin
  insert into public.managed_content_items(id,course_id,kind,current_revision,approved_revision,published_revision,created_by)
    values(i,'40000000-0000-4000-8000-000000000008','note',1,1,case when published then 1 end,pg_temp.u(1));
  insert into public.managed_content_revisions(item_id,revision,payload,authored_by)
    values(i,1,jsonb_build_object('title','Batch 2 note '||n,'body','The lesson explains active listening.'),pg_temp.u(1));
  return i;
end$$;
create temporary table notes(n int,id uuid);
insert into notes values(1,pg_temp.note(1)),(2,pg_temp.note(2,false));
select is((select count(*)::int from private.note_passages where item_id=(select id from notes where n=1)),1,
  'a note and its revision inserted together get their passages');
update public.managed_content_items set published_revision=1 where id=(select id from notes where n=2);
select is((select count(*)::int from private.note_passages where item_id=(select id from notes where n=2)),1,
  'ordinary publish after the revision still gets passages');

-- Backfill must preserve every existing passage and saved explanation, including a not-covered explanation.
\if :{?launch_batch_2_replay}
insert into private.campus_bot_explanations(item_id,revision,chosen_option,course_id,state,outcome,body,topic_item_id,
  started_at,finished_at) select id,1,-1,'40000000-0000-4000-8000-000000000008','done','explained','Keep this explanation.',
  id,now(),now() from notes where n=1;
delete from private.note_passages where item_id=(select id from notes where n=1);
create temporary table old_passages as table private.note_passages;
create temporary table old_explanations as table private.campus_bot_explanations;
\ir ../migrations/20261127300200_note_passage_publication.sql
select is((select count(*)::int from private.note_passages where item_id=(select id from notes where n=1)),1,'missing passages backfilled');
select ok(not exists(table old_passages except table private.note_passages),'existing passages left alone');
select ok(not exists(table old_explanations except table private.campus_bot_explanations)
  and not exists(table private.campus_bot_explanations except table old_explanations),'saved explanations left alone');
\endif
select is((select count(*)::int from public.managed_content_items i where i.kind='note' and i.published_revision is not null
  and not exists(select 1 from private.note_passages p where p.item_id=i.id)),0,'every published note has passages');

-- A parser failure is internal only: publishing remains available.
create or replace function private.note_passages_of(p_payload jsonb) returns table(ordinal integer,heading text,body text)
  language plpgsql immutable as $$begin raise exception 'fixture parser failure'; end$$;
select lives_ok($$select pg_temp.note(3)$$,'publishing succeeds even when passage extraction fails');

select * from finish();
rollback;
