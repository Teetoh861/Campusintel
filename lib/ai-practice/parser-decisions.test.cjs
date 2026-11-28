// lib/ai-practice/parser-decisions.test.cjs — Every decision the parser pool makes, on a fake clock with fake parser
// and ps processes: deadline, memory budget, stalled and failed samples, crash versus unmonitored, kills that fail,
// and the queue. The same steps give the same outcome on any machine under any load. What needs a real child process
// (it is really stopped, nothing is left running) is in extract-isolation.test.cjs and parser-containment.test.cjs.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const util = require('node:util')
const { parseInIsolation, parserLoad } = require('./parser-process.ts')
const { MEMORY_SAMPLE_MS, MEMORY_SAMPLE_TIMEOUT_MS, liveSamplers } = require('./memory-sampler.ts')
const { supervise } = require('./child-supervision.ts')
const { installFakeHost, pendingSample } = require('./fixtures/fake-host.cjs')

// The production values these tests pin; a change to any of them should fail here.
const PARSER_EXIT_GRACE_MS = 2_000
const SAMPLE_FAILURE_EXIT_WAIT_MS = 500
const KILL_RETRY_MS = 250
const MAX_QUEUED_PARSES = 8
const MB = 1024 * 1024
// Time here is fake; a test still running after this many real milliseconds is stuck.
const HARD_TIMEOUT = { timeout: 10_000 }
const S = MEMORY_SAMPLE_MS

let host
afterEach(async () => {
  if (!host) return
  // Whatever a failed test left behind dies and is reaped, so the pool is empty for the next test.
  for (const child of host.processes.values()) { child.onKill = 'die'; child.exit({ signal: 'SIGKILL' }) }
  await host.clock.advance(60_000)
  host.uninstall()
  host = undefined
})

const idle = () => assert.deepEqual(parserLoad(), { active: 0, queued: 0, processes: 0, samplers: 0 },
  'no parser, sampler, slot or queue entry outlives the answer')
const answered = (outcome, extra = {}) => ({ outcome, ...extra })
const small = () => { const sample = pendingSample(); sample.resolve(MB); return sample }

/** Start a parse and let it reach its first await; `report()` is the answer once there is one. */
async function start(limits = {}, kind = 'pdf') {
  let report
  const done = parseInIsolation(kind, new Uint8Array([1]), limits).then(value => { report = value })
  await host.clock.advance(0)
  return { done, report: () => report }
}

/** A real errno failure, shaped as ChildProcess#kill raises or emits it. */
function killError(code) {
  const [errno] = [...util.getSystemErrorMap()].find(([, [name]]) => name === code)
  return Object.assign(new Error(`kill ${code}`), { errno, code, syscall: 'kill' })
}

test('the deadline stops the parse when it falls due, not before, and the slot returns once the parser is dead', HARD_TIMEOUT, async () => {
  host = installFakeHost({ sample: small, parser: () => ({ exitDelayMs: 7 }) })
  const parse = await start({ timeoutMs: 1_000 })
  await host.clock.advance(999)
  assert.equal(parse.report(), undefined)
  assert.deepEqual(host.parsers[0].signals, [])
  await host.clock.advance(1)
  assert.deepEqual(host.parsers[0].signals, ['SIGKILL'])
  assert.equal(parse.report(), undefined, 'the answer waits for the parser to be confirmed dead')
  await host.clock.advance(7)
  assert.deepEqual(parse.report(), { result: { status: 'rejected', reason: 'corrupt' }, outcome: 'timeout',
    elapsedMs: 1_007, peakResidentBytes: MB })
  idle()
})

test('resident memory above the budget stops the parse at that sample; at the budget it carries on', HARD_TIMEOUT, async () => {
  const readings = [10 * MB, 100 * MB, 101 * MB]
  host = installFakeHost({ sample: index => { const sample = pendingSample(); sample.resolve(readings[index]); return sample } })
  const parse = await start({ maxResidentBytes: 100 * MB })
  await host.clock.advance(2 * S)
  assert.equal(parse.report(), undefined)
  await host.clock.advance(S)
  assert.deepEqual(parse.report(), { result: { status: 'rejected', reason: 'too-much-text' }, outcome: 'memory',
    elapsedMs: 3 * S, peakResidentBytes: 101 * MB })
  assert.equal(host.samples.length, 3, 'one sample per interval')
  idle()
})

test('a sample that never completes stops the parse once it is overdue, and no second sample is started', HARD_TIMEOUT, async () => {
  host = installFakeHost()
  const parse = await start({ timeoutMs: 60_000 })
  // Checked on each sampling tick: the first tick more than the sample timeout after the sample started.
  const due = S + (Math.floor(MEMORY_SAMPLE_TIMEOUT_MS / S) + 1) * S
  await host.clock.advance(due - 1)
  assert.equal(parse.report(), undefined)
  await host.clock.advance(1)
  assert.deepEqual(parse.report(), { result: { status: 'unavailable' }, outcome: 'unmonitored', elapsedMs: due,
    peakResidentBytes: 0 })
  assert.equal(host.samples.length, 1)
  assert.ok(host.errors.some(line => line.includes('a sample did not complete')))
  idle()
})

const VMRSS_MISSING = () => new Error('VmRSS missing from /proc status')
// Each case runs at the first sample, with that sample in flight. A parser that has died is always 'crashed'.
for (const [name, steps, expected] of [
  ['dies, then its in-flight sample fails as its /proc entry is torn down', ({ parser, sample }) => {
    parser.exit({ signal: 'SIGKILL' }); sample.reject(VMRSS_MISSING())
  }, answered('crashed', { at: S })],
  ['has its sample fail, and its exit arrives 1 ms later', ({ parser, sample }) => {
    parser.exitDelayMs = 1; parser.exit({ signal: 'SIGKILL' }); sample.reject(VMRSS_MISSING())
  }, answered('crashed', { at: S + 1 })],
  ['has its sample fail, and its exit arrives just before the wait ends', ({ parser, sample }) => {
    parser.exitDelayMs = SAMPLE_FAILURE_EXIT_WAIT_MS - 1; parser.exit({ signal: 'SIGKILL' }); sample.reject(VMRSS_MISSING())
  }, answered('crashed', { at: S + SAMPLE_FAILURE_EXIT_WAIT_MS - 1 })],
  ['has its sample fail, and its exit arrives in the loop iteration that ends the wait', ({ parser, sample }) => {
    parser.exitDelayMs = SAMPLE_FAILURE_EXIT_WAIT_MS; parser.exit({ signal: 'SIGKILL' }); sample.reject(VMRSS_MISSING())
  }, answered('crashed', { at: S + SAMPLE_FAILURE_EXIT_WAIT_MS })],
  ['is reported gone by its sample before its exit arrives', ({ parser, sample }) => {
    parser.exitDelayMs = 100; parser.exit({ signal: 'SIGKILL' }); sample.resolve('gone')
  }, answered('crashed', { at: S + 100 })],
  ['has ps fail on its zombie (exit 1, but the kernel still knows the pid)', ({ parser, sample }) => {
    parser.exitDelayMs = 30; parser.exit({ signal: 'SIGKILL' }); sample.reject(new Error('ps exited with 1'))
  }, answered('crashed', { at: S + 30 })],
  ['stays alive but cannot be measured', ({ sample }) => {
    sample.reject(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
  }, answered('unmonitored', { at: S + SAMPLE_FAILURE_EXIT_WAIT_MS })],
]) {
  test(`a parser that ${name}: ${expected.outcome}`, HARD_TIMEOUT, async () => {
    host = installFakeHost()
    const parse = await start({ timeoutMs: 60_000 })
    await host.clock.advance(S)
    assert.equal(host.samples.length, 1)
    steps({ parser: host.parsers[0], sample: host.samples[0] })
    if (expected.at > S) {
      await host.clock.advance(expected.at - S - 1)
      assert.equal(parse.report(), undefined, 'not settled early')
    }
    await host.clock.advance(expected.at > S ? 1 : 0)
    const report = parse.report()
    assert.equal(report?.outcome, expected.outcome)
    assert.deepEqual(report.result, expected.outcome === 'crashed'
      ? { status: 'rejected', reason: 'corrupt' } : { status: 'unavailable' })
    assert.equal(report.elapsedMs, expected.at)
    if (host.samples[0].outcome === 'rejected') {
      assert.equal(host.samples.length, 1, 'no further sample is started while waiting for the exit')
    }
    idle()
  })
}

test('a parser that survives SIGKILL is answered uncontained after the exit grace and keeps its slot', HARD_TIMEOUT, async () => {
  host = installFakeHost({ sample: small, parser: index => index < 2 ? { onKill: 'ignore' } : {} })
  const stuck = [await start({ timeoutMs: 300 }), await start({ timeoutMs: 300 })]
  await host.clock.advance(300 + PARSER_EXIT_GRACE_MS - 1)
  assert.deepEqual(stuck.map(parse => parse.report()), [undefined, undefined])
  await host.clock.advance(1)
  for (const parse of stuck) {
    assert.deepEqual(parse.report(), { result: { status: 'unavailable' }, outcome: 'uncontained',
      elapsedMs: 300 + PARSER_EXIT_GRACE_MS, peakResidentBytes: MB })
  }
  assert.deepEqual(parserLoad(), { active: 2, queued: 0, processes: 2, samplers: 0 }, 'both slots stay quarantined')
  // The first SIGKILL at the deadline, then one every retry interval.
  const signals = host.parsers[0].signals.length
  assert.equal(signals, 1 + PARSER_EXIT_GRACE_MS / KILL_RETRY_MS)
  const refused = await start({ queueWaitMs: 200 })
  await host.clock.advance(200)
  assert.equal(refused.report().outcome, 'unavailable', 'no third parser is started beside them')
  assert.equal(host.parsers.length, 2)
  // The kill keeps being retried; once it lands, both slots return.
  for (const parser of host.parsers) parser.onKill = 'die'
  await host.clock.advance(KILL_RETRY_MS)
  assert.ok(host.parsers[0].signals.length > signals)
  idle()
  const after = await start()
  host.parsers[2].answer({ status: 'ok', text: 'Notes\n' })
  await host.clock.advance(0)
  assert.deepEqual(after.report().result, { status: 'ok', text: 'Notes\n' })
  idle()
})

for (const [name, onKill] of [
  ['throws UV_ENOSYS', () => { throw killError('ENOSYS') }],
  ['emits EPERM', function () { this.emit('error', killError('EPERM')); return false }],
  ['alternately throws EINVAL and emits EPERM', function () {
    if (this.signals.length % 2) throw killError('EINVAL')
    this.emit('error', killError('EPERM'))
    return false
  }],
]) {
  test(`a kill that ${name} never crashes this process and keeps the slot until the parser dies`, HARD_TIMEOUT, async () => {
    const crashes = []
    const onCrash = error => crashes.push(error)
    process.on('uncaughtException', onCrash)
    try {
      host = installFakeHost({ sample: small, parser: () => ({ onKill }) })
      const parse = await start({ timeoutMs: 300 })
      await host.clock.advance(300 + PARSER_EXIT_GRACE_MS)
      assert.equal(parse.report().outcome, 'uncontained')
      assert.deepEqual(parse.report().result, { status: 'unavailable' })
      const { active, processes } = parserLoad()
      assert.deepEqual({ active, processes }, { active: 1, processes: 1 }, 'the live parser keeps its slot')
      const retried = host.parsers[0].signals.length
      await host.clock.advance(3 * KILL_RETRY_MS)
      assert.equal(host.parsers[0].signals.length, retried + 3, 'and retries continue while it lives')
      host.parsers[0].exit({ signal: 'SIGKILL' })
      await host.clock.advance(0)
      idle()
    } finally {
      process.off('uncaughtException', onCrash)
    }
    assert.deepEqual(crashes, [])
    assert.equal(host.errors.filter(line => line.includes('failed') || line.includes('could not be signalled')).length, 1,
      'one report per process, however often the retried kill fails')
  })
}

test('a ps sampler that cannot be killed is uncontained: its slot stays held, so samplers never exceed the pool', HARD_TIMEOUT, async () => {
  const samplers = []
  host = installFakeHost({ sample: () => {
    const ps = host.spawnPs({ onKill: 'ignore' })
    samplers.push(ps)
    return pendingSample(supervise(ps, 'memory sampler', liveSamplers))
  } })
  const stalled = S + (Math.floor(MEMORY_SAMPLE_TIMEOUT_MS / S) + 1) * S
  for (let request = 1; request <= 2; request += 1) {
    const parse = await start({ timeoutMs: 60_000 })
    await host.clock.advance(stalled + PARSER_EXIT_GRACE_MS)
    assert.equal(parse.report().outcome, 'uncontained', `request ${request}`)
    assert.deepEqual(parse.report().result, { status: 'unavailable' })
    assert.deepEqual(parserLoad(), { active: request, queued: 0, processes: 0, samplers: request },
      'the parser is dead, the live sampler keeps the slot')
  }
  const refused = await start({ queueWaitMs: 200 })
  await host.clock.advance(200)
  assert.equal(refused.report().outcome, 'unavailable', 'a third request starts neither a parser nor a sampler')
  assert.equal(host.parsers.length, 2)
  assert.equal(samplers.length, 2)
  // SIGTERM first, then SIGKILL on every retry while it lives.
  assert.equal(samplers[0].signals[0], 'SIGTERM')
  assert.ok(samplers[0].signals.slice(1).every(signal => signal === 'SIGKILL') && samplers[0].signals.length > 2)
  for (const ps of samplers) ps.onKill = 'die'
  await host.clock.advance(KILL_RETRY_MS)
  idle()
})

test('at most two parsers run at once; a waiter gives up when its wait runs out, a ninth is refused at once', HARD_TIMEOUT, async () => {
  host = installFakeHost({ sample: small })
  const running = [await start({ queueWaitMs: 5_000 }), await start({ queueWaitMs: 5_000 })]
  const queued = []
  for (let index = 0; index < MAX_QUEUED_PARSES - 1; index += 1) queued.push(await start({ queueWaitMs: 5_000 }, 'docx'))
  assert.deepEqual(parserLoad(), { active: 2, queued: MAX_QUEUED_PARSES - 1, processes: 2, samplers: 0 })
  const impatient = await start({ queueWaitMs: 100 }, 'docx')
  await host.clock.advance(99)
  assert.equal(impatient.report(), undefined)
  await host.clock.advance(1)
  assert.deepEqual(impatient.report(), { result: { status: 'unavailable' }, outcome: 'unavailable', elapsedMs: 100,
    peakResidentBytes: 0 })
  queued.push(await start({ queueWaitMs: 5_000 }, 'docx'))
  assert.equal(parserLoad().queued, MAX_QUEUED_PARSES)
  const overflow = await start({}, 'docx')
  assert.deepEqual(overflow.report(), { result: { status: 'unavailable' }, outcome: 'unavailable', elapsedMs: 0,
    peakResidentBytes: 0 }, 'refused without waiting')
  // Each answer frees a slot for the longest waiter, one parser per freed slot.
  for (let index = 0; index < running.length + queued.length; index += 1) {
    assert.ok(host.parsers.filter(parser => parser.state === 'alive').length <= 2, 'never more than two parsers alive')
    host.parsers[index].answer({ status: 'ok', text: `parse ${index}` })
    await host.clock.advance(0)
  }
  assert.deepEqual(queued.map(parse => parse.report().result.text), queued.map((_, index) => `parse ${index + 2}`),
    'waiters are served in the order they arrived')
  assert.ok(running.every(parse => parse.report().outcome === 'ok'))
  idle()
})

test('a waiter whose wait runs out is never granted a slot later', HARD_TIMEOUT, async () => {
  host = installFakeHost({ sample: small })
  const running = [await start(), await start()]
  const gaveUp = await start({ queueWaitMs: 100 }, 'docx')
  await host.clock.advance(100)
  assert.equal(gaveUp.report().outcome, 'unavailable')
  host.parsers[0].answer({ status: 'ok', text: 'a' })
  host.parsers[1].answer({ status: 'ok', text: 'b' })
  await host.clock.advance(0)
  assert.equal(host.parsers.length, 2, 'no parser was started for the waiter that left')
  assert.ok(running.every(parse => parse.report().outcome === 'ok'))
  idle()
})

const CORRUPT = { status: 'rejected', reason: 'corrupt' }
const TOO_MUCH = { status: 'rejected', reason: 'too-much-text' }
for (const [name, act, outcome, result] of [
  ['answers with text', parser => parser.answer({ status: 'ok', text: 'Notes\n' }), 'ok', { status: 'ok', text: 'Notes\n' }],
  ['answers with a rejection', parser => parser.answer({ status: 'rejected', reason: 'encrypted' }), 'ok',
    { status: 'rejected', reason: 'encrypted' }],
  ['answers unavailable', parser => parser.answer({ status: 'unavailable' }), 'unavailable', { status: 'unavailable' }],
  ['answers with something malformed', parser => parser.answer({ status: 'ok', text: 5 }), 'crashed', CORRUPT],
  ['answers with an unknown rejection', parser => parser.answer({ status: 'rejected', reason: 'virus' }), 'crashed', CORRUPT],
  ['is aborted by V8 (SIGABRT)', parser => parser.exit({ signal: 'SIGABRT' }), 'memory', TOO_MUCH],
  ['exits 134', parser => parser.exit({ code: 134 }), 'memory', TOO_MUCH],
  ['reports a heap out of memory', parser => parser.exit({ code: 1, stderr: 'FATAL ERROR: JavaScript heap out of memory' }),
    'memory', TOO_MUCH],
  ['is missing from the deployment', parser => parser.exit({ code: 1, stderr: "Error: Cannot find module '/x'" }),
    'unavailable', { status: 'unavailable' }],
  ['exits without answering', parser => parser.exit({ code: 0 }), 'crashed', CORRUPT],
]) {
  test(`a parser that ${name}: ${outcome}`, HARD_TIMEOUT, async () => {
    host = installFakeHost({ sample: small, parser: () => ({ exitDelayMs: 3 }) })
    const parse = await start()
    act(host.parsers[0])
    await host.clock.advance(2)
    assert.equal(parse.report(), undefined, 'the answer waits for the parser to be confirmed dead')
    await host.clock.advance(1)
    assert.equal(parse.report().outcome, outcome)
    assert.deepEqual(parse.report().result, result)
    idle()
  })
}

test('a request the parser cannot receive is crashed; a parser that cannot start is unavailable', HARD_TIMEOUT, async () => {
  host = installFakeHost({ sample: small, parser: index => [{}, { throws: new Error('EAGAIN') }, { pid: undefined }][index] })
  host.sendError = new Error('channel closed')
  const unsent = await start()
  await host.clock.advance(0)
  assert.equal(unsent.report().outcome, 'crashed')
  host.sendError = null
  const unspawned = await start()
  assert.equal(unspawned.report().outcome, 'unavailable', 'fork threw')
  const failed = await start()
  await host.clock.advance(0)
  assert.equal(failed.report().outcome, 'unavailable', 'the spawn failed asynchronously')
  assert.deepEqual(host.forks, ['spawned', 'threw', 'no pid'], 'each case ran once, in order')
  assert.equal(host.parsers[1].pid, undefined, 'the failed spawn kept its explicit undefined pid')
  assert.ok(host.errors.some(line => line.includes('spawn ENOENT')), 'and its asynchronous error was heard')
  idle()
})
