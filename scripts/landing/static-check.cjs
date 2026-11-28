// scripts/landing/static-check.cjs — After a production build, confirm the landing page was built once as a static page.
// Run: node scripts/landing/static-check.cjs [build folder]   (the folder defaults to .next)
// The verifier runs this after `pnpm build`. It reads what the build wrote, so it needs a finished build.
const fs = require('node:fs')
const path = require('node:path')

const LANDING_ROUTE = '/'
const MANIFEST = 'prerender-manifest.json'
const LANDING_HTML = path.join('server', 'app', 'index.html')

/** Decide from the build's prerender manifest whether "/" is fully static. Anything unrecognised is a "no". */
function landingBuildStatus(manifest) {
  const routes = manifest?.routes
  if (routes === null || typeof routes !== 'object' || Array.isArray(routes)) {
    return { ok: false, reason: 'the build wrote no list of prerendered pages' }
  }
  if (!Object.hasOwn(routes, LANDING_ROUTE)) return { ok: false, reason: 'the build renders it again for every request' }
  const entry = routes[LANDING_ROUTE]
  if (entry === null || typeof entry !== 'object') return { ok: false, reason: 'the build entry for it is unreadable' }
  if (entry.initialRevalidateSeconds !== false) {
    return { ok: false, reason: `the build re-renders it on a timer (${JSON.stringify(entry.initialRevalidateSeconds)})` }
  }
  // Named differently across Next.js versions; each one, when present, must say the whole page is static.
  if (entry.compute !== undefined && entry.compute !== 'static') {
    return { ok: false, reason: `the build computes it as ${JSON.stringify(entry.compute)}` }
  }
  if (entry.response !== undefined && entry.response !== 'complete') {
    return { ok: false, reason: `the build prerendered only part of it (${JSON.stringify(entry.response)})` }
  }
  if (entry.renderingMode !== undefined && entry.renderingMode !== 'STATIC') {
    return { ok: false, reason: `the build prerendered only part of it (${JSON.stringify(entry.renderingMode)})` }
  }
  if (entry.experimentalPPR === true) return { ok: false, reason: 'the build prerendered only part of it' }
  return { ok: true, reason: 'built once, never re-rendered' }
}

/** Read a finished build folder and answer for the landing page, including that its page file was written. */
function readLandingBuild(buildDirectory) {
  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(buildDirectory, MANIFEST), 'utf8'))
  } catch {
    return { ok: false, reason: `no finished build in ${buildDirectory}; run pnpm build first` }
  }
  const status = landingBuildStatus(manifest)
  if (!status.ok) return status
  let size = 0
  try { size = fs.statSync(path.join(buildDirectory, LANDING_HTML)).size } catch { /* reported below */ }
  if (size === 0) return { ok: false, reason: 'the build lists it as static but wrote no page file' }
  return { ok: true, reason: `${status.reason}, ${(size / 1024).toFixed(1)} KB of HTML` }
}

if (require.main === module) {
  const status = readLandingBuild(path.resolve(process.argv[2] ?? '.next'))
  if (status.ok) console.log(`The landing page (/) is a static page: ${status.reason}.`)
  else console.error(`The landing page (/) is not a static page: ${status.reason}.`)
  process.exitCode = status.ok ? 0 : 1
}

module.exports = { landingBuildStatus, readLandingBuild }
