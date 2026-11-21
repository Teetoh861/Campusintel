// Run against develop migrations BEFORE A1 is applied; every fixture and migration change rolls back.
// ACCESS_SCOPE_UPGRADE_DB_TEST=1 ACCESS_SCOPE_UPGRADE_DB_CONTAINER=supabase_db_ci-access-own-<project>
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { spawnSync } = require('node:child_process')
const enabled = process.env.ACCESS_SCOPE_UPGRADE_DB_TEST === '1'
test('populated develop upgrade preserves all grant benefits, selections, Early Access members and reviews', { skip: !enabled }, () => {
  const container=process.env.ACCESS_SCOPE_UPGRADE_DB_CONTAINER
  assert.match(container ?? '',/^supabase_db_ci-access-own-[a-z0-9-]+$/,'explicitly name an isolated access stack')
  const args=['exec','-i',container,'psql','-XAtq','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
  const before=spawnSync('docker',args,{input:"select to_regprocedure('private.open_course_access_read(uuid)') is null",encoding:'utf8'})
  assert.equal(before.status,0,before.stderr)
  assert.equal(before.stdout.trim(),'t','this proof requires develop migrations without A1')
  const fixture=readFileSync('lib/courses/access-scope-upgrade-fixture.sql','utf8')
  const migration=readFileSync('supabase/migrations/20261029100000_own_course_access.sql','utf8')
  const result=spawnSync('docker',args,{input:fixture.replace('-- ACCESS_SCOPE_MIGRATION', () => migration),encoding:'utf8',timeout:60000})
  assert.equal(result.status,0,result.stderr)
  assert.doesNotMatch(result.stdout,/^not ok /m,result.stdout)
  assert.equal((result.stdout.match(/^ok /gm)||[]).length,23,result.stdout)
  assert.match(result.stdout,/^1\.\.23$/m)
})
