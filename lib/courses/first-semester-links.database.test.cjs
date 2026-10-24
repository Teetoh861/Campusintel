// Exercise the real forward migration over populated predecessor data, in rolled-back transactions.
// Opt in only on an isolated stack: COURSE_LINKS_DB_TEST=1 and COURSE_LINKS_DB_CONTAINER=supabase_db_<project>.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')

const enabled = process.env.COURSE_LINKS_DB_TEST === '1'
const container = process.env.COURSE_LINKS_DB_CONTAINER || ''
const migration = readFileSync('supabase/migrations/20261025120000_link_first_semester_courses.sql', 'utf8')
const ids = "'50000000-0000-4000-8000-000000000016', '50000000-0000-4000-8000-000000000075', '50000000-0000-4000-8000-000000000076'"
const predecessor = 'begin; set local statement_timeout = \'15s\'; update public.institutional_courses set repository_course_id = null where id in (' + ids + ');'

function execute(sql) {
  assert.match(container, /^supabase_db_[a-zA-Z0-9_-]+$/, 'name an isolated local Supabase container')
  assert.notEqual(container, 'supabase_db_Campusintel', 'never use the shared database')
  return spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 30_000 })
}

test('the real course-link migration changes only the three approved foreign keys', { skip: !enabled }, () => {
  const tables = ['courses', 'course_applicability', 'managed_content_items', 'managed_content_revisions', 'entitlement_grants']
  const snapshots = tables.map(table => 'create temporary table before_' + table + ' as select * from public.' + table + ';').join('\n')
  const comparisons = tables.map(table => "'" + table + "', not exists ((select * from before_" + table + ' except select * from public.' + table +
    ') union all (select * from public.' + table + ' except select * from before_' + table + '))').join(',')
  const result = execute(predecessor + '\ncreate temporary table before_catalogue as select * from public.institutional_courses;\n' +
    snapshots + '\n' + migration + '\nselect jsonb_build_object(' + comparisons + `,
      'catalogue_metadata', not exists (
        (select to_jsonb(c) - 'repository_course_id' from before_catalogue c
         except select to_jsonb(c) - 'repository_course_id' from public.institutional_courses c)
        union all
        (select to_jsonb(c) - 'repository_course_id' from public.institutional_courses c
         except select to_jsonb(c) - 'repository_course_id' from before_catalogue c)),
      'other_links', not exists (
        (select * from before_catalogue where id not in (` + ids + `)
         except select * from public.institutional_courses where id not in (` + ids + `))
        union all
        (select * from public.institutional_courses where id not in (` + ids + `)
         except select * from before_catalogue where id not in (` + ids + `))),
      'three_links', (select count(*) = 3 from public.institutional_courses where id in (` + ids + `) and repository_course_id is not null));
      rollback;`)
  assert.equal(result.status, 0, result.stderr)
  const checks = JSON.parse(result.stdout.trim())
  assert.ok(Object.values(checks).every(value => value === true), JSON.stringify(checks))
})

for (const [name, drift, message] of [
  ['a changed code on the last catalogue row',
    "update public.institutional_courses set course_code = 'OTHER221' where id = '50000000-0000-4000-8000-000000000076';",
    /Expected exact, unlinked catalogue identity: LAG-BUA221/],
  ['an already-linked catalogue row',
    "update public.institutional_courses set repository_course_id = '40000000-0000-4000-8000-000000000006' where id = '50000000-0000-4000-8000-000000000076';",
    /Expected exact, unlinked catalogue identity: LAG-BUA221/],
  ['content already owned by another catalogue row',
    "update public.institutional_courses set repository_course_id = '40000000-0000-4000-8000-000000000007' where id = '50000000-0000-4000-8000-000000000001';",
    /Repository identity already belongs to a catalogue course/],
]) {
  test('the real course-link migration refuses ' + name, { skip: !enabled }, () => {
    const result = execute(predecessor + '\n' + drift + '\n' + migration + '\nrollback;')
    assert.notEqual(result.status, 0, 'conflicting catalogue history must not be overwritten')
    assert.match(result.stderr, message)
  })
}
