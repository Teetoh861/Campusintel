-- supabase/tests/official_bank_rows.test.sql — The official banks' source table: only migrations read it, a missing
-- row is refused before anything changes, and a bank is rebuilt in ordinal order whatever order its rows are stored in.
begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- Access: RLS is on, and no student, visitor or service key can read the table or call the rebuild.
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'private.official_bank_rows'::regclass),
  'row level security is on');
select is((select count(*)::int from pg_policies where schemaname = 'private' and tablename = 'official_bank_rows'), 0,
  'no policy opens any row');
select ok(not has_table_privilege(r, 'private.official_bank_rows', 'select, insert, update, delete'),
    format('%s has no access to the table', r))
  from unnest(array['anon', 'authenticated', 'service_role']) r;
select ok(not has_function_privilege(r, 'private.official_bank_source(text, text)', 'execute'),
    format('%s cannot call the rebuild', r))
  from unnest(array['anon', 'authenticated', 'service_role']) r;

select set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$select count(*) from private.official_bank_rows$$, '42501', null, 'a student cannot read the table');
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
select throws_ok($$select count(*) from private.official_bank_rows$$, '42501', null,
  'a logged-out visitor cannot read the table');
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select throws_ok($$select count(*) from private.official_bank_rows$$, '42501', null, 'the service key cannot read the table');
reset role;
select set_config('request.jwt.claims', null, true);

-- ---------------------------------------------------------------------------
-- Every imported bank's rows match its summary.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from private.official_bank_rows where part = 'bank'), 27, 'the 27 banks have a summary row');
select is((select array_agg(r.bank order by r.bank) from private.official_bank_rows r where r.part = 'bank'
    and private.official_bank_source(r.bank, r.value->>'code') is null), null, 'every bank rebuilds from its rows');

-- ---------------------------------------------------------------------------
-- The guard, on BUA205 (it has audited, kept, retired and added rows). After a rollback, apply would change the
-- course; with a row missing it is refused with the same error, and nothing changes.
-- ---------------------------------------------------------------------------
create temporary table bua205_final on commit drop as select coalesce(jsonb_object_agg(id::text, published_revision), '{}') live
  from public.managed_content_items where course_id = (select (value->>'courseId')::uuid from private.official_bank_rows
    where bank = 'official_bank_bua205' and part = 'bank') and kind = 'cbt_question' and published_revision is not null;
select is(private.official_bank_bua205('rollback'), 'rolled-back', 'BUA205 rolls back to its audited set');

create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'items', (select count(*) from public.managed_content_items),
    'revisions', (select count(*) from public.managed_content_revisions),
    'reviews', (select count(*) from public.managed_content_reviews),
    'publications', (select count(*) from public.managed_content_publications),
    'catalogue', (select md5(string_agg(c::text, '|' order by c.id)) from public.institutional_courses c),
    'live', (select coalesce(jsonb_object_agg(id::text, published_revision), '{}') from public.managed_content_items
      where kind = 'cbt_question' and published_revision is not null)) $$;
create temporary table bua205_before on commit drop as select pg_temp.state() state;
create function pg_temp.others() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(id::text, published_revision), '{}') from public.managed_content_items
    where kind = 'cbt_question' and published_revision is not null and course_id <> (select (value->>'courseId')::uuid
      from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'bank') $$;
create temporary table bua205_others on commit drop as select pg_temp.others() others;
create temporary table bua205_rows on commit drop as select * from private.official_bank_rows where bank = 'official_bank_bua205';

delete from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'bank';
select throws_ok($$select private.official_bank_bua205('apply')$$, 'P0001',
  'Official bank BUA205: its source rows are missing', 'a missing summary row is refused');
select throws_ok($$select private.official_bank_bua205('rollback')$$, 'P0001',
  'Official bank BUA205: its source rows are missing', 'and refused for a rollback too');
insert into private.official_bank_rows select * from bua205_rows where part = 'bank';

delete from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'keep' and ordinal = 70;
select throws_ok($$select private.official_bank_bua205('apply')$$, 'P0001',
  'Official bank BUA205: its source rows are missing', 'a missing kept-question row is refused');
insert into private.official_bank_rows select * from bua205_rows where part = 'keep' and ordinal = 70;

delete from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'add'
  and ordinal = (select max(ordinal) from bua205_rows where part = 'add');
select throws_ok($$select private.official_bank_bua205('apply')$$, 'P0001',
  'Official bank BUA205: its source rows are missing', 'a missing last added-question row is refused');
insert into private.official_bank_rows select * from bua205_rows where part = 'add'
  and ordinal = (select max(ordinal) from bua205_rows where part = 'add');

delete from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'audited' and ordinal = 1;
select throws_ok($$select private.official_bank_bua205('apply')$$, 'P0001',
  'Official bank BUA205: its source rows are missing', 'a missing audited row is refused');
insert into private.official_bank_rows select * from bua205_rows where part = 'audited' and ordinal = 1;

delete from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'retire' and ordinal = 69;
select throws_ok($$select private.official_bank_bua205('apply')$$, 'P0001',
  'Official bank BUA205: its source rows are missing', 'a missing retired row is refused');
insert into private.official_bank_rows select * from bua205_rows where part = 'retire' and ordinal = 69;

select is(pg_temp.state(), (select state from bua205_before), 'the refusals changed nothing');
select throws_ok($$select private.official_bank_source('official_bank_bua205', 'ENT211')$$, 'P0001',
  'Official bank ENT211: its source rows are missing', 'another course''s rows are refused');

-- ---------------------------------------------------------------------------
-- Order: the rows stored in reverse order rebuild the same bank, and apply publishes the same set.
-- ---------------------------------------------------------------------------
create temporary table bua205_bank on commit drop as
  select private.official_bank_source('official_bank_bua205', 'BUA205') bank;
delete from private.official_bank_rows where bank = 'official_bank_bua205';
insert into private.official_bank_rows select * from bua205_rows order by part desc, ordinal desc;
set local enable_indexscan = off;
set local enable_bitmapscan = off;
select isnt((select array_agg(ordinal) from private.official_bank_rows where bank = 'official_bank_bua205' and part = 'add'),
  (select array_agg(ordinal order by ordinal) from bua205_rows where part = 'add'), 'the rows are stored out of order');
select is(private.official_bank_source('official_bank_bua205', 'BUA205'), (select bank from bua205_bank),
  'the rebuilt bank is the same');
reset enable_indexscan;
reset enable_bitmapscan;
select is((select jsonb_agg(value->>'itemId') from jsonb_array_elements(private.official_bank_source('official_bank_bua205',
    'BUA205')->'add')), (select jsonb_agg(value->>'itemId' order by ordinal) from bua205_rows where part = 'add'),
  'added questions come back in ordinal order');
select is(private.official_bank_bua205('apply'), 'applied', 'apply runs on the reordered rows');
select is(pg_temp.others(), (select others from bua205_others), 'no other course''s questions changed');
select is((select coalesce(jsonb_object_agg(id::text, published_revision), '{}') from public.managed_content_items
    where course_id = ((select bank from bua205_bank)->>'courseId')::uuid and kind = 'cbt_question'
      and published_revision is not null), (select live from bua205_final), 'BUA205 publishes exactly its bank set again');

select * from finish();
rollback;
