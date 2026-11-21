// supabase/diagnostics/retained-jwt.cjs — Local direct-PostgREST revocation regression.
// Run with Node 22 and local Supabase. Disposable accounts are always removed.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const { createClient } = require('@supabase/supabase-js')

let step = 'read local status'
async function main() {
  const status = JSON.parse(execFileSync('supabase', ['status', '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  const base = new URL(status.API_URL)
  assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname), 'Local Supabase required')
  const options = { auth: { persistSession: false, autoRefreshToken: false } }
  const admin = createClient(base.href, status.SERVICE_ROLE_KEY, options)
  const sql = query => execFileSync('docker', ['exec', 'supabase_db_Campusintel', 'psql',
    '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const users = []
  const request = async (token, path, method = 'GET', body, headers = {}) => {
    const response = await fetch(new URL(path, base), { method,
      headers: { apikey: status.ANON_KEY, Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json', Prefer: 'return=representation', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    const data = text ? JSON.parse(text) : null
    return { http: response.status, rows: Array.isArray(data) ? data.length : null,
      code: !Array.isArray(data) ? data?.code : undefined, data }
  }
  const summary = results => Object.fromEntries(Object.entries(results).map(([key, value]) =>
    [key, { http: value.http, rows: value.rows, ...(value.code ? { code: value.code } : {}), ...(typeof value.data === 'boolean' ? { value: value.data } : {}) }]))
  const rows = (result, count) => {
    assert.ok(result.http >= 200 && result.http < 300, 'Expected successful Data API request')
    assert.equal(result.rows, count, 'Unexpected visible/affected row count')
  }
  const denied = result => {
    assert.equal(result.http, 403, 'Expected Data API denial')
    assert.equal(result.code, '42501', 'Expected insufficient privilege')
  }
  try {
    step = 'create and sign in local accounts'
    for (let i = 0; i < 2; i++) {
      const password = randomBytes(32).toString('base64url') + 'aA1!'
      const email = `d02-${randomBytes(12).toString('hex')}@example.test`
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      assert.equal(created.error, null, 'Fixture creation failed')
      const user = { id: created.data.user.id }
      assert.match(user.id, /^[a-f0-9-]{36}$/)
      users.push(user)
      user.auth = createClient(base.href, status.ANON_KEY, options)
      const signed = await user.auth.auth.signInWithPassword({ email, password })
      assert.equal(signed.error, null, 'Fixture sign-in failed')
      user.token = signed.data.session.access_token
      user.claims = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url'))
      assert.match(user.claims.session_id, /^[a-f0-9-]{36}$/)
      assert.equal(Number(sql(`select count(*) from auth.sessions where id = '${user.claims.session_id}'
        and user_id = '${user.id}' and (not_after is null or not_after > now())`)), 1)
    }
    const [owner, other] = users
    // Keep this exact access token for every request, including after sign-out.
    const retainedToken = owner.token
    const reference = async table => {
      const result = await owner.auth.from(table).select('id').eq('is_active', true).order('sort_order').limit(2)
      assert.equal(result.error, null, 'Reference read failed')
      assert.ok(result.data.length)
      return result.data.map(row => row.id)
    }
    step = 'read reference and published data'
    const [departments, levels, periods, courses] = await Promise.all([
      reference('departments'), reference('academic_levels'), reference('academic_periods'),
      owner.auth.from('courses').select('id').order('id').limit(4),
    ])
    assert.equal(courses.error, null)
    assert.equal(courses.data.length, 4)
    const courseIds = courses.data.map(row => row.id)
    const selection = { department_id: departments[0], academic_level_id: levels[0], academic_period_id: periods[0] }
    const changedSelection = { ...selection, academic_level_id: levels.at(-1) }
    const question = JSON.parse(sql(`select jsonb_build_object('course_id', course_id,
      'question_id', question_id, 'revision', published_revision) from public.managed_content_items
      where kind = 'cbt_question' and published_revision is not null order by id limit 1`))
    const published = await owner.auth.rpc('read_published_managed_content', { p_course_id: question.course_id })
    assert.equal(published.error, null, 'Live published-content read failed')
    assert.ok(published.data.some(row => row.question_id === question.question_id && row.revision === question.revision))
    const profilePath = id => `/rest/v1/profiles?id=eq.${id}&select=id,department_id,academic_level_id,academic_period_id`
    const bookmarkPath = id => `/rest/v1/student_bookmarks?user_id=eq.${id}&select=course_id`
    const historyPaths = attempt => ({
      attempts: `/rest/v1/quiz_attempts?id=eq.${attempt}&select=id,status`,
      answers: `/rest/v1/quiz_attempt_answers?attempt_id=eq.${attempt}&select=question_id`,
      questions: `/rest/v1/quiz_attempt_questions?attempt_id=eq.${attempt}&select=question_id,content_revision`,
    })
    const readHistory = async (token, attempt) => Object.fromEntries(await Promise.all(
      Object.entries(historyPaths(attempt)).map(async ([key, path]) => [key, await request(token, path)])))

    step = 'live profile/bookmark/history fixture operations'
    for (const user of users) {
      rows(await request(user.token, profilePath(user.id), 'PATCH', selection), 1)
      rows(await request(user.token, '/rest/v1/student_bookmarks', 'POST', { user_id: user.id, course_id: courseIds[0] }), 1)
      rows(await request(user.token, bookmarkPath(user.id), 'DELETE'), 1)
      rows(await request(user.token, '/rest/v1/student_bookmarks', 'POST', { user_id: user.id, course_id: courseIds[0] }), 1)
      user.attempt = randomUUID()
      const args = { p_session_id: user.claims.session_id, p_attempt_id: user.attempt,
        p_course_id: question.course_id, p_question_count: 1, p_operation: 'start',
        p_expected_revision: null, p_status: 'in_progress', p_answers: [
          { question_id: question.question_id, ordinal: 0, content_revision: question.revision },
        ] }
      const started = await admin.rpc('write_quiz_attempt', args)
      assert.equal(started.error, null)
      assert.equal(started.data.status, 'saved')
      const recorded = await admin.rpc('write_quiz_attempt', { ...args, p_question_count: 0,
        p_operation: 'record', p_expected_revision: 0, p_answers: [
          { question_id: question.question_id, ordinal: 0, option_index: 0 },
        ] })
      assert.equal(recorded.error, null)
      assert.equal(recorded.data.status, 'saved')
      const finished = await admin.rpc('write_quiz_attempt', { ...args, p_question_count: 0,
        p_operation: 'finish', p_expected_revision: 1, p_status: 'submitted', p_answers: [] })
      assert.equal(finished.error, null)
      assert.equal(finished.data.status, 'saved')
    }
    const reconciliation = { p_reconciliation_id: randomUUID(), p_course_ids: [courseIds[1]] }
    const before = {
      profileRead: await request(retainedToken, profilePath(owner.id)),
      profileWrite: await request(retainedToken, profilePath(owner.id), 'PATCH', selection),
      reconcile: await request(retainedToken, '/rest/v1/rpc/reconcile_student_bookmarks', 'POST', reconciliation),
      replay: await request(retainedToken, '/rest/v1/rpc/reconcile_student_bookmarks', 'POST', reconciliation),
      bookmarkRead: await request(retainedToken, bookmarkPath(owner.id)),
      ...await readHistory(retainedToken, owner.attempt),
    }
    rows(before.profileRead, 1)
    rows(before.profileWrite, 1)
    rows(before.bookmarkRead, 2)
    assert.equal(before.reconcile.data, true)
    assert.equal(before.replay.data, false)
    for (const key of ['attempts', 'answers', 'questions']) rows(before[key], 1)

    step = 'live cross-owner denials'
    const bola = {
      profileRead: await request(retainedToken, profilePath(other.id)),
      profileWrite: await request(retainedToken, profilePath(other.id), 'PATCH', changedSelection),
      bookmarkRead: await request(retainedToken, bookmarkPath(other.id)),
      bookmarkDelete: await request(retainedToken, bookmarkPath(other.id), 'DELETE'),
      bookmarkInsert: await request(retainedToken, '/rest/v1/student_bookmarks', 'POST',
        { user_id: other.id, course_id: courseIds[2] }),
      ...await readHistory(retainedToken, other.attempt),
    }
    for (const [key, result] of Object.entries(bola)) key === 'bookmarkInsert' ? denied(result) : rows(result, 0)
    const snapshot = () => sql(`select jsonb_build_object(
      'profiles', (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p where id in ('${owner.id}', '${other.id}')),
      'bookmarks', (select jsonb_agg(to_jsonb(b) order by user_id, course_id) from public.student_bookmarks b where user_id in ('${owner.id}', '${other.id}')),
      'receipts', (select jsonb_agg(to_jsonb(r) order by user_id, reconciliation_id) from public.student_bookmark_reconciliations r where user_id in ('${owner.id}', '${other.id}')),
      'attempts', (select jsonb_agg(to_jsonb(a) order by id) from public.quiz_attempts a where user_id in ('${owner.id}', '${other.id}')),
      'answers', (select jsonb_agg(to_jsonb(a) order by attempt_id) from public.quiz_attempt_answers a where attempt_id in ('${owner.attempt}', '${other.attempt}')),
      'questions', (select jsonb_agg(to_jsonb(q) order by attempt_id) from public.quiz_attempt_questions q where attempt_id in ('${owner.attempt}', '${other.attempt}'))
    )`)
    const saved = snapshot()
    step = 'revoke local session through Auth admin sign-out'
    const revoked = await admin.auth.admin.signOut(retainedToken, 'global')
    assert.equal(revoked.error, null, 'Local session revocation failed')
    assert.equal(Number(sql(`select count(*) from auth.sessions where id = '${owner.claims.session_id}'`)), 0)
    assert.ok(owner.claims.exp * 1000 > Date.now(), 'Retained JWT must remain unexpired')

    step = 'retained JWT direct Data API requests'
    // Independent requests start only after the session deletion has committed.
    const after = Object.fromEntries(await Promise.all(Object.entries({
      profileRead: [profilePath(owner.id)],
      profileWrite: [profilePath(owner.id), 'PATCH', changedSelection],
      bookmarkRead: [bookmarkPath(owner.id)],
      bookmarkDelete: [bookmarkPath(owner.id), 'DELETE'],
      bookmarkInsert: ['/rest/v1/student_bookmarks', 'POST', { user_id: owner.id, course_id: courseIds[2] }],
      reconcile: ['/rest/v1/rpc/reconcile_student_bookmarks', 'POST',
        { p_reconciliation_id: randomUUID(), p_course_ids: [courseIds[3]] }],
      published: ['/rest/v1/rpc/read_published_managed_content', 'POST', { p_course_id: question.course_id }],
      ...Object.fromEntries(Object.entries(historyPaths(owner.attempt)).map(([key, path]) => [key, [path]])),
    }).map(async ([key, args]) => [key, await request(retainedToken, ...args)])))
    const privateRpc = await request(other.token, '/rest/v1/rpc/has_live_account_session', 'POST', {})
    const privateSchema = await request(other.token, '/rest/v1/rpc/has_live_account_session', 'POST', {},
      { 'Content-Profile': 'private' })
    const changed = snapshot() !== saved
    console.log(JSON.stringify({ localOnly: true, sessionRevoked: true,
      jwtSecondsUntilExpiry: owner.claims.exp - Math.floor(Date.now() / 1000),
      before: summary(before), bola: summary(bola), after: summary(after),
      helperExposure: summary({ privateRpc, privateSchema }), accountDataChanged: changed,
      paths: ['GET/PATCH /rest/v1/profiles?id=eq.<owner>',
        'GET/DELETE /rest/v1/student_bookmarks?user_id=eq.<owner>', 'POST /rest/v1/student_bookmarks',
        'POST /rest/v1/rpc/reconcile_student_bookmarks', 'GET /rest/v1/quiz_attempts?id=eq.<attempt>',
        'GET /rest/v1/quiz_attempt_answers?attempt_id=eq.<attempt>',
        'GET /rest/v1/quiz_attempt_questions?attempt_id=eq.<attempt>'],
    }, null, 2))
    for (const [key, result] of Object.entries(after)) {
      ['bookmarkInsert', 'reconcile', 'published'].includes(key) ? denied(result) : rows(result, 0)
    }
    assert.equal(privateRpc.http, 404)
    assert.equal(privateRpc.code, 'PGRST202')
    assert.equal(privateSchema.http, 406)
    assert.equal(privateSchema.code, 'PGRST106')
    assert.equal(changed, false, 'Retained JWT must not mutate any fixture account data')
    step = 'other live account remains functional'
    rows(await request(other.token, profilePath(other.id)), 1)
    rows(await request(other.token, bookmarkPath(other.id)), 1)
    for (const result of Object.values(await readHistory(other.token, other.attempt))) rows(result, 1)
    rows(await request(other.token, profilePath(owner.id)), 0)
    rows(await request(retainedToken, profilePath(other.id)), 0)
    rows(await request(retainedToken, bookmarkPath(other.id)), 0)
    for (const result of Object.values(await readHistory(retainedToken, other.attempt))) rows(result, 0)
    console.log('PASS: live owner access, BOLA, retained-JWT denial, private helper nonexposure, immutable account data.')
  } finally {
    for (const user of users) {
      const result = await admin.auth.admin.deleteUser(user.id)
      assert.equal(result.error, null, 'Local diagnostic account cleanup failed')
    }
  }
}

main().catch(error => {
  console.error(`Local D02 regression failed at ${step} (${error.code || error.name}); no credentials were logged.`)
  process.exitCode = 1
})
