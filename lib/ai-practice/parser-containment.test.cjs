// lib/ai-practice/parser-containment.test.cjs — On a real host that misbehaves, real parsers fail closed: an unreadable,
// missing or hung memory monitor stops the parse, a hung ps is killed, and a parser killed mid-parse is a crash. Only
// outcomes are asserted here; when each decision falls due, and kills that fail, are in parser-decisions.test.cjs.
// Run one at a time: in order within this file, and one real-parser file at a time across the batch.
const { after, afterEach, before, test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { strToU8, zipSync } = require('fflate')
const { measureResidentBytes, parseInIsolation, parserLoad, parserProbes } = require('./parser-process.ts')
const fixtures = require('./fixtures/adversarial-documents.cjs')
const { holdRealParsers, releaseRealParsers, settleParsers } = require('./fixtures/real-parsers.cjs')

const MB = 1024 * 1024
// Real processes on a possibly loaded machine: generous, and only reached when something is stuck.
const HARD_TIMEOUT = { timeout: 90_000 }
// Generous: a shell normally starts in milliseconds.
const PS_READY_LIMIT_MS = 30_000
// Requests the hung-ps test may make while waiting for one whose ps was ready in time; each takes about 2.5 s.
const READY_REQUESTS = 10
const validDocx = () => zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:document>') })
const settledCleanly = () => assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 },
  'no parser, sampler, slot or queue entry outlives the answer')
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' } }

// One real-parser file at a time on this machine, and a failed test leaves nothing behind for the next one.
before(holdRealParsers)
after(releaseRealParsers)
afterEach(() => settleParsers(parserLoad))

/** Point the memory monitor somewhere else for the duration of `work`. */
async function withProbes(probes, work) {
  const original = { ...parserProbes }
  Object.assign(parserProbes, probes)
  try { return await work() } finally { Object.assign(parserProbes, original) }
}

/**
 * Start the fake ps once by hand and wait, generously, until it has set its trap and recorded itself: true when it
 * did, false when it exited or never got that far. It is then killed and its pid forgotten, so only the samplers the
 * pool starts are counted.
 */
async function psReady(ps, pidLog) {
  const child = spawn(ps, [], { stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  const until = Date.now() + PS_READY_LIMIT_MS
  try {
    while (Date.now() < until && child.exitCode === null && child.signalCode === null) {
      if (fs.existsSync(pidLog) && fs.readFileSync(pidLog, 'utf8').trim()) return true
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    return false
  } finally {
    child.kill('SIGKILL')
    await exited
    fs.rmSync(pidLog, { force: true })
  }
}

/** A `ps` on PATH that ignores SIGTERM and never answers; each records its pid. Removed afterwards. */
async function withHungPs(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-practice-hung-ps-'))
  const pidLog = path.join(directory, 'pids')
  // exec keeps the pid and the ignored SIGTERM, so the recorded process is the one the monitor must stop.
  fs.writeFileSync(path.join(directory, 'ps'), `#!/bin/sh\ntrap '' TERM\necho $$ >> "${pidLog}"\nexec sleep 600\n`, { mode: 0o755 })
  const pids = () => fs.existsSync(pidLog) ? fs.readFileSync(pidLog, 'utf8').trim().split('\n').map(Number) : []
  const PATH = process.env.PATH
  process.env.PATH = `${directory}${path.delimiter}${PATH}`
  try {
    return await withProbes({ memorySource: 'ps' }, () => work(pids, () => psReady(path.join(directory, 'ps'), pidLog)))
  } finally {
    process.env.PATH = PATH
    for (const pid of pids().filter(alive)) process.kill(pid, 'SIGKILL')
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('the real probe measures a live process and reports a reaped one as gone', HARD_TIMEOUT, async () => {
  const own = await measureResidentBytes(process.pid)
  assert.ok(typeof own === 'number' && own > MB, `this process: ${own}`)
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(resolve => child.once('exit', resolve))
  assert.equal(await measureResidentBytes(child.pid), 'gone')
  assert.equal(parserLoad().samplers, 0, 'each ps is reaped before its sample is reported')
})

test('a missing /proc entry is believed only when the kernel confirms the process is gone', HARD_TIMEOUT, async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(resolve => child.once('exit', resolve))
  await withProbes({ memorySource: 'proc', procRoot: '/nonexistent/proc' }, async () => {
    assert.equal(await measureResidentBytes(child.pid), 'gone', 'ESRCH confirms the reaped process')
    await assert.rejects(measureResidentBytes(process.pid), { code: 'ENOENT' }, 'a live process is never reported gone')
  })
})

test('a host without /proc stops a live parser instead of letting it run to the deadline', HARD_TIMEOUT, async () => {
  const report = await withProbes({ memorySource: 'proc', procRoot: '/nonexistent/proc' },
    () => parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 60_000, maxResidentBytes: 1 }))
  // e8ecc4d took ENOENT as an exit, never measured this one-byte budget, and answered 'timeout' at the deadline.
  assert.equal(report.outcome, 'unmonitored')
  assert.deepEqual(report.result, { status: 'unavailable' })
  settledCleanly()
})

test('a memory monitor that cannot read stops the parse and answers unavailable', HARD_TIMEOUT, async () => {
  const denied = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-practice-proc-denied-'))
  fs.chmodSync(denied, 0o000)
  try {
    const report = await withProbes({ memorySource: 'proc', procRoot: denied },
      () => parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 60_000, maxResidentBytes: MB }))
    assert.equal(report.outcome, 'unmonitored')
    assert.deepEqual(report.result, { status: 'unavailable' }, 'the claim is released, the file is not judged')
    settledCleanly()
  } finally {
    fs.chmodSync(denied, 0o700)
    fs.rmSync(denied, { recursive: true, force: true })
  }
})

test('a ps that ignores SIGTERM is killed before its slot returns, across three failed requests', HARD_TIMEOUT, async t => {
  await withHungPs(async (pids, ready) => {
    // parser-decisions.test.cjs proves the decision on a fake clock; this proves it against a real ps, so it runs only
    // when one can be started, and otherwise reports itself skipped, never passed.
    if (!await ready()) {
      t.skip(`the fake ps did not start and set its trap within ${PS_READY_LIMIT_MS / 1000} s`)
      return
    }
    // Each sample gives its ps the 2 s sample timeout to start; a starved machine can miss that, so requests continue
    // (bounded) until one has exercised a ps that ignores SIGTERM.
    for (let request = 1; request <= 3 || (pids().length === 0 && request <= READY_REQUESTS); request += 1) {
      // The hung sample, not the deadline, ends each parse.
      const report = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 60_000 })
      assert.equal(report.outcome, 'unmonitored', `request ${request}`)
      assert.deepEqual(report.result, { status: 'unavailable' })
      // e8ecc4d left one live sampler behind per request; here the kernel confirms each one gone.
      // A shell that a loaded machine starts too slowly dies of the SIGTERM before it records itself.
      assert.ok(pids().length <= request, 'one sampler per request, none started while another was alive')
      assert.deepEqual(pids().filter(alive), [], `request ${request}: no sampler outlives its request`)
      settledCleanly()
    }
    if (pids().length === 0) {
      t.skip(`in ${READY_REQUESTS} requests no fake ps set its trap before the sample timeout stopped it`)
      return
    }
    assert.ok(pids().length >= 1, 'at least one sampler ignored SIGTERM and had to be killed')
    t.diagnostic(`${pids().length} sampler(s) ignored SIGTERM and were killed`)
  })
})

test('a parser that disappears mid-parse is answered as crashed and leaves nothing behind', HARD_TIMEOUT, async () => {
  // The deadline is far off, so only the kill can end this parse; 'crashed' rather than 'timeout' shows it was heard.
  const parsing = parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 60_000 })
  let pid
  // A loaded machine can take seconds to start node; the hard timeout bounds this.
  while (pid === undefined) {
    await new Promise(resolve => setTimeout(resolve, 20))
    try {
      pid = Number(execFileSync('pgrep', ['-P', String(process.pid), '-f', 'extract-parser'], { encoding: 'utf8' }).trim())
    } catch { /* Not started yet: pgrep exits 1 until it is. */ }
  }
  process.kill(pid, 'SIGKILL')
  const report = await parsing
  // Its memory sample can fail as it is torn down; that is still a crash, never 'unmonitored'.
  assert.equal(report.outcome, 'crashed')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  settledCleanly()
})

test('a parser whose spawn fails asynchronously leaves no phantom process behind', HARD_TIMEOUT, async () => {
  const execPath = process.execPath
  process.execPath = '/nonexistent/campusintel-node'
  let report
  try {
    report = await parseInIsolation('docx', validDocx())
  } finally {
    process.execPath = execPath
  }
  assert.equal(report.outcome, 'unavailable')
  assert.deepEqual(report.result, { status: 'unavailable' })
  settledCleanly()
})
