// lib/ai-practice/parser-containment.test.cjs — The parser pool fails closed when the host misbehaves: an unreadable,
// missing or hung memory monitor stops the parse, a signal that fails or throws never crashes this process, and a
// parser or ps sampler that survives SIGKILL keeps its slot until it dies.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { ChildProcess, execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { monitorEventLoopDelay } = require('node:perf_hooks')
const util = require('node:util')
const { strToU8, zipSync } = require('fflate')
const { measureResidentBytes, parseInIsolation, parserLoad, parserProbes } = require('./parser-process.ts')
const fixtures = require('./fixtures/adversarial-documents.cjs')
const { EARLY_TIMER_TOLERANCE_MS } = require('./fixtures/timer-tolerance.cjs')

const MB = 1024 * 1024
const STALL_LIMIT_MS = 500
const validDocx = () => zipSync({ 'word/document.xml': strToU8('<w:document><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:document>') })
const settledCleanly = () => assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 },
  'no parser, sampler, slot or queue entry outlives the answer')
const alive = pid => { try { process.kill(pid, 0); return true } catch (error) { return error.code !== 'ESRCH' } }

async function untilIdle(withinMs) {
  const until = Date.now() + withinMs
  while (Date.now() < until) {
    const load = parserLoad()
    if (load.active === 0 && load.processes === 0 && load.samplers === 0) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`parsers still held: ${JSON.stringify(parserLoad())}`)
}

/** Point the memory monitor somewhere else for the duration of `work`. */
async function withProbes(probes, work) {
  const original = { ...parserProbes }
  Object.assign(parserProbes, probes)
  try { return await work() } finally { Object.assign(parserProbes, original) }
}

/** Replace ChildProcess#kill for the duration of `work`, counting each call. */
async function withKill(replacement, work) {
  const kill = ChildProcess.prototype.kill
  const calls = { count: 0 }
  ChildProcess.prototype.kill = function (...args) { calls.count += 1; return replacement.call(this, kill, ...args) }
  try { return await work(calls) } finally { ChildProcess.prototype.kill = kill }
}

/** A real errno failure, shaped as ChildProcess#kill raises or emits it. */
function killError(code) {
  const [errno] = [...util.getSystemErrorMap()].find(([, [name]]) => name === code)
  return Object.assign(new Error(`kill ${code}`), { errno, code, syscall: 'kill' })
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
    return await withProbes({ memorySource: 'ps' }, () => work(pids))
  } finally {
    process.env.PATH = PATH
    for (const pid of pids().filter(alive)) process.kill(pid, 'SIGKILL')
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('the real probe measures a live process and reports a reaped one as gone', async () => {
  const own = await measureResidentBytes(process.pid)
  assert.ok(typeof own === 'number' && own > MB, `this process: ${own}`)
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(resolve => child.once('exit', resolve))
  assert.equal(await measureResidentBytes(child.pid), 'gone')
  assert.equal(parserLoad().samplers, 0, 'each ps is reaped before its sample is reported')
})

test('a missing /proc entry is believed only when the kernel confirms the process is gone', async () => {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise(resolve => child.once('exit', resolve))
  await withProbes({ memorySource: 'proc', procRoot: '/nonexistent/proc' }, async () => {
    assert.equal(await measureResidentBytes(child.pid), 'gone', 'ESRCH confirms the reaped process')
    await assert.rejects(measureResidentBytes(process.pid), { code: 'ENOENT' }, 'a live process is never reported gone')
  })
})

test('a host without /proc stops a live parser at the first sample instead of letting it run to the deadline', async () => {
  const report = await withProbes({ memorySource: 'proc', procRoot: '/nonexistent/proc' },
    () => parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 10_000, maxResidentBytes: 1 }))
  assert.equal(report.outcome, 'unmonitored')
  assert.deepEqual(report.result, { status: 'unavailable' })
  // e8ecc4d took ENOENT as an exit, never measured this one-byte budget, and answered 'timeout' at 10 s.
  assert.ok(report.elapsedMs < 2_000, `answered after ${report.elapsedMs} ms`)
  settledCleanly()
})

test('a memory monitor that cannot read stops the parse and answers unavailable', async () => {
  const denied = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-practice-proc-denied-'))
  fs.chmodSync(denied, 0o000)
  try {
    const report = await withProbes({ memorySource: 'proc', procRoot: denied },
      () => parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 10_000, maxResidentBytes: MB }))
    assert.equal(report.outcome, 'unmonitored')
    assert.deepEqual(report.result, { status: 'unavailable' }, 'the claim is released, the file is not judged')
    assert.ok(report.elapsedMs < 2_000, `answered after ${report.elapsedMs} ms`)
    settledCleanly()
  } finally {
    fs.chmodSync(denied, 0o700)
    fs.rmSync(denied, { recursive: true, force: true })
  }
})

test('a ps that ignores SIGTERM is killed before its slot returns, across three failed requests', async () => {
  const stalls = monitorEventLoopDelay({ resolution: 10 })
  stalls.enable()
  await withHungPs(async pids => {
    for (let request = 1; request <= 3; request += 1) {
      const report = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 10_000 })
      assert.equal(report.outcome, 'unmonitored', `request ${request}`)
      assert.deepEqual(report.result, { status: 'unavailable' })
      assert.ok(report.elapsedMs >= 2_000 && report.elapsedMs < 5_000, `request ${request} answered after ${report.elapsedMs} ms`)
      // e8ecc4d left one live sampler behind per request; here the kernel confirms each one gone.
      // A shell that a loaded machine starts too slowly dies of the SIGTERM before it records itself.
      assert.ok(pids().length <= request, 'one sampler per request, none started while another was alive')
      assert.deepEqual(pids().filter(alive), [], `request ${request}: no sampler outlives its request`)
      settledCleanly()
    }
    assert.ok(pids().length >= 1, 'at least one sampler ignored SIGTERM and had to be killed')
  })
  stalls.disable()
  assert.ok(stalls.max / 1e6 < STALL_LIMIT_MS, `worst event-loop stall ${(stalls.max / 1e6).toFixed(0)} ms`)
})

test('a ps that cannot be killed is uncontained: its slot stays held, so samplers never exceed the pool', async () => {
  await withHungPs(async pids => {
    await withKill(function (kill, ...args) { return this.spawnfile === 'ps' ? false : kill.apply(this, args) }, async () => {
      for (let request = 1; request <= 2; request += 1) {
        const report = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 10_000 })
        assert.equal(report.outcome, 'uncontained', `request ${request}`)
        assert.deepEqual(report.result, { status: 'unavailable' })
        assert.ok(report.elapsedMs >= 4_000 && report.elapsedMs < 7_000, `request ${request} answered after ${report.elapsedMs} ms`)
        assert.deepEqual(parserLoad(), { active: request, queued: 0, processes: 0, samplers: request },
          'the parser is dead, the live sampler keeps the slot')
      }
      const refused = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { queueWaitMs: 200 })
      assert.equal(refused.outcome, 'unavailable', 'a third request starts neither a parser nor a sampler')
      assert.equal(pids().length, 2)
      assert.equal(pids().filter(alive).length, 2)
    })
    // The kill is retried while quarantined; once it lands, both slots return.
    await untilIdle(3_000)
    assert.deepEqual(pids().filter(alive), [])
  })
  assert.deepEqual((await parseInIsolation('docx', validDocx())).result, { status: 'ok', text: 'Notes\n' })
  settledCleanly()
})

test('a parser that survives SIGKILL keeps its slot, so live parsers never exceed the pool', async () => {
  // Signal delivery fails: Node returns false and the process keeps running.
  await withKill(() => false, async () => {
    const stuck = await Promise.all([1, 2].map(() => parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 300 })))
    for (const report of stuck) {
      assert.equal(report.outcome, 'uncontained')
      assert.deepEqual(report.result, { status: 'unavailable' })
      assert.ok(report.elapsedMs >= 2_300 - EARLY_TIMER_TOLERANCE_MS && report.elapsedMs < 6_000, `answered after ${report.elapsedMs} ms`)
    }
    const { active, queued, processes } = parserLoad()
    assert.deepEqual({ active, queued, processes }, { active: 2, queued: 0, processes: 2 }, 'both slots stay quarantined')
    const refused = await parseInIsolation('docx', validDocx(), { queueWaitMs: 200 })
    assert.equal(refused.outcome, 'unavailable', 'no third parser is started beside them')
    assert.equal(parserLoad().processes, 2)
  })
  await untilIdle(3_000)
  assert.deepEqual((await parseInIsolation('docx', validDocx())).result, { status: 'ok', text: 'Notes\n' })
  settledCleanly()
})

for (const [name, failure] of [
  ['throws UV_ENOSYS', () => { throw killError('ENOSYS') }],
  ['emits EPERM', function () { this.emit('error', killError('EPERM')); return false }],
  ['alternately throws EINVAL and emits EPERM', function () {
    if ((this.failures = (this.failures ?? 0) + 1) % 2) throw killError('EINVAL')
    this.emit('error', killError('EPERM'))
    return false
  }],
]) {
  test(`a kill that ${name} never crashes this process and keeps the slot until the parser dies`, async () => {
    const crashes = []
    const onCrash = error => crashes.push(error)
    process.on('uncaughtException', onCrash)
    try {
      await withKill(function (kill, ...args) { return this.spawnfile === 'ps' ? kill.apply(this, args) : failure.call(this) },
        async calls => {
          const report = await parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 300 })
          assert.equal(report.outcome, 'uncontained')
          assert.deepEqual(report.result, { status: 'unavailable' })
          // Answered at the deadline plus the exit grace, not left unresolved.
          assert.ok(report.elapsedMs >= 2_300 - EARLY_TIMER_TOLERANCE_MS && report.elapsedMs < 6_000, `answered after ${report.elapsedMs} ms`)
          assert.ok(calls.count >= 4, `the kill was retried: ${calls.count} attempts`)
          const { active, processes } = parserLoad()
          assert.deepEqual({ active, processes }, { active: 1, processes: 1 }, 'the live parser keeps its slot')
          const retried = calls.count
          await new Promise(resolve => setTimeout(resolve, 600))
          assert.ok(calls.count > retried, 'and retries continue while it lives')
        })
      await untilIdle(3_000)
    } finally {
      process.off('uncaughtException', onCrash)
    }
    assert.deepEqual(crashes, [])
    settledCleanly()
  })
}

test('a parser that disappears mid-parse is answered as crashed and leaves nothing behind', async () => {
  const parsing = parseInIsolation('pdf', fixtures.cpuBoundPdf(), { timeoutMs: 10_000 })
  let pid
  for (let attempt = 0; attempt < 100 && pid === undefined; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 20))
    try {
      pid = Number(execFileSync('pgrep', ['-P', String(process.pid), '-f', 'extract-parser'], { encoding: 'utf8' }).trim())
    } catch { /* Not started yet: pgrep exits 1 until it is. */ }
  }
  assert.ok(pid > 0, 'the parser process was found')
  process.kill(pid, 'SIGKILL')
  const report = await parsing
  assert.equal(report.outcome, 'crashed')
  assert.deepEqual(report.result, { status: 'rejected', reason: 'corrupt' })
  assert.ok(report.elapsedMs < 2_000, `answered after ${report.elapsedMs} ms`)
  settledCleanly()
})

test('a parser whose spawn fails asynchronously leaves no phantom process behind', async () => {
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
