// lib/ai-practice/fixtures/real-parsers.cjs — Shared rules for test files that run real parser processes: only one
// such file parses at a time on this machine, and a failed test leaves no child, sampler or held slot behind.
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Generous: SIGKILL normally lands in milliseconds; only a stuck process takes this long.
const SETTLE_LIMIT_MS = 10_000
const POLL_MS = 25
// The test runner runs files in parallel; real parsers (memory bombs, CPU-bound PDFs) run one file at a time.
const LOCK = path.join(os.tmpdir(), 'campusintel-real-parser-tests.lock')
// Longer than any real-parser file takes on a loaded machine; past it the holder is stuck, and this file fails.
const LOCK_WAIT_LIMIT_MS = 10 * 60_000
const LOCK_POLL_MS = 100

const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' } }
const lockHolder = () => { try { return Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) } catch { return 0 } }

/** Take the machine-wide real-parser lock, waiting for another file to finish; a dead holder's lock is taken over. */
async function holdRealParsers() {
  const until = Date.now() + LOCK_WAIT_LIMIT_MS
  for (;;) {
    try {
      fs.mkdirSync(LOCK)
      fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid))
      process.once('exit', releaseRealParsers)
      return
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    const holder = lockHolder()
    // A holder that died without releasing (or had not yet written its pid when it died) leaves a stale lock.
    if (holder === 0 ? lockAgeMs() > LOCK_POLL_MS * 10 : !alive(holder)) fs.rmSync(LOCK, { recursive: true, force: true })
    else if (Date.now() > until) throw new Error(`real parser tests are still held by process ${holder}`)
    else await new Promise(resolve => setTimeout(resolve, LOCK_POLL_MS))
  }
}

function lockAgeMs() {
  try { return Date.now() - fs.statSync(LOCK).mtimeMs } catch { return 0 }
}

/** Release the lock if this process holds it. */
function releaseRealParsers() {
  if (lockHolder() === process.pid) fs.rmSync(LOCK, { recursive: true, force: true })
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
