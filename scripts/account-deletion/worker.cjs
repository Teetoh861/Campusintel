#!/usr/bin/env node
// Explicit invocation only. This file installs/activates no scheduled job.
const { z } = require('zod')
const { ACCOUNT_DELETION_WORKER_BATCH_SIZE, ACCOUNT_DELETION_WORKER_TIMEOUT_MS } = require('../../lib/account/deletion-policy.cjs')

const count = z.number().int().nonnegative()
const monitor = z.object({
  lastRunAt: z.string().nullable(), workerStale: z.boolean(),
  pending: count, due: count, overdue: count, failed: count,
  oldestDeadline: z.string().nullable(),
  overdueJobs: z.array(z.object({ jobId: z.string().uuid(), deadline: z.string(),
    attempts: count, errorCode: z.string().nullable(), escalatedAt: z.string().nullable() }).strict()),
}).strict()
const result = z.object({ completed: count, failedThisRun: count, escalatedThisRun: count, monitor }).strict()

/** Call only one narrow service RPC; never log the key, HTTP payloads or provider errors. */
async function run(args, env = process.env, transport = fetch) {
  if (args.length !== 1 || !['--status', '--run'].includes(args[0])) {
    throw new Error('usage: node scripts/account-deletion/worker.cjs --status | --run')
  }
  const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL || '')
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Deletion worker configuration unavailable')
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (!local && url.protocol !== 'https:') throw new Error('Deletion worker requires HTTPS')
  if (args[0] === '--run' && env.ACCOUNT_DELETION_WORKER_ENABLED !== 'true') {
    throw new Error('Deletion worker is disabled; configure monitoring before activation')
  }
  const key = env.SUPABASE_SECRET_KEY
  if (!key || key !== key.trim() || (!local && !/^sb_secret_[A-Za-z0-9_-]+$/.test(key))) {
    throw new Error('Deletion worker configuration unavailable')
  }
  const operation = args[0] === '--run' ? 'run_account_deletion_jobs' : 'account_deletion_monitor'
  const response = await transport(new URL('/rest/v1/rpc/' + operation, url), {
    method: 'POST', signal: AbortSignal.timeout(ACCOUNT_DELETION_WORKER_TIMEOUT_MS), redirect: 'error',
    headers: { apikey: key, ...(local ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json' },
    body: JSON.stringify(args[0] === '--run' ? { p_limit: ACCOUNT_DELETION_WORKER_BATCH_SIZE } : {}),
  })
  if (!response.ok) throw new Error('Deletion worker RPC failed; inspect restricted service monitoring')
  const data = (args[0] === '--run' ? result : monitor).parse(await response.json())
  const state = 'monitor' in data ? data.monitor : data
  // Exit 2 is an escalation to the founder/operations on-call; exit 1 is a
  // worker/monitor failure. The deployed scheduler MUST route both to alerts.
  const escalated = 'escalatedThisRun' in data ? data.escalatedThisRun : 0
  return { data, exitCode: state.overdue > 0 || escalated > 0 ? 2 : state.failed > 0 || state.workerStale ? 1 : 0 }
}

if (require.main === module) {
  run(process.argv.slice(2)).then(({ data, exitCode }) => {
    process.stdout.write(JSON.stringify(data) + '\n')
    process.exitCode = exitCode
  }).catch(() => {
    process.stderr.write('Account deletion worker failed. Founder/operations must investigate.\n')
    process.exitCode = 1
  })
}
module.exports = { run }
