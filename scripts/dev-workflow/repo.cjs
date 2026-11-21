// scripts/dev-workflow/repo.cjs — Validate repository identity and provide safe Git helpers.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const EXPECTED_ORIGIN = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)teetoh861\/campusintel(?:\.git)?\/?$/i
const MAX_OUTPUT = 32 * 1024 * 1024

/** Run a subprocess with argument arrays and fail when its exit status is unexpected. */
function command(program, args, cwd, allowed = [0], extraEnv = {}) {
  const result = spawnSync(program, args, {
    cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT,
    env: { ...process.env, ...extraEnv },
  })
  if (result.error || !allowed.includes(result.status)) {
    throw new Error(`${program} ${args[0] || ''} failed (exit ${result.status ?? 'unavailable'})`)
  }
  return result
}

/** Run a Git command without invoking a shell. */
function git(cwd, args, allowed) {
  return command('git', args, cwd, allowed)
}

/** Split Git's NUL-delimited output into nonempty entries. */
function lines0(value) {
  return value.split('\0').filter(Boolean)
}

/** Verify the Git origin and package identity, then return repository metadata. */
function repository(cwd = process.cwd()) {
  const root = git(cwd, ['rev-parse', '--show-toplevel']).stdout.trim()
  const remotes = git(root, ['config', '--get-all', 'remote.origin.url']).stdout.trim().split('\n')
  if (remotes.length !== 1 || !EXPECTED_ORIGIN.test(remotes[0])) {
    throw new Error('origin is not the expected Teetoh861/Campusintel Git repository')
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (pkg.name !== 'campusintel') throw new Error('repository package identity is not campusintel')
  return { root, origin: remotes[0] }
}

/** Return the currently checked-out branch, or a detached-HEAD marker. */
function branch(cwd) {
  return git(cwd, ['branch', '--show-current']).stdout.trim() || '(detached HEAD)'
}

/** Resolve a Git reference to a commit SHA. */
function sha(cwd, ref) {
  return git(cwd, ['rev-parse', '--verify', `${ref}^{commit}`]).stdout.trim()
}

/** Return origin/develop and its merge base with HEAD. */
function base(cwd) {
  const develop = sha(cwd, 'refs/remotes/origin/develop')
  return { develop, fork: git(cwd, ['merge-base', 'HEAD', develop]).stdout.trim() }
}

/** Require a worktree to have no tracked or nonignored untracked changes. */
function clean(cwd, label) {
  if (git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']).stdout) {
    throw new Error(`${label} worktree is dirty`)
  }
}

/** Reject malformed or protected user-supplied branch names. */
function validBranch(cwd, value) {
  if (!value || /[\x00-\x1f\x7f]/.test(value) ||
      git(cwd, ['check-ref-format', '--branch', value], [0, 1, 128]).status !== 0) {
    throw new Error('invalid branch name')
  }
  if (value === 'develop' || value === 'main') throw new Error('protected branch name')
  return value
}

/** Report whether an exact Git reference exists. */
function refExists(cwd, ref) {
  return git(cwd, ['show-ref', '--verify', '--quiet', ref], [0, 1]).status === 0
}

/** List tracked changes and nonignored untracked files since the review base. */
function changed(cwd, fork) {
  const tracked = lines0(git(cwd, ['diff', '--name-only', '--no-renames', '-z', fork, '--']).stdout)
  const untracked = lines0(git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']).stdout)
  return { tracked, untracked, all: [...new Set([...tracked, ...untracked])].sort() }
}

/** List linked worktrees and their branch or prunable state. */
function worktrees(cwd) {
  const rows = git(cwd, ['worktree', 'list', '--porcelain', '-z']).stdout.split('\0\0').filter(Boolean)
  return rows.map(row => {
    const fields = row.split('\0')
    return {
      path: fields.find(field => field.startsWith('worktree '))?.slice(9),
      branch: fields.find(field => field.startsWith('branch '))?.slice(7),
      prunable: fields.some(field => field.startsWith('prunable ')),
    }
  })
}

module.exports = { base, branch, changed, clean, command, git, lines0,
  refExists, repository, sha, validBranch, worktrees }
