// scripts/dev-workflow/verify.cjs — Run project checks and report required or skipped gates.
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { base, branch, changed, git, lines0, sha } = require('./repo.cjs')
const { DATABASE_SUITE, TEST_STACK, projectId, suiteEnvironment } = require('./database-suites.cjs')

const TEST_RUNNER = path.join(__dirname, 'run-tests.cjs')
const APPLICATION_TEST_LOADER = './lib/auth/test-loader.cjs'
const TEST_ERROR_LINE_LIMIT = 4

/** Build the one node:test invocation shape: literal file paths through the runner, never CLI globs. */
function testCommand(files, { loader } = {}) {
  return { program: process.execPath,
    args: [...(loader ? ['--require', loader] : []), TEST_RUNNER, ...files] }
}

/** Collect application, database race and workflow test files exactly as Git tracks them.
 * The review flow never stages, so a suite deleted in the working tree is still in the index;
 * it is excluded here rather than reported as a failed test file.
 */
function collectTestFiles(root) {
  const deleted = new Set(lines0(git(root, ['ls-files', '--deleted', '-z']).stdout))
  const files = lines0(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).stdout)
    .filter(file => /\.test\.(?:cjs|ts)$/.test(file) && !deleted.has(file))
  return {
    application: files.filter(file => !file.startsWith('scripts/dev-workflow/') && !DATABASE_SUITE.test(file)),
    database: files.filter(file => DATABASE_SUITE.test(file)),
    workflow: files.filter(file => file.startsWith('scripts/dev-workflow/') && file.endsWith('.test.cjs')),
  }
}

// Database and app code, and the checks that test them: a change to any of these runs the pgTAP and race suites.
const DB_PREFIXES = [
  'supabase/', 'app/', 'lib/', 'components/', 'hooks/', 'scripts/dev-workflow/', '.github/workflows/',
]
const DB_FILES = ['proxy.ts', 'next.config.mjs', 'package.json', 'pnpm-lock.yaml']

/** Decide whether changed paths require database and managed-content checks. */
function scope(paths) {
  const content = paths.some(file => file.startsWith('lib/data/') ||
    file.startsWith('scripts/managed-content/') ||
    file === 'supabase/migrations/20261002130000_repository_content_seed.sql' ||
    file === 'supabase/tests/repository_content_parity.test.sql')
  const db = content || paths.some(file => DB_PREFIXES.some(prefix => file.startsWith(prefix)) ||
    DB_FILES.includes(file))
  return { db, content }
}

/** node:test's end-of-run counts in a TAP stream, undefined where absent. */
function testCounts(output) {
  const [pass, fail, skipped, tests, cancelled] = ['pass', 'fail', 'skipped', 'tests', 'cancelled'].map(key =>
    new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output)?.[1])
  return { pass, fail, skipped, tests, cancelled }
}

/** Retain each TAP failure's title, source location and opening error lines, including nested tests. */
function testFailures(output) {
  const failures = output.matchAll(/^([ \t]*)not ok \d+ - ([^\r\n]+)((?:\r?\n\1[ \t]+[^\r\n]*)*)/gm)
  return [...failures].map(([, , title, diagnostics]) => {
    const lines = diagnostics.split(/\r?\n/)
    const location = lines.find(line => /^[ \t]*location:/.test(line))
    const errorIndex = lines.findIndex(line => /^[ \t]*error:/.test(line))
    const error = errorIndex < 0 ? [] : [lines[errorIndex]]
    if (errorIndex >= 0) {
      const continuation = /^[ \t]*/.exec(lines[errorIndex])[0] + ' '
      for (const line of lines.slice(errorIndex + 1, errorIndex + TEST_ERROR_LINE_LIMIT)) {
        if (!line.startsWith(continuation)) break
        error.push(line)
      }
    }
    return [`  ${title}`, ...[location, ...error].filter(Boolean).map(line => `    ${line.trim()}`)].join('\n')
  })
}

function pnpmCommand() {
  const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8' })
  return probe.error?.code === 'ENOENT'
    ? { program: 'corepack', prefix: ['pnpm'] }
    : { program: 'pnpm', prefix: [] }
}

/** Execute the applicable checks and return a pasteable summary with an exit code. */
function runVerification(repo, options = {}) {
  const execute = options.execute || spawnSync
  const { root } = repo
  const { develop, fork } = base(root)
  const paths = changed(root, fork)
  const needed = scope(paths.all)
  if (options.db) needed.db = true
  if (options.content) needed.content = needed.db = true
  const rows = []
  const failureDetails = []
  const environment = { ...process.env, DO_NOT_TRACK: '1' }
  const pnpm = pnpmCommand()

  function check(name, program, args, detail, { expectTests = false } = {}) {
    const result = execute(program, args, {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: environment,
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    const counts = testCounts(output)
    // A test batch with input files that executed nothing is a discovery failure, not a pass.
    const nothingRan = expectTests && (counts.tests === undefined || counts.tests === '0')
    // node:test reports a test that ran out of time as cancelled; here it is a failure like any other.
    const failedTests = Number(counts.fail || 0) + Number(counts.cancelled || 0)
    const testSummary = nothingRan ? 'no tests executed for the supplied files'
      : counts.pass === undefined ? null
        : `${counts.pass} passed, ${failedTests} failed, ${counts.skipped || '0'} skipped`
    const blockedBuild = name === 'Production build' && result.status !== 0 &&
      /binding to a port[\s\S]*Operation not permitted/.test(output)
    const blockedDb = name === 'Database tests' && result.status !== 0 &&
      /(?:connection refused|cannot connect to (?:the )?docker|docker daemon|database is not running)/i.test(output)
    const status = result.error || result.status !== 0 || nothingRan
      ? blockedBuild || blockedDb ? 'BLOCKED' : 'FAIL'
      : 'PASS'
    rows.push({ name, status, detail: result.error ? 'command unavailable'
      : blockedBuild ? 'Turbopack could not bind a local port; build did not complete'
        : blockedDb ? 'local database service failed during test run'
          : testSummary || (result.status === 0 ? detail : `exit ${result.status}`) })
    if (expectTests && status === 'FAIL') {
      // A stuck test is named by the runner's watchdog, since its file never reports it.
      const stuck = output.match(/^run-tests: .* the batch was stopped$/gm) ?? []
      const failures = [...stuck.map(line => `  ${line}`), ...testFailures(output)]
      if (failures.length) failureDetails.push(`${name} failures:\n${failures.join('\n')}`)
    }
  }

  const { application: tests, database: suites, workflow: toolingTests } = collectTestFiles(root)
  if (tests.length === 0) {
    rows.push({ name: 'Application tests', status: 'FAIL', detail: 'no test files found' })
  } else {
    const command = testCommand(tests, { loader: APPLICATION_TEST_LOADER })
    check('Application tests', command.program, command.args, `${tests.length} test files`, { expectTests: true })
  }
  if (toolingTests.length) {
    const command = testCommand(toolingTests)
    check('Workflow tests', command.program, command.args, `${toolingTests.length} test file(s)`, { expectTests: true })
  } else {
    rows.push({ name: 'Workflow tests', status: 'SKIP', detail: 'no workflow tests present' })
  }
  check('TypeScript', pnpm.program, [...pnpm.prefix, 'exec', 'tsc', '--noEmit'], 'pnpm exec tsc --noEmit')
  check('Production build', pnpm.program, [...pnpm.prefix, 'build'], 'pnpm build')

  const trackedWhitespace = execute('git', ['diff', '--check', fork, '--'], {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })
  let whitespaceOk = !trackedWhitespace.error && trackedWhitespace.status === 0
  for (const file of paths.untracked) {
    const result = execute('git', ['diff', '--no-index', '--check', '--', '/dev/null', file], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    })
    // --no-index reports 1 for an ordinary difference; whitespace errors use 3.
    if (result.error || ![0, 1].includes(result.status) || result.stdout || result.stderr) {
      whitespaceOk = false
    }
  }
  rows.push({ name: 'Diff whitespace', status: whitespaceOk ? 'PASS' : 'FAIL',
    detail: 'tracked and untracked changes' })

  if (needed.content) {
    check('Managed-content parity', process.execPath,
      ['scripts/managed-content/generate.cjs', '--check'], 'generated SQL and parity snapshot')
  } else {
    rows.push({ name: 'Managed-content parity', status: 'SKIP', detail: 'no managed-content source/artifact paths changed' })
  }

  if (needed.db) {
    const health = execute('supabase', ['status', '--output', 'json'], {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: environment,
    })
    if (health.error || health.status !== 0) {
      rows.push({ name: 'Database tests', status: 'BLOCKED',
        detail: 'local Supabase service unavailable; run supabase start' })
    } else {
      check('Database tests', 'supabase', ['test', 'db', '--local'], 'supabase test db --local')
    }
    raceTests(health.error || health.status !== 0)
  } else {
    rows.push({ name: 'Database tests', status: 'SKIP', detail: 'no database or app code changed' })
    rows.push({ name: 'Database race tests', status: 'SKIP', detail: 'no database or app code changed' })
  }

  /** Run each database race suite alone, since they share database state; any failed or skipped test fails. */
  function raceTests(unavailable) {
    const name = 'Database race tests'
    const project = projectId(root, environment)
    if (unavailable) {
      rows.push({ name, status: 'BLOCKED', detail: 'local Supabase service unavailable; run supabase start' })
      return
    }
    if (!TEST_STACK.test(project ?? '')) {
      rows.push({ name, status: 'BLOCKED', detail: `they commit rows, so they need a test stack, not ${project}: ` +
        'start one with SUPABASE_PROJECT_ID=ci-access-own-<name> (or SUPABASE_WORKDIR)' })
      return
    }
    const env = { ...environment, ...suiteEnvironment(`supabase_db_${project}`) }
    const failed = []
    let passed = 0
    const started = Date.now()
    for (const file of suites) {
      const command = testCommand([file], { loader: APPLICATION_TEST_LOADER })
      const result = execute(command.program, command.args, {
        cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env,
      })
      const output = `${result.stdout || ''}\n${result.stderr || ''}`
      const counts = testCounts(output)
      const problems = [
        result.error && 'could not run',
        Number(counts.fail || 0) + Number(counts.cancelled || 0) > 0 &&
          `${Number(counts.fail || 0) + Number(counts.cancelled || 0)} failed`,
        Number(counts.skipped || 0) > 0 && `${counts.skipped} skipped (its opt-in flag or container is not set)`,
        Number(counts.tests || 0) === 0 && 'no tests executed',
        !result.error && result.status !== 0 && `exit ${result.status}`,
      ].filter(Boolean)
      passed += Number(counts.pass || 0)
      if (problems.length === 0) continue
      failed.push(file)
      const stuck = output.match(/^run-tests: .* the batch was stopped$/gm) ?? []
      failureDetails.push([`${name}: ${file} — ${problems.join(', ')}`,
        ...stuck.map(line => `  ${line}`), ...testFailures(output)].join('\n'))
    }
    const seconds = Math.round((Date.now() - started) / 1000)
    rows.push(failed.length
      ? { name, status: 'FAIL', detail: `${failed.length} of ${suites.length} files failed: ${failed.join(', ')}` }
      : { name, status: suites.length ? 'PASS' : 'FAIL', detail: suites.length
        ? `${suites.length} files one at a time, ${passed} passed in ${seconds} s`
        : 'no database race suites found' })
  }

  const exitCode = rows.some(row => row.status === 'FAIL' || row.status === 'BLOCKED') ? 1 : 0
  const output = [
    'CampusIntel verification',
    `Repository: ${repo.origin}`,
    `Branch: ${branch(root)}`,
    `HEAD: ${sha(root, 'HEAD')}`,
    `origin/develop: ${develop}`,
    `Review base: ${fork}`,
    `Changed files: ${paths.all.length}`,
    '',
    ...rows.map(row => `${row.status.padEnd(7)} ${row.name} — ${row.detail}`),
    ...(failureDetails.length ? ['', ...failureDetails] : []),
    '', `Result: ${exitCode ? 'FAIL' : 'PASS'}`,
  ].join('\n')
  return { output, exitCode, rows, scope: needed }
}

module.exports = { collectTestFiles, runVerification, scope, testCommand, testCounts }
