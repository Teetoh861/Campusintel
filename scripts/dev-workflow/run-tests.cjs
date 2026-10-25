// scripts/dev-workflow/run-tests.cjs — Run explicit test files through node:test without CLI glob parsing.
// Node's `--test` positional arguments are glob patterns, so a literal Next.js route
// segment such as app/courses/[slug] matches nothing and the suite is silently skipped.
// The programmatic runner takes literal paths; this is the one owner of that argument shape.
// When the verifier itself runs under node:test (workflow tests), the inherited child-context
// marker would make run() skip every file; this process is always a fresh top-level runner.
delete process.env.NODE_TEST_CONTEXT
const path = require('node:path')
const { run } = require('node:test')
const { tap } = require('node:test/reporters')

// Nothing can hang a batch. A top-level test still running after this is stuck: it is named and the batch is
// stopped. node:test has no default per-test timeout, and --test-timeout does not reach the runner's file processes.
// Generous for a loaded machine: the slowest test takes about 16 s on an idle one.
const TEST_TIMEOUT_MS = 120_000
const WATCHDOG_INTERVAL_MS = 1_000

/** Resolve caller-supplied test paths once, byte for byte, without glob interpretation. */
function testFiles(args, cwd = process.cwd()) {
  return args.map(file => path.resolve(cwd, file))
}

/** Run literal test files under the per-test watchdog; the exit code reports failures and stuck tests. */
function runFiles(files, { testTimeoutMs = TEST_TIMEOUT_MS } = {}) {
  let executed = 0
  let failed = 0
  // A file without tests still reports itself as one passing entry named by its path; ignore those.
  const isRealTest = event => !files.includes(event.name)
  const stopped = new AbortController()
  // forceExit: a file exits once its tests have finished, even if a failed one left a process, timer or interval.
  const stream = run({ files, concurrency: true, forceExit: true, signal: stopped.signal })
  const running = new Map()
  const key = event => `${event.file}:${event.line}:${event.column}:${event.name}`
  stream.on('test:dequeue', event => {
    if (event.nesting === 0 && isRealTest(event)) running.set(key(event), { event, started: Date.now() })
  })
  stream.on('test:complete', event => {
    running.delete(key(event))
    // A file that ended, however it ended, has nothing left running.
    if (!isRealTest(event)) for (const [id, test] of running) if (test.event.file === event.file) running.delete(id)
  })
  const watchdog = setInterval(() => {
    for (const { event, started } of running.values()) {
      if (Date.now() - started <= testTimeoutMs) continue
      process.stderr.write(`run-tests: "${event.name}" (${path.relative(process.cwd(), event.file)}:${event.line}) ` +
        `ran for more than ${testTimeoutMs / 1000} s; the batch was stopped\n`)
      process.exitCode = 1
      clearInterval(watchdog)
      stopped.abort()
      return
    }
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
