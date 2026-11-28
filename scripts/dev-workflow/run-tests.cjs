// scripts/dev-workflow/run-tests.cjs — Run explicit test files through node:test without CLI glob parsing.
// Node's `--test` positional arguments are glob patterns, so a literal Next.js route
// segment such as app/courses/[slug] matches nothing and the suite is silently skipped.
// The programmatic runner takes literal paths; this is the one owner of that argument shape.
// When the verifier itself runs under node:test (workflow tests), the inherited child-context
// marker would make run() skip every file; this process is always a fresh top-level runner.
delete process.env.NODE_TEST_CONTEXT
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('node:test')
const { tap } = require('node:test/reporters')
const realParsers = require('../../lib/ai-practice/fixtures/real-parsers.cjs')

// Nothing can hang a batch. Every file is supervised until it completes: a top-level test, or the time before, between
// or after its tests (loading, before and after hooks), that runs longer than this is stuck. It is named and the batch
// is stopped. node:test has no default per-test timeout, and --test-timeout does not reach the runner's file processes.
// Generous for a loaded machine: the slowest test takes about 16 s on an idle one.
const TEST_TIMEOUT_MS = 120_000
const WATCHDOG_INTERVAL_MS = 1_000
// Test files that run real parser processes (memory bombs, CPU-bound PDFs): their own batch, one file at a time, while
// this process holds the machine-wide real-parser lock. workflow.test.cjs keeps this list equal to the files that use
// lib/ai-practice/fixtures/real-parsers.cjs.
const SERIAL_TEST_FILES = [
  'lib/ai-practice/extract-isolation.test.cjs',
  'lib/ai-practice/extract.test.cjs',
  'lib/ai-practice/parser-containment.test.cjs',
]
const REPOSITORY = path.resolve(__dirname, '../..')
// While waiting for the lock, how often to say so again.
const LOCK_WAIT_NOTICE_MS = 60_000
// node:test's end-of-run counts, which each batch prints; the runner prints one set summed over both batches.
const SUMMARY_KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']
const SUMMARY_LINE = new RegExp(`^(${SUMMARY_KEYS.join('|')}) ([\\d.]+)$`)
const TAP_HEADER = 'TAP version 13\n'

/** Resolve caller-supplied test paths once, byte for byte, without glob interpretation. */
function testFiles(args, cwd = process.cwd()) {
  return args.map(file => path.resolve(cwd, file))
}

/** The real path of a file; test events name a file by its real path, the file's own events by the path as given. */
function realPath(file) {
  try { return fs.realpathSync(file) } catch { return file }
}

/** Top-level hooks a test file declares, as file:line by kind; node:test reports no hook events, so a stuck file's
 * hooks are named from its source. */
function declaredHooks(file) {
  const hooks = { before: [], after: [], beforeEach: [], afterEach: [] }
  let source = ''
  try { source = fs.readFileSync(file, 'utf8') } catch { return hooks }
  source.split('\n').forEach((text, index) => {
    const kind = /^(before|after|beforeEach|afterEach)\(/.exec(text)?.[1]
    if (kind) hooks[kind].push(`${path.relative(process.cwd(), file)}:${index + 1}`)
  })
  return hooks
}

const hookAt = (hooks, kind) => hooks[kind].length ? `the ${kind} hook at ${hooks[kind].join(' or ')}` : null

/**
 * Supervise one node:test run of `files` until it ends: `stop(reason)` names the first test, hook or silent file that
 * runs past the limit. Counts executed and failed tests into `totals`.
 */
function supervise(stream, files, testTimeoutMs, stop, totals) {
  // A file without tests still reports itself as one passing entry named by its path; ignore those.
  const isRealTest = event => !files.includes(event.name)
  // Per file: top-level tests declared and finished, the one running, and when the file last made progress (null
  // until it reports anything, since a file may still be waiting for a free slot).
  const states = new Map(files.map(file => [realPath(file), { file: realPath(file), enqueued: 0, completed: 0,
    test: null, since: null, done: false }]))
  let lastEvent = Date.now()
  const stateOf = event => { lastEvent = Date.now(); return event.file === undefined ? undefined : states.get(realPath(event.file)) }
  for (const name of ['test:stdout', 'test:stderr', 'test:diagnostic']) stream.on(name, stateOf)
  stream.on('test:enqueue', event => {
    const state = stateOf(event)
    if (!state || event.nesting !== 0 || !isRealTest(event)) return
    state.enqueued += 1
    state.since ??= Date.now()
  })
  stream.on('test:dequeue', event => {
    const state = stateOf(event)
    if (state && event.nesting === 0 && isRealTest(event)) state.test = { event, started: Date.now() }
  })
  stream.on('test:complete', event => {
    const state = stateOf(event)
    if (!state || event.nesting !== 0) return
    // The file itself has ended, however it ended.
    if (!isRealTest(event)) { state.done = true; state.test = null; return }
    state.test = null
    state.completed += 1
    state.since = Date.now()
  })
  stream.on('test:pass', event => { if (isRealTest(event)) totals.executed++ })
  stream.on('test:fail', event => { if (isRealTest(event)) totals.executed++; totals.failed++ })

  /** What has run past the limit, or null. */
  function stuck(now) {
    const seconds = `${testTimeoutMs / 1000} s`
    for (const state of states.values()) {
      const { file } = state
      if (state.done || state.since === null) continue
      const where = path.relative(process.cwd(), file)
      state.hooks ??= declaredHooks(file)
      if (state.test) {
        if (now - state.test.started <= testTimeoutMs) continue
        // A before hook runs once the first test is dequeued, so it cannot be told apart from that test.
        const around = [state.completed === 0 && hookAt(state.hooks, 'before'), hookAt(state.hooks, 'beforeEach'),
          hookAt(state.hooks, 'afterEach')].filter(Boolean)
        const { name, line } = state.test.event
        return `"${name}" (${where}:${line})${around.length ? `, or ${around.join(' or ')},` : ''} ran for more than ${seconds}`
      }
      if (now - state.since <= testTimeoutMs) continue
      if (state.completed < state.enqueued) return `${where}: nothing ran for more than ${seconds} between its tests`
      return `${where}: ${hookAt(state.hooks, 'after') ?? 'the file (it declares no after hook)'} ran for more than ` +
        `${seconds} after its last test`
    }
    // A file that never reports anything (stuck while loading) shows only as silence from every file.
    const silent = [...states.values()].filter(state => !state.done && state.since === null).map(state => state.file)
    if (silent.length && now - lastEvent > testTimeoutMs && ![...states.values()].some(state => state.test)) {
      return `${silent.map(file => path.relative(process.cwd(), file)).join(', ')} reported nothing for more than ${seconds}`
    }
    return null
  }

  const watchdog = setInterval(() => {
    const reason = stuck(Date.now())
    if (reason) stop(reason)
  }, WATCHDOG_INTERVAL_MS)
  stream.once('end', () => clearInterval(watchdog))
}

/**
 * Run literal test files: real-parser files as a serial batch under the machine-wide lock, everything else in parallel
 * beside them, each batch under the watchdog. Prints one TAP stream with one summary; the exit code reports failures,
 * stuck tests or hooks, and a lock that was never free.
 */
async function runFiles(files, { testTimeoutMs = TEST_TIMEOUT_MS,
  serialFiles = SERIAL_TEST_FILES.map(file => path.join(REPOSITORY, file)) } = {}) {
  const started = Date.now()
  const serialPaths = new Set(serialFiles.map(realPath))
  const serial = files.filter(file => serialPaths.has(realPath(file)))
  const parallel = files.filter(file => !serialPaths.has(realPath(file)))
  const stopped = new AbortController()
  const stop = reason => {
    if (stopped.signal.aborted) return
    process.stderr.write(`run-tests: ${reason}; the batch was stopped\n`)
    process.exitCode = 1
    stopped.abort()
  }
  const totals = { executed: 0, failed: 0 }
  const summary = Object.fromEntries(SUMMARY_KEYS.map(key => [key, 0]))

  /** One node:test run as TAP chunks, without its own header and summary. */
  function batch(batchFiles, options) {
    // forceExit: a file exits once its tests have finished, even if a failed one left a process, timer or interval.
    const stream = run({ files: batchFiles, forceExit: true, signal: stopped.signal, ...options })
    supervise(stream, batchFiles, testTimeoutMs, stop, totals)
    return stream.filter(({ type, data }) => {
      const count = type === 'test:diagnostic' && data.nesting === 0 && data.file === undefined &&
        SUMMARY_LINE.exec(data.message)
      if (count) summary[count[1]] += Number(count[2])
      return !count
    }).compose(tap).filter(chunk => chunk !== TAP_HEADER)
  }

  async function runSerial() {
    let lock
    let notice
    try {
      lock = await realParsers.takeRealParserLock({ signal: stopped.signal, onWait: (address, limitMs) => {
        const since = Date.now()
        const say = () => process.stderr.write(`run-tests: waiting for the real-parser lock (${address}): another test ` +
          `run is using real parsers; ${Math.round((Date.now() - since) / 1000)} s of at most ${limitMs / 60_000} min\n`)
        say()
        notice = setInterval(say, LOCK_WAIT_NOTICE_MS)
      } })
    } catch (error) {
      if (!stopped.signal.aborted) stop(`${error.message}; ${serial.length} real-parser test file(s) did not run`)
      return ''
    } finally {
      clearInterval(notice)
    }
    try {
      let output = ''
      for await (const chunk of batch(serial, { concurrency: 1, argv: [realParsers.RUNNER_HOLDS_LOCK] })) output += chunk
      return output
    } finally {
      await realParsers.releaseRealParserLock(lock)
    }
  }

  process.stdout.write(TAP_HEADER)
  const serialOutput = serial.length ? runSerial() : Promise.resolve('')
  if (parallel.length) for await (const chunk of batch(parallel, { concurrency: true })) process.stdout.write(chunk)
  process.stdout.write(await serialOutput)
  summary.duration_ms = Date.now() - started
  for (const key of SUMMARY_KEYS) process.stdout.write(`# ${key} ${summary[key]}\n`)
  if (totals.failed > 0) process.exitCode = 1
  else if (totals.executed === 0) {
    process.stderr.write(`run-tests: ${files.length} file(s) supplied but no tests executed\n`)
    process.exitCode = 1
  }
}

function main() {
  const files = testFiles(process.argv.slice(2))
  if (files.length === 0) {
    process.stderr.write('run-tests: no test files supplied\n')
    process.exitCode = 1
    return
  }
  runFiles(files).catch(error => {
    console.error('run-tests:', error)
    process.exitCode = 1
  })
}

if (require.main === module) main()

module.exports = { SERIAL_TEST_FILES, TEST_TIMEOUT_MS, runFiles, testFiles }
