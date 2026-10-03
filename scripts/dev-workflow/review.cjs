// scripts/dev-workflow/review.cjs — Build a safe review patch from tracked and untracked source.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { base, branch, changed, git, sha } = require('./repo.cjs')

const EXCLUDED_PARTS = new Set([
  '.git', '.next', '.cache', '.turbo', '.vercel', '.aws', '.ssh', '.secrets',
  '.agents', '.codex', '.claude', '.pnpm', '.venv', 'node_modules', 'coverage',
  'credentials', 'dist', 'build', 'out', 'tmp', 'temp', 'venv', 'logs',
  '_audit', '_design', '_source', '__pycache__',
])
const SECRET_MARKERS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\b(?:gh[pousr]_|github_pat_|npm_)[A-Za-z0-9_]{30,}\b/,
  /\b(?:sk_live_|rk_live_|sb_secret_)[A-Za-z0-9_-]{20,}\b/,
  /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/,
  /postgres(?:ql)?:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/,
  /\b(?:password|passphrase|client_secret|service_role_key|api_key|private_key)\b\s*[:=]\s*['"`][^'"`\n]+/i,
  /\b(?:password|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"`][A-Za-z0-9_+\/=.-]{20,}/i,
]

/** Reject sensitive, generated, non-file, or escaping paths before packaging. */
function safePath(root, relative) {
  if (!relative || path.isAbsolute(relative) || /[\x00-\x1f\x7f]/.test(relative) ||
      relative.split('/').some(part => part === '..' || part === '.' || !part)) {
    throw new Error('review contains an unsafe path')
  }
  const parts = relative.split('/')
  const basename = parts.at(-1).toLowerCase()
  if (parts.some(part => EXCLUDED_PARTS.has(part.toLowerCase())) ||
      parts[0] === 'supabase' && parts[1]?.startsWith('.') ||
      parts.some(part => /^\.env(?:\.|$)/i.test(part)) ||
      /^(?:\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|service-account(?:\..*)?|id_(?:rsa|ed25519)(?:\..*)?)$/i.test(basename) ||
      /\.(?:pem|key|p12|pfx|keystore|jks|sqlite|db|log|zip|tar|tgz)$/i.test(basename)) {
    throw new Error(`review refuses sensitive or generated path: ${relative}`)
  }
  const full = path.resolve(root, relative)
  if (!full.startsWith(`${root}${path.sep}`)) throw new Error('review path escapes repository')
  let stat
  try { stat = fs.lstatSync(full) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (stat) {
    if (!stat.isFile()) throw new Error(`review refuses non-file path: ${relative}`)
    const resolved = fs.realpathSync(full)
    if (!resolved.startsWith(`${fs.realpathSync(root)}${path.sep}`)) {
      throw new Error(`review path escapes repository: ${relative}`)
    }
  }
}

/** Reject oversized patches and recognizable credential signatures. */
function safePatch(patch) {
  if (Buffer.byteLength(patch) > 32 * 1024 * 1024) {
    throw new Error('review patch exceeds the 32 MiB safety limit')
  }
  if (SECRET_MARKERS.some(marker => marker.test(patch))) {
    throw new Error('review patch contains a possible credential; package was not written')
  }
}

/** Write a review summary and complete patch to a private temporary directory. */
function packageReview(repo) {
  const { root } = repo
  const { develop, fork } = base(root)
  const paths = changed(root, fork)
  paths.all.forEach(relative => safePath(root, relative))

  let patch = git(root, ['diff', '--binary', '--full-index', '--no-renames', fork, '--']).stdout
  for (const relative of paths.untracked) {
    const result = git(root, ['diff', '--no-index', '--binary', '--full-index', '--',
      '/dev/null', relative], [1])
    patch += result.stdout
  }
  safePatch(patch)

  const stat = spawnSync('git', ['apply', '--stat', '--'], {
    cwd: root, input: patch, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })
  if (stat.error || stat.status !== 0) throw new Error('review patch could not be summarized')

  const status = git(root, ['status', '--short', '--untracked-files=all']).stdout.trimEnd()
  const summary = [
    '# CampusIntel review package', '',
    `Repository: ${repo.origin}`,
    `Branch: ${branch(root)}`,
    `HEAD: ${sha(root, 'HEAD')}`,
    `origin/develop: ${develop}`,
    `Review base (merge-base): ${fork}`,
    '', '## Worktree status', '', '```text', status || 'clean', '```',
    '', '## Changed files', '', ...paths.all.map(file => `- ${file}`),
    '', '## Diff stat', '', '```text', stat.stdout.trimEnd() || '(no changes)', '```',
    '', 'Patch: review.patch', '',
  ].join('\n')

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campusintel-review-'))
  fs.chmodSync(directory, 0o700)
  fs.writeFileSync(path.join(directory, 'summary.md'), summary, { flag: 'wx', mode: 0o600 })
  fs.writeFileSync(path.join(directory, 'review.patch'), patch, { flag: 'wx', mode: 0o600 })
  return { directory, files: paths.all.length, base: fork }
}

module.exports = { packageReview, safePatch, safePath }
