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

/** Resolve caller-supplied test paths once, byte for byte, without glob interpretation. */
function testFiles(args, cwd = process.cwd()) {
  return args.map(file => path.resolve(cwd, file))
}

function main() {
  const files = testFiles(process.argv.slice(2))
  if (files.length === 0) {
    process.stderr.write('run-tests: no test files supplied\n')
    process.exitCode = 1
    return
  }
  let executed = 0
  let failed = 0
  // A file without tests still reports itself as one passing entry named by its path; ignore those.
  const isRealTest = event => !files.includes(event.name)
  const stream = run({ files, concurrency: true })
  stream.on('test:pass', event => { if (isRealTest(event)) executed++ })
  stream.on('test:fail', event => { if (isRealTest(event)) executed++; failed++ })
  stream.on('end', () => {
    if (failed > 0) process.exitCode = 1
    else if (executed === 0) {
      process.stderr.write(`run-tests: ${files.length} file(s) supplied but no tests executed\n`)
      process.exitCode = 1
    }
  })
  stream.compose(tap).pipe(process.stdout)
}

if (require.main === module) main()

module.exports = { testFiles }
