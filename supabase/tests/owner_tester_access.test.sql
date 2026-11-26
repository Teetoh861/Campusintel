-- supabase/tests/owner_tester_access.test.sql — Owner tester access (20261125200000_owner_tester_access.sql): nothing a
-- student can reach, nothing without the test-site row (production), her saved selection opens and can name any
-- semester, it expires and steps aside for any grant or payment record, the operator function's refusals, the daily
-- Campus Bot cap with platform limits still on, other students unchanged, and payments' functions byte-identical.
-- Time is simulated by moving timestamps. Everything rolls back.
begin;
select no_plan();
select is(array[private.study_guide('study_guide_bua203', 'rollback'), private.study_guide('study_guide_lag_bua210', 'rollback'),
    private.official_bank_bua203('rollback'), private.official_bank_lag_bua210('rollback')],
  array_fill('rolled-back'::text, array[4]), 'the BUA203 and LAG-BUA210 copies (20261125100000) rolled back for this test');
select is(private.owner_content_rule('rollback'), 'rolled-back', 'fixture content as the earlier migrations left it');

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('7e100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('7e200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.a(n integer) returns uuid language sql immutable
  as $$ select ('7e300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.r(n integer) returns uuid language sql immutable
  as $$ select ('7e400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(code text) returns uuid language sql stable security definer set search_path = ''
  as $$ select id from public.institutional_courses where course_code = code limit 1 $$;
create function pg_temp.rc(code text) returns uuid language sql stable security definer set search_path = ''
  as $$ select repository_course_id from public.institutional_courses where course_code = code limit 1 $$;
create function pg_temp.gst() returns uuid language sql immutable as $$ select '40000000-0000-4000-8000-000000000008'::uuid $$;
create function pg_temp.topic() returns uuid language sql stable security definer set search_path = '' as $$
  select i.id from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  where i.course_id = '40000000-0000-4000-8000-000000000008' and i.kind = 'note'
    and r.payload -> 'practice' @> '[{"topic":"Listening Skills and Note-taking"}]' limit 1 $$;
-- BUA, 200 Level, First Semester (the running semester); Second Semester is not running.
create function pg_temp.dept() returns uuid language sql immutable as $$ select '10000000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.lvl() returns uuid language sql immutable as $$ select '20000000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.first() returns uuid language sql immutable as $$ select '30000000-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.second() returns uuid language sql immutable as $$ select '30000000-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.student(n integer) returns void language sql as $$
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
    raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
    'tester-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.s(n), pg_temp.u(n), now(), now());
  update public.profiles set first_name = 'Ada', department_id = pg_temp.dept(), academic_level_id = pg_temp.lvl(),
    academic_period_id = pg_temp.first() where id = pg_temp.u(n) $$;
create function pg_temp.tester(n integer, p_expires interval default interval '7 days', p_cap bigint default 3000000)
returns void language sql as $$
  insert into private.tester_accounts (user_id, starts_at, expires_at, daily_cap_tokens, set_by, reason, updated_at)
  values (pg_temp.u(n), clock_timestamp() - interval '1 hour', clock_timestamp() + p_expires, p_cap, 'operator:test',
    'owner testing', clock_timestamp())
  on conflict (user_id) do update set expires_at = excluded.expires_at, daily_cap_tokens = excluded.daily_cap_tokens,
    revoked_at = null, revoked_by = null, revoke_reason = null $$;
create function pg_temp.site_on() returns void language sql as $$
  insert into private.tester_site (project_ref, enabled_by, reason) values ('znwluaiylogqapansuht', 'test', 'test site')
  on conflict do nothing $$;
create function pg_temp.site_off() returns void language sql as $$ delete from private.tester_site where singleton $$;
create function pg_temp.dec(n integer, code text, p_at timestamptz default clock_timestamp()) returns jsonb
  language sql stable as $$ select to_jsonb(d) - 'term_id' - 'ends_at' || jsonb_build_object('ends', d.ends_at is not null)
  from private.course_access_decision(pg_temp.u(n), pg_temp.c(code), p_at) d $$;
-- A call through the student's own session (as PostgREST runs it), or through the service role (the app server).
create function pg_temp.as_student(n integer, p_call text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'session_id', pg_temp.s(n),
    'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select ' || p_call into v;
  reset role;
  return v;
end $$;
create function pg_temp.svc(p_call text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  set local role service_role;
  execute 'select ' || p_call into v;
  reset role;
  return v;
end $$;
grant execute on function pg_temp.as_student(integer, text), pg_temp.svc(text) to authenticated, service_role;
create function pg_temp.student_exec(n integer, p_statement text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'session_id', pg_temp.s(n),
    'role', 'authenticated')::text, true);
  set local role authenticated;
  execute p_statement;
  reset role;
end $$;
grant execute on function pg_temp.student_exec(integer, text) to authenticated;
-- Save a selection as the student does (one UPDATE through their own session).
create function pg_temp.save(n integer, p_period uuid, p_level uuid default null) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'session_id', pg_temp.s(n),
    'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.profiles set academic_period_id = p_period, academic_level_id = coalesce(p_level, academic_level_id)
    where id = auth.uid();
  reset role;
end $$;
grant execute on function pg_temp.save(integer, uuid, uuid) to authenticated;
-- Every student-facing read the change touches, as one value, without the clock fields.
create function pg_temp.snapshot(n integer) returns jsonb language sql as $$
  select jsonb_build_object(
    'courses', pg_temp.as_student(n, format('(select jsonb_agg(to_jsonb(a) order by a.institutional_course_id)
      from public.get_my_course_access(array[%L,%L,%L,%L]::uuid[]) a)',
      pg_temp.c('BUA201'), pg_temp.c('ENT211'), pg_temp.c('BUA202'), pg_temp.c('GST111'))),
    'entitlement', pg_temp.as_student(n, 'public.get_my_entitlement()') - 'now',
    'allowance', pg_temp.as_student(n, 'public.get_my_ai_allowance()'),
    'selection', pg_temp.as_student(n, 'public.get_my_course_selection()'),
    'list', private.course_on_current_list(pg_temp.u(n), pg_temp.c('BUA201'), clock_timestamp()),
    'funded', private.ai_funding_current(pg_temp.u(n), clock_timestamp()),
    'offers', private.discovery_email_allowed(pg_temp.u(n)),
    'reply_funding', (select count(*) from private.campus_bot_reply_funding(pg_temp.u(n), clock_timestamp())),
    'set_funding', private.ai_allowance_admission(pg_temp.u(n), array['trial', 'early_access', 'paid'])) $$;
create function pg_temp.usage(p_input integer, p_output integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('provider', 'anthropic', 'model', 'claude-haiku-5-5', 'inputTokens', p_input,
    'outputTokens', p_output, 'cacheReadInputTokens', 0, 'cacheCreationInputTokens', 0, 'estimatedCostUsd', 0.0005,
    'durationMs', 900) $$;
create function pg_temp.chat(n integer, req integer) returns jsonb language sql as $$
  select public.begin_campus_bot_chat(pg_temp.s(n), pg_temp.r(req), pg_temp.gst(), pg_temp.topic(), true) $$;
create function pg_temp.answer(n integer, p_started jsonb, p_outcome text default 'answered') returns jsonb
  language sql as $$ select public.finish_campus_bot_chat(pg_temp.u(n), (p_started ->> 'reply_id')::uuid, p_outcome,
    case when p_outcome = 'answered' then '{"text":"A good listener prepares.","in_notes":true,"verdict":"not-quite",
      "check":"What comes first?","memory_trick":null}'::jsonb end, pg_temp.usage(6000, 350)) $$;
create function pg_temp.quiz(n integer, req integer) returns jsonb language sql as $$
  select public.begin_campus_bot_topic_set(pg_temp.s(n), pg_temp.r(req), pg_temp.gst(), pg_temp.topic(),
    array['trial', 'early_access', 'paid']) $$;
create function pg_temp.topic_set(g uuid) returns jsonb language sql stable security definer as $$
  select jsonb_build_object('formatVersion',1,'origin','ai-generated','visibility','personal','verification','unverified',
    'course',jsonb_build_object('code','GST111','title','Use of English'),
    'source',jsonb_build_object('kind','notes-topic','courseId',x.source_course_id,'itemId',x.source_item_id,
      'revision',x.source_revision,'title','A topic','number',1,'pinned',false,'sha256',repeat('a',64),'charCount',100,
      'passageCount',2),
    'questions',(select jsonb_agg(jsonb_build_object('id','ai_'||lpad(to_hex(q),24,'0'),'prompt','Question '||q||'?',
      'options',jsonb_build_array('Right','Wrong one','Wrong two','Wrong three'),'correctOption',0,'explanation','Because.',
      'section','Topic','grounding',jsonb_build_object('documentId',x.source_item_id,'sourceSha256',repeat('a',64),
        'passageId','N1','passageStart',0,'passageEnd',10,'quote','a quote here')) order by q)
      from generate_series(1,5) q))
  from public.ai_practice_generations x where x.id = g $$;
create function pg_temp.finish_quiz(n integer, p_started jsonb) returns jsonb language sql as $$
  select public.finish_campus_bot_topic_set(pg_temp.u(n), (p_started ->> 'generation_id')::uuid, 'generated', null,
    pg_temp.topic_set((p_started ->> 'generation_id')::uuid), pg_temp.usage(9000, 1500), null) $$;
-- The claim hashes the server sends for an address (plain digests stand in for the HMACs, as in early_access_claim.test).
create function pg_temp.h(p_value text) returns text language sql immutable as
  $$ select encode(sha256(convert_to(p_value, 'UTF8')), 'hex') $$;
create function pg_temp.hashes(n integer) returns jsonb language sql stable security definer as $$
  select jsonb_build_array(jsonb_build_object('version', 1, 'hash',
    pg_temp.h('claim-v1:' || (select lower(email) from auth.users where id = pg_temp.u(n))),
    'check', pg_temp.h('claim-key-check-v1'))) $$;
create function pg_temp.rev(n integer) returns bigint language sql stable security definer as
  $$ select revision from public.profiles where id = pg_temp.u(n) $$;
-- Run one call and undo everything it wrote, returning its answer (or the error it raised).
create function pg_temp.dry(p_call text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  begin
    execute 'select ' || p_call into v;
    raise exception using errcode = 'P0D01', message = coalesce(v::text, 'null');
  exception when sqlstate 'P0D01' then return sqlerrm::jsonb;
    when others then return jsonb_build_object('error', sqlstate);
  end;
end $$;
-- can_read_ai_course, as the RLS on AI documents evaluates it for the student's own session.
create function pg_temp.ai_course(n integer, code text) returns boolean language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(n), 'session_id', pg_temp.s(n),
    'role', 'authenticated')::text, true);
  return private.can_read_ai_course(pg_temp.c(code));
end $$;
-- The four offer decisions and Campus Bot course reading, each undone after it answers; only their verdicts.
create function pg_temp.offers(n integer) returns jsonb language sql as $$
  select jsonb_build_object(
    'pass', pg_temp.dry(format('public.discovery_pass_eligibility(%L, %L)', pg_temp.s(n), pg_temp.hashes(n))) -> 'eligible',
    'activate', pg_temp.dry(format('public.activate_discovery_pass(%L, %L, %s)', pg_temp.s(n), pg_temp.hashes(n),
      pg_temp.rev(n))) -> 'state',
    'month', pg_temp.dry(format('public.early_access_claim_eligibility(%L, %L)', pg_temp.s(n), pg_temp.hashes(n)))
      -> 'eligible',
    'claim', pg_temp.dry(format('public.claim_early_access(%L, %L, %s)', pg_temp.s(n), pg_temp.hashes(n),
      pg_temp.rev(n))) -> 'state',
    'ai_course', pg_temp.ai_course(n, 'BUA201')) $$;
-- The free month claim open (launched yesterday) or closed (no launch).
create function pg_temp.claim_open(p_open boolean) returns void language sql as $$
  update private.entitlement_policy set actual_launch_at = case when p_open then clock_timestamp() - interval '1 day' end,
    early_access_claim_closes_at = case when p_open then clock_timestamp() + interval '5 days' end where singleton $$;
create function pg_temp.offer_states(n integer) returns jsonb language plpgsql as $$
declare closed jsonb; opened jsonb;
begin
  perform pg_temp.claim_open(false); closed := pg_temp.offers(n);
  perform pg_temp.claim_open(true); opened := pg_temp.offers(n);
  perform pg_temp.claim_open(false);
  return jsonb_build_object('claim-closed', closed, 'claim-open', opened);
end $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable as $$ select result from outcome where step = p_step $$;

-- 1. Nothing a student (or the app's own key) can reach -----------------------------------------------------------------
select is((select count(*)::int from private.tester_site), 0, 'no migration or seed switches the test site on');
select is((select count(*)::int from private.tester_accounts), 0, 'and no tester exists after the migrations');
select ok(c.relrowsecurity, 'RLS is on for private.' || c.relname) from pg_class c
  join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname in ('tester_site', 'tester_accounts');
select is((select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r,
  unnest(array['private.tester_site', 'private.tester_accounts']) t,
  unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p where has_table_privilege(r, t, p)), 0,
  'no API role, the service role included, can read or write either table');
select ok(not has_schema_privilege(r, 'private', 'USAGE'), 'the private schema is closed to ' || r)
  from unnest(array['anon', 'authenticated']) r;
select ok(not has_function_privilege(r, f, 'EXECUTE'), f || ' is closed to ' || r)
  from unnest(array['private.tester_access_ends(uuid,timestamptz)', 'private.tester_access_active(uuid,timestamptz)',
    'private.tester_written_weight()', 'private.tester_day_end(timestamptz)', 'private.tester_cap_use(uuid,timestamptz)',
    'private.tester_cap_left(uuid,timestamptz)']) f
  cross join unnest(array['anon', 'authenticated', 'service_role']) r;
select ok(has_function_privilege('service_role', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
  and not has_function_privilege('anon', f, 'EXECUTE'), f || ' is service-role only')
  from unnest(array['public.admin_set_tester_access(uuid,text,integer,bigint,text,text)',
    'public.admin_tester_status(uuid)']) f;
-- The argument check: no function a student can call takes anything that could carry a tester verdict.
select is((select coalesce(array_agg(p.oid::regprocedure::text order by 1), '{}') from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'graphql', 'graphql_public', 'pgtap')
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      and exists (select 1 from unnest(coalesce(p.proargnames, '{}')) a
        where a ~* '(tester|verdict|site|exempt|bypass|override)')), '{}'::text[],
  'no function executable by anon or authenticated has a tester, verdict, site, exemption or bypass argument');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%tester%'
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'no tester function is callable by a student');

select pg_temp.student(n) from generate_series(1, 11) n;
select pg_temp.tester(1);
-- Direct writes by a student are refused at the privilege layer.
select throws_ok(format($$select pg_temp.student_exec(2, %L)$$, $q$insert into private.tester_accounts
  (user_id, starts_at, expires_at, set_by, reason, updated_at) values (auth.uid(), now(), now() + interval '7 days', 'me',
  'me me', now())$q$), '42501', null,
  'a student cannot write a tester row');
select throws_ok(format($$select pg_temp.student_exec(2, %L)$$, $q$insert into private.tester_site
  (project_ref, enabled_by, reason) values ('x', 'me', 'me me')$q$),
  '42501', null, 'a student cannot switch the test site on');
select throws_ok(format($$select pg_temp.as_student(2, %L)$$, $q$public.admin_set_tester_access(auth.uid(), 'grant', 30,
  null, 'me', 'me me')$q$), '42501', null, 'a student cannot call the operator function');
select throws_ok(format($$select pg_temp.student_exec(2, %L)$$, $q$update public.profiles set role = 'operator'
  where id = auth.uid()$q$), '42501', null, 'a student cannot promote themselves');
select throws_ok($$select pg_temp.svc('(select to_jsonb(count(*)) from private.tester_accounts)')$$, '42501', null,
  'the app''s service key cannot read the tester table either');

-- 2. The setting absent (production): a tester row changes nothing ------------------------------------------------------
select is(private.tester_access_active(pg_temp.u(1), clock_timestamp()), false, 'no test-site row: never active');
select is(pg_temp.dec(1, 'BUA201'), pg_temp.dec(2, 'BUA201'), 'her course decision equals a normal student''s');
select is(pg_temp.dec(1, 'BUA201') ->> 'reason', 'needs-plan', 'which is needs-plan without a plan');
select is(pg_temp.snapshot(1), pg_temp.snapshot(2) || jsonb_build_object('selection', pg_temp.snapshot(1) -> 'selection'),
  'every read she makes matches a normal student''s');
select throws_ok($$select pg_temp.save(1, pg_temp.second())$$, 'CI422', null,
  'her save of a semester that is not running is refused, as for anyone');
insert into outcome values ('prod-grant', pg_temp.svc(format('public.admin_set_tester_access(%L, %L, 7, null, %L, %L)',
  pg_temp.u(2), 'grant', 'est', 'owner testing')));
select is(pg_temp.o('prod-grant'), '{"state":"not-test-site"}'::jsonb, 'the operator function refuses without the row');
select is((select count(*)::int from private.tester_accounts where user_id = pg_temp.u(2)), 0, 'and writes no tester');
select is((select count(*)::int from private.entitlement_events where event = 'operator.tester-refused'
  and detail ->> 'user_id' = pg_temp.u(2)::text and user_id is null), 1, 'but records the attempt');

-- 3. Other students: snapshots with the setting off, then on ------------------------------------------------------------
create temporary table before_snapshot as select n, pg_temp.snapshot(n) as value, pg_temp.offer_states(n) as offers
  from generate_series(2, 4) n;
select ok((select offers -> 'claim-closed' ->> 'pass' from before_snapshot where n = 2) = 'true'
  and (select offers -> 'claim-open' ->> 'month' from before_snapshot where n = 2) = 'true',
  'the comparison is meaningful: a normal student is offered the pass, and the month while the claim is open');
select pg_temp.site_on();
select is(pg_temp.offer_states(n), (select offers from before_snapshot b where b.n = g.n),
  'student ' || n || ': free pass and free month eligibility, activation, claim and Campus Bot course reads unchanged')
  from generate_series(2, 4) g(n);
select is(pg_temp.snapshot(n), (select value from before_snapshot b where b.n = g.n),
  'student ' || n || ': every read is unchanged with the setting on') from generate_series(2, 4) g(n);
select throws_ok($$select pg_temp.save(2, pg_temp.second())$$, 'CI422', null,
  'a normal student still cannot save a semester that is not running');

-- 4. Her courses, her plan, her offers (setting on) -------------------------------------------------------------------
select is(private.tester_access_active(pg_temp.u(1), clock_timestamp()), true, 'active with the row and the record');
select is(pg_temp.dec(1, code) ->> 'reason', 'tester', code || ' (her list) opens through tester access')
  from (select ic.course_code code from public.course_applicability a join public.institutional_courses ic
    on ic.id = a.institutional_course_id where a.department_id = pg_temp.dept() and a.academic_level_id = pg_temp.lvl()
    and a.academic_period_id = pg_temp.first() and not ic.is_free) x;
select is(pg_temp.dec(1, 'GST111') ->> 'reason', 'free', 'free courses stay free');
select is(pg_temp.dec(1, 'BUA202') ->> 'reason', 'outside-list', 'a course outside her selection stays closed');
select is(pg_temp.as_student(1, 'public.get_my_entitlement()') -> 'access' ->> 'source', 'tester', 'her plan reads tester access');
update private.payment_policy set sales_open = true where singleton;
select is(pg_temp.as_student(1, 'public.get_my_entitlement()') -> 'plans', '[]'::jsonb, 'and offers her no plans');
select isnt(pg_temp.as_student(2, 'public.get_my_entitlement()') -> 'plans', '[]'::jsonb, 'while others see them');
select is(pg_temp.as_student(1, 'public.get_my_ai_allowance()') ->> 'source', 'tester', 'Campus Bot is funded for her');
select is(private.discovery_email_allowed(pg_temp.u(1)), false, 'the free pass and free month are paused for her');
select is(private.discovery_email_allowed(pg_temp.u(2)), true, 'not for others');
select is(pg_temp.offer_states(1), '{"claim-closed": {"pass": false, "activate": "trial-not-offered", "month": false,
  "claim": "closed", "ai_course": true}, "claim-open": {"pass": false, "activate": "trial-not-offered",
  "month": false, "claim": "not-available", "ai_course": true}}'::jsonb,
  'her offers are all refused before anything is written, and Campus Bot reads her course');

-- 5. Selection: any department, level and semester, saved herself ------------------------------------------------------
select lives_ok($$select pg_temp.save(1, pg_temp.second())$$, 'she saves a semester that is not running');
select is((select detail ->> 'exemption' from private.course_selection_events where user_id = pg_temp.u(1)
  and event = 'selection.changed' order by id desc limit 1), 'tester', 'the change is recorded as hers, exempted');
select is(pg_temp.dec(1, code) ->> 'reason', 'tester', code || ' (her new semester) opens')
  from (select ic.course_code code from public.course_applicability a join public.institutional_courses ic
    on ic.id = a.institutional_course_id where a.department_id = pg_temp.dept() and a.academic_level_id = pg_temp.lvl()
    and a.academic_period_id = pg_temp.second() and not ic.is_free) x;
select ok((select count(*) from public.course_applicability where department_id = pg_temp.dept()
  and academic_level_id = pg_temp.lvl() and academic_period_id = pg_temp.second()) > 0, 'the second-semester list is not empty');
select is(pg_temp.dec(1, 'BUA201') ->> 'reason', 'outside-list', 'her old semester''s course is now outside her list');
select is(pg_temp.as_student(1, 'public.get_my_course_selection()') ->> 'state', 'open', 'her selection reads open');
select lives_ok($$select pg_temp.save(1, pg_temp.first())$$, 'and she can move back');

-- 6. Expiry, revocation and stepping aside ---------------------------------------------------------------------------
select is(pg_temp.dec(1, 'BUA201', (select expires_at from private.tester_accounts where user_id = pg_temp.u(1))
  - interval '1 second') ->> 'reason', 'tester', 'still on a second before it ends');
select is(pg_temp.dec(1, 'BUA201', (select expires_at from private.tester_accounts where user_id = pg_temp.u(1))
  + interval '1 second') ->> 'reason', 'needs-plan', 'and over a second after');
update private.tester_accounts set expires_at = clock_timestamp() - interval '1 minute' where user_id = pg_temp.u(1);
select is(pg_temp.snapshot(1) - 'selection', pg_temp.snapshot(5) - 'selection', 'expired: she reads like any free student');
select throws_ok($$select pg_temp.save(1, pg_temp.second())$$, 'CI422', null, 'expired: the semester rule applies again');
select pg_temp.tester(1);
update private.tester_accounts set revoked_at = clock_timestamp(), revoked_by = 'operator:test' where user_id = pg_temp.u(1);
select is(private.tester_access_active(pg_temp.u(1), clock_timestamp()), false, 'revoked: off at once');
select pg_temp.tester(1);
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  values (pg_temp.u(1), 'manual', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day', 'none', 'test');
select is(private.tester_access_active(pg_temp.u(1), clock_timestamp()), false, 'any unrevoked grant: steps aside');
select is(pg_temp.dec(1, 'BUA201') ->> 'reason', 'own-list', 'and the grant decides, as for anyone');
update public.entitlement_grants set revoked_at = clock_timestamp(), revoked_by = 'test', revoke_reason = 'test'
  where user_id = pg_temp.u(1);
select is(private.tester_access_active(pg_temp.u(1), clock_timestamp()), true, 'a revoked manual grant no longer blocks it');
-- An ended grant that was never revoked still makes it step aside, and the status names it.
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  values (pg_temp.u(4), 'manual', clock_timestamp() - interval '3 days', clock_timestamp() - interval '1 day', 'none', 'test');
select pg_temp.tester(4);
select is(private.tester_access_active(pg_temp.u(4), clock_timestamp()), false, 'an expired, unrevoked grant: steps aside');
insert into outcome values ('status-4', pg_temp.svc(format('public.admin_tester_status(%L)', pg_temp.u(4))));
select is(pg_temp.o('status-4') -> 'testers' -> 0 ->> 'state', 'stepped-aside', 'status says it stepped aside');
select is(pg_temp.o('status-4') -> 'testers' -> 0 -> 'stepped_aside_by' -> 'grants' -> 0 ->> 'grant_id',
  (select id::text from public.entitlement_grants where user_id = pg_temp.u(4)), 'and names the grant');
select is((pg_temp.o('status-4') -> 'testers' -> 0 -> 'stepped_aside_by' -> 'grants' -> 0 ->> 'ended')::boolean, true,
  'as ended');
update private.tester_accounts set revoked_at = clock_timestamp(), revoked_by = 'operator:test' where user_id = pg_temp.u(4);
-- A payment order, even one never paid, ends it for good.
update public.profiles set academic_period_id = pg_temp.first() where id = pg_temp.u(3);
select pg_temp.tester(3);
select is(private.tester_access_active(pg_temp.u(3), clock_timestamp()), true, 'student 3 is a tester');
insert into outcome values ('order', pg_temp.svc(format('public.create_payment_order(%L, %L, %s, %L, %L, %L)',
  pg_temp.s(3), 'standard_semester', (select revision from public.profiles where id = pg_temp.u(3)), gen_random_uuid(),
  '/access', 'bachs')));
select is(pg_temp.o('order') ->> 'state', 'created', 'student 3 opens an order (unpaid)');
select is(private.tester_access_active(pg_temp.u(3), clock_timestamp()), false, 'an order ends tester access');
select is(pg_temp.dec(3, 'BUA201') ->> 'reason', 'needs-plan', 'and courses close again');
select is((select count(*)::int from private.plan_use_events where user_id in (pg_temp.u(1), pg_temp.u(3))), 0,
  'no plan use was ever recorded for a tester');

-- 7. The operator function ----------------------------------------------------------------------------------------------
insert into outcome values ('g1', pg_temp.svc(format('public.admin_set_tester_access(%L, %L, null, null, %L, %L)',
  pg_temp.u(6), 'grant', 'est', 'owner testing')));
select is(pg_temp.o('g1') ->> 'state', 'granted', 'grant switches it on');
select ok(abs(extract(epoch from (pg_temp.o('g1') ->> 'expires_at')::timestamptz - clock_timestamp()) - 7 * 86400) < 60,
  'for 7 days by default');
select is((pg_temp.o('g1') ->> 'daily_cap_tokens')::bigint, 3000000::bigint, 'with a 3,000,000 token daily cap');
update private.tester_accounts set starts_at = starts_at - interval '2 days', expires_at = expires_at - interval '2 days'
  where user_id = pg_temp.u(6);
insert into outcome values ('g2', pg_temp.svc(format('public.admin_set_tester_access(%L, %L, 30, null, %L, %L)',
  pg_temp.u(6), 'grant', 'est', 'renew')));
select is(pg_temp.o('g2') ->> 'state', 'renewed', 'the same command renews');
select ok(abs(extract(epoch from (pg_temp.o('g2') ->> 'expires_at')::timestamptz - clock_timestamp()) - 30 * 86400) < 60,
  'from this moment');
select is((pg_temp.o('g2') ->> 'starts_at')::timestamptz, (pg_temp.o('g1') ->> 'starts_at')::timestamptz - interval '2 days',
  'keeping its start');
select throws_ok(format($$select pg_temp.svc(%L)$$, format('public.admin_set_tester_access(%L, %L, 31, null, %L, %L)',
  pg_temp.u(6), 'grant', 'est', 'too long')), '22023', null, 'at most 30 days');
select throws_ok(format($$select pg_temp.svc(%L)$$, format('public.admin_set_tester_access(%L, %L, 7, 99999, %L, %L)',
  pg_temp.u(6), 'grant', 'est', 'too small')), '22023', null, 'a cap below 100,000 is refused');
select throws_ok(format($$select pg_temp.svc(%L)$$, format('public.admin_set_tester_access(%L, %L, 7, null, %L, %L)',
  pg_temp.u(6), 'grant', 'est', 'r')), '22023', null, 'a reason is required');
insert into outcome values ('rv', pg_temp.svc(format('public.admin_set_tester_access(%L, %L, null, null, %L, %L)',
  pg_temp.u(6), 'revoke', 'est', 'done')));
select is(pg_temp.o('rv') ->> 'state', 'revoked', 'revoke switches it off');
insert into outcome values ('rv2', pg_temp.svc(format('public.admin_set_tester_access(%L, %L, null, null, %L, %L)',
  pg_temp.u(6), 'revoke', 'est', 'again')));
select is(pg_temp.o('rv2') ->> 'state', 'not-active', 'a second revoke changes nothing');
select is((select array_agg(event order by id) from private.entitlement_events where user_id = pg_temp.u(6)),
  array['operator.tester-granted', 'operator.tester-renewed', 'operator.tester-revoked'], 'each change is audited');
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
  values (pg_temp.u(7), 'manual', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day', 'none', 'test');
update public.profiles set role = 'operator' where id = pg_temp.u(8);
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values (pg_temp.u(9), now(), now() + interval '720 hours', now() + interval '720 hours');
select is(pg_temp.svc(format('public.admin_set_tester_access(%L, %L, null, null, %L, %L)', pg_temp.u(n), 'grant', 'est',
  'owner testing')) ->> 'state', expected, 'grant refused: ' || expected)
  from (values (7, 'has-grants'), (8, 'operator-account'), (9, 'account-restricted'), (3, 'payment-records')) x(n, expected);
select pg_temp.tester(n) from generate_series(1, 2) n;
select pg_temp.tester(10);
select is(pg_temp.svc(format('public.admin_set_tester_access(%L, %L, null, null, %L, %L)', pg_temp.u(11), 'grant', 'est',
  'owner testing')) ->> 'state', 'too-many-testers', 'at most 3 active testers');
update private.tester_accounts set revoked_at = clock_timestamp(), revoked_by = 'operator:test' where user_id = pg_temp.u(2);
select is(pg_temp.svc('public.admin_tester_status(null)') -> 'site' ->> 'project_ref', 'znwluaiylogqapansuht',
  'status shows the test-site row');
select is((select t ->> 'state' from jsonb_array_elements(pg_temp.svc(format('public.admin_tester_status(%L)', pg_temp.u(3)))
  -> 'testers') t), 'stepped-aside', 'status names a tester who stepped aside');
select is((select t -> 'stepped_aside_by' -> 'payment_orders' -> 0 ->> 'order_id' from jsonb_array_elements(
  pg_temp.svc(format('public.admin_tester_status(%L)', pg_temp.u(3))) -> 'testers') t),
  pg_temp.o('order') -> 'order' ->> 'id', 'and the payment order that caused it');

-- 8. Campus Bot: no plan limits, the daily cap, platform limits still on ---------------------------------------------------
update private.campus_bot_settings set explain_enabled = true, ask_enabled = true, topic_sets_enabled = true where singleton;
select pg_temp.tester(1, interval '7 days', 100000);
insert into outcome values ('c1', pg_temp.chat(1, 1));
select is(pg_temp.o('c1') ->> 'state', 'started', 'Ask is admitted with no plan or pass');
select is(pg_temp.o('c1') ->> 'funding', 'tester', 'funded by tester access');
select is((select jsonb_build_array(funding_source, funding_grant_id, session_window_id, week_window_id, reserved_tokens)
  from private.campus_bot_replies where id = (pg_temp.o('c1') ->> 'reply_id')::uuid),
  jsonb_build_array('tester', null, null, null, 18000), 'no grant, no plan windows, the worst case reserved');
select is((select in_flight from private.tester_cap_use(pg_temp.u(1), clock_timestamp())), 18000::bigint,
  'a live reservation counts against the day');
insert into outcome values ('c1-done', pg_temp.answer(1, pg_temp.o('c1')));
select is((select charged_tokens from private.campus_bot_replies where id = (pg_temp.o('c1') ->> 'reply_id')::uuid),
  7750::bigint, 'charged only what was used');
insert into outcome values ('q1', pg_temp.quiz(1, 2));
select is(pg_temp.o('q1') ->> 'funding', 'tester', 'Quiz me is admitted through tester access');
insert into outcome values ('q1-done', pg_temp.finish_quiz(1, pg_temp.o('q1')));
select is(pg_temp.o('q1-done') ->> 'status', 'generated', 'and delivered: the grant-less funding passes the delivery check');
update private.campus_bot_replies set charged_tokens = 95000 where id = (pg_temp.o('c1') ->> 'reply_id')::uuid;
insert into outcome values ('cap-chat', pg_temp.chat(1, 3)), ('cap-quiz', pg_temp.quiz(1, 4));
select is(pg_temp.o(step) ->> 'state', 'session-limit', step || ': refused at the daily cap')
  from unnest(array['cap-chat', 'cap-quiz']) step;
select is((pg_temp.o('cap-chat') ->> 'resets_at')::timestamptz, private.tester_day_end(clock_timestamp()),
  'and told it resets at the next UTC midnight');
update private.campus_bot_replies set reserved_at = reserved_at - interval '1 day'
  where id = (pg_temp.o('c1') ->> 'reply_id')::uuid;
update public.ai_usage_events set reserved_at = reserved_at - interval '1 day' where user_id = pg_temp.u(1);
select ok(private.tester_cap_left(pg_temp.u(1), clock_timestamp()) = 100000, 'yesterday''s use does not count');
update private.campus_bot_settings set ask_enabled = false where singleton;
select is(pg_temp.chat(1, 5) ->> 'state', 'disabled', 'a feature switched off stays off for her');
update private.campus_bot_settings set ask_enabled = true, daily_chat_messages = 0 where singleton;
select is(pg_temp.chat(1, 6) ->> 'state', 'capacity', 'the platform''s daily limit still applies');
update private.campus_bot_settings set daily_chat_messages = 10000 where singleton;
insert into outcome values ('q2', pg_temp.quiz(1, 7));
update private.tester_accounts set revoked_at = clock_timestamp(), revoked_by = 'operator:test' where user_id = pg_temp.u(1);
select is(pg_temp.finish_quiz(1, pg_temp.o('q2')) ->> 'status', 'failed', 'a set finishing after revocation is not delivered');
select is((select charged_tokens from public.ai_usage_events e join public.ai_practice_generations g on g.usage_event_id = e.id
  where g.id = (pg_temp.o('q2') ->> 'generation_id')::uuid), 0::bigint, 'and costs nothing');
select is(pg_temp.chat(1, 8) ->> 'state', 'not-entitled', 'revoked: no Campus Bot');
select is(pg_temp.chat(2, 9) ->> 'state', 'not-entitled', 'a normal student without a plan has none either');

-- Once a request settles past the cap, every further admission that day is refused: Ask, Quiz me, Explain, uploads.
select pg_temp.tester(1, interval '7 days', 100000);
insert into outcome values ('over', pg_temp.chat(1, 20));
select is(pg_temp.o('over') ->> 'state', 'started', 'a request is admitted with room left');
insert into outcome values ('over-done', pg_temp.answer(1, pg_temp.o('over')));
-- Settled past the cap (an overrun the provider reported): the day is now below zero.
update private.campus_bot_replies set charged_tokens = 120000 where id = (pg_temp.o('over') ->> 'reply_id')::uuid;
select ok(private.tester_cap_left(pg_temp.u(1), clock_timestamp()) < 0, 'the day is past the cap');
insert into outcome values ('ex-start', public.practice_start(pg_temp.s(1), pg_temp.a(1), pg_temp.gst(), 'new', null, 100,
  10800, '[]', null, null, null, 'instant', 'Listening Skills and Note-taking'));
insert into outcome values ('ex-pick', (select public.practice_pick(pg_temp.s(1), pg_temp.a(1), q.question_id,
  ((r.payload ->> 'correctOption')::int + 1) % jsonb_array_length(r.payload -> 'options'))
  from public.quiz_attempt_questions q join public.managed_content_revisions r on r.item_id = q.item_id
    and r.revision = q.content_revision where q.attempt_id = pg_temp.a(1) order by q.question_id limit 1));
select is(pg_temp.o('ex-pick') ->> 'state', 'picked', 'she has an answered question to explain');
insert into outcome values ('doc', public.create_ai_practice_document(pg_temp.s(1), pg_temp.c('BUA201'), 'notes.txt',
  'text/plain', 10, array['trial', 'early_access', 'paid']));
select is(pg_temp.o('doc') ->> 'status', 'created', 'an upload of her own notes is accepted');
insert into storage.objects (bucket_id, name) values ('ai-practice-uploads', pg_temp.o('doc') ->> 'storage_path');
insert into outcome values ('claim', public.claim_ai_practice_extraction(pg_temp.s(1), (pg_temp.o('doc') ->> 'document_id')::uuid));
select ok(public.settle_ai_practice_document(pg_temp.s(1), (pg_temp.o('doc') ->> 'document_id')::uuid,
  (pg_temp.o('claim') ->> 'claim_id')::uuid, null, 'ready notes', encode(sha256(convert_to('ready notes', 'UTF8')), 'hex'), 2),
  'and its text is ready');
insert into outcome values
  ('past-chat', pg_temp.chat(1, 21)),
  ('past-quiz', pg_temp.quiz(1, 22)),
  ('past-explain', public.begin_campus_bot_explanation(pg_temp.s(1), pg_temp.a(1), (select question_id
    from public.quiz_attempt_questions where attempt_id = pg_temp.a(1) order by question_id limit 1), true)),
  ('past-upload', public.begin_ai_practice_generation(pg_temp.s(1), pg_temp.r(23),
    (pg_temp.o('doc') ->> 'document_id')::uuid, array['trial', 'early_access', 'paid']));
select is(pg_temp.o(step) ->> 'state', 'session-limit', step || ': refused for the rest of the day')
  from unnest(array['past-chat', 'past-quiz', 'past-explain', 'past-upload']) step;
select is((select count(*)::int from private.campus_bot_replies where user_id = pg_temp.u(1) and state = 'reserved'), 0,
  'nothing was reserved past the cap');

-- 9. Payments: the functions are exactly as they were ---------------------------------------------------------------------
-- Expected values: md5(pg_get_functiondef) recorded from the database before this migration was applied
-- (supabase/tests/fixtures/owner_tester_access_functiondefs.json, "unchanged").
select is(md5(pg_get_functiondef(x.fn::regprocedure)), x.expected, x.fn || ' is byte-identical')
  from (values
    ('public.attach_payment_checkout(uuid,text,text,text,timestamp with time zone)', '44c7b7c3838cdf311073d0546ae22ec0'),
    ('public.claim_payment_checks(integer,boolean,uuid)', 'a8c71a05c3ce0d551f3753fa9a7fbbc4'),
    ('public.create_payment_order(uuid,text,bigint,uuid,text,text)', 'c732344dee71e1eb66081153378ba39b'),
    ('public.fulfil_payment(uuid,text,text,text,bigint,text,text,timestamp with time zone,text,text)', '192355fbaad804000e1a67b582b95808'),
    ('public.get_my_payment_order(uuid)', '43e297e6f22f1e96e48c805140dda649'),
    ('public.plans_on_sale()', 'a92ab56296d74f046ab2d42ae74b8df0'),
    ('private.course_selection_state_for(uuid,uuid,timestamp with time zone,timestamp with time zone)', '4671132487086bb7dc04fc1d06773b88'),
    ('private.current_course_scope(uuid,timestamp with time zone)', 'ffe8bf8d221ab341c6a245b1eb90644b'),
    ('private.has_current_paid_plan(uuid,timestamp with time zone)', 'c3ed6b857fd1211daffa45dfa1fbda86'),
    ('private.mark_plan_use(uuid,text,uuid,text,timestamp with time zone)', '4440c34cace05978a9be32673a424587'),
    ('private.plan_use_events_guard()', '9a54cbe23a0368025ed93e6329aae665'),
    ('private.refund_assessment(private.payment_orders,private.payment_fulfilments,text[],timestamp with time zone)', '09373aceace63856d30391dc4b8e07df'),
    ('public.record_payment_check(uuid,text,uuid)', '289cb631c35da3b3070f8d8c94b7a3c3'),
    ('public.record_payment_event(text,text,text,uuid,text)', '54cee0fbe9d81711d7e8824c5a17c5ef'),
    ('public.record_payment_outcome(uuid,text,text,text)', 'b17d154f162a1bc00d2a41983c16b901'),
    ('public.record_plan_use(uuid,text,uuid,text)', 'a18ddb169965f44908a681e4a95231f2'),
    ('public.record_refund_result(uuid,text,text,text,text,text)', 'a635517167f25ebbf120f176be599e6b'),
    ('public.refund_eligibility(uuid,text[],timestamp with time zone,uuid)', 'b0cd7713c12f9e2f20e358380d220259'),
    ('public.refund_order(uuid,text,uuid,text[],text,text,timestamp with time zone,uuid)', '3f1d8364717659b2e5466ff4fd233722')) x(fn, expected);

-- 10. Account deletion: the tester row goes with the account, the audit stays --------------------------------------------
select is((select confdeltype::text from pg_constraint where conrelid = 'private.tester_accounts'::regclass and contype = 'f'),
  'c', 'tester rows cascade with the account');
delete from auth.users where id = pg_temp.u(6);
select is((select count(*)::int from private.tester_accounts where user_id = pg_temp.u(6)), 0, 'purge removes the row');
select ok((select count(*) from private.entitlement_events where event like 'operator.tester-%' and user_id is null
  and detail ->> 'reason' in ('owner testing', 'renew', 'done')) >= 3, 'and keeps the audit without the link');

select * from finish();
rollback;
