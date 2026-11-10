-- supabase/tests/repository_seed_idempotence.test.sql — Seed replay preserves source and later operator work.
begin;
select no_plan();

select set_config('test.seed_item_count', count(*)::text, true)
from public.managed_content_items
where created_by = '00000000-0000-4000-8000-000000000042';
select set_config('test.seed_revision_count', count(*)::text, true)
from public.managed_content_revisions
where authored_by = '00000000-0000-4000-8000-000000000042';

insert into public.managed_content_items (
  id, course_id, kind, source_key, created_by
) values (
  '90000000-0000-4000-8000-000000000042',
  '40000000-0000-4000-8000-000000000001',
  'note', 'operator-authored-after-seed',
  '11111111-1111-4111-8111-111111111111'
);
insert into public.managed_content_revisions (
  item_id, revision, payload, authored_by
) values (
  '90000000-0000-4000-8000-000000000042', 1,
  '{"title":"Operator note","body":"Later work"}'::jsonb,
  '11111111-1111-4111-8111-111111111111'
);

insert into public.managed_content_revisions (
  item_id, revision, payload, authored_by
)
-- An operator draft on top of the overview's latest revision (revision two is the approved 20261110090000 text).
select id, current_revision + 1, jsonb_set(
  (select payload from public.managed_content_revisions
   where item_id = i.id and revision = 1),
  '{body}', '"Operator revised overview"'::jsonb
), '11111111-1111-4111-8111-111111111111'
from public.managed_content_items i
where i.course_id = '40000000-0000-4000-8000-000000000001'
  and i.kind = 'course_overview';
update public.managed_content_items
set current_revision = current_revision + 1, lock_version = lock_version + 1
where course_id = '40000000-0000-4000-8000-000000000001'
  and kind = 'course_overview';

select private.replay_repository_content_seed();
select private.replay_repository_content_seed();

select is((select count(*)::int from public.managed_content_revisions
  where authored_by = '00000000-0000-4000-8000-000000000042' and payload->>'examTip' like '%if time%'), 0,
  'replaying the seed keeps the approved exam-tip corrections (20261104110000)');
select is((select payload->>'examTip' from public.managed_content_revisions
  where item_id = 'd4c93605-c101-542c-835e-b9fe4f271618' and revision = 1),
  'Include the formula AND explain what costs are deducted. Give an example.',
  'a corrected tip keeps the rest of its text');

-- A correction target that has gone missing is recreated by the replay with the corrected text, not the seeded one.
set local session_replication_role = replica;
delete from public.managed_content_publications where item_id = 'd4c93605-c101-542c-835e-b9fe4f271618';
delete from public.managed_content_reviews where item_id = 'd4c93605-c101-542c-835e-b9fe4f271618';
delete from public.managed_content_revisions where item_id = 'd4c93605-c101-542c-835e-b9fe4f271618';
delete from public.managed_content_items where id = 'd4c93605-c101-542c-835e-b9fe4f271618';
set local session_replication_role = origin;
select is((select count(*)::int from public.managed_content_items where id = 'd4c93605-c101-542c-835e-b9fe4f271618'), 0,
  'the target is missing before the replay');
select private.replay_repository_content_seed();
select is((select jsonb_build_array(i.current_revision, i.published_revision, r.payload->>'examTip')
    from public.managed_content_items i join public.managed_content_revisions r on r.item_id = i.id and r.revision = 1
    where i.id = 'd4c93605-c101-542c-835e-b9fe4f271618'),
  '[1,1,"Include the formula AND explain what costs are deducted. Give an example."]'::jsonb,
  'the replay recreates a missing target with the corrected exam tip');
select is((select count(*)::int from public.managed_content_revisions
  where authored_by = '00000000-0000-4000-8000-000000000042' and payload->>'examTip' like '%if time%'), 0,
  'no exam tip keeps time advice after recreating a target');

select ok(not has_function_privilege('authenticated',
  'private.replay_repository_content_seed()', 'EXECUTE'),
  'browser API roles cannot invoke migration-only seed replay');

select is((select count(*)::int from public.managed_content_items
  where created_by = '00000000-0000-4000-8000-000000000042'),
  current_setting('test.seed_item_count')::int,
  'replaying the seed twice creates no duplicate managed items');
select is((select count(*)::int from public.managed_content_revisions
  where authored_by = '00000000-0000-4000-8000-000000000042'),
  current_setting('test.seed_revision_count')::int,
  'replaying the seed twice creates no duplicate source revisions');
select is((select current_revision from public.managed_content_items
  where course_id = '40000000-0000-4000-8000-000000000001'
    and kind = 'course_overview'), 3,
  'replaying the seed does not overwrite a later operator revision');
select is((select payload->>'body' from public.managed_content_revisions r
  join public.managed_content_items i on i.id = r.item_id
  where i.course_id = '40000000-0000-4000-8000-000000000001'
    and i.kind = 'course_overview' and r.revision = 3),
  'Operator revised overview', 'the operator wording remains intact');
select is((select count(*)::int from public.managed_content_items
  where id = '90000000-0000-4000-8000-000000000042'
    and created_by = '11111111-1111-4111-8111-111111111111'),
  1, 'replaying the seed leaves unrelated operator-owned content untouched');

select * from finish();
rollback;
