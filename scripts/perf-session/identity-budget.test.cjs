const { test } = require('node:test')
const assert = require('node:assert/strict')
const { measurePages } = require('./measure.cjs')
const fs = require('node:fs')
const path = require('node:path')
const { depth, summarize, assertBudget } = require('./call-budget.cjs')

test('audit counter distinguishes concurrent calls and catches late repeated identity checks', () => {
  const auth = { endpoint: '/auth/v1/user', start: 0, end: 10 }
  const context = { endpoint: '/rest/v1/rpc/read_student_context', start: 11, end: 20 }
  const own = { endpoint: '/rest/v1/rpc/get_my_entitlement', start: 21, end: 30 }
  assert.equal(depth([auth, context, own]), 3)
  assert.equal(depth([auth, { ...context, start: 1 }]), 1)
  assertBudget(summarize([auth, context, own]), 'page')
  assert.throws(() => assertBudget(summarize([auth, context, own,
    { endpoint: '/rest/v1/rpc/read_account_lifecycle', start: 31, end: 40 }]), 'page'), /identity depth 3\/2/)
  assert.throws(() => assertBudget(summarize([auth, context, { ...auth, start: 31, end: 40 }]), 'page'), /getUser calls 2\/1/)
  const recheck = { endpoint: '/rest/v1/profiles?select,id', columns: 'department_id,academic_level_id,academic_period_id',
    start: 21, end: 30 }
  assert.equal(summarize([auth, context, recheck]).identityDepth, 2, 'course-selection recheck stays page-owned')
})

// Production-server integration: measure.cjs writes request-linked raw tracer calls, never fabricated counts.
// Set PERF_SESSION_TRACE, PERF_SESSION_USERS, PERF_SESSION_COURSE and PERF_SESSION_RESULTS for a live run.
test('every signed-in page stays within the identity budget', { skip: process.env.PERF_SESSION_TRACE ? false
  : 'Requires the local traced production server and signed-in fixtures' }, async () => {
  const measured = await measurePages({ trace: process.env.PERF_SESSION_TRACE, users: process.env.PERF_SESSION_USERS,
    course: process.env.PERF_SESSION_COURSE, out: process.env.PERF_SESSION_RESULTS })
  const app = path.resolve(__dirname, '../../app')
  const pages = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? pages(path.join(directory, entry.name)) : entry.name === 'page.tsx' ? [path.join(directory, entry.name)] : [])
  for (const file of pages(app)) {
    if (!/StudentAccessGate|getStudentSessionContext/.test(fs.readFileSync(file, 'utf8'))) continue
    const route = '/' + path.relative(app, path.dirname(file))
    const pattern = new RegExp('^' + route.replace(/\[[^/]+\]/g, '[^/]+') + '$')
    assert.ok(Object.values(measured).some(result => pattern.test(result.path)), `${route}: absent from budget harness`)
  }
  for (const name of ['dashboard', 'my-courses', 'course-open', 'course-locked', 'quiz', 'access', 'account',
    'courses', 'bookmarks', 'materials', 'profile-selection', 'course-materials', 'theory', 'preview', 'ai-practice',
    'account-deletion']) {
    assert.ok(measured[name]?.runs?.length >= 3, `${name}: missing measurements`)
    for (const run of measured[name].runs) {
      assert.ok(run.status < 400, `${name}: unexpected HTTP ${run.status}`)
      const context = run.calls.filter(call => call.endpoint === '/rest/v1/rpc/read_student_context')
      assert.equal(context.length, 1, name)
      assert.equal(context[0].status, 200, `${name}: context RPC failed`)
      assert.equal(run.calls.find(call => call.endpoint === '/auth/v1/user')?.status, 200, `${name}: Auth failed`)
      assertBudget(summarize(run.calls), name)
    }
  }
})


test('client navigations also stay within the identity budget when the root layout is reused', {
  skip: process.env.PERF_SESSION_NAVIGATION_HEADERS ? false : 'Requires real browser navigation headers and the traced server',
}, async () => {
  const measured = await measurePages({ trace: process.env.PERF_SESSION_TRACE, users: process.env.PERF_SESSION_USERS,
    course: process.env.PERF_SESSION_COURSE, out: process.env.PERF_SESSION_RESULTS.replace(/\.json$/, '-rsc.json'),
    mode: 'rsc', navigationHeaders: process.env.PERF_SESSION_NAVIGATION_HEADERS })
  for (const [name, result] of Object.entries(measured)) for (const run of result.runs) {
    assertBudget(summarize(run.calls), name + ' navigation')
    assert.equal(run.calls.find(call => call.endpoint === '/rest/v1/rpc/read_student_context')?.status, 200, name)
  }
})
