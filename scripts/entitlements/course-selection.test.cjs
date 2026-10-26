// scripts/entitlements/course-selection.test.cjs — The operator tool's course-selection and calendar commands: one
// narrow function each, mandatory actor and reason for every change, validated keys and Lagos calendar days.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { run } = require('./ops.cjs')

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-secret' }
const USER = '6f1c2d4e-8a9b-4c3d-9e2f-1a2b3c4d5e6f'

function harness(reply = () => ({ state: 'changed' }), status = 200) {
  const requests = []
  const transport = async (url, init) => {
    requests.push({ fn: new URL(url).pathname.replace('/rest/v1/rpc/', ''), body: JSON.parse(init.body) })
    return new Response(JSON.stringify(reply()), { status })
  }
  const output = []
  return { requests, output, run: args => run(args, ENV, transport, text => output.push(text)) }
}

const change = ['selection-change', '--user', USER, '--department', 'accounting', '--level', '200-level',
  '--semester', 'first-semester', '--expected-revision', '4']

test('selection-change sends the keys, the revision shown by selection-status, the actor and the reason', async () => {
  const h = harness(() => ({ state: 'changed', revision: 5 }))
  await h.run([...change, '--actor', 'Ops', '--reason', 'asked on WhatsApp'])
  assert.deepEqual(h.requests, [{ fn: 'admin_change_course_selection', body: { p_user_id: USER,
    p_department_key: 'accounting', p_level_key: '200-level', p_period_key: 'first-semester', p_expected_revision: 4,
    p_allow_empty: false, p_actor: 'Ops', p_reason: 'asked on WhatsApp' } }])
  assert.deepEqual(JSON.parse(h.output[0]), { state: 'changed', revision: 5 })
  await h.run([...change, '--allow-empty', '--actor', 'Ops', '--reason', 'courses come later'])
  assert.equal(h.requests.at(-1).body.p_allow_empty, true, 'an empty combination needs the explicit flag (D12)')
})

test('no change is sent without an actor, a reason, a valid student, keys and a revision', async () => {
  const h = harness()
  await assert.rejects(h.run([...change, '--reason', 'asked']), /--actor is required/)
  await assert.rejects(h.run([...change, '--actor', 'Ops']), /--reason is required/)
  await assert.rejects(h.run(['selection-change', '--user', 'someone', '--department', 'accounting', '--level',
    '200-level', '--semester', 'first-semester', '--expected-revision', '4', '--actor', 'Ops', '--reason', 'x']),
  /--user is required and must be valid/)
  await assert.rejects(h.run(['selection-change', '--user', USER, '--department', 'Accounting Dept', '--level',
    '200-level', '--semester', 'first-semester', '--expected-revision', '4', '--actor', 'Ops', '--reason', 'x']),
  /--department is required and must be valid/)
  await assert.rejects(h.run(['selection-change', '--user', USER, '--department', 'accounting', '--level',
    '200-level', '--semester', 'first-semester', '--actor', 'Ops', '--reason', 'x']), /--expected-revision is required/)
  assert.equal(h.requests.length, 0)
})

test('the calendar commands: one function each, dates checked as calendar days before anything is sent', async () => {
  const h = harness(() => ({ state: 'created' }))
  await h.run(['term-set', '--session', '2026/2027', '--semester', 'first-semester', '--resumes-on', '2026-11-16',
    '--actor', 'Ops', '--reason', 'resumption moved by the university'])
  await h.run(['term-extend', '--session', '2026/2027', '--semester', 'first-semester', '--department', 'all',
    '--last-day', '2027-03-22', '--actor', 'Ops', '--reason', 'strike'])
  await h.run(['calendar'])
  await h.run(['selection-status', '--user', USER])
  assert.deepEqual(h.requests, [
    { fn: 'admin_set_academic_term', body: { p_session_label: '2026/2027', p_period_key: 'first-semester',
      p_resumes_on: '2026-11-16', p_actor: 'Ops', p_reason: 'resumption moved by the university' } },
    { fn: 'admin_set_department_end', body: { p_session_label: '2026/2027', p_period_key: 'first-semester',
      p_department_key: 'all', p_last_day: '2027-03-22', p_actor: 'Ops', p_reason: 'strike' } },
    { fn: 'admin_academic_calendar', body: {} },
    { fn: 'admin_course_selection_status', body: { p_user_id: USER } }])
  const bad = harness()
  await assert.rejects(bad.run(['term-set', '--session', '2026/2027', '--semester', 'first-semester', '--resumes-on',
    '2027-02-30', '--actor', 'Ops', '--reason', 'x']), /--resumes-on must be a calendar day/)
  await assert.rejects(bad.run(['term-set', '--session', '2026-2027', '--semester', 'first-semester', '--resumes-on',
    '2026-11-09', '--actor', 'Ops', '--reason', 'x']), /--session is required and must be valid/)
  await assert.rejects(bad.run(['term-extend', '--session', '2026/2027', '--semester', 'first-semester',
    '--department', 'all', '--last-day', '22/03/2027', '--actor', 'Ops', '--reason', 'x']), /--last-day is required/)
  await assert.rejects(bad.run(['term-extend', '--session', '2026/2027', '--semester', 'first-semester',
    '--department', 'all', '--last-day', '2027-03-22', '--reason', 'strike']), /--actor is required/)
  assert.equal(bad.requests.length, 0)
})

test('a refusal carries the database reason so the operator knows what to fix', async () => {
  const h = harness(() => ({ code: '22023', message: 'Semester dates refused: overlapping-semesters', details: null }), 400)
  await assert.rejects(h.run(['term-set', '--session', '2026/2027', '--semester', 'second-semester', '--resumes-on',
    '2027-01-04', '--actor', 'Ops', '--reason', 'calendar']),
  /admin_set_academic_term refused \(22023\): Semester dates refused: overlapping-semesters/)
  await assert.rejects(harness(() => null, 500).run(['calendar']), /admin_academic_calendar refused \(500\)$/)
})
