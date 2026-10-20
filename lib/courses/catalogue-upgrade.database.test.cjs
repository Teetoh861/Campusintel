// Replay the real forward migration over populated predecessor data, in a
// rolled-back transaction. Opt in: BUA_CATALOGUE_DB_TEST=1; optionally set
// BUA_CATALOGUE_DB_CONTAINER to another local Supabase test container.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const enabled = process.env.BUA_CATALOGUE_DB_TEST === '1'
const container = process.env.BUA_CATALOGUE_DB_CONTAINER || 'supabase_db_CampusintelBua300lCatalog'
const migration = readFileSync('supabase/migrations/20261020100000_bua_300l_catalogue_correction.sql', 'utf8')
const newIds = `id between '50000000-0000-4000-8000-000000000150' and '50000000-0000-4000-8000-000000000154'`
const target = `department_id = (select id from public.departments where key = 'business-administration')
  and academic_level_id = (select id from public.academic_levels where key = '300-level')
  and academic_period_id = (select id from public.academic_periods where key = 'first-semester')`

function execute(statement) {
  assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/, 'use a local Supabase test container')
  return spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', timeout: 30_000 })
}

// Recreate only the five-course predecessor offering. Even a failing migration
// disconnects with an uncommitted transaction, so every fixture is rolled back.
const predecessor = `begin;
set local statement_timeout = '15s';
delete from public.course_applicability where institutional_course_id in
  (select id from public.institutional_courses where ${newIds});
delete from public.institutional_courses where ${newIds};
insert into public.course_applicability
  (institutional_course_id, department_id, academic_level_id, academic_period_id)
select c.id, d.id, l.id, p.id
from public.institutional_courses c cross join public.departments d
cross join public.academic_levels l cross join public.academic_periods p
where c.id in ('50000000-0000-4000-8000-000000000145', '50000000-0000-4000-8000-000000000149')
  and d.key = 'business-administration' and l.key = '300-level' and p.key = 'first-semester'
on conflict do nothing;`

test('the real correction preserves historical references, content identity, other offerings and entitlements',
  { skip: !enabled }, () => {
    const unchangedTables = ['courses', 'profiles', 'ai_practice_documents', 'ai_practice_generations',
      'ai_usage_events', 'entitlement_grants']
    const snapshots = unchangedTables.map(table =>
      `create temporary table before_${table} as select * from public.${table};`).join('\n')
    const comparisons = unchangedTables.map(table => `'${table}', not exists (
      (select * from before_${table} except select * from public.${table})
      union all (select * from public.${table} except select * from before_${table}))`).join(',\n')
    const result = execute(`${predecessor}
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', '64000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'bua-history@example.test', 'x', now(), '{}', '{}', now(), now());
      update public.profiles set
        department_id = (select id from public.departments where key = 'business-administration'),
        academic_level_id = (select id from public.academic_levels where key = '300-level'),
        academic_period_id = (select id from public.academic_periods where key = 'first-semester')
      where id = '64000000-0000-4000-8000-000000000001';
      insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by)
      values ('64000000-0000-4000-8000-000000000001', 'manual', now(), now() + interval '1 day', 'capped', 5, 'test');
      insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path,
        file_name, media_type, declared_bytes, expires_at)
      select doc.id, '64000000-0000-4000-8000-000000000001', doc.course_id,
        '64000000-0000-4000-8000-000000000001/' || doc.id, 'historical.txt', 'text/plain', 10, now() + interval '1 day'
      from (values
        ('64000000-0000-4000-8000-000000000010'::uuid, '50000000-0000-4000-8000-000000000145'::uuid),
        ('64000000-0000-4000-8000-000000000011'::uuid, '50000000-0000-4000-8000-000000000149'::uuid)
      ) doc(id, course_id);
      insert into public.ai_usage_events (id, user_id, feature, state, settled_at)
      values ('64000000-0000-4000-8000-000000000020', '64000000-0000-4000-8000-000000000001',
        'upload_practice', 'released', now());
      insert into public.ai_practice_generations (user_id, request_id, document_id, institutional_course_id,
        usage_event_id, status, completed_at, expires_at)
      values ('64000000-0000-4000-8000-000000000001', '64000000-0000-4000-8000-000000000021',
        '64000000-0000-4000-8000-000000000011', '50000000-0000-4000-8000-000000000149',
        '64000000-0000-4000-8000-000000000020', 'failed', now(), now() + interval '1 day');

      -- A later content link must stay on BUA302, never move to BUA303.
      update public.institutional_courses set repository_course_id = '40000000-0000-4000-8000-000000000010'
      where id = '50000000-0000-4000-8000-000000000145';
      -- Preserve mappings of either historical identity outside the corrected tuple.
      insert into public.course_applicability
        (institutional_course_id, department_id, academic_level_id, academic_period_id)
      select c.id, d.id, l.id, p.id from (values
        ('50000000-0000-4000-8000-000000000145'::uuid, 'finance', 'first-semester'),
        ('50000000-0000-4000-8000-000000000149'::uuid, 'business-administration', 'second-semester')
      ) c(id, department, period)
      join public.departments d on d.key = c.department
      join public.academic_levels l on l.key = '300-level'
      join public.academic_periods p on p.key = c.period;
      create temporary table before_identities as select * from public.institutional_courses;
      create temporary table before_other_offerings as select * from public.course_applicability where not (${target});
      ${snapshots}
      ${migration}
      select jsonb_build_object(${comparisons},
        'old_identities', not exists (
          (select * from before_identities except select * from public.institutional_courses)
          union all (select * from public.institutional_courses where not (${newIds}) except select * from before_identities)),
        'other_offerings', not exists (
          (select * from before_other_offerings except select * from public.course_applicability where not (${target}))
          union all (select * from public.course_applicability where not (${target}) except select * from before_other_offerings)),
        'new_courses_unlinked', (select count(*) = 5 and bool_and(repository_course_id is null and not is_free)
          from public.institutional_courses where ${newIds}),
        'selected_codes', (select jsonb_agg(c.course_code order by c.course_code)
          from public.course_applicability a join public.institutional_courses c on c.id = a.institutional_course_id
          where ${target}));
      rollback;`)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout.trim()), {
      ...Object.fromEntries(unchangedTables.map(table => [table, true])),
      old_identities: true, other_offerings: true, new_courses_unlinked: true,
      selected_codes: ['BUA303', 'BUA305', 'BUA310', 'BUA313', 'BUA319', 'BUA321', 'BUA323', 'BUS254'],
    })
  })

for (const [name, drift, message] of [
  ['an unexpected extra offering', `insert into public.course_applicability
    select '50000000-0000-4000-8000-000000000001', department_id, academic_level_id, academic_period_id
    from public.course_applicability where ${target} limit 1`, /review catalogue drift/],
  ['an existing new course code', `insert into public.institutional_courses
    values ('64000000-0000-4000-8000-000000000099', 'BUA303', 'A different recorded identity', null, false)`,
    /resolve identity conflicts explicitly/],
  ['a reused reserved UUID', `insert into public.institutional_courses
    values ('50000000-0000-4000-8000-000000000150', 'CUSTOM999', 'Existing custom identity', null, false)`,
    /resolve identity conflicts explicitly/],
]) {
  test(`the correction refuses ${name}`, { skip: !enabled }, () => {
    const result = execute(`${predecessor}\n${drift};\n${migration}\nrollback;`)
    assert.notEqual(result.status, 0, 'conflicting history must not be silently merged or overwritten')
    assert.match(result.stderr, message)
  })
}
