// Critical-path counter from perf-audit-evidence/server/measure.py. Keep the same 0.5 ms timing tolerance.
const IDENTITY_BUDGET = 2
const IDENTITY = new Set(['/auth/v1/user', '/auth/v1/token', '/auth/v1/.well-known/jwks.json',
  '/rest/v1/rpc/read_account_lifecycle', '/rest/v1/rpc/read_student_context',
  '/rest/v1/departments', '/rest/v1/academic_levels', '/rest/v1/academic_periods'])

function depth(calls) {
  const ordered = [...calls].sort((a, b) => a.start - b.start)
  const depths = []
  for (const [i, call] of ordered.entries()) {
    depths.push(1 + Math.max(0, ...ordered.slice(0, i).flatMap((earlier, j) =>
      earlier.end <= call.start + 0.5 ? [depths[j]] : [])))
  }
  return Math.max(0, ...depths)
}

function isIdentity(call) {
  const path = call.endpoint.split('?')[0]
  // The course reader's three-column selection recheck is its own data work, not the page's initial profile.
  if (path === '/rest/v1/profiles') return call.columns?.split(',').includes('first_name') ?? true
  return IDENTITY.has(path)
}

function summarize(calls) {
  const own = calls.filter(call => !isIdentity(call))
  const ownStart = Math.min(Infinity, ...own.map(call => call.start))
  // Include late identity checks too: moving a duplicate check after page data cannot evade the regression.
  const identity = calls.filter(call => call.start < ownStart || isIdentity(call))
  return { calls: calls.length, depth: depth(calls), identityCalls: identity.length, identityDepth: depth(identity),
    authCalls: calls.filter(call => call.endpoint === '/auth/v1/user').length }
}

function assertBudget(result, name) {
  if (result.identityDepth > IDENTITY_BUDGET || result.authCalls !== 1) {
    throw new Error(`${name}: identity depth ${result.identityDepth}/${IDENTITY_BUDGET}, getUser calls ${result.authCalls}/1`)
  }
}

module.exports = { depth, summarize, assertBudget, IDENTITY_BUDGET }
