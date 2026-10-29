const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Static half of the identity budget: runs by default, no server or database. Every app page and the layouts,
// templates and server components they render reach Auth, lifecycle and profile identity only through the shared
// render-session modules, which share one getUser and one read_student_context per request. Route handlers are
// exempt: they are not page entries and keep their fresh checks before writes.
const root = path.resolve(__dirname, '../..')
const ENTRY = /^(page|layout|template|loading|not-found|global-not-found|default|forbidden|unauthorized)\.(tsx|ts|jsx|js)$/
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const FORBIDDEN = [
  ['auth.getUser()', /\.getUser\s*\(/g],
  ['read_account_lifecycle', /read_account_lifecycle/g],
  ['direct profiles read', /\.from\(\s*['"`]profiles['"`]\s*\)/g],
]
// The shared session modules: render clients go through readRenderStudentSession; other clients stay fresh.
const SHARED = new Set(['lib/auth/verified-user.ts', 'lib/auth/render-session.ts', 'lib/auth/student-state.ts',
  'lib/account/lifecycle.ts', 'lib/profile/student-profile.ts', 'lib/profile/course-selection.ts'])
// Reachable from pages but not identity reads. Each is counted, so a second call in the same file still fails.
const EXEMPT = {
  // Non-render (route handler) fallback; render clients take the shared snapshot on the line above it.
  'lib/entitlements/server.ts': { 'auth.getUser()': 1, guard: /isStudentRenderClient\(client\) \? await readRenderStudentSession/ },
  // The course reader's own selection recheck against its course rows, not the page's initial profile.
  'lib/courses/read-model.ts': { 'direct profiles read': 1 },
  // Operator role authorization on the admin surface, after the shared live-session check.
  'lib/operator/access.ts': { 'direct profiles read': 1 },
}

function strip(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

function findings(source) {
  const code = strip(source)
  return FORBIDDEN.flatMap(([name, pattern]) => (code.match(pattern) ?? []).map(() => name))
}

function resolve(from, specifier) {
  const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(from), specifier) : null
  if (base === null) return null
  for (const candidate of [base, ...EXTENSIONS.map(ext => base + ext), ...EXTENSIONS.map(ext => path.join(base, 'index' + ext))]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function imports(source) {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
  return [...source.matchAll(pattern)].map(match => match[1])
}

function entries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) return full === path.join(root, 'app/api') ? [] : entries(full)
    return ENTRY.test(entry.name) ? [full] : []
  })
}

/** Every server module rendered from an app entry, with the entry that first reached it. */
function serverGraph() {
  const reached = new Map()
  const queue = entries(path.join(root, 'app')).map(file => [file, file])
  while (queue.length) {
    const [file, entry] = queue.shift()
    if (reached.has(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    // A client component never runs server identity work; its server props come from the page that renders it.
    if (/^\s*['"]use client['"]/.test(strip(source))) continue
    reached.set(file, entry)
    for (const specifier of imports(source)) {
      const target = resolve(file, specifier)
      if (target !== null && !reached.has(target)) queue.push([target, entry])
    }
  }
  return reached
}

test('the scanner sees identity calls and ignores comments and other names', () => {
  assert.deepEqual(findings(`const { data } = await client.auth.getUser()
    await client.rpc('read_account_lifecycle'); await client.from("profiles").select('id')`),
  ['auth.getUser()', 'read_account_lifecycle', 'direct profiles read'])
  assert.deepEqual(findings(`// client.auth.getUser()
    /* read_account_lifecycle */ await getStudentSessionUser(); client.from('profile_events'); const u = 'https://x/y'`), [])
})

test('every app page and the server components it renders use only the shared session modules for identity', () => {
  const graph = serverGraph()
  const pages = [...graph.keys()].filter(file => path.basename(file).startsWith('page.'))
  assert.ok(pages.length >= 20, `only ${pages.length} pages discovered`)
  for (const shared of ['lib/auth/render-session.ts', 'lib/auth/server-chrome.ts', 'lib/supabase/server.ts']) {
    assert.ok(graph.has(path.join(root, shared)), `${shared} is not reached from any page; discovery is broken`)
  }
  const failures = []
  for (const [file, entry] of graph) {
    const relative = path.relative(root, file)
    if (SHARED.has(relative)) continue
    const source = fs.readFileSync(file, 'utf8')
    const counts = {}
    for (const name of findings(source)) counts[name] = (counts[name] ?? 0) + 1
    const exempt = EXEMPT[relative] ?? {}
    if (exempt.guard && !exempt.guard.test(source)) failures.push(`${relative}: render-session guard removed`)
    for (const [name, count] of Object.entries(counts)) {
      if (count > (exempt[name] ?? 0)) failures.push(`${relative}: ${name} ×${count} (rendered from ${path.relative(root, entry)})`)
    }
  }
  for (const [relative, exempt] of Object.entries(EXEMPT)) {
    const file = path.join(root, relative)
    const found = graph.has(file) ? findings(fs.readFileSync(file, 'utf8')) : []
    for (const [name, count] of Object.entries(exempt)) {
      if (name !== 'guard' && found.filter(item => item === name).length !== count) failures.push(`${relative}: stale exemption for ${name}`)
    }
  }
  assert.deepEqual(failures, [], 'identity reads outside the shared session modules')
})
