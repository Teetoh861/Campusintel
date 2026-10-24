// scripts/dev-workflow/workflow.test.cjs — Exercise workflow safety with disposable Git fixtures.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const { repository } = require('./repo.cjs')
const { packageReview } = require('./review.cjs')
const { collectTestFiles, runVerification, scope, testCommand } = require('./verify.cjs')

const CLI = path.join(__dirname, 'cli.cjs')
const RUNNER = path.join(__dirname, 'run-tests.cjs')
const TAP_PASS = '# tests 1\n# pass 1\n# fail 0\n'
/** Mocked commands answer test batches with a real TAP summary so discovery guards see executed tests. */
const mockExecute = fn => (program, args, options) => {
  const result = fn(program, args, options)
  return args.includes(RUNNER) && !result.stdout ? { ...result, stdout: TAP_PASS } : result
}
const ORIGIN = 'https://github.com/Teetoh861/Campusintel.git'

test('PR verification starts scoped Supabase with the pinned CLI and shows startup failures', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../../.github/workflows/pr-verification.yml'), 'utf8')
  const startStep = workflow.split('      - name: Start local database for SQL tests\n')[1]
    ?.split('      - name: Verify application and applicable optional checks\n')[0]
  assert.ok(startStep, 'the local Supabase startup step exists')
  assert.match(workflow, /uses: supabase\/setup-cli@v3\s+if: steps\.scope\.outputs\.db == 'true'\s+with:\s+version: 2\.109\.1/)
  assert.match(startStep, /if: steps\.scope\.outputs\.db == 'true'/)
  assert.match(startStep, /if ! supabase start > "\$RUNNER_TEMP\/supabase-start\.log" 2>&1; then/)
  assert.match(startStep, /cat "\$RUNNER_TEMP\/supabase-start\.log"/)
  assert.match(startStep, /exit 1/)
  assert.doesNotMatch(workflow, /supabase db start/)
})

function run(program, args, cwd, allowed = [0]) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' })
  assert.ok(allowed.includes(result.status), `${program} ${args[0]}: ${result.stderr}`)
  return result
}

function git(cwd, ...args) {
  return run('git', args, cwd).stdout.trim()
}

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'campusintel-workflow-test-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const bare = path.join(home, 'origin.git')
  const root = path.join(home, 'repo')
  fs.mkdirSync(root)
  run('git', ['init', '--bare', bare], home)
  git(root, 'init', '-b', 'develop')
  git(root, 'config', 'user.name', 'Workflow Test')
  git(root, 'config', 'user.email', 'workflow@example.test')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"campusintel"}\n')
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n.env*.local\n')
  fs.writeFileSync(path.join(root, 'source.ts'), 'export const value = 1\n')
  fs.mkdirSync(path.join(root, 'lib', 'auth'), { recursive: true })
  fs.writeFileSync(path.join(root, 'lib', 'auth', 'sample.test.cjs'), 'test fixture\n')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture base')
  git(root, 'remote', 'add', 'origin', ORIGIN)
  git(root, 'config', `url.file://${bare}.insteadOf`, ORIGIN)
  git(root, 'push', '-u', 'origin', 'develop')
  git(root, 'fetch', 'origin')
  return { home, root, bare, base: git(root, 'rev-parse', 'HEAD') }
}

function cli(root, ...args) {
  return run(process.execPath, [CLI, ...args], root, [0, 1])
}

test('Git origin rejects a different repository even with the campusintel package name', t => {
  const f = fixture(t)
  git(f.root, 'remote', 'set-url', 'origin', 'https://github.com/Teetoh861/StayFocus.git')
  const result = cli(f.root, 'scope')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /origin is not the expected/)
})

test('start refuses dirty source, invalid names, and an existing branch', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'draft.ts'), 'draft\n')
  assert.match(cli(f.root, 'start', 'feature/one').stderr, /source worktree is dirty/)
  fs.unlinkSync(path.join(f.root, 'draft.ts'))
  assert.match(cli(f.root, 'start', 'feature/../unsafe').stderr, /invalid branch name/)
  git(f.root, 'branch', 'feature/existing')
  assert.match(cli(f.root, 'start', 'feature/existing').stderr, /already exists/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.base)
})

test('start creates an isolated branch from fetched origin/develop', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'isolated')
  const result = cli(f.root, 'start', 'feature/isolated', '--worktree', target)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, new RegExp(f.base))
  assert.equal(git(target, 'branch', '--show-current'), 'feature/isolated')
  assert.equal(git(target, 'rev-parse', 'HEAD'), f.base)
  assert.equal(git(f.root, 'branch', '--show-current'), 'develop')
  assert.match(cli(f.root, 'start', 'feature/another', '--worktree', target).stderr,
    /path already exists/)
})

test('start tolerates unrelated prunable worktree records and rejects control characters in paths', t => {
  const f = fixture(t)
  const stale = path.join(f.home, 'stale-worktree')
  git(f.root, 'worktree', 'add', '--detach', stale)
  fs.rmSync(stale, { recursive: true })
  const target = path.join(f.home, 'new-worktree')
  assert.match(cli(f.root, 'start', 'feature/bad-path', '--worktree', `${target}\nother`).stderr,
    /invalid worktree path/)
  const result = cli(f.root, 'start', 'feature/fresh', '--worktree', target)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(target, 'rev-parse', 'HEAD'), f.base)
})

test('review includes committed, working-tree, and untracked source without ignored files or staging', t => {
  const f = fixture(t)
  git(f.root, 'switch', '-c', 'feature/review')
  fs.writeFileSync(path.join(f.root, 'source.ts'), 'export const value = 2\n')
  git(f.root, 'add', 'source.ts')
  git(f.root, 'commit', '-m', 'committed feature')
  fs.appendFileSync(path.join(f.root, 'source.ts'), 'export const next = 3\n')
  fs.writeFileSync(path.join(f.root, 'new.ts'), 'export const untracked = true\n')
  fs.writeFileSync(path.join(f.root, '.env.local'), 'PRIVATE_VALUE=ignored\n')
  fs.mkdirSync(path.join(f.root, 'node_modules'))
  fs.writeFileSync(path.join(f.root, 'node_modules', 'ignored.ts'), 'ignored\n')
  const before = git(f.root, 'status', '--porcelain=v1')
  const result = packageReview(repository(f.root))
  t.after(() => fs.rmSync(result.directory, { recursive: true, force: true }))
  const patch = fs.readFileSync(path.join(result.directory, 'review.patch'), 'utf8')
  const summary = fs.readFileSync(path.join(result.directory, 'summary.md'), 'utf8')
  assert.match(patch, /export const value = 2/)
  assert.match(patch, /export const next = 3/)
  assert.match(patch, /export const untracked = true/)
  assert.doesNotMatch(patch, /PRIVATE_VALUE|ignored\.ts/)
  assert.match(summary, /new\.ts/)
  assert.match(summary, /Diff stat/)
  assert.equal(git(f.root, 'status', '--porcelain=v1'), before)
  assert.equal(git(f.root, 'diff', '--cached', '--name-only'), '')
})

test('review refuses sensitive paths and credential-looking content', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, '.env.production'), 'PRIVATE_VALUE=unsafe\n')
  assert.match(cli(f.root, 'review').stderr, /sensitive or generated path/)
  fs.unlinkSync(path.join(f.root, '.env.production'))
  fs.writeFileSync(path.join(f.root, 'token.ts'),
    'const token = "ghp_' + 'A'.repeat(36) + '"\n')
  assert.match(cli(f.root, 'review').stderr, /possible credential/)
})

test('verification propagates a failed required check and explains skipped checks', t => {
  const f = fixture(t)
  const execute = mockExecute((program, args) => ({ status: args.includes('tsc') ? 1 : 0,
    stdout: '', stderr: '' }))
  const report = runVerification(repository(f.root), { execute })
  assert.equal(report.exitCode, 1)
  assert.match(report.output, /FAIL\s+TypeScript/)
  assert.match(report.output, /PASS\s+Application tests/)
  assert.match(report.output, /SKIP\s+Database tests/)
  assert.match(report.output, /Result: FAIL/)
})

test('verification names every failing test with its location and first error lines', t => {
  const f = fixture(t)
  const file = path.join(f.root, 'lib', 'auth', 'sample.test.cjs')
  fs.writeFileSync(path.join(f.root, 'lib', 'auth', 'test-loader.cjs'), '')
  fs.writeFileSync(file, [
    "const { test } = require('node:test')",
    "const assert = require('node:assert/strict')",
    "test('queue timing failure', () => assert.equal(1, 2, 'first error line\\nsecond error line\\nthird error line\\nfourth error line'))",
    "test('nested suite failure', async t => {",
    "  await t.test('nested test failure', () => assert.ok(false, 'nested error'))",
    "})",
    "test('passing fixture test', () => {})",
    '',
  ].join('\n'))
  const report = runVerification(repository(f.root), { execute: (program, args, options) =>
    args.includes(RUNNER) ? spawnSync(program, args, options)
      : { status: 0, stdout: '', stderr: '' },
  })
  assert.equal(report.exitCode, 1)
  assert.match(report.output, /FAIL\s+Application tests — 1 passed, 3 failed, 0 skipped/)
  for (const title of ['queue timing failure', 'nested test failure', 'nested suite failure']) {
    assert.ok(report.output.includes(title), title)
  }
  for (const line of [3, 4, 5]) assert.ok(report.output.includes(`sample.test.cjs:${line}:`), `location on line ${line}`)
  assert.match(report.output, /first error line\n\s+second error line\n\s+third error line/)
  assert.match(report.output, /error: 'nested error'/)
  assert.doesNotMatch(report.output, /fourth error line|passing fixture test|node:internal|duration_ms:/)
})

test('verification reports a build environment block without claiming a build pass', t => {
  const f = fixture(t)
  const report = runVerification(repository(f.root), { execute: mockExecute((program, args) => ({
    status: args.includes('build') ? 1 : 0,
    stdout: '',
    stderr: args.includes('build') ? 'binding to a port\nOperation not permitted' : '',
  })) })
  assert.equal(report.rows.find(row => row.name === 'Production build').status, 'BLOCKED')
  assert.equal(report.exitCode, 1)
})

test('verification checks whitespace in untracked files without treating a normal diff as failure', t => {
  const f = fixture(t)
  const file = path.join(f.root, 'new.ts')
  const execute = mockExecute((program, args, options) => program === 'git'
    ? spawnSync(program, args, options)
    : { status: 0, stdout: '', stderr: '' })
  fs.writeFileSync(file, 'export const clean = true\n')
  const cleanReport = runVerification(repository(f.root), { execute })
  assert.equal(cleanReport.rows.find(row => row.name === 'Diff whitespace').status, 'PASS')
  fs.writeFileSync(file, 'export const dirty = true  \n')
  const dirtyReport = runVerification(repository(f.root), { execute })
  assert.equal(dirtyReport.rows.find(row => row.name === 'Diff whitespace').status, 'FAIL')
  assert.equal(dirtyReport.exitCode, 1)
})

test('scope requires SQL tests and generated parity for managed-content sources', () => {
  assert.deepEqual(scope(['lib/data/courses.ts']), { db: true, content: true })
  assert.deepEqual(scope(['supabase/tests/profile_selection.test.sql']), { db: true, content: false })
  assert.deepEqual(scope(['components/ui/button.tsx']), { db: false, content: false })
})

test('verification distinguishes an unavailable DB service from failed SQL tests', t => {
  const f = fixture(t)
  fs.mkdirSync(path.join(f.root, 'supabase', 'tests'), { recursive: true })
  fs.writeFileSync(path.join(f.root, 'supabase', 'tests', 'new.test.sql'), '-- fixture\n')
  let testRan = false
  const blocked = runVerification(repository(f.root), { execute: mockExecute((program, args) => {
    if (program === 'supabase' && args[0] === 'status') return { status: 1 }
    if (program === 'supabase' && args[0] === 'test') testRan = true
    return { status: 0 }
  }) })
  assert.equal(blocked.rows.find(row => row.name === 'Database tests').status, 'BLOCKED')
  assert.match(blocked.output, /local Supabase service unavailable; run supabase start/)
  assert.doesNotMatch(blocked.output, /supabase db start/)
  assert.equal(blocked.exitCode, 1)
  assert.equal(testRan, false)

  const failed = runVerification(repository(f.root), { execute: mockExecute((program, args) =>
    ({ status: program === 'supabase' && args[0] === 'test' ? 1 : 0 })) })
  assert.equal(failed.rows.find(row => row.name === 'Database tests').status, 'FAIL')
  assert.equal(failed.exitCode, 1)

  const interrupted = runVerification(repository(f.root), { execute: mockExecute((program, args) => ({
    status: program === 'supabase' && args[0] === 'test' ? 1 : 0,
    stderr: program === 'supabase' && args[0] === 'test' ? 'connection refused' : '',
  })) })
  assert.equal(interrupted.rows.find(row => row.name === 'Database tests').status, 'BLOCKED')
})

test('cleanup from an unrelated worktree leaves unmerged work intact', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'unmerged-worktree')
  const caller = path.join(f.home, 'unrelated-worktree')
  assert.equal(cli(f.root, 'start', 'feature/unmerged', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const work = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'unmerged work')
  git(target, 'push', '-u', 'origin', 'feature/unmerged')
  git(f.root, 'worktree', 'add', '-b', 'chore/unrelated', caller, f.base)
  const result = cli(caller, 'cleanup', 'feature/unmerged')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /not merged into origin\/develop/)
  assert.match(git(caller, 'branch', '--list', 'feature/unmerged'), /feature\/unmerged/)
  assert.ok(fs.existsSync(target))
  assert.equal(git(f.root, 'rev-parse', 'develop'), f.base)
})

test('cleanup refuses dirty feature worktrees before touching branches', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'feature-worktree')
  assert.equal(cli(f.root, 'start', 'feature/dirty', '--worktree', target).status, 0)
  git(target, 'push', '-u', 'origin', 'feature/dirty')
  fs.writeFileSync(path.join(target, 'draft.ts'), 'draft\n')
  const result = cli(f.root, 'cleanup', 'feature/dirty')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /feature worktree is dirty/)
  assert.match(git(f.root, 'branch', '--list', 'feature/dirty'), /feature\/dirty/)
  assert.ok(fs.existsSync(target))
})

test('cleanup preserves ignored private files in a feature worktree', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'private-worktree')
  assert.equal(cli(f.root, 'start', 'feature/private', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, '.env.local'), 'PRIVATE_VALUE=fixture\n')
  const result = cli(f.root, 'cleanup', 'feature/private')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /ignored private files/)
  assert.ok(fs.existsSync(path.join(target, '.env.local')))
})

test('cleanup removes only a merged disposable feature worktree and branch', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'merged-worktree')
  assert.equal(cli(f.root, 'start', 'feature/merged', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const merged = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'merged fixture work')
  git(f.root, 'merge', '--ff-only', 'feature/merged')
  git(f.root, 'push', 'origin', 'develop')
  fs.mkdirSync(path.join(target, 'node_modules'))
  fs.writeFileSync(path.join(target, 'node_modules', 'ignored.txt'), 'dependency fixture\n')
  const result = cli(f.root, 'cleanup', 'feature/merged')
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!fs.existsSync(target))
  assert.equal(git(f.root, 'branch', '--list', 'feature/merged'), '')
  assert.equal(git(f.root, 'rev-parse', 'develop'), git(f.root, 'rev-parse', 'origin/develop'))
})

test('cleanup succeeds from an unrelated clean worktree when the merged feature has no upstream', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'merged-worktree')
  const caller = path.join(f.home, 'unrelated-worktree')
  assert.equal(cli(f.root, 'start', 'feature/merged', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const merged = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'merged fixture work')
  git(f.root, 'merge', '--ff-only', 'feature/merged')
  git(f.root, 'push', 'origin', 'develop')
  assert.equal(git(f.root, 'for-each-ref', '--format=%(upstream)', 'refs/heads/feature/merged'), '')
  git(f.root, 'worktree', 'add', '-b', 'chore/unrelated', caller, f.base)
  const result = cli(caller, 'cleanup', 'feature/merged')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Removed local feature branch: feature\/merged/)
  assert.ok(!fs.existsSync(target))
  assert.equal(git(caller, 'branch', '--list', 'feature/merged'), '')
  assert.equal(git(caller, 'branch', '--show-current'), 'chore/unrelated')
  assert.equal(git(f.root, 'rev-parse', 'develop'), git(f.root, 'rev-parse', 'origin/develop'))
})

test('cleanup removes a merged pushed branch with an origin feature upstream', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'pushed-worktree')
  const caller = path.join(f.home, 'caller-worktree')
  assert.equal(cli(f.root, 'start', 'feature/pushed', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const merged = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'pushed fixture work')
  git(target, 'push', '-u', 'origin', 'feature/pushed')
  const featureTip = git(target, 'rev-parse', 'HEAD')
  assert.equal(git(f.root, 'for-each-ref', '--format=%(upstream)',
    'refs/heads/feature/pushed'), 'refs/remotes/origin/feature/pushed')

  git(f.root, 'worktree', 'add', '-b', 'chore/caller', caller, f.base)
  git(caller, 'merge', '--no-ff', '--no-edit', 'feature/pushed')
  git(caller, 'push', 'origin', 'HEAD:develop')
  const remoteFeature = git(f.root, 'ls-remote', '--heads', 'origin',
    'refs/heads/feature/pushed')
  assert.equal(git(f.root, 'rev-parse', 'develop'), f.base)

  const result = cli(caller, 'cleanup', 'feature/pushed')
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Removed local feature branch: feature\/pushed/)
  assert.ok(!fs.existsSync(target))
  assert.equal(git(caller, 'branch', '--list', 'feature/pushed'), '')
  assert.equal(git(f.root, 'rev-parse', 'develop'), git(f.root, 'rev-parse', 'origin/develop'))
  assert.equal(git(f.root, 'ls-remote', '--heads', 'origin',
    'refs/heads/feature/pushed'), remoteFeature)
  assert.match(remoteFeature, new RegExp(featureTip))
})

test('cleanup uses local develop when the pushed feature upstream is stale', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'stale-upstream-worktree')
  const caller = path.join(f.home, 'caller-worktree')
  assert.equal(cli(f.root, 'start', 'feature/stale', '--worktree', target).status, 0)
  git(target, 'push', '-u', 'origin', 'feature/stale')
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const merged = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'merged after pushing feature')
  git(f.root, 'worktree', 'add', '-b', 'chore/caller', caller, f.base)
  git(caller, 'merge', '--no-ff', '--no-edit', 'feature/stale')
  git(caller, 'push', 'origin', 'HEAD:develop')
  assert.equal(git(f.root, 'rev-parse', 'origin/feature/stale'), f.base)

  const result = cli(caller, 'cleanup', 'feature/stale')
  assert.equal(result.status, 0, result.stderr)
  assert.ok(!fs.existsSync(target))
  assert.equal(git(caller, 'branch', '--list', 'feature/stale'), '')
  assert.equal(git(f.root, 'rev-parse', 'develop'), git(f.root, 'rev-parse', 'origin/develop'))
})

test('cleanup refuses a multi-valued feature upstream before removing its worktree', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'ambiguous-worktree')
  assert.equal(cli(f.root, 'start', 'feature/ambiguous', '--worktree', target).status, 0)
  git(target, 'push', '-u', 'origin', 'feature/ambiguous')
  git(f.root, 'config', '--add', 'branch.feature/ambiguous.merge', 'refs/heads/develop')
  const result = cli(f.root, 'cleanup', 'feature/ambiguous')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /unsupported upstream configuration/)
  assert.ok(fs.existsSync(target))
  assert.match(git(f.root, 'branch', '--list', 'feature/ambiguous'), /feature\/ambiguous/)
  assert.equal(git(f.root, 'rev-parse', 'develop'), f.base)
})

test('cleanup restores a pushed upstream when local develop cannot advance', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'blocked-worktree')
  assert.equal(cli(f.root, 'start', 'feature/blocked', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const merged = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'merged fixture work')
  git(target, 'push', '-u', 'origin', 'feature/blocked')
  git(target, 'push', 'origin', 'HEAD:develop')
  git(f.root, 'switch', '-c', 'chore/caller')
  fs.writeFileSync(path.join(f.root, '.git', 'refs', 'heads', 'develop.lock'), '')

  const result = cli(f.root, 'cleanup', 'feature/blocked')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /git branch failed/)
  assert.equal(git(f.root, 'for-each-ref', '--format=%(upstream)',
    'refs/heads/feature/blocked'), 'refs/remotes/origin/feature/blocked')
  assert.ok(fs.existsSync(target))
  assert.equal(git(f.root, 'rev-parse', 'develop'), f.base)
})

test('cleanup advances local develop when the caller is on another local branch', t => {
  const f = fixture(t)
  const target = path.join(f.home, 'merged-worktree')
  assert.equal(cli(f.root, 'start', 'feature/remote-merged', '--worktree', target).status, 0)
  fs.writeFileSync(path.join(target, 'work.ts'), 'export const merged = true\n')
  git(target, 'add', 'work.ts')
  git(target, 'commit', '-m', 'merged fixture work')
  const featureTip = git(target, 'rev-parse', 'HEAD')
  git(target, 'push', 'origin', 'HEAD:develop')
  git(f.root, 'switch', '-c', 'chore/unrelated')
  assert.equal(git(f.root, 'rev-parse', 'develop'), f.base)
  const result = cli(f.root, 'cleanup', 'feature/remote-merged')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(git(f.root, 'rev-parse', 'develop'), featureTip)
  assert.equal(git(f.root, 'branch', '--list', 'feature/remote-merged'), '')
  assert.equal(git(f.root, 'branch', '--show-current'), 'chore/unrelated')
  assert.ok(!fs.existsSync(target))
})

test('test batches pass literal paths through the runner so bracketed route suites execute', t => {
  const f = fixture(t)
  const body = "const { test } = require('node:test')\ntest('runs', () => {})\n"
  fs.mkdirSync(path.join(f.root, 'app', '[param]'), { recursive: true })
  fs.writeFileSync(path.join(f.root, 'normal.test.cjs'), body)
  fs.writeFileSync(path.join(f.root, 'app', '[param]', 'inner.test.cjs'), body)
  fs.writeFileSync(path.join(f.root, 'empty.test.cjs'), 'module.exports = {}\n')
  const bracket = 'app/[param]/inner.test.cjs'
  const command = testCommand([bracket, 'normal.test.cjs'], { loader: './loader.cjs' })
  assert.equal(command.program, process.execPath)
  assert.deepEqual(command.args, ['--require', './loader.cjs', RUNNER, bracket, 'normal.test.cjs'],
    'paths are passed byte for byte in one pass; nothing is escaped or rewritten')
  assert.deepEqual(testCommand(['a[b]*?{c}.test.cjs']).args, [RUNNER, 'a[b]*?{c}.test.cjs'])
  const execute = files => spawnSync(process.execPath, testCommand(files).args, { cwd: f.root, encoding: 'utf8' })
  const normal = execute(['normal.test.cjs'])
  assert.equal(normal.status, 0); assert.match(normal.stdout, /^# tests 1$/m)
  const inner = execute([bracket])
  assert.equal(inner.status, 0); assert.match(inner.stdout, /^# tests 1$/m)
  const both = execute([bracket, 'normal.test.cjs'])
  assert.equal(both.status, 0); assert.match(both.stdout, /^# tests 2$/m); assert.match(both.stdout, /^# pass 2$/m)
  const nothing = execute(['empty.test.cjs'])
  assert.equal(nothing.status, 1)
  assert.match(nothing.stderr, /1 file\(s\) supplied but no tests executed/)
  assert.equal(spawnSync(process.execPath, [RUNNER], { cwd: f.root, encoding: 'utf8' }).status, 1)
  const collected = collectTestFiles(f.root)
  assert.deepEqual(collected.application.sort(), [bracket, 'empty.test.cjs', 'lib/auth/sample.test.cjs', 'normal.test.cjs'])
  assert.deepEqual(collected.workflow, [])
})

test('a suite deleted in the working tree but still in the index is not collected', t => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.root, 'normal.test.cjs'), 'test fixture\n')
  assert.deepEqual(collectTestFiles(f.root).application.sort(), ['lib/auth/sample.test.cjs', 'normal.test.cjs'])
  fs.rmSync(path.join(f.root, 'lib', 'auth', 'sample.test.cjs'))
  assert.equal(git(f.root, 'diff', '--cached', '--name-only'), '', 'nothing is staged')
  assert.deepEqual(git(f.root, 'ls-files', '--deleted'), 'lib/auth/sample.test.cjs')
  assert.deepEqual(collectTestFiles(f.root).application, ['normal.test.cjs'])
})

test('the production collection reaches the bracketed Course Detail, tracker and API suites', () => {
  const { application, workflow } = collectTestFiles(path.join(__dirname, '../..'))
  for (const file of ['app/courses/[slug]/course-detail.test.cjs', 'app/courses/[slug]/CourseViewTracker.test.cjs',
    'app/courses/[slug]/quiz/liveBank.test.cjs', 'app/api/courses/[slug]/quiz-bank/route.test.cjs']) {
    assert.ok(application.includes(file), file)
  }
  assert.equal(application.some(file => file.startsWith('scripts/dev-workflow/')), false)
  assert.ok(workflow.includes('scripts/dev-workflow/workflow.test.cjs'))
})

test('a test batch with input files that executes nothing fails the verifier instead of reporting green', t => {
  const f = fixture(t)
  const report = runVerification(repository(f.root), { execute: (program, args) => ({
    status: 0, stderr: '',
    stdout: args.includes(RUNNER) ? '# tests 0\n# pass 0\n# fail 0\n' : '',
  }) })
  const row = report.rows.find(row => row.name === 'Application tests')
  assert.equal(row.status, 'FAIL')
  assert.equal(row.detail, 'no tests executed for the supplied files')
  assert.equal(report.exitCode, 1)
  const silent = runVerification(repository(f.root), { execute: () => ({ status: 0, stdout: '', stderr: '' }) })
  assert.equal(silent.rows.find(row => row.name === 'Application tests').status, 'FAIL')
})
