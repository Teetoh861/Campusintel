// lib/ai-practice/fixtures/real-parsers.cjs — Shared rules for test files that run real parser processes: only one
// such file parses at a time on this machine, and a failed test leaves no child, sampler or held slot behind.
const { execFileSync } = require('node:child_process')
const net = require('node:net')

// Generous: SIGKILL normally lands in milliseconds; only a stuck process takes this long.
const SETTLE_LIMIT_MS = 10_000
const POLL_MS = 25
// The test runner runs files in parallel; real parsers (memory bombs, CPU-bound PDFs) run one file at a time. The lock
// is a listening socket on this loopback port: the kernel admits one holder and frees it the moment that process ends,
// however it ends, so no lock file is left behind to go stale, be recovered or be deleted by the wrong process.
const LOCK_HOST = '127.0.0.1'
const LOCK_PORT = 47_291
// Longer than any real-parser file takes on a loaded machine; past it the holder is stuck, and this file fails.
const LOCK_WAIT_LIMIT_MS = 10 * 60_000
const LOCK_POLL_MS = 100

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

/** Take the machine-wide real-parser lock, waiting while another test file holds it. */
async function holdRealParsers() {
  if (held) return
  const until = Date.now() + LOCK_WAIT_LIMIT_MS
  for (;;) {
    const { server, error } = await tryListen()
    if (server) {
      // Never keeps this process alive; the lock goes with the process.
      held = server.unref()
      return
    }
    if (error.code !== 'EADDRINUSE') throw error
    if (Date.now() > until) throw new Error(`real parser tests are still held by another process (${LOCK_HOST}:${LOCK_PORT})`)
    await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS))
  }
}

/** Release the lock if this process holds it. */
async function releaseRealParsers() {
  if (!held) return
  const server = held
  held = null
  await new Promise(resolve => server.close(resolve))
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

module.exports = { holdRealParsers, releaseRealParsers, settleParsers }
