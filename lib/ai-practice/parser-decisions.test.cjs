// lib/ai-practice/parser-decisions.test.cjs — Decisions the parser pool makes, on a fake clock with fake parser and ps
// processes, so the same steps give the same outcome on any machine under any load.
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { parseInIsolation, parserLoad } = require('./parser-process.ts')
const { MEMORY_SAMPLE_MS } = require('./memory-sampler.ts')
const { installFakeHost } = require('./fixtures/fake-host.cjs')

// The production value this pins; a change to it should fail here.
const SAMPLE_FAILURE_EXIT_WAIT_MS = 500
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

/** Start a parse and let it reach its first await; `report()` is the answer once there is one. */
async function start(limits = {}, kind = 'pdf') {
  let report
  const done = parseInIsolation(kind, new Uint8Array([1]), limits).then(value => { report = value })
  await host.clock.advance(0)
  return { done, report: () => report }
}

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
