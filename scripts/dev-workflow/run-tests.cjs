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

// Nothing can hang a batch. Every file is supervised until it completes: a top-level test, or the time before, between
// or after its tests (loading, before and after hooks), that runs longer than this is stuck. It is named and the batch
// is stopped. node:test has no default per-test timeout, and --test-timeout does not reach the runner's file processes.
// Generous for a loaded machine: the slowest test takes about 16 s on an idle one.
const TEST_TIMEOUT_MS = 120_000
const WATCHDOG_INTERVAL_MS = 1_000
// A test file announces on stderr a wait whose limit it enforces itself (lib/ai-practice/fixtures/real-parsers.cjs: one
// real-parser file at a time). Until it is done waiting, that file's time does not count; afterwards its clock restarts.
const WAIT_LINE = /^run-tests: (done )?waiting for .+$/gm

/** Resolve caller-supplied test paths once, byte for byte, without glob interpretation. */
function testFiles(args, cwd = process.cwd()) {
  return args.map(file => path.resolve(cwd, file))
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

/** Run literal test files under the watchdog; the exit code reports failures and stuck tests or hooks. */
function runFiles(files, { testTimeoutMs = TEST_TIMEOUT_MS } = {}) {
  let executed = 0
  let failed = 0
  // A file without tests still reports itself as one passing entry named by its path; ignore those.
  const isRealTest = event => !files.includes(event.name)
  const stopped = new AbortController()
  // forceExit: a file exits once its tests have finished, even if a failed one left a process, timer or interval.
  const stream = run({ files, concurrency: true, forceExit: true, signal: stopped.signal })
  // Per file: top-level tests declared and finished, the one running, and when the file last made progress (null
  // until it reports anything, since a file may still be waiting for a free slot).
  // Keyed by real path: test events name a file by its real path, the file's own events by the path as given.
  const realPaths = new Map()
  const real = file => {
    if (!realPaths.has(file)) { try { realPaths.set(file, fs.realpathSync(file)) } catch { realPaths.set(file, file) } }
    return realPaths.get(file)
  }
  const states = new Map(files.map(file => [real(file), { file: real(file), enqueued: 0, completed: 0, test: null,
    since: null, waiting: false, done: false }]))
  let lastEvent = Date.now()
  const stateOf = event => { lastEvent = Date.now(); return event.file === undefined ? undefined : states.get(real(event.file)) }
  for (const name of ['test:stdout', 'test:diagnostic']) stream.on(name, stateOf)
  stream.on('test:stderr', event => {
    const state = stateOf(event)
    const last = state && [...String(event.message).matchAll(WAIT_LINE)].at(-1)
    if (!last) return
    state.waiting = !last[1]
    if (state.waiting) return
    const now = Date.now()
    if (state.test) state.test.started = now
    if (state.since !== null) state.since = now
  })
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

  /** What has run past the limit, or null. */
  function stuck(now) {
    const seconds = `${testTimeoutMs / 1000} s`
    for (const state of states.values()) {
      const { file } = state
      if (state.done || state.since === null || state.waiting) continue
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
    const busy = [...states.values()].some(state => state.test || state.waiting)
    if (silent.length && now - lastEvent > testTimeoutMs && !busy) {
      return `${silent.map(file => path.relative(process.cwd(), file)).join(', ')} reported nothing for more than ${seconds}`
    }
    return null
  }

  const watchdog = setInterval(() => {
    const reason = stuck(Date.now())
    if (!reason) return
    process.stderr.write(`run-tests: ${reason}; the batch was stopped\n`)
    process.exitCode = 1
    clearInterval(watchdog)
    stopped.abort()
  }, WATCHDOG_INTERVAL_MS)
  stream.on('test:pass', event => { if (isRealTest(event)) executed++ })
  stream.on('test:fail', event => { if (isRealTest(event)) executed++; failed++ })
  stream.on('end', () => {
    clearInterval(watchdog)
    if (failed > 0) process.exitCode = 1
    else if (executed === 0) {
      process.stderr.write(`run-tests: ${files.length} file(s) supplied but no tests executed\n`)
      process.exitCode = 1
    }
  })
  stream.compose(tap).pipe(process.stdout)
}

function main() {
  const files = testFiles(process.argv.slice(2))
  if (files.length === 0) {
    process.stderr.write('run-tests: no test files supplied\n')
    process.exitCode = 1
    return
  }
  runFiles(files)
}

if (require.main === module) main()

module.exports = { TEST_TIMEOUT_MS, runFiles, testFiles }
