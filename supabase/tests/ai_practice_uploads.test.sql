-- supabase/tests/ai_practice_uploads.test.sql — Ownership, direct-call abuse, extraction leases, allowance accounting,
-- Account lifecycle and purge, retention and Storage policy for AI practice.
begin;
select no_plan();

-- Structure and deny-by-default access ---------------------------------------
select has_table('public', 'ai_practice_documents', 'documents table exists');
select has_table('public', 'ai_practice_generations', 'generations table exists');
select has_table('public', 'ai_usage_events', 'shared AI usage ledger exists');
select has_table('public', 'ai_allowance_windows', 'allowance window table exists');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.ai_practice_documents'::regclass,
  'public.ai_practice_generations'::regclass, 'public.ai_usage_events'::regclass,
  'public.ai_allowance_windows'::regclass)), 'RLS is enabled on every AI practice table');
select ok((select bool_and(confdeltype = 'c') from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass
  and conrelid in ('public.ai_practice_documents'::regclass, 'public.ai_practice_generations'::regclass,
    'public.ai_usage_events'::regclass, 'public.ai_allowance_windows'::regclass)),
  'account deletion cascades through every owned AI row');
select ok(not has_table_privilege('anon', 'public.ai_practice_documents', 'SELECT')
  and not has_table_privilege('anon', 'public.ai_practice_generations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ai_practice_documents', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ai_practice_documents', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_practice_generations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.ai_practice_generations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.ai_usage_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.ai_allowance_windows', 'SELECT')
  and not has_table_privilege('service_role', 'public.ai_usage_events', 'UPDATE'),
  'students cannot write documents, sets or the ledger directly');
select is((select count(*)::integer from unnest(array[
    'public.create_ai_practice_document(uuid,uuid,text,text,integer,text[])',
    'public.claim_ai_practice_extraction(uuid,uuid)',
    'public.settle_ai_practice_document(uuid,uuid,uuid,text,text,text,integer)',
    'public.release_ai_practice_extraction(uuid,uuid,uuid)',
    'public.note_ai_practice_upload_removed(uuid,uuid)',
    'public.begin_ai_practice_generation(uuid,uuid,uuid,text[])',
    'public.finish_ai_practice_generation(uuid,uuid,text,text,jsonb,jsonb)',
    'public.list_ai_practice_uploads_to_remove(integer)', 'public.list_ai_practice_purge_blockers(integer)',
    'public.purge_expired_ai_practice()', 'public.issue_ai_allowance_grant(uuid,text,integer,integer)']) fn
  where has_function_privilege('authenticated', fn, 'EXECUTE') or has_function_privilege('anon', fn, 'EXECUTE')
    or not has_function_privilege('service_role', fn, 'EXECUTE')), 0,
  'reservation, extraction settlement, accounting, grants and cleanup are service-role only');
select is((select count(*)::integer from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('create_ai_practice_document', 'settle_ai_practice_document', 'note_ai_practice_upload_removed',
    'begin_ai_practice_generation')), 4, 'no student-callable overload of a writing function exists');
select ok(has_function_privilege('authenticated', 'public.get_my_ai_allowance()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_my_ai_allowance()', 'EXECUTE'),
  'only signed-in students read their allowance');
select ok(not has_function_privilege('authenticated', 'private.ai_practice_session_user(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.ai_practice_session_user(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.ai_allowance_admission(uuid,text[])', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.ai_practice_removable_uploads()', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.ai_practice_upload_is_open(text)', 'EXECUTE'),
  'private helpers are not callable, except the slot check the Storage insert policy uses');
select is((select public from storage.buckets where id = 'ai-practice-uploads'), false, 'upload bucket is private');
select is((select file_size_limit from storage.buckets where id = 'ai-practice-uploads'), 5242880::bigint,
  'Storage enforces the 5 MB file limit');

-- Fixtures: A and B are ordinary students; C is scheduled for deletion later. ---------
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '21111111-1111-4111-8111-111111111111',
   'authenticated', 'authenticated', 'ai-a@example.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222',
   'authenticated', 'authenticated', 'ai-b@example.test', 'x', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '23333333-3333-4333-8333-333333333333',
   'authenticated', 'authenticated', 'ai-c@example.test', 'x', now(), '{}', '{}', now(), now());
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('a1111111-1111-4111-8111-111111111111', '21111111-1111-4111-8111-111111111111', now(), now(), null),
  ('a0000000-0000-4000-8000-00000000000e', '21111111-1111-4111-8111-111111111111', now(), now(), now() - interval '1 minute'),
  ('b2222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222', now(), now(), null),
  ('c3333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333333', now(), now(), null);
create temporary table fixture (key text primary key, value uuid) on commit drop;
grant all on fixture to authenticated, service_role;
insert into fixture values ('course', (select id from public.institutional_courses order by id limit 1));
create temporary table outcome (step text primary key, result jsonb) on commit drop;
grant all on outcome to authenticated, service_role;

-- Direct-call abuse: a student holding their own live JWT ---------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"21111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1111111-1111-4111-8111-111111111111"}';
select throws_ok($$ select public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'notes.txt', 'text/plain', 10, array['trial']) $$,
  '42501', null, 'a student cannot reserve an upload slot directly');
select throws_ok($$ select public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111', gen_random_uuid()) $$,
  '42501', null, 'a student cannot claim an extraction directly');
select throws_ok($$ select public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111', gen_random_uuid(),
  gen_random_uuid(), null, 'fabricated text', repeat('a', 64), 2) $$,
  '42501', null, 'a student cannot submit a fabricated extraction outcome');
select throws_ok($$ select public.release_ai_practice_extraction('21111111-1111-4111-8111-111111111111',
  gen_random_uuid(), gen_random_uuid()) $$, '42501', null, 'a student cannot release a claim');
select throws_ok($$ select public.note_ai_practice_upload_removed('21111111-1111-4111-8111-111111111111', gen_random_uuid()) $$,
  '42501', null, 'a student cannot mark an upload removed');
select throws_ok($$ select public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111', gen_random_uuid(),
  gen_random_uuid(), array['trial', 'early_access', 'test']) $$, '42501', null, 'a student cannot start a generation');
select throws_ok($$ select public.finish_ai_practice_generation('21111111-1111-4111-8111-111111111111', gen_random_uuid(),
  'failed', null, null, null) $$, '42501', null, 'a student cannot settle a generation');
select throws_ok($$ select public.issue_ai_allowance_grant('21111111-1111-4111-8111-111111111111', 'trial') $$,
  '42501', null, 'a student cannot grant themselves AI access');
select throws_ok($$ select public.purge_expired_ai_practice() $$, '42501', null, 'a student cannot run the purge');
select throws_ok($$ insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name,
  media_type, declared_bytes, expires_at) select gen_random_uuid(), '21111111-1111-4111-8111-111111111111', value, 'x', 'n.txt',
  'text/plain', 1, now() + interval '1 day' from fixture where key = 'course' $$, '42501', null,
  'a student cannot insert a document row');
reset role;

-- Reservation: identity from the session, and only with an accepted grant -----------------
set local role service_role;
select is((public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'notes.txt', 'text/plain', 10, array['trial', 'early_access'])
  ->> 'status'), 'not-entitled', 'without a grant no upload slot is reserved');
reset role;
select is((select count(*)::integer from public.ai_practice_documents) + (select count(*)::integer
  from public.ai_allowance_windows), 0, 'a refused reservation creates nothing and never starts a trial');
set local role service_role;
select is((public.issue_ai_allowance_grant('21111111-1111-4111-8111-111111111111', 'trial') ->> 'state'), 'issued',
  'trusted server code issues the trial grant');
select is((public.create_ai_practice_document(gen_random_uuid(), (select value from fixture where key = 'course'),
  'notes.txt', 'text/plain', 10, array['trial']) ->> 'status'), 'signed-out', 'an unknown session reserves nothing');
select is((public.create_ai_practice_document('a0000000-0000-4000-8000-00000000000e',
  (select value from fixture where key = 'course'), 'notes.txt', 'text/plain', 10, array['trial']) ->> 'status'),
  'signed-out', 'an expired session reserves nothing');
select is((public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111', gen_random_uuid(), 'notes.pdf',
  'application/pdf', 100, array['trial']) ->> 'status'), 'invalid-course', 'an unknown course cannot own an upload');
select throws_ok($$ select public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'notes.exe', 'application/x-msdownload', 100, array['trial']) $$,
  '23514', null, 'unsupported media types are refused');
select throws_ok($$ select public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'big.pdf', 'application/pdf', 5242881, array['trial']) $$,
  '23514', null, 'declared size above 5 MB is refused');
select throws_ok($$ select public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'n.txt', 'text/plain', 1, array['anything']) $$,
  '22023', null, 'unknown grant sources are refused');
insert into fixture select 'doc_a', (public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'notes.txt', 'text/plain', 2048, array['trial', 'early_access'])
  ->> 'document_id')::uuid;
select is((public.issue_ai_allowance_grant('22222222-2222-4222-8222-222222222222', 'test', 3, 1) ->> 'state'), 'issued',
  'a controlled test grant can be issued');
select is((public.create_ai_practice_document('b2222222-2222-4222-8222-222222222222',
  (select value from fixture where key = 'course'), 'n.txt', 'text/plain', 1, array['trial', 'early_access']) ->> 'status'),
  'not-entitled', 'production never honours a test grant at reservation');
reset role;
select is((select storage_path from public.ai_practice_documents where id = (select value from fixture where key = 'doc_a')),
  '21111111-1111-4111-8111-111111111111/' || (select value from fixture where key = 'doc_a'),
  'the object path is derived from the session owner and document id');

-- Storage admission: only the reserved path of a live, unclaimed slot inside its window ---------
set local role service_role;
insert into fixture select 'doc_claimed', (public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'c.txt', 'text/plain', 10, array['trial']) ->> 'document_id')::uuid;
insert into fixture select 'doc_old', (public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'o.txt', 'text/plain', 10, array['trial']) ->> 'document_id')::uuid;
select is((public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_claimed')) ->> 'state'), 'claimed', 'a slot can be claimed for extraction');
reset role;
update public.ai_practice_documents set created_at = now() - interval '61 minutes'
  where id = (select value from fixture where key = 'doc_old');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1111111-1111-4111-8111-111111111111"}';
insert into storage.objects (bucket_id, name)
  values ('ai-practice-uploads', (select '21111111-1111-4111-8111-111111111111/' || value from fixture where key = 'doc_a'));
select pass('the owner can write the reserved object');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('ai-practice-uploads', '21111111-1111-4111-8111-111111111111/' || gen_random_uuid()) $$,
  '42501', null, 'an unreserved path in the owner folder is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name)
  values ('ai-practice-uploads', '22222222-2222-4222-8222-222222222222/' || gen_random_uuid()) $$,
  '42501', null, 'another student folder is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('ai-practice-uploads',
  (select '21111111-1111-4111-8111-111111111111/' || value from fixture where key = 'doc_claimed')) $$,
  '42501', null, 'a slot already claimed for extraction accepts no new file');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('ai-practice-uploads',
  (select '21111111-1111-4111-8111-111111111111/' || value from fixture where key = 'doc_old')) $$,
  '42501', null, 'a slot past its upload window accepts no new file');
reset role;

-- Extraction lease: one holder, takeover only after expiry, settlement only by the holder ----------
set local role service_role;
insert into outcome values ('claim_a', public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a')));
select is((select result ->> 'state' from outcome where step = 'claim_a'), 'claimed', 'the first caller claims the upload');
select is((public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a')) ->> 'state'), 'busy', 'a competing caller is told it is busy');
select is((public.claim_ai_practice_extraction('b2222222-2222-4222-8222-222222222222',
  (select value from fixture where key = 'doc_a')) ->> 'state'), 'not-found', 'another student cannot claim it');
select is(public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a'), gen_random_uuid(), 'corrupt', null, null, null), false,
  'a caller without the claim cannot settle');
select is(public.settle_ai_practice_document('b2222222-2222-4222-8222-222222222222',
  (select value from fixture where key = 'doc_a'), (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_a'),
  'corrupt', null, null, null), false, 'another student session cannot settle even with the claim id');
select throws_ok($$ select public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a'), (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_a'),
  null, 'extracted text', repeat('a', 64), 2) $$, '22023', null, 'stored text must match its digest');
select throws_ok($$ select public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a'), (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_a'),
  'corrupt', 'text', null, null) $$, '22023', null, 'rejection and text are mutually exclusive');
select is(public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a'), (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_a'),
  null, 'extracted text', encode(sha256(convert_to('extracted text', 'UTF8')), 'hex'), 2), true,
  'the claim holder settles extraction once');
select is((public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a')) ->> 'state'), 'settled', 'a settled upload cannot be claimed again');
select is(public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_a'), (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_a'),
  'corrupt', null, null, null), false, 'a settled document cannot be settled again');
reset role;
select ok((select extraction_claim is null and status = 'ready' from public.ai_practice_documents
  where id = (select value from fixture where key = 'doc_a')), 'settling clears the claim');

-- A crashed extraction: its lease expires and is taken over; the stale holder is shut out.
set local role service_role;
insert into fixture select 'doc_lease', (public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'l.txt', 'text/plain', 10, array['trial']) ->> 'document_id')::uuid;
insert into outcome values ('crashed', public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_lease')));
reset role;
select ok((select extraction_claimed_until between now() + interval '119 seconds' and now() + interval '121 seconds'
  from public.ai_practice_documents where id = (select value from fixture where key = 'doc_lease')),
  'the lease runs for the policy duration (120 s)');
update public.ai_practice_documents set extraction_claimed_until = now() - interval '1 second'
  where id = (select value from fixture where key = 'doc_lease');
set local role service_role;
insert into outcome values ('takeover', public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_lease')));
select is((select result ->> 'state' from outcome where step = 'takeover'), 'claimed', 'an expired lease is taken over');
select isnt((select result ->> 'claim_id' from outcome where step = 'takeover'),
  (select result ->> 'claim_id' from outcome where step = 'crashed'), 'the takeover holds a new claim');
select is(public.settle_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_lease'), (select (result ->> 'claim_id')::uuid from outcome where step = 'crashed'),
  'corrupt', null, null, null), false, 'the crashed holder can no longer settle');
select is(public.release_ai_practice_extraction('21111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_lease'), (select (result ->> 'claim_id')::uuid from outcome where step = 'crashed')),
  false, 'the crashed holder cannot release the new claim');
select is(public.release_ai_practice_extraction('21111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_lease'), (select (result ->> 'claim_id')::uuid from outcome where step = 'takeover')),
  true, 'the holder releases early after an outage');
select is((public.claim_ai_practice_extraction('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'doc_lease')) ->> 'state'), 'claimed', 'a released upload can be claimed at once');
reset role;

-- RLS for reads -------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"21111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a1111111-1111-4111-8111-111111111111"}';
select is((public.get_my_ai_allowance() ->> 'state'), 'active', 'the owner reads their allowance');
select ok((select count(*) from public.ai_practice_documents) >= 4, 'the owner reads their documents');
set local request.jwt.claims = '{"sub":"21111111-1111-4111-8111-111111111111","role":"authenticated","session_id":"a9999999-9999-4999-8999-999999999999"}';
select is((select count(*)::integer from public.ai_practice_documents), 0, 'a revoked session cannot read documents');
select is((select count(*)::integer from storage.objects where bucket_id = 'ai-practice-uploads'), 0,
  'a revoked session cannot read upload objects');
select throws_ok($$ select public.get_my_ai_allowance() $$, '42501', null, 'a revoked session cannot read allowance');
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","session_id":"b2222222-2222-4222-8222-222222222222"}';
select is((select count(*)::integer from public.ai_practice_documents), 0, 'documents are owner-only');
select is((select count(*)::integer from storage.objects where bucket_id = 'ai-practice-uploads'), 0,
  'upload objects are owner-only');
select is((public.get_my_ai_allowance() ->> 'source'), 'test', 'the allowance view names the grant source');
reset role;

-- Generation admission: identity from the session --------------------------------------
update private.ai_practice_policy set trial_units = 2;
update public.ai_allowance_windows set total_units = 2 where user_id = '21111111-1111-4111-8111-111111111111';
set local role service_role;
select is((public.begin_ai_practice_generation(gen_random_uuid(), gen_random_uuid(),
  (select value from fixture where key = 'doc_a'), array['trial']) ->> 'state'), 'signed-out',
  'an unknown session cannot start a generation');
select is((public.begin_ai_practice_generation('a0000000-0000-4000-8000-00000000000e', gen_random_uuid(),
  (select value from fixture where key = 'doc_a'), array['trial']) ->> 'state'), 'signed-out',
  'an expired session cannot start a generation');
select throws_ok($$ select public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  gen_random_uuid(), (select value from fixture where key = 'doc_a'), array[]::text[]) $$, '22023', null,
  'admission requires at least one accepted grant source');
select is((public.begin_ai_practice_generation('b2222222-2222-4222-8222-222222222222',
  '3bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', (select value from fixture where key = 'doc_a'),
  array['trial', 'early_access']) ->> 'state'), 'not-entitled', 'production never honours a test grant');
select is((public.begin_ai_practice_generation('b2222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', (select value from fixture where key = 'doc_a'),
  array['trial', 'early_access', 'test']) ->> 'state'),
  'document-unavailable', 'a student cannot generate from another student document');
insert into outcome values ('first', public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']));
select is((select result ->> 'state' from outcome where step = 'first'), 'started', 'a generation starts');
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '31111111-1111-4111-8111-111111111111', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']) ->> 'state'),
  'existing', 'replaying the same request id is idempotent');
reset role;
select is((select count(*)::integer from public.ai_usage_events where user_id = '21111111-1111-4111-8111-111111111111'), 1,
  'a replay reserves no second unit');
set local role service_role;
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '32222222-2222-4222-8222-222222222222', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']) ->> 'state'),
  'busy', 'only one generation runs per student');

-- A failure releases the reservation.
select is((public.finish_ai_practice_generation('21111111-1111-4111-8111-111111111111',
  (select (result ->> 'generation_id')::uuid from outcome where step = 'first'), 'failed', 'timeout', null,
  '{"provider":"anthropic","model":"claude-sonnet-5-5","inputTokens":10,"outputTokens":0,"estimatedCostUsd":0.00002}'))
  ->> 'state', 'finished', 'a failed generation finishes');
reset role;
select is((select state from public.ai_usage_events where id = (select usage_event_id
  from public.ai_practice_generations where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'first'))),
  'released', 'failed generation does not consume allowance');
select is((select cost_usd from public.ai_usage_events where id = (select usage_event_id
  from public.ai_practice_generations where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'first'))),
  0.00002::numeric, 'provider cost is still recorded for a failed generation');
set local role service_role;
select is((public.finish_ai_practice_generation('21111111-1111-4111-8111-111111111111',
  (select (result ->> 'generation_id')::uuid from outcome where step = 'first'), 'failed', 'timeout', null, null))
  ->> 'state', 'already-finished', 'finishing twice is a no-op');

-- A committed success replays without a second charge: the lost-response case.
insert into outcome values ('second', public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '34444444-4444-4444-8444-444444444444', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']));
select throws_ok($$ select public.finish_ai_practice_generation('21111111-1111-4111-8111-111111111111',
  (select (result ->> 'generation_id')::uuid from outcome where step = 'second'), 'generated', null,
  '{"formatVersion":1,"origin":"ai-generated","visibility":"public","verification":"verified","questions":[{}]}', null) $$,
  '22023', null, 'a set claiming to be public or verified is refused');
select is((public.finish_ai_practice_generation('21111111-1111-4111-8111-111111111111',
  (select (result ->> 'generation_id')::uuid from outcome where step = 'second'), 'generated', null,
  '{"formatVersion":1,"origin":"ai-generated","visibility":"personal","verification":"unverified","questions":[{}]}', null))
  ->> 'state', 'finished', 'a personal set is stored');
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '34444444-4444-4444-8444-444444444444', (select value from fixture where key = 'doc_a'), array['trial', 'early_access'])
  ->> 'generation_id'), (select result ->> 'generation_id' from outcome where step = 'second'),
  'replaying a committed request returns the original generation');
reset role;
select is((select count(*)::integer from public.ai_usage_events
  where user_id = '21111111-1111-4111-8111-111111111111' and state = 'consumed'), 1, 'the replay is not charged again');

-- A crashed generation: its stale reservation is released before the replay check.
set local role service_role;
insert into outcome values ('stale', public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '39999999-9999-4999-8999-999999999999', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']));
reset role;
update public.ai_practice_generations set created_at = now() - interval '6 minutes'
  where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'stale');
set local role service_role;
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '39999999-9999-4999-8999-999999999999', (select value from fixture where key = 'doc_a'), array['trial', 'early_access'])
  ->> 'status'), 'failed', 'replaying a crashed request reports it closed, not running');
reset role;
select is((select state from public.ai_usage_events where id = (select usage_event_id from public.ai_practice_generations
  where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'stale'))), 'released',
  'the crashed request released its reservation');

-- The fixed total then stops further requests.
set local role service_role;
insert into outcome values ('third', public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '35555555-5555-4555-8555-555555555555', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']));
select is((public.finish_ai_practice_generation('21111111-1111-4111-8111-111111111111',
  (select (result ->> 'generation_id')::uuid from outcome where step = 'third'), 'generated', null,
  '{"formatVersion":1,"origin":"ai-generated","visibility":"personal","verification":"unverified","questions":[{}]}', null))
  ->> 'state', 'finished', 'second success is stored');
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '36666666-6666-4666-8666-666666666666', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']) ->> 'state'),
  'allowance-exhausted', 'the fixed trial total is enforced');
select is((public.create_ai_practice_document('a1111111-1111-4111-8111-111111111111',
  (select value from fixture where key = 'course'), 'n.txt', 'text/plain', 1, array['trial']) ->> 'status'),
  'allowance-exhausted', 'a spent grant reserves no new upload slot');
reset role;

-- The window is a fixed seven-day total, not a daily reset.
update public.ai_allowance_windows set starts_at = now() - interval '2 days', ends_at = now() + interval '5 days'
  where user_id = '21111111-1111-4111-8111-111111111111';
update public.ai_usage_events set reserved_at = now() - interval '1 day 1 hour'
  where user_id = '21111111-1111-4111-8111-111111111111';
set local role service_role;
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '37777777-7777-4777-8777-777777777777', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']) ->> 'state'),
  'allowance-exhausted', 'a new day does not restore consumed allowance');
reset role;
update public.ai_allowance_windows set ends_at = now() - interval '1 second', starts_at = now() - interval '7 days'
  where user_id = '21111111-1111-4111-8111-111111111111';
update private.ai_practice_policy set trial_units = 10;
update public.ai_allowance_windows set total_units = 10 where user_id = '21111111-1111-4111-8111-111111111111';
set local role service_role;
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '38888888-8888-4888-8888-888888888888', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']) ->> 'state'),
  'allowance-expired', 'the window closes after seven days even with units left');
reset role;

-- The global daily cap holds.
update public.ai_allowance_windows set ends_at = now() + interval '1 day' where user_id = '21111111-1111-4111-8111-111111111111';
update private.ai_practice_policy set global_daily_generations = 0;
set local role service_role;
select is((public.begin_ai_practice_generation('a1111111-1111-4111-8111-111111111111',
  '3aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', (select value from fixture where key = 'doc_a'), array['trial', 'early_access']) ->> 'state'),
  'capacity', 'the platform daily cap stops new generations');
reset role;
update private.ai_practice_policy set global_daily_generations = 500;

-- Account lifecycle: logout, scheduling and a generation in flight -------------------------
delete from auth.sessions where id = 'b2222222-2222-4222-8222-222222222222';
set local role service_role;
select is((public.begin_ai_practice_generation('b2222222-2222-4222-8222-222222222222', gen_random_uuid(),
  gen_random_uuid(), array['trial', 'early_access', 'test']) ->> 'state'), 'signed-out',
  'after logout the session admits nothing');
select is((public.issue_ai_allowance_grant('23333333-3333-4333-8333-333333333333', 'trial') ->> 'state'), 'issued',
  'C holds a trial grant');
insert into fixture select 'doc_c', (public.create_ai_practice_document('c3333333-3333-4333-8333-333333333333',
  (select value from fixture where key = 'course'), 'c.txt', 'text/plain', 10, array['trial']) ->> 'document_id')::uuid;
insert into fixture select 'doc_c2', (public.create_ai_practice_document('c3333333-3333-4333-8333-333333333333',
  (select value from fixture where key = 'course'), 'c2.txt', 'text/plain', 10, array['trial']) ->> 'document_id')::uuid;
insert into outcome values ('claim_c', public.claim_ai_practice_extraction('c3333333-3333-4333-8333-333333333333',
  (select value from fixture where key = 'doc_c')));
select ok(public.settle_ai_practice_document('c3333333-3333-4333-8333-333333333333', (select value from fixture where key = 'doc_c'),
  (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_c'), null, 'c text',
  encode(sha256(convert_to('c text', 'UTF8')), 'hex'), 2), 'C settles a document');
insert into outcome values ('claim_c2', public.claim_ai_practice_extraction('c3333333-3333-4333-8333-333333333333',
  (select value from fixture where key = 'doc_c2')));
insert into outcome values ('running_c', public.begin_ai_practice_generation('c3333333-3333-4333-8333-333333333333',
  gen_random_uuid(), (select value from fixture where key = 'doc_c'), array['trial']));
select is((select result ->> 'state' from outcome where step = 'running_c'), 'started', 'C has a generation in flight');
reset role;
-- Scheduling as the Account RPC records it, keeping the session row so only the job decides.
insert into private.account_deletion_jobs (user_id, requested_at, deadline, retry_at)
  values ('23333333-3333-4333-8333-333333333333', now(), now() + interval '720 hours', now() + interval '720 hours');
set local role service_role;
select is((public.begin_ai_practice_generation('c3333333-3333-4333-8333-333333333333', gen_random_uuid(),
  (select value from fixture where key = 'doc_c'), array['trial']) ->> 'state'), 'signed-out',
  'a deletion-scheduled account admits no generation even with a live session row');
select is((public.create_ai_practice_document('c3333333-3333-4333-8333-333333333333',
  (select value from fixture where key = 'course'), 'n.txt', 'text/plain', 1, array['trial']) ->> 'status'),
  'signed-out', 'a deletion-scheduled account reserves no upload');
select is((public.claim_ai_practice_extraction('c3333333-3333-4333-8333-333333333333',
  (select value from fixture where key = 'doc_c2')) ->> 'state'), 'signed-out', 'a deletion-scheduled account claims nothing');
select is(public.settle_ai_practice_document('c3333333-3333-4333-8333-333333333333', (select value from fixture where key = 'doc_c2'),
  (select (result ->> 'claim_id')::uuid from outcome where step = 'claim_c2'), 'corrupt', null, null, null), false,
  'an extraction claimed before scheduling cannot settle after it');
select is((public.finish_ai_practice_generation('23333333-3333-4333-8333-333333333333',
  (select (result ->> 'generation_id')::uuid from outcome where step = 'running_c'), 'generated', null,
  '{"formatVersion":1,"origin":"ai-generated","visibility":"personal","verification":"unverified","questions":[{}]}', null)
  ->> 'status'), 'failed', 'a generation finishing after scheduling is closed, not delivered');
reset role;
select ok((select status = 'failed' and outcome_reason = 'account-restricted' and question_set is null
  from public.ai_practice_generations where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'running_c')),
  'no set is stored for a scheduled account');
select is((select state from public.ai_usage_events where user_id = '23333333-3333-4333-8333-333333333333'), 'released',
  'and nothing is charged for it');
set local role authenticated;
set local request.jwt.claims = '{"sub":"23333333-3333-4333-8333-333333333333","role":"authenticated","session_id":"c3333333-3333-4333-8333-333333333333"}';
select is((select count(*)::integer from public.ai_practice_documents) + (select count(*)::integer
  from public.ai_practice_generations), 0, 'a scheduled account reads no AI rows');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('ai-practice-uploads',
  (select '23333333-3333-4333-8333-333333333333/' || value from fixture where key = 'doc_c2')) $$,
  '42501', null, 'a scheduled account cannot sign a new upload');
reset role;

-- Account purge with AI Storage present -----------------------------------------------
-- A signed upload URL issued before scheduling bypasses RLS when used; Storage records the owner. Two such
-- objects: one at C's reserved path, one orphan with no row at all.
insert into storage.objects (bucket_id, name, owner, owner_id, created_at) values
  ('ai-practice-uploads', (select '23333333-3333-4333-8333-333333333333/' || value from fixture where key = 'doc_c2'),
    '23333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333333', now()),
  ('ai-practice-uploads', '23333333-3333-4333-8333-333333333333/' || gen_random_uuid(),
    '23333333-3333-4333-8333-333333333333', '23333333-3333-4333-8333-333333333333', now());
set local role service_role;
select ok((select bool_and(name like '23333333-3333-4333-8333-333333333333/%')
  from public.list_ai_practice_uploads_to_remove(2) name), 'objects blocking an Account purge are swept first');
select is((select count(*)::integer from public.list_ai_practice_uploads_to_remove(100) name
  where name like '23333333-3333-4333-8333-333333333333/%'), 2,
  'a scheduled account''s reserved-path and orphaned objects are both listed for removal');
select is(public.list_ai_practice_purge_blockers(1) ->> 'remaining', '2',
  'the worker pre-step counts every object blocking the purge');
select is(jsonb_array_length(public.list_ai_practice_purge_blockers(1) -> 'names'), 1, 'and lists them in bounded batches');
select ok((select bool_and(name like '23333333-3333-4333-8333-333333333333/%')
  from jsonb_array_elements_text(public.list_ai_practice_purge_blockers(100) -> 'names') name),
  'only objects of the deletion-scheduled account are purge blockers');
reset role;
update private.account_deletion_jobs set requested_at = now() - interval '721 hours',
  deadline = now() - interval '1 hour', retry_at = now() - interval '1 second'
  where user_id = '23333333-3333-4333-8333-333333333333';
set local role service_role;
select is((public.begin_ai_practice_generation('c3333333-3333-4333-8333-333333333333', gen_random_uuid(),
  (select value from fixture where key = 'doc_c'), array['trial']) ->> 'state'), 'signed-out',
  'an account past its deletion deadline admits no generation, even with a surviving session row');
select is((public.run_account_deletion_jobs(25) ->> 'failedThisRun')::integer, 1,
  'the Account worker refuses to purge while AI objects remain');
reset role;
select is((select last_error_code from private.account_deletion_jobs where user_id = '23333333-3333-4333-8333-333333333333'),
  'P0002', 'and records the fail-closed Storage error for retry');
select ok((select count(*) from public.ai_practice_documents where user_id = '23333333-3333-4333-8333-333333333333') = 2
  and (select count(*) from public.ai_allowance_windows where user_id = '23333333-3333-4333-8333-333333333333') = 1,
  'the failed purge rolled back: every AI row is still present');
set local role service_role;
select is((public.purge_expired_ai_practice() ->> 'purge_blocking_uploads')::integer, 2,
  'the AI sweep reports how many objects still block a purge');
reset role;
-- Stand-in for the Storage API removal performed by runAiPracticeCleanup (exercised for real in
-- scripts/ai-practice/storage-integration.cjs); pgTAP has no provider files, only metadata.
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'ai-practice-uploads' and name like '23333333-3333-4333-8333-333333333333/%';
reset storage.allow_delete_query;
update private.account_deletion_jobs set retry_at = clock_timestamp() - interval '1 second'
  where user_id = '23333333-3333-4333-8333-333333333333';
set local role service_role;
select is(public.list_ai_practice_purge_blockers(100) ->> 'remaining', '0', 'nothing blocks the purge any more');
select is((public.run_account_deletion_jobs(25) ->> 'completed')::integer, 1, 'once the objects are gone the purge completes');
reset role;
select is((select count(*)::integer from public.ai_practice_documents where user_id = '23333333-3333-4333-8333-333333333333')
  + (select count(*)::integer from public.ai_practice_generations where user_id = '23333333-3333-4333-8333-333333333333')
  + (select count(*)::integer from public.ai_usage_events where user_id = '23333333-3333-4333-8333-333333333333')
  + (select count(*)::integer from public.ai_allowance_windows where user_id = '23333333-3333-4333-8333-333333333333'),
  0, 'the purge leaves no AI rows for the account');
select ok((select count(*) from public.ai_practice_documents where user_id = '21111111-1111-4111-8111-111111111111') >= 4
  and (select count(*) from storage.objects where name like '21111111-1111-4111-8111-111111111111/%') = 1,
  'another student''s AI rows and objects are untouched');

-- Retention: a row is never purged while its object remains -------------------------------
select ok((select expires_at between now() + interval '29 days' and now() + interval '31 days'
  from public.ai_practice_generations where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'second')),
  'personal sets expire after 30 days');
select ok((select expires_at between now() + interval '6 days' and now() + interval '8 days'
  from public.ai_practice_documents where id = (select value from fixture where key = 'doc_a')),
  'source documents expire after 7 days');
set local role service_role;
select ok((select (select value from fixture where key = 'doc_a')::text = any (array_agg(split_part(name, '/', 2)))
  from public.list_ai_practice_uploads_to_remove(100) name), 'a settled document upload is listed for removal');
reset role;
update public.ai_practice_documents set expires_at = now() - interval '1 second'
  where id = (select value from fixture where key = 'doc_a');
update public.ai_practice_generations set expires_at = now() - interval '1 second'
  where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'second');
set local role service_role;
insert into outcome values ('purge_held', public.purge_expired_ai_practice());
reset role;
select is((select (result ->> 'retained_documents')::integer from outcome where step = 'purge_held'), 1,
  'an expired document whose object remains is kept and reported');
select ok((select (result ->> 'outstanding_uploads')::integer from outcome where step = 'purge_held') >= 1,
  'outstanding objects are reported, not hidden');
select is((select count(*)::integer from public.ai_practice_documents where id = (select value from fixture where key = 'doc_a')),
  1, 'the row survives while its Storage object exists');
select is((select count(*)::integer from public.ai_practice_generations
  where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'second')), 0, 'expired sets are purged');
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'ai-practice-uploads'
  and name = (select '21111111-1111-4111-8111-111111111111/' || value from fixture where key = 'doc_a');
reset storage.allow_delete_query;
set local role service_role;
insert into outcome values ('purge_done', public.purge_expired_ai_practice());
reset role;
select is((select (result ->> 'deleted_documents')::integer from outcome where step = 'purge_done'), 1,
  'the expired document is purged once its object is gone');
select is((select (result ->> 'retained_documents')::integer from outcome where step = 'purge_done'), 0,
  'nothing expired is held back any more');
select is((select count(*)::integer from public.ai_practice_generations
  where id = (select (result ->> 'generation_id')::uuid from outcome where step = 'third')), 1,
  'unexpired sets survive their document');
select ok((select count(*) from public.ai_usage_events where user_id = '21111111-1111-4111-8111-111111111111') >= 3,
  'usage accounting outlives purged content');

-- Account deletion removes every owned row; an object left behind stays visible to the sweep.
insert into storage.objects (bucket_id, name, owner_id)
  values ('ai-practice-uploads', '21111111-1111-4111-8111-111111111111/' || gen_random_uuid(), '21111111-1111-4111-8111-111111111111');
delete from auth.users where id = '21111111-1111-4111-8111-111111111111';
select is((select count(*)::integer from public.ai_usage_events where user_id = '21111111-1111-4111-8111-111111111111')
  + (select count(*)::integer from public.ai_practice_generations where user_id = '21111111-1111-4111-8111-111111111111')
  + (select count(*)::integer from public.ai_allowance_windows where user_id = '21111111-1111-4111-8111-111111111111'),
  0, 'account deletion leaves no AI practice rows');
set local role service_role;
select ok((select count(*) from public.list_ai_practice_uploads_to_remove(100) name
  where name like '21111111-1111-4111-8111-111111111111/%') >= 1,
  'an object without a row is left for the cleanup sweep, never stranded');
reset role;

select * from finish();
rollback;
