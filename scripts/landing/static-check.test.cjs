// scripts/landing/static-check.test.cjs — The check that a production build lists the landing page as static.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { landingBuildStatus, readLandingBuild } = require('./static-check.cjs')

const SCRIPT = path.join(__dirname, 'static-check.cjs')
// The entry Next.js 16 writes for a page built once; the fields this check reads, as the build wrote them.
const STATIC_ENTRY = { routeType: 'page', response: 'complete', compute: 'static', initialRevalidateSeconds: false,
  srcRoute: '/', dataRoute: '/index.rsc' }
const manifest = routes => ({ version: 4, routes, dynamicRoutes: {}, notFoundRoutes: [] })

/** A build folder with the given manifest and, unless empty, a landing page file of that many bytes. */
function build(t, contents, pageBytes = 2048) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campusintel-static-check-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  if (contents !== null) fs.writeFileSync(path.join(directory, 'prerender-manifest.json'), contents)
  if (pageBytes !== null) {
    fs.mkdirSync(path.join(directory, 'server', 'app'), { recursive: true })
    fs.writeFileSync(path.join(directory, 'server', 'app', 'index.html'), 'x'.repeat(pageBytes))
  }
  return directory
}

test('a landing page built once is static', () => {
  assert.deepEqual(landingBuildStatus(manifest({ '/': STATIC_ENTRY, '/icon.svg': STATIC_ENTRY })),
    { ok: true, reason: 'built once, never re-rendered' })
  // Older builds name fewer fields; the ones that are present still decide.
  assert.equal(landingBuildStatus(manifest({ '/': { initialRevalidateSeconds: false, dataRoute: '/index.rsc' } })).ok, true)
  assert.equal(landingBuildStatus(manifest({ '/': { ...STATIC_ENTRY, renderingMode: 'STATIC' } })).ok, true)
})

test('a landing page rendered per request, on a timer or only in part is not static', () => {
  const refused = [
    [manifest({ '/icon.svg': STATIC_ENTRY }), /renders it again for every request/],
    [manifest({}), /renders it again for every request/],
    [manifest({ '/': { ...STATIC_ENTRY, initialRevalidateSeconds: 3600 } }), /on a timer \(3600\)/],
    [manifest({ '/': { ...STATIC_ENTRY, initialRevalidateSeconds: undefined } }), /on a timer/],
    [manifest({ '/': { ...STATIC_ENTRY, compute: 'dynamic' } }), /computes it as "dynamic"/],
    [manifest({ '/': { ...STATIC_ENTRY, response: 'partial' } }), /only part of it \("partial"\)/],
    [manifest({ '/': { ...STATIC_ENTRY, renderingMode: 'PARTIALLY_STATIC' } }), /only part of it \("PARTIALLY_STATIC"\)/],
    [manifest({ '/': { ...STATIC_ENTRY, experimentalPPR: true } }), /only part of it/],
    [manifest({ '/': null }), /unreadable/],
    [manifest({ '/': 'static' }), /unreadable/],
    [manifest({ '/index': STATIC_ENTRY, '/dashboard': STATIC_ENTRY }), /renders it again for every request/],
    [{ version: 4 }, /no list of prerendered pages/],
    [{ routes: ['/'] }, /no list of prerendered pages/],
    [null, /no list of prerendered pages/],
  ]
  for (const [input, reason] of refused) {
    const status = landingBuildStatus(input)
    assert.equal(status.ok, false, JSON.stringify(input))
    assert.match(status.reason, reason)
  }
  // Only the build's own entry counts, never an inherited one.
  assert.equal(landingBuildStatus(manifest(Object.create({ '/': STATIC_ENTRY }))).ok, false)
})

test('the check reads a finished build and needs the page file the build wrote', t => {
  const good = build(t, JSON.stringify(manifest({ '/': STATIC_ENTRY })))
  assert.deepEqual(readLandingBuild(good), { ok: true, reason: 'built once, never re-rendered, 2.0 KB of HTML' })
  assert.match(readLandingBuild(build(t, JSON.stringify(manifest({ '/': STATIC_ENTRY })), null)).reason, /wrote no page file/)
  assert.match(readLandingBuild(build(t, JSON.stringify(manifest({ '/': STATIC_ENTRY })), 0)).reason, /wrote no page file/)
  assert.match(readLandingBuild(build(t, null)).reason, /no finished build in .*; run pnpm build first/)
  assert.match(readLandingBuild(build(t, '{"routes":')).reason, /no finished build/)
  assert.match(readLandingBuild(build(t, JSON.stringify(manifest({})))).reason, /every request/)
})

test('run as a command it says which and exits 0 only for a static landing page', t => {
  const run = directory => spawnSync(process.execPath, [SCRIPT, directory], { encoding: 'utf8' })
  const passed = run(build(t, JSON.stringify(manifest({ '/': STATIC_ENTRY }))))
  assert.equal(passed.status, 0)
  assert.equal(passed.stdout, 'The landing page (/) is a static page: built once, never re-rendered, 2.0 KB of HTML.\n')
  assert.equal(passed.stderr, '')
  const failed = run(build(t, JSON.stringify(manifest({ '/dashboard': STATIC_ENTRY }))))
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, '')
  assert.equal(failed.stderr, 'The landing page (/) is not a static page: the build renders it again for every request.\n')
  // With no folder named it reads .next in the current directory.
  const empty = build(t, null, null)
  const missing = spawnSync(process.execPath, [SCRIPT], { cwd: empty, encoding: 'utf8' })
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /no finished build in .*\.next; run pnpm build first/)
})
