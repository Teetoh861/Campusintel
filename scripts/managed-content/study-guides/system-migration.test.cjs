// scripts/managed-content/study-guides/system-migration.test.cjs — The overview correction's functions, recreated in
// 20261111090000_study_guide_notes.sql, are the ones 20261110090000 runs except for the rolled-back guide's revision.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildManifest } = require('../source-manifest.cjs')
const { OVERVIEW_MIGRATION, overviewFunctionsSql, overviewRevisions } = require('../overview-revisions.cjs')
const { GUIDE_ACTOR, SYSTEM_MIGRATION } = require('../study-guides.cjs')

const MIGRATIONS = path.join(__dirname, '../../../supabase/migrations')

test('the recreated functions differ from 20261110090000 only where a guide revision is pending', () => {
  const manifest = buildManifest()
  const revisions = overviewRevisions(manifest)
  const original = fs.readFileSync(path.join(MIGRATIONS, OVERVIEW_MIGRATION), 'utf8')
  const system = fs.readFileSync(path.join(MIGRATIONS, SYSTEM_MIGRATION), 'utf8')
  const redefined = overviewFunctionsSql(manifest.actor, revisions, GUIDE_ACTOR)
  assert.ok(system.includes(redefined), 'the system migration carries the generated functions')
  // The original migration's functions, as it runs them.
  assert.ok(original.includes(overviewFunctionsSql(manifest.actor, revisions)))
  // Take the three guide clauses out again and only "or replace" remains.
  const pending = `(VAR.approved_revision = VAR.published_revision and exists (select 1
          from public.managed_content_revisions g where g.item_id = VAR.id and g.revision = VAR.current_revision
          and g.authored_by = '${GUIDE_ACTOR}'))`
  const clause = name => pending.replaceAll('VAR', name)
  const stripped = redefined
    .replace(`\n      and not ${clause('i')}`, '')
    .replace(`(i.current_revision = i.published_revision\n      or ${clause('i')})`, 'i.current_revision = i.published_revision')
    .replace(` and not (v_item.current_revision > v_revision\n          and ${clause('v_item')})`, '')
    .replaceAll('create or replace function', 'create function')
  assert.equal(stripped, overviewFunctionsSql(manifest.actor, revisions))
  assert.equal(redefined.split(GUIDE_ACTOR).length - 1, 3, 'three guide clauses')
})
