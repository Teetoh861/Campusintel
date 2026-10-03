// scripts/dev-workflow/verify.cjs — Run project checks and report required or skipped gates.
const { spawnSync } = require('node:child_process')
const { base, branch, changed, git, lines0, sha } = require('./repo.cjs')

const DB_PREFIXES = [
  'supabase/', 'lib/supabase/', 'lib/auth/', 'lib/managed-content/',
  'lib/quiz-attempts/', 'lib/operator/', 'lib/bookmarks/', 'lib/profile/',
  'app/api/',
]

/** Decide whether changed paths require database and managed-content checks. */
function scope(paths) {
  const content = paths.some(file => file.startsWith('lib/data/') ||
    file.startsWith('scripts/managed-content/') ||
    file === 'supabase/migrations/20261002130000_repository_content_seed.sql' ||
    file === 'supabase/tests/repository_content_parity.test.sql')
  const db = content || paths.some(file => DB_PREFIXES.some(prefix => file.startsWith(prefix)) ||
    file === 'lib/data/course-registry.ts')
  return { db, content }
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
  const environment = { ...process.env, DO_NOT_TRACK: '1' }
  const pnpm = pnpmCommand()

  function check(name, program, args, detail) {
    const result = execute(program, args, {
      cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: environment,
    })
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
    const counts = ['pass', 'fail', 'skipped'].map(key =>
      new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output)?.[1])
    const testSummary = counts[0] === undefined ? null
      : `${counts[0]} passed, ${counts[1] || '0'} failed, ${counts[2] || '0'} skipped`
    const blockedBuild = name === 'Production build' && result.status !== 0 &&
      /binding to a port[\s\S]*Operation not permitted/.test(output)
    const blockedDb = name === 'Database tests' && result.status !== 0 &&
      /(?:connection refused|cannot connect to (?:the )?docker|docker daemon|database is not running)/i.test(output)
    const status = result.error || result.status !== 0
      ? blockedBuild || blockedDb ? 'BLOCKED' : 'FAIL'
      : 'PASS'
    rows.push({ name, status, detail: result.error ? 'command unavailable'
      : blockedBuild ? 'Turbopack could not bind a local port; build did not complete'
        : blockedDb ? 'local database service failed during test run'
          : testSummary || (result.status === 0 ? detail : `exit ${result.status}`) })
  }

  const tests = lines0(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).stdout)
    .filter(file => /\.test\.(?:cjs|ts)$/.test(file) && !file.startsWith('scripts/dev-workflow/'))
  if (tests.length === 0) {
    rows.push({ name: 'Application tests', status: 'FAIL', detail: 'no test files found' })
  } else {
    check('Application tests', process.execPath,
      ['--require', './lib/auth/test-loader.cjs', '--test', '--test-reporter=tap', ...tests],
      `${tests.length} test files`)
  }
  const toolingTests = lines0(git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']).stdout)
    .filter(file => file.startsWith('scripts/dev-workflow/') && file.endsWith('.test.cjs'))
  if (toolingTests.length) {
    check('Workflow tests', process.execPath, ['--test', '--test-reporter=tap', ...toolingTests],
      `${toolingTests.length} test file(s)`)
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
        detail: 'local Supabase service unavailable; run supabase db start' })
    } else {
      check('Database tests', 'supabase', ['test', 'db', '--local'], 'supabase test db --local')
    }
  } else {
    rows.push({ name: 'Database tests', status: 'SKIP', detail: 'no database/Supabase paths changed' })
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
    '', `Result: ${exitCode ? 'FAIL' : 'PASS'}`,
  ].join('\n')
  return { output, exitCode, rows, scope: needed }
}

module.exports = { runVerification, scope }
