// lib/ai-practice/fixtures/real-parsers.cjs — Shared rules for test files that run real parser processes: only one
// such file parses at a time on this machine, and a failed test leaves no child, sampler or held slot behind.
// scripts/dev-workflow/run-tests.cjs runs these files as one serial batch and holds the lock around it; a file run
// directly (node --test) takes the lock itself.
const { execFileSync } = require('node:child_process')
const net = require('node:net')

// Generous: SIGKILL normally lands in milliseconds; only a stuck process takes this long.
const SETTLE_LIMIT_MS = 10_000
const POLL_MS = 25
// Real parsers (memory bombs, CPU-bound PDFs) run one test file at a time on this machine. The lock is a listening
// socket on this loopback port: the kernel admits one holder and frees it the moment that process ends, however it
// ends, so no lock file is left behind to go stale, be recovered or be deleted by the wrong process.
const LOCK_HOST = '127.0.0.1'
const LOCK_PORT = 47_291
// Longer than the real-parser tests take on a loaded machine; past it the holder is stuck, and the waiter fails.
const LOCK_WAIT_LIMIT_MS = 10 * 60_000
const LOCK_POLL_MS = 100
// Passed by the runner to the files of its serial batch, whose lock it already holds.
const RUNNER_HOLDS_LOCK = '--runner-holds-real-parser-lock'

let held = null

/** Listen on the lock port: the listening server once held, or the error that refused it. */
function tryListen() {
  const server = net.createServer(socket => socket.destroy())
  return new Promise(resolve => {
    server.once('error', error => resolve({ error }))
    // exclusive: never shared through the cluster module; the kernel refuses a second listener on the same address.
    server.listen({ host: LOCK_HOST, port: LOCK_PORT, exclusive: true }, () => resolve({ server }))
  })
}

/**
 * Take the machine-wide real-parser lock, waiting while another process holds it, for at most the lock's limit.
 * `onWait` is called once if it has to wait. Resolves to the held lock, which never keeps this process alive.
 */
async function takeRealParserLock({ onWait = () => {}, signal } = {}) {
  const until = Date.now() + LOCK_WAIT_LIMIT_MS
  let waited = false
  for (;;) {
    signal?.throwIfAborted()
    const { server, error } = await tryListen()
    if (server) return server.unref()
    if (error.code !== 'EADDRINUSE') throw error
    if (Date.now() > until) {
      throw new Error(`the real-parser lock (${LOCK_HOST}:${LOCK_PORT}) was still held after ${LOCK_WAIT_LIMIT_MS / 1000} s`)
    }
    if (!waited) { waited = true; onWait(`${LOCK_HOST}:${LOCK_PORT}`, LOCK_WAIT_LIMIT_MS) }
    await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS))
  }
}

/** Release a lock taken with takeRealParserLock. */
const releaseRealParserLock = lock => new Promise(resolve => lock.close(resolve))

/** For a test file's before hook: take the lock, unless the runner already holds it for this file. */
async function holdRealParsers() {
  if (held || process.argv.includes(RUNNER_HOLDS_LOCK)) return
  held = await takeRealParserLock({
    onWait: address => process.stderr.write(`waiting for another real-parser test run to finish (${address})\n`),
  })
}

/** For a test file's after hook: release the lock if this file took it. */
async function releaseRealParsers() {
  if (!held) return
  const lock = held
  held = null
  await releaseRealParserLock(lock)
}

/** Pids of this process's own children; none should be alive between tests. */
function ownChildren() {
  try {
    return execFileSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number)
  } catch {
    // pgrep exits 1 when there are none.
    return []
  }
}

/** SIGKILL any child this process still has, then wait until the pool reports nothing running or held. */
async function settleParsers(parserLoad) {
  for (const pid of ownChildren()) {
    try { process.kill(pid, 'SIGKILL') } catch { /* Already gone. */ }
  }
  const until = Date.now() + SETTLE_LIMIT_MS
  for (;;) {
    const load = parserLoad()
    if (load.active === 0 && load.queued === 0 && load.processes === 0 && load.samplers === 0) return
    if (Date.now() > until) throw new Error(`parsers still held after clean-up: ${JSON.stringify(load)}`)
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

module.exports = { RUNNER_HOLDS_LOCK, holdRealParsers, releaseRealParserLock, releaseRealParsers, settleParsers,
  takeRealParserLock }
