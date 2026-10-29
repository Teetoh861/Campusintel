-- supabase/tests/server_run_practice.test.sql — Server-run CBT practice (20261025100000_server_run_practice.sql): the
-- database draws each attempt, withholds the bank and its key, holds the deadline, keeps the sheet saved in time and
-- grades it once; students reach practice only through the application server (service role); legacy browser-run
-- attempts never block, resume or outlive their 24-hour window.
-- Time is simulated by moving attempt timestamps: now() is fixed for the whole transaction, but the practice functions
-- decide on clock_timestamp(), so a deadline that must have passed is set from clock_timestamp().
begin;
select no_plan();

-- Helpers ------------------------------------------------------------------------------------------------------------
create function pg_temp.u(n integer) returns uuid language sql immutable
  as $$ select ('d1000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.s(n integer) returns uuid language sql immutable
  as $$ select ('d2000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.a(n integer) returns uuid language sql immutable
  as $$ select ('d3000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.t(n integer) returns uuid language sql immutable
  as $$ select ('d4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.c(n text) returns uuid language sql immutable
  as $$ select ('40000000-0000-4000-8000-0000000000' || n)::uuid $$;
create function pg_temp.near(p_a timestamptz, p_b timestamptz) returns boolean language sql immutable
  as $$ select abs(extract(epoch from p_a - p_b)) < 5 $$;
-- Practice calls as the application server makes them (the caller sets the service role).
create function pg_temp.whole_bank(p_course uuid, p_size integer) returns boolean
language sql stable security definer set search_path = ''
as $$ select count(*) <= p_size from private.practice_pool(p_course) $$;
create function pg_temp.start(p_user integer, p_attempt integer, p_course text, p_expected integer default 50,
  p_intent text default 'new', p_redo integer default null, p_sections jsonb default '[]', p_size integer default 50,
  p_seconds integer default 1800) returns jsonb language sql
  as $$ select public.practice_start(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.c(p_course), p_intent,
    case when p_redo is null then null else pg_temp.a(p_redo) end, p_size, p_seconds, p_sections, p_expected,
    p_seconds, pg_temp.whole_bank(pg_temp.c(p_course), p_expected)) $$;
create function pg_temp.save(p_user integer, p_attempt integer, p_tab integer, p_seq integer, p_base integer,
  p_changes jsonb) returns jsonb language sql
  as $$ select public.practice_save(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.t(p_tab), p_seq, p_base,
    p_changes) $$;
create function pg_temp.submit(p_user integer, p_attempt integer, p_tab integer, p_seq integer, p_base integer,
  p_changes jsonb) returns jsonb language sql
  as $$ select public.practice_submit(pg_temp.s(p_user), pg_temp.a(p_attempt), pg_temp.t(p_tab), p_seq, p_base,
    p_changes) $$;
-- Fixture reads as the owner: the pinned questions and their key, which no API role can read.
create function pg_temp.q(p_attempt integer, p_ordinal integer) returns text language sql stable security definer
  set search_path = '' as $$ select question_id::text from public.quiz_attempt_questions
    where attempt_id = pg_temp.a(p_attempt) and ordinal = p_ordinal $$;
create function pg_temp.qs(p_attempt integer) returns uuid[] language sql stable security definer set search_path = ''
  as $$ select coalesce(array_agg(question_id order by ordinal), '{}') from public.quiz_attempt_questions
    where attempt_id = pg_temp.a(p_attempt) $$;
create function pg_temp.choice(p_attempt integer, p_ordinal integer, p_right boolean) returns jsonb language sql stable
  security definer set search_path = '' as $$
  select jsonb_build_object(q.question_id::text, case when p_right then (r.payload ->> 'correctOption')::integer
      else ((r.payload ->> 'correctOption')::integer + 1) % jsonb_array_length(r.payload -> 'options') end)
  from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = pg_temp.a(p_attempt) and q.ordinal = p_ordinal $$;
-- A sheet of p_right right answers then p_wrong wrong answers, from ordinal 0.
create function pg_temp.sheet(p_attempt integer, p_right integer, p_wrong integer) returns jsonb language sql stable
  as $$ select coalesce(jsonb_object_agg(e.key, e.value), '{}') from generate_series(0, p_right + p_wrong - 1) n,
    jsonb_each(pg_temp.choice(p_attempt, n, n < p_right)) e $$;
create function pg_temp.row_of(p_attempt integer) returns public.quiz_attempts language sql stable security definer
  set search_path = '' as $$ select * from public.quiz_attempts where id = pg_temp.a(p_attempt) $$;
create function pg_temp.keys(p_value jsonb) returns text[] language sql immutable
  as $$ select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(p_value) k $$;
-- Every key name anywhere in a JSON value.
create function pg_temp.all_keys(p_value jsonb) returns text[] language sql immutable as $$
  with recursive walk(v) as (select p_value union all
    select child from walk, lateral (
      select value from jsonb_each(case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end)
      union all select value from jsonb_array_elements(case when jsonb_typeof(walk.v) = 'array' then walk.v else '[]' end)
    ) children(child))
  select coalesce(array_agg(distinct k), '{}') from walk, lateral jsonb_object_keys(
    case when jsonb_typeof(walk.v) = 'object' then walk.v else '{}' end) k $$;
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;
create function pg_temp.o(p_step text) returns jsonb language sql stable
  as $$ select result from outcome where step = p_step $$;
-- Key and explanation fields the student must never receive before grading.
create function pg_temp.leaks(p_value jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(k order by k), '{}') from unnest(pg_temp.all_keys(p_value)) k
  where k in ('correct_option', 'correctOption', 'explanation', 'is_correct', 'item_id', 'selected', 'score') $$;

-- 1. Structure, privileges and policy --------------------------------------------------------------------------------
select is((select count(*)::integer from unnest(array[
    'public.practice_start(uuid,uuid,uuid,text,uuid,integer,integer,jsonb,integer,integer,boolean,text)',
    'public.practice_state(uuid,uuid)', 'public.practice_attempt(uuid,uuid)',
    'public.practice_save(uuid,uuid,uuid,integer,integer,jsonb)',
    'public.practice_submit(uuid,uuid,uuid,integer,integer,jsonb)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0,
  'practice entry points are callable only by the application server (service role), never by a student directly');
select is((select count(*)::integer from unnest(array['private.practice_pool(uuid)',
    'private.practice_can_start(uuid,uuid,timestamptz)',
    'private.practice_draw(uuid,uuid,uuid,integer,jsonb)', 'private.practice_questions(uuid,boolean)',
    'private.practice_view(public.quiz_attempts)', 'private.practice_answer(text,public.quiz_attempts)',
    'private.practice_grade(uuid,jsonb,text,timestamptz)', 'private.close_overdue_practice(uuid)',
    'private.close_overdue_practice_all()', 'private.practice_changes_valid(uuid,jsonb)',
    'private.practice_reconcile(public.quiz_attempts,uuid,integer,integer,jsonb)',
    'private.practice_sheet_answer(text,public.quiz_attempts)']) fn,
    unnest(array['anon', 'authenticated', 'service_role']) api_role
  where has_function_privilege(api_role, fn, 'EXECUTE')), 0, 'practice helpers are callable by no API role');
select ok(has_function_privilege('authenticated', 'public.published_cbt_summary(uuid[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.published_cbt_summary(uuid[])', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.published_cbt_summary(uuid[])', 'EXECUTE'),
  'the bank summary is for signed-in students only, like the content read');
select is(pg_get_function_result('public.published_cbt_summary(uuid[])'::regprocedure),
  'TABLE(course_id uuid, bank_size integer)', 'the summary returns a count per course and nothing else');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'practice\_%'
    and exists (select 1 from unnest(p.proargtypes::oid[]) t
      where t in ('timestamptz'::regtype, 'timestamp'::regtype, 'interval'::regtype, 'date'::regtype))), 0,
  'no practice entry point takes a time from its caller');
select ok(not exists (select 1 from unnest((select proargnames from pg_proc
    where oid = 'public.practice_start(uuid,uuid,uuid,text,uuid,integer,integer,jsonb,integer,integer,boolean,text)'::regprocedure)) arg
  where arg ~ '(question|answer|item|option|deadline|score)'),
  'a start names no question, answer, deadline or score: the database chooses and decides them');
select is((select jsonb_build_object('tabs', attempt_tabs, 'batch', sweep_batch, 'legacy', legacy_window)
  from private.practice_policy), '{"tabs":16,"batch":500,"legacy":"24:00:00"}'::jsonb,
  'approved policy: 16 tabs per attempt, sweeps of 500, legacy saves for 24 hours');
select is((select count(*)::integer from unnest(array['anon', 'authenticated', 'service_role']) api_role,
    unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) privilege
  where has_table_privilege(api_role, 'private.practice_policy', privilege)), 0, 'the policy is not readable by API roles');
select ok((select pg_get_indexdef(indexrelid) from pg_index where indexrelid = 'public.quiz_attempts_one_open_practice_idx'::regclass)
  ~ 'UNIQUE INDEX .* \(user_id, course_id\) WHERE \(\(status = ''in_progress''::text\) AND \(deadline_at IS NOT NULL\)\)',
  'one open server-run attempt per student and course; legacy rows are outside the index');
select is((select jsonb_build_object('schedule', schedule, 'command', command, 'active', active) from cron.job
  where jobname = 'campusintell-practice-close-overdue'),
  '{"schedule":"*/5 * * * *","command":"select private.close_overdue_practice_all()","active":true}'::jsonb,
  'the overdue sweep runs every five minutes');

-- 2. Fixtures --------------------------------------------------------------------------------------------------------
-- 1 S and 2 O: full plans. 3 N: free tier only. 5 R: a plan that ends mid-attempt. 6 P: operator. 7 L: legacy rows.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', pg_temp.u(n), 'authenticated', 'authenticated',
  'practice-' || n || '@example.test', 'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
from unnest(array[1, 2, 3, 5, 6, 7]) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.s(n), pg_temp.u(n), now(), now() from unnest(array[1, 2, 3, 5, 6, 7]) n;
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
select pg_temp.u(n), 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test'
from unnest(array[1, 2, 5, 7]) n;
update public.profiles set role = 'operator' where id = pg_temp.u(6);

-- 3. The content read withholds the bank; the summary counts it; access is the content read's ------------------------
create temporary table published_other on commit drop as
select i.course_id, count(*)::integer n from public.managed_content_items i
join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
where i.published_revision is not null and i.kind <> 'cbt_question'
  and (i.parent_item_id is null or exists (select 1 from public.managed_content_items parent
    where parent.id = i.parent_item_id and parent.published_revision = i.published_parent_revision))
group by i.course_id;
grant select on published_other to authenticated;
create temporary table pool_sizes on commit drop as
select right(c::text, 2) course, (select count(*)::integer from private.practice_pool(c)) n
from unnest(array[pg_temp.c('07'), pg_temp.c('01'), pg_temp.c('08')]) c;
grant select on pool_sizes to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000001"}';
select is((select count(*)::integer from public.read_published_managed_content(pg_temp.c('07'))
  where kind = 'cbt_question'), 0, 'a student with access receives no CBT question from the content read');
select is((select count(*)::integer from public.read_published_managed_content(pg_temp.c('07'))),
  (select n from published_other where course_id = pg_temp.c('07')),
  'and still receives every other published item of the course: overview, notes, theory and model answers');
select ok((select count(*) from public.read_published_managed_content(pg_temp.c('07'))
  where kind in ('theory_question', 'model_answer')) > 0, 'theory and its model answers stay in the content read (D8)');
select is((select jsonb_object_agg(right(course_id::text, 2), bank_size) from public.published_cbt_summary(
    array[pg_temp.c('07'), pg_temp.c('01'), pg_temp.c('08'), pg_temp.c('07')])),
  '{"01":50,"07":150,"08":100}'::jsonb, 'the summary counts each listed course once');
select is((select jsonb_object_agg(right(course_id::text, 2), bank_size) from public.published_cbt_summary(
    array[pg_temp.c('07'), pg_temp.c('01'), pg_temp.c('08')])),
  (select jsonb_object_agg(course, n) from pool_sizes),
  'the summary is exactly the size of the pool the start draws from');
select throws_ok($$ select * from public.published_cbt_summary('{}'::uuid[]) $$, '22023', null, 'an empty list is refused');
select throws_ok($$ select * from public.published_cbt_summary(array[null]::uuid[]) $$, '22023', null,
  'a missing course is refused');
select throws_ok($$ select * from public.published_cbt_summary(array_fill(pg_temp.c('08'), array[201])) $$, '22023',
  null, 'at most 200 courses per call');
select throws_ok($$ select * from private.practice_pool(pg_temp.c('07')) $$, '42501', null,
  'a student cannot read the pool');
select throws_ok($$ select count(*) from public.managed_content_revisions $$, '42501', null,
  'or any revision directly');
-- Preflight 5: no access, no content and no count.
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000003"}';
select throws_ok($$ select * from public.read_published_managed_content(pg_temp.c('07')) $$, 'CI403', null,
  'without access the content read is refused (CI403)');
select throws_ok($$ select * from public.published_cbt_summary(array[pg_temp.c('07')]) $$, 'CI403', null,
  'and so is the bank summary');
select throws_ok($$ select * from public.published_cbt_summary(array[pg_temp.c('08'), pg_temp.c('07')]) $$, 'CI403',
  null, 'one unreadable course refuses the whole list');
select throws_ok($$ select * from public.read_published_managed_content(pg_temp.c('01')) $$, 'CI403', null,
  'theory and model answers of a locked course are refused too');
select is((select bank_size from public.published_cbt_summary(array[pg_temp.c('08')])), 100,
  'a free course is counted for a student on the free tier');
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"d2000000-0000-4000-8000-0000000000ff"}';
select throws_ok($$ select * from public.published_cbt_summary(array[pg_temp.c('08')]) $$, '42501', null,
  'a session that is not live cannot count');
reset role;
set local role anon;
select throws_ok($$ select * from public.published_cbt_summary(array[pg_temp.c('08')]) $$, '42501', null,
  'a signed-out caller cannot call the summary');
select throws_ok($$ select * from public.read_published_managed_content(pg_temp.c('08')) $$, '42501', null,
  'or the content read');
reset role;
-- Operators' content tools still carry the key.
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000006"}';
select is((select count(*)::integer from public.list_managed_content(pg_temp.c('07'))
  where kind = 'cbt_question' and payload ? 'correctOption'), 150,
  'the operator editor still lists every CBT question with its correct option');
reset role;

-- One pool, whatever the start skips: withdrawn and malformed rows are counted by neither.
update public.managed_content_items set published_revision = null
  where id in (select id from public.managed_content_items where course_id = pg_temp.c('05') and kind = 'cbt_question'
    order by id limit 10);
update public.managed_content_revisions r set payload = r.payload || '{"options":["Only one"],"correctOption":0}'
  from (select id, published_revision from public.managed_content_items where course_id = pg_temp.c('05')
    and kind = 'cbt_question' and published_revision is not null order by id desc limit 3) i
  where r.item_id = i.id and r.revision = i.published_revision;
update public.managed_content_revisions r set payload = r.payload || '{"prompt":"   "}'
  from (select id, published_revision from public.managed_content_items where course_id = pg_temp.c('05')
    and kind = 'cbt_question' and published_revision is not null order by id desc offset 3 limit 2) i
  where r.item_id = i.id and r.revision = i.published_revision;
select is((select count(*)::integer from public.managed_content_items where course_id = pg_temp.c('05')
  and kind = 'cbt_question' and published_revision is not null), 90, 'fixture: 90 published, 5 of them malformed');
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000001"}';
select is((select bank_size from public.published_cbt_summary(array[pg_temp.c('05')])), 85,
  'the summary counts only valid published questions');
reset role;
set local role service_role;
insert into outcome values ('s-05', pg_temp.start(1, 50, '05'));
reset role;
select is((select jsonb_build_object('state', pg_temp.o('s-05') ->> 'state', 'bank', pg_temp.o('s-05') -> 'attempt' -> 'bank_size',
    'pool', (select count(*) from private.practice_pool(pg_temp.c('05'))),
    'discovery_pool', (select count(*) from private.discovery_cbt_pool(pg_temp.c('05'))))),
  '{"state":"ready","bank":85,"pool":85,"discovery_pool":85}'::jsonb,
  'the start sees the same 85: summary, start, practice pool and the valid-question rule agree');
select ok(pg_temp.qs(50) <@ (select array_agg(question_id) from private.practice_pool(pg_temp.c('05'))),
  'and draws only from them, never a withdrawn or malformed question');
-- D4 is decided from the bank's size at start: with 40 left the attempt is the whole bank, in a new order.
set local role service_role;
insert into outcome values ('s-05-done', pg_temp.submit(1, 50, 1, 0, 0, '{}'));
reset role;
update public.managed_content_items set published_revision = null
  where id in (select i.id from private.practice_pool(pg_temp.c('05')) p join public.managed_content_items i on i.id = p.item_id
    order by i.id limit 45);
set local role service_role;
select is(pg_temp.start(1, 51, '05'), '{"state":"policy-changed","bank_size":40,"question_count":40,"duration_seconds":1800}'::jsonb,
  'a brief of 50 is refused when only 40 remain, and nothing starts');
reset role;
select is((select count(*)::integer from public.quiz_attempts where id = pg_temp.a(51)), 0, 'no attempt row was created');
set local role service_role;
insert into outcome values ('s-05-40', pg_temp.start(1, 51, '05', 40));
reset role;
select is((select jsonb_build_object('n', (pg_temp.o('s-05-40') -> 'attempt' -> 'question_count')::integer,
    'bank', (pg_temp.o('s-05-40') -> 'attempt' -> 'bank_size')::integer)),
  '{"n":40,"bank":40}'::jsonb, 'confirmed again, the attempt is the whole bank of 40 (bank size = attempt size)');
select ok((select array_agg(x order by x) from unnest(pg_temp.qs(51)) x)
  = (select array_agg(question_id order by question_id) from private.practice_pool(pg_temp.c('05'))),
  'every question of the bank, each once');

-- 4. Start: drawn by the server, key withheld, deadline held -----------------------------------------------------------
create temporary table sections07 on commit drop as
select array_agg(section order by section desc) sections from (select distinct coalesce(nullif(payload ->> 'section', ''),
  'General') section from private.practice_pool(pg_temp.c('07'))) s;
grant select on sections07 to service_role;
set local role service_role;
insert into outcome values ('s1', pg_temp.start(1, 1, '07', p_sections => (select to_jsonb(sections) from sections07)));
reset role;
select is(pg_temp.o('s1') ->> 'state', 'ready', 'a student with access starts');
select is(jsonb_array_length(pg_temp.o('s1') -> 'attempt' -> 'questions'), 50, 'with 50 questions');
select is((select count(distinct x)::integer from unnest(pg_temp.qs(1)) x), 50, 'all different');
select ok(pg_temp.qs(1) <@ (select array_agg(question_id) from private.practice_pool(pg_temp.c('07'))),
  'all from the course pool');
select is((select array_agg((e ->> 'question_id')::uuid order by n) from jsonb_array_elements(
  pg_temp.o('s1') -> 'attempt' -> 'questions') with ordinality q(e, n)), pg_temp.qs(1),
  'delivered in the pinned order');
select is(pg_temp.leaks(pg_temp.o('s1')), '{}'::text[],
  'nothing in the start answer carries a correct option, explanation, mark, score or managed identity');
select is((select array_agg(distinct pg_temp.keys(e)::text) from jsonb_array_elements(pg_temp.o('s1') -> 'attempt' -> 'questions') e),
  array['{options,prompt,question_id,section}'], 'each question is its prompt, options and section only');
select ok(pg_temp.near((pg_temp.o('s1') -> 'attempt' ->> 'deadline_at')::timestamptz, clock_timestamp() + interval '30 minutes'),
  'the deadline is the database clock plus the server''s duration');
select is((pg_temp.row_of(1)).deadline_at, (pg_temp.o('s1') -> 'attempt' ->> 'deadline_at')::timestamptz,
  'and is the one stored');
select ok((select bool_and(pos >= prev) from (select pos, lag(pos, 1, 0) over (order by n) prev from (
    select n, array_position((select sections from sections07), e ->> 'section') pos
    from jsonb_array_elements(pg_temp.o('s1') -> 'attempt' -> 'questions') with ordinality q(e, n)) x) y),
  'questions come grouped in the server''s section order');
select is(pg_temp.o('s1') -> 'attempt' -> 'saved', '{"answers":{},"revision":0}'::jsonb, 'with an empty sheet');
set local role service_role;
select is(pg_temp.start(1, 1, '07', p_sections => (select to_jsonb(sections) from sections07)) -> 'attempt' -> 'questions',
  pg_temp.o('s1') -> 'attempt' -> 'questions', 'a replayed start returns the same attempt');
select is((select jsonb_build_object('state', r ->> 'state', 'id', r -> 'attempt' ->> 'id')
  from (select pg_temp.start(1, 2, '07') r) x),
  jsonb_build_object('state', 'in-progress', 'id', pg_temp.a(1)), 'a second start returns the open attempt instead');
reset role;
select is((select count(*)::integer from public.quiz_attempts where id = pg_temp.a(2)), 0, 'and creates nothing');
set local role service_role;
select is(pg_temp.start(1, 3, '01', 40) ->> 'state', 'policy-changed',
  'a brief that no longer matches the server''s attempt is asked again');
select throws_ok($$ select pg_temp.start(1, 4, '08', p_seconds => 299) $$, '22023', null, 'durations are bounded');
select throws_ok($$ select pg_temp.start(1, 4, '08', p_size => 101) $$, '22023', null, 'sizes are bounded');
select throws_ok($$ select pg_temp.start(1, 4, '08', p_sections => '[1]') $$, '22023', null, 'sections are names');
select throws_ok($$ select pg_temp.start(1, 4, '08', p_intent => 'redo') $$, '22023', null,
  'a redo names the attempt it repeats');
select is(pg_temp.start(3, 4, '07') ->> 'state', 'locked', 'a student without access cannot start');
select is(public.practice_start(pg_temp.s(1), pg_temp.a(4), '90000000-0000-4000-8000-000000000001', 'new', null, 50,
  1800, '[]', 50, 1800, false) ->> 'state', 'invalid-course', 'an unknown course cannot start');
select is(public.practice_start('d2000000-0000-4000-8000-0000000000ff', pg_temp.a(4), pg_temp.c('08'), 'new', null,
  50, 1800, '[]', 50, 1800, false) ->> 'state', 'signed-out', 'an unknown session is signed out');
select is(pg_temp.start(3, 4, '08') ->> 'state', 'ready', 'a free course starts on the free tier');
reset role;

-- 5. Nothing readable marks an open attempt -------------------------------------------------------------------------
set local role service_role;
insert into outcome values ('save1', pg_temp.save(1, 1, 1, 1, 0, pg_temp.sheet(1, 1, 1)));
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000001"}';
select is((select jsonb_build_object('score', score, 'saved', jsonb_typeof(saved_answers)) from public.quiz_attempts
  where id = pg_temp.a(1)), '{"score":null,"saved":"object"}'::jsonb,
  'the owner sees their saved choices but no score while the attempt is open');
select is((select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(1)), 0,
  'and no marked answer');
select is((select count(*)::integer from public.quiz_attempt_questions where attempt_id = pg_temp.a(1)), 50,
  'the pinned identities are their own');
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000002"}';
select is((select count(*)::integer from public.quiz_attempts where user_id = pg_temp.u(1)), 0,
  'another student sees none of these attempts');
select is((select count(*)::integer from public.quiz_attempt_questions where attempt_id = pg_temp.a(1)), 0,
  'or their questions');
select throws_ok($$ update public.quiz_attempts set saved_answers = '{}' where id = pg_temp.a(1) $$, '42501', null,
  'and cannot change them');
reset role;

-- 6. Saving: only in time, only pinned questions, in each tab's order ---------------------------------------------
select is(pg_temp.keys(pg_temp.o('save1')), array['answers', 'deadline_at', 'now', 'revision', 'state'],
  'a save answers with the sheet, its revision and the deadline only');
select is(pg_temp.o('save1') -> 'answers', pg_temp.sheet(1, 1, 1), 'the sheet is what was sent');
select is(pg_temp.leaks(pg_temp.o('save1')), '{}'::text[], 'and says nothing about correctness');
set local role service_role;
select is((select jsonb_build_object('state', r ->> 'state', 'revision', r -> 'revision')
  from (select pg_temp.save(1, 1, 1, 1, 0, pg_temp.sheet(1, 1, 1)) r) x),
  '{"state":"saved","revision":1}'::jsonb, 'a retried save is acknowledged, not applied twice');
select is((select jsonb_build_object('state', r ->> 'state', 'revision', r -> 'revision')
  from (select pg_temp.save(1, 1, 1, 0, 0, '{}') r) x), '{"state":"saved","revision":1}'::jsonb,
  'a sync changes nothing');
select is(pg_temp.save(1, 1, 1, 2, 1, pg_temp.choice(1, 2, true)) -> 'revision', '2', 'a newer change is applied');
select is((select jsonb_build_object('state', r ->> 'state', 'revision', r -> 'revision')
  from (select pg_temp.save(1, 1, 1, 1, 0, pg_temp.choice(1, 3, true)) r) x),
  '{"state":"stale","revision":2}'::jsonb, 'an older request of the same tab arriving late changes nothing');
select is(pg_temp.save(1, 1, 2, 1, 2, pg_temp.choice(1, 4, false)) -> 'answers',
  pg_temp.sheet(1, 1, 1) || pg_temp.choice(1, 2, true) || pg_temp.choice(1, 4, false),
  'a second tab''s change is laid over the sheet, keeping the first tab''s answers');
select throws_ok($$ select pg_temp.save(1, 1, 1, 9, 3, jsonb_build_object(pg_temp.q(1, 5), null)) $$, '22023', null,
  'a choice cannot be cleared');
select throws_ok($$ select pg_temp.save(1, 1, 1, 9, 3, jsonb_build_object(pg_temp.q(1, 5), 8)) $$, '22023', null,
  'a choice must be one of the question''s options');
select throws_ok($$ select pg_temp.save(1, 1, 1, 9, 3, jsonb_build_object(pg_temp.q(50, 0), 0)) $$, '22023', null,
  'a question outside the attempt is refused');
select throws_ok($$ select pg_temp.save(1, 1, 1, 9, 99, '{}') $$, '22023', null,
  'a sheet revision the database never issued is refused');
reset role;
update private.practice_policy set attempt_tabs = 2;
set local role service_role;
select is(pg_temp.save(1, 1, 3, 1, 3, pg_temp.choice(1, 5, true)) ->> 'state', 'too-many-tabs',
  'a tab beyond the attempt''s capacity is refused and applies nothing');
reset role;
update private.practice_policy set attempt_tabs = 16;
select is((pg_temp.row_of(1)).saved_revision, 3, 'three changes were applied in all');

-- 7. Submitting: graded once, from the sheet the database holds ----------------------------------------------------
set local role service_role;
insert into outcome values ('sub1', pg_temp.submit(1, 1, 1, 3, 3, pg_temp.choice(1, 6, true)));
reset role;
select is(pg_temp.o('sub1') -> 'attempt' -> 'result' #- '{finished_at}', '{"score":3,"total":50,"timed_out":false}'::jsonb,
  'the database grades the held sheet with the pending change: 3 right of 5 answered');
select is((select jsonb_build_object('status', status, 'score', score, 'answers', (select count(*) from public.quiz_attempt_answers
  where attempt_id = id), 'right', (select count(*) from public.quiz_attempt_answers where attempt_id = id and is_correct))
  from public.quiz_attempts where id = pg_temp.a(1)), '{"status":"submitted","score":3,"answers":5,"right":3}'::jsonb,
  'the stored attempt says the same, with one marked row per answered question');
select is((select array_agg(distinct pg_temp.keys(e)::text) from jsonb_array_elements(pg_temp.o('sub1') -> 'attempt' -> 'questions') e),
  array['{correct_option,explanation,item_id,options,prompt,question_id,revision,section,selected}'],
  'after grading each question carries its correct option, explanation, choice and managed identity for review and reports');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.o('sub1') -> 'attempt' -> 'questions') e
  where e -> 'selected' = e -> 'correct_option'), 3, 'the review agrees with the score');
set local role service_role;
select is(pg_temp.submit(1, 1, 1, 4, 4, pg_temp.choice(1, 7, true)) -> 'attempt' -> 'result',
  pg_temp.o('sub1') -> 'attempt' -> 'result', 'a second submission returns the first grading unchanged');
select is(pg_temp.save(1, 1, 1, 5, 4, pg_temp.choice(1, 7, true)) ->> 'state', 'graded',
  'and a late save changes nothing');
reset role;
select throws_ok($$ select private.practice_grade(pg_temp.a(1), '{}', 'submitted', clock_timestamp()) $$, '55000', null,
  'a graded attempt cannot be graded again');
select is(private.close_overdue_practice(pg_temp.u(1)), 0, 'and is not closed again');
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000001"}';
select is((select count(*)::integer from public.quiz_attempt_answers where attempt_id = pg_temp.a(1)), 5,
  'once graded, the owner can read their marked answers');
reset role;
-- Hand check: seven deliberately right and five deliberately wrong.
set local role service_role;
insert into outcome values ('h1', pg_temp.start(2, 30, '01'));
insert into outcome values ('h1-sub', pg_temp.submit(2, 30, 1, 1, 0, pg_temp.sheet(30, 7, 5)));
reset role;
select is(pg_temp.o('h1-sub') -> 'attempt' -> 'result' -> 'score', '7', 'seven right and five wrong score 7 of 50');
select is((select jsonb_build_object('right', count(*) filter (where e -> 'selected' = e -> 'correct_option'),
    'wrong', count(*) filter (where e -> 'selected' <> 'null' and e -> 'selected' <> e -> 'correct_option'),
    'blank', count(*) filter (where e -> 'selected' = 'null'))
  from jsonb_array_elements(pg_temp.o('h1-sub') -> 'attempt' -> 'questions') e),
  '{"right":7,"wrong":5,"blank":38}'::jsonb, 'the review marks each one as chosen and the rest unanswered');

-- 8. The deadline: graded on the next request or by the sweep, from answers saved in time ---------------------------
set local role service_role;
insert into outcome values ('d1', pg_temp.start(2, 31, '08'));
select is(pg_temp.save(2, 31, 1, 1, 0, pg_temp.choice(31, 0, true)) ->> 'state', 'saved', 'an answer saved in time');
reset role;
update public.quiz_attempts set created_at = created_at - interval '1 hour', deadline_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.a(31);
set local role service_role;
insert into outcome values ('d1-late', pg_temp.save(2, 31, 1, 2, 1, pg_temp.choice(31, 1, true)));
reset role;
select is(pg_temp.o('d1-late') ->> 'state', 'graded', 'a save after the deadline is not taken: the attempt is graded');
select is(pg_temp.o('d1-late') -> 'attempt' -> 'result' -> 'score', '1', 'from the sheet saved in time only');
select is((select jsonb_build_object('status', status, 'at_deadline', finished_at = deadline_at, 'saved', saved_revision)
  from public.quiz_attempts where id = pg_temp.a(31)), '{"status":"timed_out","at_deadline":true,"saved":1}'::jsonb,
  'timed out, as of the deadline, with the late change never written');
set local role service_role;
insert into outcome values ('d2', pg_temp.start(2, 32, '08'));
select is(pg_temp.save(2, 32, 1, 1, 0, pg_temp.sheet(32, 2, 0)) ->> 'state', 'saved', 'two answers saved in time');
reset role;
update public.quiz_attempts set created_at = created_at - interval '1 hour', deadline_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.a(32);
set local role service_role;
select is(pg_temp.submit(2, 32, 1, 2, 1, pg_temp.sheet(32, 5, 0)) -> 'attempt' -> 'result' #- '{finished_at}',
  '{"score":2,"total":50,"timed_out":true}'::jsonb, 'a submission after the deadline counts only the sheet saved in time');
insert into outcome values ('d3', pg_temp.start(2, 33, '08'));
select is(pg_temp.save(2, 33, 1, 1, 0, pg_temp.sheet(33, 3, 0)) ->> 'state', 'saved', 'three answers saved in time');
reset role;
update public.quiz_attempts set created_at = created_at - interval '1 hour', deadline_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.a(33);
set local role service_role;
select is((select jsonb_build_object('state', r ->> 'state', 'id', r -> 'attempt' ->> 'id', 'score', r -> 'attempt' -> 'score',
    'status', r -> 'attempt' -> 'status', 'bank_size', r -> 'attempt' -> 'bank_size')
  from (select public.practice_state(pg_temp.s(2), pg_temp.c('08')) r) x),
  jsonb_build_object('state', 'graded', 'id', pg_temp.a(33), 'score', 3, 'status', 'timed_out', 'bank_size', 100),
  'the student''s next request grades an overdue attempt before anything is shown');
insert into outcome values ('d4', pg_temp.start(2, 34, '01'));
select is(pg_temp.save(2, 34, 1, 1, 0, pg_temp.sheet(34, 1, 1)) ->> 'state', 'saved', 'a student who never returns');
reset role;
update public.quiz_attempts set created_at = created_at - interval '1 hour', deadline_at = clock_timestamp() - interval '1 second'
  where id = pg_temp.a(34);
select ok(private.close_overdue_practice_all() >= 1, 'the sweep closes overdue attempts');
select is((select jsonb_build_object('status', status, 'score', score) from public.quiz_attempts where id = pg_temp.a(34)),
  '{"status":"timed_out","score":1}'::jsonb, 'graded from the sheet saved in time');
select is(private.close_overdue_practice_all(), 0, 'a second sweep finds nothing to grade');

-- 9. Other students ------------------------------------------------------------------------------------------------
set local role service_role;
select is(public.practice_attempt(pg_temp.s(2), pg_temp.a(1)), '{"state":"not-found"}'::jsonb,
  'another student cannot open this attempt');
select is(public.practice_save(pg_temp.s(2), pg_temp.a(50), pg_temp.t(1), 1, 0, '{}'), '{"state":"not-found"}'::jsonb,
  'or save to it');
select is(public.practice_submit(pg_temp.s(2), pg_temp.a(51), pg_temp.t(1), 1, 0, '{}'), '{"state":"not-found"}'::jsonb,
  'or submit it');
select is(pg_temp.start(2, 51, '05', 40) ->> 'state', 'conflict', 'or claim its id with a start');
select is(pg_temp.start(2, 35, '07', p_intent => 'redo', p_redo => 1) ->> 'state', 'not-found',
  'or redo it');
select is(pg_temp.start(1, 36, '05', 40, p_intent => 'redo', p_redo => 51) ->> 'state', 'in-progress',
  'a redo while the course has an open attempt returns that attempt');

reset role;

-- 10. D3 over a 150-question bank, D4 over a 50-question bank ------------------------------------------------------
set local role service_role;
select is(pg_temp.start(2, 21, '07') ->> 'state', 'ready', 'a first attempt at the 150-question bank');
select is(pg_temp.submit(2, 21, 1, 0, 0, '{}') ->> 'state', 'graded', 'submitted');
select is(pg_temp.start(2, 22, '07') ->> 'state', 'ready', 'a second');
select is(pg_temp.submit(2, 22, 1, 0, 0, '{}') ->> 'state', 'graded', 'submitted');
select is(pg_temp.start(2, 23, '07') ->> 'state', 'ready', 'a third');
select is(pg_temp.submit(2, 23, 1, 0, 0, '{}') ->> 'state', 'graded', 'submitted');
select is(pg_temp.start(2, 24, '07') ->> 'state', 'ready', 'a fourth, with every question already given');
reset role;
select ok(not (pg_temp.qs(21) && pg_temp.qs(22)) and not (pg_temp.qs(21) && pg_temp.qs(23))
  and not (pg_temp.qs(22) && pg_temp.qs(23)), 'three attempts at 150 share no question: unseen questions come first');
select is((select count(distinct x)::integer from unnest(pg_temp.qs(21) || pg_temp.qs(22) || pg_temp.qs(23)) x), 150,
  'together they cover the bank');
select ok(not (pg_temp.qs(24) && pg_temp.qs(23)), 'once all are seen, the next avoids the previous attempt');
select is((pg_temp.row_of(30)).bank_size, 50, 'ENT211: the bank equals the attempt');
set local role service_role;
insert into outcome values ('e2', pg_temp.start(2, 37, '01'));
reset role;
select is((select array_agg(x order by x) from unnest(pg_temp.qs(37)) x), (select array_agg(x order by x) from unnest(pg_temp.qs(30)) x),
  'the same 50 questions');
select isnt(pg_temp.qs(37), pg_temp.qs(30), 'in a new order (D4)');

set local role service_role;
-- 11. Redo and Retake ----------------------------------------------------------------------------------------------
insert into outcome values ('r1', pg_temp.start(1, 10, '07', p_intent => 'redo', p_redo => 1));
reset role;
select is(pg_temp.o('r1') ->> 'state', 'ready', 'redo starts');
select is(pg_temp.qs(10), pg_temp.qs(1), 'with the same questions in the same order');
select is((select jsonb_build_object('intent', intent, 'redo_of', redo_of = pg_temp.a(1), 'saved', saved_answers)
  from public.quiz_attempts where id = pg_temp.a(10)), '{"intent":"redo","redo_of":true,"saved":null}'::jsonb,
  'as a new attempt with an empty sheet');
set local role service_role;
select is(pg_temp.submit(1, 10, 1, 0, 0, '{}') -> 'attempt' -> 'result' -> 'score', '0', 'an empty redo scores 0');
insert into outcome values ('t1', pg_temp.start(1, 11, '07'));
select is(pg_temp.submit(1, 11, 1, 0, 0, '{}') ->> 'state', 'graded', 'a retake starts and finishes');
reset role;
select ok(not (pg_temp.qs(11) && pg_temp.qs(1)), 'a retake gives questions not given before (D3)');
-- A question of the original that is unpublished or replaced stops Redo; nothing is created.
update public.managed_content_items set published_revision = null where question_id = (pg_temp.qs(11))[1];
set local role service_role;
select is(pg_temp.start(1, 12, '07', p_intent => 'redo', p_redo => 11), '{"state":"questions-changed"}'::jsonb,
  'a redo after one of its questions was unpublished is refused');
reset role;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
select i.id, 2, r.payload || '{"prompt":"Replaced wording"}', pg_temp.u(6)
from public.managed_content_items i join public.managed_content_revisions r on r.item_id = i.id and r.revision = 1
where i.question_id = (pg_temp.qs(1))[2];
update public.managed_content_items set current_revision = 2, approved_revision = 2, published_revision = 2
  where question_id = (pg_temp.qs(1))[2];
set local role service_role;
select is(pg_temp.start(1, 12, '07', p_intent => 'redo', p_redo => 1), '{"state":"questions-changed"}'::jsonb,
  'and so is a redo after one was replaced by a new revision');
reset role;
select is((select count(*)::integer from public.quiz_attempts where id = pg_temp.a(12)), 0, 'nothing was created');
set local role service_role;
select is((select r -> 'attempt' -> 'questions' -> 1 ->> 'prompt' from (select public.practice_attempt(pg_temp.s(1), pg_temp.a(1)) r) x),
  (select r -> 'attempt' -> 'questions' -> 1 ->> 'prompt' from (select pg_temp.o('s1') r) x),
  'a graded attempt still shows the revision the student saw');
reset role;

-- 12. Access ending mid-attempt: it finishes, and its review stays (D7) ---------------------------------------------
set local role service_role;
insert into outcome values ('x1', pg_temp.start(5, 40, '07'));
reset role;
update public.entitlement_grants set revoked_at = now(), revoked_by = 'test', revoke_reason = 'test'
  where user_id = pg_temp.u(5);
select ok(not private.can_read_course_content(pg_temp.u(5), pg_temp.c('07')), 'fixture: access has ended');
set local role service_role;
select is(public.practice_attempt(pg_temp.s(5), pg_temp.a(40)) ->> 'state', 'ready', 'the open attempt still resumes');
select is(pg_temp.save(5, 40, 1, 1, 0, pg_temp.sheet(40, 2, 0)) ->> 'state', 'saved', 'saves');
select is(pg_temp.submit(5, 40, 1, 1, 1, '{}') -> 'attempt' -> 'result' -> 'score', '2', 'and is graded');
select ok(public.practice_attempt(pg_temp.s(5), pg_temp.a(40)) -> 'attempt' -> 'questions' -> 0 ? 'correct_option',
  'its review stays open to the student');
select is(pg_temp.start(5, 41, '07') ->> 'state', 'locked', 'but no new attempt starts');
reset role;

-- 13. Legacy attempts (D6, D10) -------------------------------------------------------------------------------------
create temporary table legacy_pick on commit drop as
select question_id, revision, row_number() over (order by question_id) n
from (select question_id, revision from private.practice_pool(pg_temp.c('07')) order by question_id limit 2) p;
grant select on legacy_pick to service_role;
-- Stuck legacy attempts (two open, one over 24 hours old) and one finished legacy attempt that was given 100 of the
-- course's questions, all as old tabs left them.
insert into public.quiz_attempts (id, user_id, course_id, question_count, created_at, status, finished_at) values
  (pg_temp.a(60), pg_temp.u(7), pg_temp.c('07'), 1, now() - interval '30 days', 'in_progress', null),
  (pg_temp.a(61), pg_temp.u(7), pg_temp.c('07'), 1, now() - interval '25 hours', 'in_progress', null),
  (pg_temp.a(64), pg_temp.u(7), pg_temp.c('07'), 100, now() - interval '3 days', 'submitted', now() - interval '3 days');
insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
select a, p.question_id, 0, p.item_id, p.revision from unnest(array[pg_temp.a(60), pg_temp.a(61)]) a,
  (select * from private.practice_pool(pg_temp.c('07')) order by question_id limit 1) p;
insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
select pg_temp.a(64), p.question_id, (row_number() over (order by p.question_id) - 1)::integer, p.item_id, p.revision
from (select * from private.practice_pool(pg_temp.c('07')) order by question_id limit 100) p;
insert into public.quiz_attempt_answers (attempt_id, question_id, ordinal, option_index, is_correct, section_label)
select attempt_id, question_id, 0, 0, true, 'General' from public.quiz_attempt_questions
where attempt_id in (pg_temp.a(60), pg_temp.a(61));
set local role authenticated;
set local request.jwt.claims = '{"sub":"d1000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"d2000000-0000-4000-8000-000000000007"}';
select is((select count(*)::integer from public.quiz_attempt_answers), 0,
  'marked answers of open legacy attempts are hidden from their owner');
reset role;
set local role service_role;
select is(public.practice_state(pg_temp.s(7), pg_temp.c('07')) ->> 'state', 'none',
  'stuck legacy attempts are never offered for resume, nor shown as a result');
select is(pg_temp.start(7, 62, '07') ->> 'state', 'ready', 'and never block a new attempt');
reset role;
select ok(pg_temp.qs(62) && pg_temp.qs(64),
  'a legacy attempt does not count towards the draw: questions it gave can be drawn first (D3)');
set local role service_role;
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(63), pg_temp.c('07'), 2, 'start', null, 'in_progress',
  (select jsonb_agg(jsonb_build_object('question_id', question_id, 'ordinal', n - 1, 'content_revision', revision))
   from legacy_pick p)), '{"status":"conflict"}'::jsonb, 'an old-style start is refused (hard cutover)');
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(62), pg_temp.c('07'), 1, 'start', null, 'in_progress',
  jsonb_build_array(jsonb_build_object('question_id', (pg_temp.qs(62))[1], 'ordinal', 0, 'content_revision', 1))),
  '{"status":"conflict"}'::jsonb, 'including a replayed start naming a server-run attempt');
reset role;
select is((select count(*)::integer from public.quiz_attempts where id = pg_temp.a(63)), 0, 'nothing was pinned');
set local role service_role;
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(61), pg_temp.c('07'), 0, 'record', 0, 'in_progress',
  (select jsonb_build_array(jsonb_build_object('question_id', question_id, 'ordinal', 0, 'option_index', 1))
   from (select (pg_temp.qs(61))[1] question_id) q)), '{"status":"finalized"}'::jsonb,
  'an old tab cannot save a legacy attempt started more than 24 hours ago');
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(61), pg_temp.c('07'), 0, 'finish', 0, 'submitted', '[]'),
  '{"status":"finalized"}'::jsonb, 'or finish it');
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(62), pg_temp.c('07'), 0, 'finish', 0, 'submitted', '[]'),
  '{"status":"not-found"}'::jsonb, 'a server-run attempt cannot be written through the legacy path');
reset role;
-- A legacy attempt an old tab opened just before the cutover.
insert into public.quiz_attempts (id, user_id, course_id, question_count) values (pg_temp.a(63), pg_temp.u(7), pg_temp.c('07'), 2);
insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
select pg_temp.a(63), p.question_id, (l.n - 1)::integer, p.item_id, p.revision
from legacy_pick l join private.practice_pool(pg_temp.c('07')) p on p.question_id = l.question_id;
create temporary table legacy_choice on commit drop as
select q.question_id, q.ordinal, (r.payload ->> 'correctOption')::integer right_option,
  ((r.payload ->> 'correctOption')::integer + 1) % jsonb_array_length(r.payload -> 'options') wrong_option
from public.quiz_attempt_questions q join public.managed_content_revisions r on r.item_id = q.item_id
  and r.revision = q.content_revision where q.attempt_id = pg_temp.a(63);
grant select on legacy_choice to service_role;
set local role service_role;
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(63), pg_temp.c('07'), 0, 'record', 0, 'in_progress',
  (select jsonb_agg(jsonb_build_object('question_id', question_id, 'ordinal', ordinal,
    'option_index', case when ordinal = 0 then right_option else wrong_option end)) from legacy_choice)) ->> 'status',
  'saved', 'an old tab still saves a legacy attempt younger than 24 hours');
select is(public.write_quiz_attempt(pg_temp.s(7), pg_temp.a(63), pg_temp.c('07'), 0, 'finish', 1, 'submitted', '[]') ->> 'status',
  'saved', 'and finishes it');
reset role;
select is((select jsonb_build_object('status', status, 'score', score) from public.quiz_attempts where id = pg_temp.a(63)),
  '{"status":"submitted","score":1}'::jsonb, 'its stored score is computed by the server: one right of two');

-- 14. Signed out -----------------------------------------------------------------------------------------------------
delete from auth.sessions where id = pg_temp.s(3);
set local role service_role;
select is(public.practice_state(pg_temp.s(3), pg_temp.c('08')), '{"state":"signed-out"}'::jsonb,
  'a removed session is signed out');
select is(public.practice_save(pg_temp.s(3), pg_temp.a(4), pg_temp.t(1), 1, 0, '{}'), '{"state":"signed-out"}'::jsonb,
  'and cannot save');
reset role;

-- 15. A fresh start is judged on the wall clock, after its locks ------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', pg_temp.u(8), 'authenticated', 'authenticated', 'practice-8@example.test',
  'x', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at) values (pg_temp.s(8), pg_temp.u(8), now(), now());
insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)
values (pg_temp.u(8), 'manual', now() - interval '1 day', clock_timestamp() + interval '1 second', 'none', 'test');
select pg_sleep(1.2);
select ok(private.can_read_course_content(pg_temp.u(8), pg_temp.c('07')),
  'fixture: at the transaction''s start time the grant still reads as active');
set local role service_role;
select is(pg_temp.start(8, 70, '07'), '{"state":"locked"}'::jsonb,
  'but a start after it ended, on the wall clock, is locked');
reset role;
select is((select count(*)::integer from public.quiz_attempts where user_id = pg_temp.u(8)), 0, 'and creates nothing');
update auth.sessions set not_after = clock_timestamp() - interval '1 second' where id = pg_temp.s(1);
set local role service_role;
select is(pg_temp.start(1, 71, '08'), '{"state":"signed-out"}'::jsonb, 'a session that has ended starts nothing');
reset role;
update auth.sessions set not_after = null where id = pg_temp.s(1);

-- 16. Results stay the student's: reload after a lost response, after access ends, after the bank changes ----------
set local role service_role;
select is((select jsonb_build_object('state', r ->> 'state', 'id', r -> 'attempt' ->> 'id', 'score', r -> 'attempt' -> 'score')
  from (select public.practice_state(pg_temp.s(1), pg_temp.c('07')) r) x),
  jsonb_build_object('state', 'graded', 'id', pg_temp.a(11), 'score', 0),
  'with no open attempt, the course state is the most recent graded attempt, so a reload shows its result');
reset role;
update public.managed_content_items set published_revision = null where course_id = pg_temp.c('07') and kind = 'cbt_question';
set local role service_role;
insert into outcome values ('x1-late', public.practice_attempt(pg_temp.s(5), pg_temp.a(40)));
reset role;
select is((select jsonb_build_object('state', r ->> 'state', 'score', r -> 'attempt' -> 'result' -> 'score',
    'bank_size', r -> 'attempt' -> 'bank_size', 'questions', jsonb_array_length(r -> 'attempt' -> 'questions'),
    'keyed', (select count(*) from jsonb_array_elements(r -> 'attempt' -> 'questions') e
      where e ? 'correct_option' and e ->> 'prompt' <> ''))
  from (select pg_temp.o('x1-late') r) x),
  '{"state":"graded","score":2,"bank_size":149,"questions":50,"keyed":50}'::jsonb,
  'after access ended and the whole bank was unpublished, the owner still opens the full graded review by id, with the bank size at its start (149: one question was withdrawn in section 11)');
set local role service_role;
select is(public.practice_state(pg_temp.s(5), pg_temp.c('07')) -> 'attempt' ->> 'id', pg_temp.a(40)::text,
  'and the course state still leads to it');
select is(pg_temp.start(1, 72, '07') ->> 'state', 'unavailable', 'while a fresh start finds nothing to draw');
reset role;

select * from finish();
rollback;
