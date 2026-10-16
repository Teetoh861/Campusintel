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

test('explicit worker run is bounded, validates output and fails closed on monitoring/transport failures', async () => {
  const enabled = { ...env, ACCOUNT_DELETION_WORKER_ENABLED: 'true' }
  const result = await run(['--run'], enabled, async (url, options) => {
    assert.equal(url.pathname, '/rest/v1/rpc/run_account_deletion_jobs')
    assert.deepEqual(JSON.parse(options.body), { p_limit: 25 })
    return Response.json({ completed: 2, failedThisRun: 0, escalatedThisRun: 0, monitor: healthy() })
  })
  assert.equal(result.exitCode, 0)
  assert.equal((await run(['--status'], env, async () => Response.json({ ...healthy(), workerStale: true }))).exitCode, 1)
  assert.equal((await run(['--run'], enabled, async () => Response.json({ completed: 1,
    failedThisRun: 0, escalatedThisRun: 1, monitor: healthy() }))).exitCode, 2, 'late success still escalates')
  for (const response of [Response.json({}, { status: 503 }), Response.json({ ...healthy(), studentEmail: 'unexpected' })]) {
    await assert.rejects(() => run(['--status'], env, async () => response))
  }
  await assert.rejects(() => run(['--status'], env, async () => { throw new Error('network unavailable') }))
  await assert.rejects(() => run([], env))
  await assert.rejects(() => run(['--status'], { ...env, NEXT_PUBLIC_SUPABASE_URL: 'http://hosted.example.test' }))
})
