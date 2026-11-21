const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { run } = require('./worker.cjs')
const env = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-test-service' }
const healthy = () => ({ lastRunAt: null, workerStale: false, pending: 0, due: 0, overdue: 0, failed: 0, oldestDeadline: null, overdueJobs: [] })

test('worker is disabled by default and status uses only its narrow monitoring RPC', async () => {
  let calls = 0
  const transport = async (url, options) => {
    calls++; assert.equal(url.pathname, '/rest/v1/rpc/account_deletion_monitor')
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), {})
    return Response.json(healthy())
  }
  await assert.rejects(() => run(['--run'], env, transport), /disabled/)
  assert.equal(calls, 0)
  assert.equal((await run(['--status'], env, transport)).exitCode, 0)
  assert.equal(calls, 1)
})

test('24-hour overdue jobs return an operations escalation even while retry is delayed', async () => {
  const status = { ...healthy(), pending: 1, due: 1, overdue: 1, failed: 1,
    oldestDeadline: '2026-10-14T00:00:00Z', overdueJobs: [{ jobId: randomUUID(),
      deadline: '2026-10-14T00:00:00Z', attempts: 3, errorCode: 'P0001', escalatedAt: null }] }
  const result = await run(['--status'], env, async () => Response.json(status))
  assert.equal(result.exitCode, 2)
  assert.deepEqual(result.data, status)
  assert.equal((await run(['--status'], env, async () => Response.json({ ...healthy(), failed: 1 }))).exitCode, 1)
})

const enabled = { ...env, ACCOUNT_DELETION_WORKER_ENABLED: 'true' }
const BLOCKERS_PATH = '/rest/v1/rpc/list_ai_practice_purge_blockers'
/** Answers the AI pre-step with "nothing blocks a purge" and hands the purge RPC to the test. */
const withoutBlockers = purge => async (url, options) =>
  url.pathname === BLOCKERS_PATH ? Response.json({ remaining: 0, names: [] }) : purge(url, options)

test('explicit worker run is bounded, validates output and fails closed on monitoring/transport failures', async () => {
  const result = await run(['--run'], enabled, withoutBlockers(async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/run_account_deletion_jobs')
    assert.deepEqual(JSON.parse(options.body), { p_limit: 25 })
    return Response.json({ completed: 2, failedThisRun: 0, escalatedThisRun: 0, monitor: healthy() })
  }))
  assert.equal(result.exitCode, 0)
  assert.equal((await run(['--status'], env, async () => Response.json({ ...healthy(), workerStale: true }))).exitCode, 1)
  assert.equal((await run(['--run'], enabled, withoutBlockers(async () => Response.json({ completed: 1,
    failedThisRun: 0, escalatedThisRun: 1, monitor: healthy() })))).exitCode, 2, 'late success still escalates')
  for (const response of [Response.json({}, { status: 503 }), Response.json({ ...healthy(), studentEmail: 'unexpected' })]) {
    await assert.rejects(() => run(['--status'], env, async () => response))
  }
  await assert.rejects(() => run(['--status'], env, async () => { throw new Error('network unavailable') }))
  await assert.rejects(() => run([], env))
  await assert.rejects(() => run(['--status'], { ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://hosted.example.test' }))
})

const USER = '23333333-3333-4333-8333-333333333333'
const purged = (overrides = {}) => Response.json({ completed: 1, failedThisRun: 0, escalatedThisRun: 0, monitor: healthy(),
  ...overrides })

/** Storage holding blocking AI uploads that the worker's pre-step lists and removes through the Storage API. */
function storageWith(paths, { failRemoval = false, stuck = false } = {}) {
  const calls = []
  const objects = new Set(paths)
  const transport = async (url, options) => {
    calls.push([options.method, url.pathname])
    assert.equal(options.redirect, 'error')
    if (url.pathname === BLOCKERS_PATH) {
      assert.deepEqual(JSON.parse(options.body), { p_limit: 100 })
      return Response.json({ remaining: objects.size, names: [...objects].slice(0, 100) })
    }
    if (url.pathname === '/storage/v1/object/ai-practice-uploads') {
      assert.equal(options.method, 'DELETE')
      if (failRemoval) return Response.json({ error: 'storage down' }, { status: 503 })
      const { prefixes } = JSON.parse(options.body)
      if (!stuck) prefixes.forEach(path => objects.delete(path))
      return Response.json(prefixes.map(name => ({ name })))
    }
    assert.equal(url.pathname, '/rest/v1/rpc/run_account_deletion_jobs')
    // The real purge refuses any account that still owns an object.
    return objects.size === 0 ? purged() : purged({ completed: 0, failedThisRun: 1 })
  }
  return { calls, objects, transport }
}

test('AI uploads of scheduled accounts are removed through Storage before the purge, which then succeeds', async () => {
  const late = `${USER}/${randomUUID()}`
  const storage = storageWith([late, `${USER}/${randomUUID()}`])
  const result = await run(['--run'], enabled, storage.transport)
  assert.deepEqual(storage.calls, [['POST', BLOCKERS_PATH], ['DELETE', '/storage/v1/object/ai-practice-uploads'],
    ['POST', BLOCKERS_PATH], ['POST', '/rest/v1/rpc/run_account_deletion_jobs']], 'sweep, re-check, then purge')
  assert.deepEqual(result.data.aiStorage, { ok: true, removed: 2, remaining: 0 })
  assert.equal(result.data.completed, 1)
  assert.equal(result.exitCode, 0)
  assert.ok(!JSON.stringify(result.data).includes(USER), 'output carries counts only, never paths or ids')
})

test('a Storage failure still runs the fail-closed purge and is reported as a worker failure', async () => {
  const storage = storageWith([`${USER}/${randomUUID()}`], { failRemoval: true })
  const result = await run(['--run'], enabled, storage.transport)
  assert.equal(storage.calls.at(-1)[1], '/rest/v1/rpc/run_account_deletion_jobs', 'other accounts still complete')
  assert.deepEqual(result.data.aiStorage, { ok: false, removed: null, remaining: null })
  assert.equal(result.data.failedThisRun, 1, 'the account with a remaining object is refused (P0002)')
  assert.equal(result.exitCode, 1)
  assert.equal(storage.objects.size, 1)
})

test('cleanup is never reported complete while objects remain, and each run is bounded', async () => {
  const many = Array.from({ length: 2_500 }, () => `${USER}/${randomUUID()}`)
  const first = storageWith(many)
  const partial = await run(['--run'], enabled, first.transport)
  assert.equal(first.calls.filter(([method]) => method === 'DELETE').length, 20, 'at most 20 x 100 removals per run')
  assert.deepEqual(partial.data.aiStorage, { ok: true, removed: 2_000, remaining: 500 })
  assert.equal(partial.exitCode, 1)
  // Storage answers success but the objects are still listed: the re-read count, not the reply, decides.
  const stuck = storageWith([`${USER}/${randomUUID()}`], { stuck: true })
  const result = await run(['--run'], enabled, stuck.transport)
  assert.equal(result.data.aiStorage.remaining, 1)
  assert.equal(result.exitCode, 1)
  // Retrying is safe: the next run continues where the last stopped.
  const resumed = await run(['--run'], enabled, first.transport)
  assert.deepEqual(resumed.data.aiStorage, { ok: true, removed: 500, remaining: 0 })
  assert.equal(resumed.exitCode, 0)
})

test('an unexpected blocker listing fails the sweep without reaching Storage', async () => {
  const calls = []
  const result = await run(['--run'], enabled, async (url, options) => {
    calls.push(url.pathname)
    if (url.pathname === BLOCKERS_PATH) return Response.json({ remaining: 1, names: ['../../escape'] })
    assert.notEqual(options.method, 'DELETE')
    return purged({ completed: 0, failedThisRun: 1 })
  })
  assert.deepEqual(calls, [BLOCKERS_PATH, '/rest/v1/rpc/run_account_deletion_jobs'])
  assert.equal(result.data.aiStorage.ok, false)
  assert.equal(result.exitCode, 1)
})
