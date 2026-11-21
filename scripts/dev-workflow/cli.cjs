#!/usr/bin/env node
// scripts/dev-workflow/cli.cjs — Provide safe start, verify, review, scope, and cleanup commands.
const fs = require('node:fs')
const path = require('node:path')
const { base, changed, clean, git, lines0, refExists, repository,
  sha, validBranch, worktrees } = require('./repo.cjs')
const { packageReview } = require('./review.cjs')
const { runVerification, scope } = require('./verify.cjs')

function exists(value) {
  try { fs.lstatSync(value); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function futureRealPath(value) {
  const missing = []
  let parent = value
  while (!exists(parent)) {
    missing.unshift(path.basename(parent))
    parent = path.dirname(parent)
  }
  return path.join(fs.realpathSync(parent), ...missing)
}

/** Create a new feature branch in an isolated worktree from fetched origin/develop. */
function start(repo, name, requestedPath) {
  const { root } = repo
  validBranch(root, name)
  clean(root, 'source')
  if (requestedPath && /[\x00-\x1f\x7f]/.test(requestedPath)) {
    throw new Error('invalid worktree path')
  }
  const target = requestedPath
    ? path.resolve(process.cwd(), requestedPath)
    : path.resolve(root, '..', 'Campusintel-worktrees', encodeURIComponent(name))
  if (exists(target)) throw new Error('requested worktree path already exists')
  const realTarget = futureRealPath(target)
  for (const item of worktrees(root)) {
    const existing = exists(item.path) ? fs.realpathSync(item.path) : path.resolve(item.path)
    if (realTarget === existing || realTarget.startsWith(`${existing}${path.sep}`) ||
        existing.startsWith(`${realTarget}${path.sep}`)) {
      throw new Error('requested worktree path overlaps an existing worktree')
    }
  }
  if (refExists(root, `refs/heads/${name}`) || refExists(root, `refs/remotes/origin/${name}`)) {
    throw new Error('feature branch already exists locally or in remote-tracking refs')
  }
  git(root, ['fetch', '--no-tags', 'origin',
    '+refs/heads/develop:refs/remotes/origin/develop'])
  const remoteBranch = git(root, ['ls-remote', '--exit-code', '--heads', 'origin',
    `refs/heads/${name}`], [0, 2])
  if (remoteBranch.status === 0) throw new Error('feature branch already exists on origin')
  const develop = sha(root, 'refs/remotes/origin/develop')
  git(root, ['worktree', 'add', '-b', name, '--', target, develop])
  return `Created branch: ${name}\nWorktree: ${target}\nBase origin/develop: ${develop}`
}

function mergedInto(cwd, ancestor, descendant) {
  return git(cwd, ['merge-base', '--is-ancestor', ancestor, descendant], [0, 1]).status === 0
}

function removableIgnored(cwd) {
  const ignored = lines0(git(cwd, ['ls-files', '--others', '--ignored',
    '--exclude-standard', '--directory', '-z']).stdout)
  return ignored.every(file => file === 'node_modules/' || file === '.next/' ||
    file === 'tsconfig.tsbuildinfo' || file === 'next-env.d.ts' || file === '.DS_Store')
}

function deletionConfig(name) {
  return ['-c', `branch.${name}.remote=.`, '-c',
    `branch.${name}.merge=refs/heads/develop`]
}

function localConfigValues(cwd, key) {
  return lines0(git(cwd, ['config', '--local', '-z', '--get-all', key], [0, 1]).stdout)
}

/** Remove a clean local feature only after confirming it was merged into origin/develop. */
function cleanup(repo, name) {
  const { root } = repo
  validBranch(root, name)
  if (!refExists(root, `refs/heads/${name}`)) throw new Error('local feature branch does not exist')
  clean(root, 'source')
  const listed = worktrees(root)
  const feature = listed.find(item => item.branch === `refs/heads/${name}`)
  const developWorktree = listed.find(item => item.branch === 'refs/heads/develop')
  if (feature?.path === root) throw new Error('run cleanup from a different clean worktree')
  if (feature) {
    clean(feature.path, 'feature')
    if (!removableIgnored(feature.path)) {
      throw new Error('feature worktree contains ignored private files; move them before cleanup')
    }
  }
  if (developWorktree && developWorktree.path !== root) clean(developWorktree.path, 'develop')

  git(root, ['fetch', '--no-tags', 'origin',
    '+refs/heads/develop:refs/remotes/origin/develop'])
  const remote = sha(root, 'refs/remotes/origin/develop')
  const localDevelop = sha(root, 'refs/heads/develop')
  const featureTip = sha(root, `refs/heads/${name}`)
  if (!mergedInto(root, featureTip, remote)) {
    throw new Error('feature branch is not merged into origin/develop; cleanup refused')
  }
  if (!mergedInto(root, localDevelop, remote)) {
    throw new Error('local develop cannot fast-forward to origin/develop; cleanup refused')
  }
  const remoteKey = `branch.${name}.remote`
  const mergeKey = `branch.${name}.merge`
  const branchRef = `refs/heads/${name}`
  const upstream = git(root, ['for-each-ref', '--format=%(upstream)', branchRef]).stdout.trim()
  const pushedUpstream = upstream === `refs/remotes/origin/${name}`
  if (upstream && upstream !== 'refs/heads/develop' && !pushedUpstream) {
    throw new Error('feature branch has an unsupported upstream; cleanup refused')
  }
  const configuredRemote = pushedUpstream ? localConfigValues(root, remoteKey) : []
  const configuredMerge = pushedUpstream ? localConfigValues(root, mergeKey) : []
  if (pushedUpstream &&
      (configuredRemote.length !== 1 || configuredRemote[0] !== 'origin' ||
       configuredMerge.length !== 1 || configuredMerge[0] !== branchRef)) {
    throw new Error('feature branch has an unsupported upstream configuration; cleanup refused')
  }

  // Git treats branch.merge as multi-valued, so -c cannot replace a push -u upstream.
  // Temporarily use local develop for branch -d, then restore the original upstream on failure.
  const config = upstream ? [] : deletionConfig(name)
  try {
    if (pushedUpstream) git(root, ['branch', '--set-upstream-to=develop', name])
    const deletionUpstream = git(root, [...config, 'for-each-ref', '--format=%(upstream)',
      branchRef]).stdout.trim()
    if (deletionUpstream !== 'refs/heads/develop') {
      throw new Error('feature deletion cannot use local develop as its merge safety base; cleanup refused')
    }
    if (localDevelop !== remote) {
      if (developWorktree) {
        git(developWorktree.path, ['reset', '--keep', remote])
      } else {
        git(root, ['branch', '-f', 'develop', remote])
      }
    }
    if (feature) git(root, ['worktree', 'remove', '--', feature.path])
    git(root, [...config, 'branch', '-d', '--', name])
  } catch (error) {
    if (pushedUpstream && refExists(root, branchRef)) {
      git(root, ['config', '--local', '--replace-all', remoteKey, 'origin'])
      git(root, ['config', '--local', '--replace-all', mergeKey, branchRef])
    }
    throw error
  }
  return `Updated local develop: ${remote}\nRemoved local feature branch: ${name}` +
    (feature ? `\nRemoved worktree: ${feature.path}` : '')
}

function usage() {
  throw new Error('usage: cli.cjs start <branch> [--worktree <path>] | verify [--db] [--content] | review | scope | cleanup <branch>')
}

/** Dispatch one CLI command after verifying the Git repository's identity. */
function main(args) {
  const [operation, ...rest] = args
  const repo = repository()
  if (operation === 'start') {
    if (rest.length !== 1 && !(rest.length === 3 && rest[1] === '--worktree' && rest[2])) usage()
    return start(repo, rest[0], rest[2])
  }
  if (operation === 'verify') {
    if (rest.some(arg => !['--db', '--content'].includes(arg))) usage()
    const report = runVerification(repo, { db: rest.includes('--db'), content: rest.includes('--content') })
    process.exitCode = report.exitCode
    return report.output
  }
  if (operation === 'review') {
    if (rest.length) usage()
    const result = packageReview(repo)
    return `Review package: ${result.directory}\nSummary: ${path.join(result.directory, 'summary.md')}\nPatch: ${path.join(result.directory, 'review.patch')}\nChanged files: ${result.files}`
  }
  if (operation === 'scope') {
    if (rest.length) usage()
    const { fork } = base(repo.root)
    const needed = scope(changed(repo.root, fork).all)
    return `db=${needed.db}\ncontent=${needed.content}`
  }
  if (operation === 'cleanup') {
    if (rest.length !== 1) usage()
    return cleanup(repo, rest[0])
  }
  return usage()
}

if (require.main === module) {
  try { process.stdout.write(`${main(process.argv.slice(2))}\n`) } catch (error) {
    process.stderr.write(`CampusIntel workflow: ${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = { cleanup, main, start }
