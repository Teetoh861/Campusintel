const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve, dirname } = require('node:path')
const { spawnSync } = require('node:child_process')

test('launch migrations preserve actual usage and backfill only missing passages',
  { skip: process.env.CAMPUS_BOT_DB_TEST !== '1' }, () => {
    const container = process.env.CAMPUS_BOT_DB_CONTAINER
    assert.match(container ?? '', /^supabase_db_ci-access-own-[a-z0-9-]+$/, 'explicit disposable local stack required')
    const file = resolve(__dirname, '../../supabase/tests/launch_batch_2.test.sql')
    const source = readFileSync(file, 'utf8').replace(/^\\ir (.+)$/gm,
      (_, relative) => readFileSync(resolve(dirname(file), relative), 'utf8'))
      .replace('begin;', 'begin;\ncreate extension if not exists pgtap with schema extensions;')
    const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-XAtq', '-U', 'postgres',
      '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-v', 'launch_batch_2_replay=1'],
    { input: source, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.doesNotMatch(result.stdout, /^not ok\b/m, result.stdout)
    const assertions = result.stdout.match(/^ok \d+\b/gm) ?? []
    assert.ok(assertions.length >= 30, 'the full replay and backfill assertions ran:\n' + result.stdout)
    assert.match(result.stdout, new RegExp(`^1\\.\\.${assertions.length}$`, 'm'), 'complete pgTAP plan')
  })
