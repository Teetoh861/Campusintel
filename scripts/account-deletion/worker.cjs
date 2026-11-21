#!/usr/bin/env node
// Explicit invocation only. This file installs/activates no scheduled job.
const { z } = require('zod')
const { ACCOUNT_DELETION_AI_UPLOAD_BATCH_SIZE, ACCOUNT_DELETION_AI_UPLOAD_MAX_BATCHES, ACCOUNT_DELETION_WORKER_BATCH_SIZE,
  ACCOUNT_DELETION_WORKER_TIMEOUT_MS } = require('../../lib/account/deletion-policy.cjs')

// Created by supabase/migrations/20261016140000_ai_practice_uploads.sql. Its objects are student-owned, so
// run_account_deletion_jobs fails closed (P0002) for an account while any remain.
const AI_UPLOAD_BUCKET = 'ai-practice-uploads'

const count = z.number().int().nonnegative()
const monitor = z.object({
  lastRunAt: z.string().nullable(), workerStale: z.boolean(),
  pending: count, due: count, overdue: count, failed: count,
  oldestDeadline: z.string().nullable(),
  overdueJobs: z.array(z.object({ jobId: z.string().uuid(), deadline: z.string(),
    attempts: count, errorCode: z.string().nullable(), escalatedAt: z.string().nullable() }).strict()),
}).strict()
const result = z.object({ completed: count, failedThisRun: count, escalatedThisRun: count, monitor }).strict()
const purgeBlockers = z.object({ remaining: count,
  names: z.array(z.string().regex(/^[0-9a-f-]{36}\/[^/]+$/)).max(ACCOUNT_DELETION_AI_UPLOAD_BATCH_SIZE) }).strict()

/**
 * Remove the AI uploads of deletion-scheduled accounts through the Storage API before the purge, in bounded
 * batches. Reports only counts, never paths. remaining is re-read from the database after the last removal,
 * so the run never claims success while a blocking object exists.
 */
async function removeAiUploadBlockers(request) {
  let removed = 0
  for (let batch = 0; ; batch += 1) {
    const listed = purgeBlockers.parse(await request('/rest/v1/rpc/list_ai_practice_purge_blockers', 'POST',
      { p_limit: ACCOUNT_DELETION_AI_UPLOAD_BATCH_SIZE }))
    if (listed.remaining === 0 || listed.names.length === 0 || batch === ACCOUNT_DELETION_AI_UPLOAD_MAX_BATCHES) {
      return { ok: true, removed, remaining: listed.remaining }
    }
    const deleted = await request(`/storage/v1/object/${AI_UPLOAD_BUCKET}`, 'DELETE', { prefixes: listed.names })
    if (!Array.isArray(deleted)) throw new Error('AI upload removal returned an unexpected response')
    removed += deleted.length
  }
}

/** Call only narrow service endpoints; never log the key, HTTP payloads, paths or provider errors. */
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
  const request = async (path, method, body) => {
    const response = await transport(new URL(path, url), {
      method, signal: AbortSignal.timeout(ACCOUNT_DELETION_WORKER_TIMEOUT_MS), redirect: 'error',
      headers: { apikey: key, ...(local ? { Authorization: 'Bearer ' + key } : {}), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('Deletion worker RPC failed; inspect restricted service monitoring')
    return response.json()
  }
  // A failed or incomplete AI sweep never skips the purge: the purge itself refuses (P0002) any account that
  // still owns an object, so running it stays safe and still completes every other account.
  const aiStorage = args[0] === '--run'
    ? await removeAiUploadBlockers(request).catch(() => ({ ok: false, removed: null, remaining: null }))
    : null
  const operation = args[0] === '--run' ? 'run_account_deletion_jobs' : 'account_deletion_monitor'
  const parsed = (args[0] === '--run' ? result : monitor).parse(await request('/rest/v1/rpc/' + operation, 'POST',
    args[0] === '--run' ? { p_limit: ACCOUNT_DELETION_WORKER_BATCH_SIZE } : {}))
  const state = 'monitor' in parsed ? parsed.monitor : parsed
  // Exit 2 is an escalation to the founder/operations on-call; exit 1 is a
  // worker/monitor failure. The deployed scheduler MUST route both to alerts.
  const escalated = 'escalatedThisRun' in parsed ? parsed.escalatedThisRun : 0
  const aiStorageIncomplete = aiStorage !== null && (!aiStorage.ok || aiStorage.remaining !== 0)
  const data = aiStorage === null ? parsed : { ...parsed, aiStorage }
  return { data, exitCode: state.overdue > 0 || escalated > 0 ? 2
    : state.failed > 0 || state.workerStale || aiStorageIncomplete ? 1 : 0 }
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
