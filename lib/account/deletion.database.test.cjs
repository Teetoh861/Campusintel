// Opt in on the local-only Auth/database stack: ACCOUNT_DELETION_DB_TEST=1.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const { NextResponse } = require('next/server')
const { fixture } = require('../auth/session-generation-database-fixture.cjs')
const enabled = process.env.ACCOUNT_DELETION_DB_TEST === '1'
const databaseContainer = process.env.ACCOUNT_DELETION_DB_CONTAINER || 'supabase_db_Campusintel'
const LOCK_WAIT_TIMEOUT_MS = 10_000
const args = ['exec', '-i', databaseContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1']

function sql(statement) {
  const result = spawnSync('docker', [...args, '-c', statement], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function background(statement) {
  const process = spawn('docker', [...args, '-c', statement], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', error = ''
  process.stdout.on('data', value => { out += value }); process.stderr.on('data', value => { error += value })
  return new Promise((resolve, reject) => process.on('error', reject).on('close', code => {
    if (code !== 0) reject(new Error(error)); else resolve(out.trim())
  }))
}
function bearer(accessToken) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: 'Bearer ' + accessToken } },
  })
}
async function raw(f) {
  return f.invoke(() => f.student.getStudentSessionContext(NextResponse.json({}), undefined, { allowRestricted: true }))
}
async function rawToken(f) {
  const context = await raw(f)
  return require('../auth/account-continuity.ts').issueAccountContinuityToken(context.user.id, context.sessionId)
}
async function schedule(f) {
  const result = await f.post('schedule-deletion', { password: f.password, confirmed: true }, await f.pageToken())
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()))
  f.apply(result); return result
}
async function restrictedLogin(f, account) {
  const response = await f.post('login', { email: account.email, password: f.password, next: '/bookmarks' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { next: '/account/deletion' })
  f.apply(response)
}

test('real password scheduling revokes every device; subsequent login requires Yes; No signs out without cancelling', { skip: !enabled }, async () => fixture(async f => {
  const [account, other] = f.accounts
  await f.login(account); await f.completeProfile('Deletion fixture')
  const cookieBefore = f.cookieHeader(), pageToken = await f.pageToken()
  const held = await f.native()
  const initial = await f.invoke(async () => (await f.server.createClient()).auth.getSession())
  const tokens = initial.data.session
  const gateway = require('../supabase/auth-gateway.ts').getAuthGateway('local')
  const secondDevice = await gateway.signInWithPassword({ email: account.email, password: f.password })
  assert.equal(secondDevice.error, null)
  const wrong = await f.post('schedule-deletion', { password: randomUUID(), confirmed: true }, pageToken)
  assert.equal(wrong.status, 400)
  assert.equal(sql(`select count(*) from private.account_deletion_jobs where user_id='${account.id}'`), '0')
  const stale = await f.post('schedule-deletion', { password: f.password, confirmed: true }, 'stale-render')
  assert.equal(stale.status, 409)
  const scheduled = await schedule(f)
  assert.deepEqual(await scheduled.json(), { next: '/login?state=deletion-scheduled' })
  assert.equal(await f.current(), null)
  assert.equal(sql(`select count(*) from auth.sessions where user_id='${account.id}'`), '0')
  assert.equal(sql(`select count(*) from auth.refresh_tokens where user_id='${account.id}' and not revoked`), '0')
  const firstDeadline = sql(`select deadline from private.account_deletion_jobs where user_id='${account.id}'`)
  for (const token of [tokens.access_token, secondDevice.data.session.access_token]) {
    const old = bearer(token)
    assert.equal((await old.rpc('read_account_lifecycle')).data.status, 'signed-out')
    assert.deepEqual((await old.from('profiles').select('id')).data, [])
  }
  const oldRefresh = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  assert.ok((await oldRefresh.auth.refreshSession({ refresh_token: secondDevice.data.session.refresh_token })).error)
  f.apply(held); assert.equal(await f.current(), null, 'delayed refresh cannot revive scheduled account')
  assert.equal(await f.current(cookieBefore), null, 'original cookie cannot bypass the database lifecycle')
  await restrictedLogin(f, account)
  assert.equal(await f.current(), null, 'ordinary server helper denies a fresh scheduled login')
  assert.equal((await raw(f)).user.id, account.id)
  assert.equal(sql(`select deadline from private.account_deletion_jobs where user_id='${account.id}'`), firstDeadline, 'login did not cancel or extend deadline')
  const proxy = await f.native()
  assert.equal(new URL(proxy.headers.get('location')).pathname, '/account/deletion', 'direct student page navigation is mandatory decision')
  const no = await f.post('logout', {}, await rawToken(f)); assert.equal(no.status, 200); f.apply(no)
  assert.equal(await raw(f), null)
  assert.equal(sql(`select count(*) from private.account_deletion_jobs where user_id='${account.id}'`), '1', 'No preserves request')
  await restrictedLogin(f, account)
  const token = await rawToken(f)
  const requestId = sql(`select id from private.account_deletion_jobs where user_id='${account.id}'`)
  const wrongRequest = await f.post('cancel-deletion', { requestId: randomUUID() }, token)
  assert.equal(wrongRequest.status, 409)
  const yes = await f.post('cancel-deletion', { requestId }, token)
  assert.equal(yes.status, 200); assert.deepEqual(await yes.json(), { next: '/dashboard' }); f.apply(yes)
  assert.equal((await f.current()).user.id, account.id)
  assert.equal(sql(`select count(*) from private.account_deletion_jobs where user_id='${account.id}'`), '0')
  assert.equal((await f.invoke(() => require('../profile/student-profile.ts').getCurrentStudentProfile())).status, 'complete')
  await f.post('logout', {}, await f.pageToken()).then(f.apply)
  await f.login(other)
  const crossAccount = await f.post('cancel-deletion', { requestId }, token)
  assert.equal(crossAccount.status, 409, 'stale account action cannot affect the new account')
}))

test('real provider login/refresh/password recovery and all app data stay unavailable after expiry with worker delayed', { skip: !enabled }, async () => fixture(async f => {
  const [account] = f.accounts
  await f.login(account); await schedule(f); await restrictedLogin(f, account)
  const pageToken = await rawToken(f), requestId = sql(`select id from private.account_deletion_jobs where user_id='${account.id}'`)
  const current = await f.invoke(async () => (await f.server.createClient()).auth.getSession())
  sql(`update private.account_deletion_jobs set requested_at=statement_timestamp()-interval '721 hours',
    deadline=statement_timestamp()-interval '1 hour',retry_at=statement_timestamp()-interval '1 hour' where user_id='${account.id}'`)
  assert.equal(await f.current(), null)
  const cancelled = await f.post('cancel-deletion', { requestId }, pageToken)
  assert.equal(cancelled.status, 403)
  const direct = bearer(current.data.session.access_token)
  assert.equal((await direct.rpc('read_account_lifecycle')).data.status, 'expired')
  assert.deepEqual((await direct.from('profiles').select('id')).data, [])
  assert.deepEqual((await direct.from('courses').select('id')).data, [])
  const provider = require('../supabase/auth-gateway.ts').getAuthGateway('local')
  assert.ok((await provider.signInWithPassword({ email: account.email, password: f.password })).error, 'Auth itself cannot create an expired session')
  const expiredLogin = await f.post('login', { email: account.email, password: f.password }, undefined, null)
  assert.equal(expiredLogin.status, 503, 'Auth session trigger rejects before an authenticated lifecycle read is possible')
  assert.deepEqual(await expiredLogin.json(), { error: require('../auth/constants.ts').AUTH_MESSAGES.unavailable })
  assert.equal(expiredLogin.cookies.getAll().length, 0, 'expired login never transfers browser authority')
  const refresher = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  assert.ok((await refresher.auth.refreshSession({ refresh_token: current.data.session.refresh_token })).error, 'Auth refresh denied after expiry')
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  assert.ok((await admin.auth.admin.updateUserById(account.id, { password: randomUUID() })).error, 'even an already-consumed recovery grant cannot replace password late')
  assert.equal(sql(`select count(*) from auth.users where id='${account.id}'`), '1', 'denial does not depend on purge completing')
}))

test('cancellation waiting across deadline loses to database time; concurrent workers purge exactly once', { skip: !enabled }, async () => fixture(async f => {
  const [account] = f.accounts
  await f.login(account); await schedule(f); await restrictedLogin(f, account)
  const pageToken = await rawToken(f), requestId = sql(`select id from private.account_deletion_jobs where user_id='${account.id}'`)
  // A transaction updates the deadline while holding the same account lock.
  // Observe its server-side lock state; the timer is only the DB fixture's release.
  const applicationName = 'account-deletion-race-' + randomUUID()
  const holder = background(`set application_name='${applicationName}'; begin;
    select pg_advisory_xact_lock(hashtextextended('account-lifecycle:${account.id}',0));
    update private.account_deletion_jobs set requested_at=statement_timestamp()-interval '720 hours'+interval '500 milliseconds',
      deadline=statement_timestamp()+interval '500 milliseconds',retry_at=statement_timestamp() where user_id='${account.id}';
    select pg_sleep(2); commit;`)
  const until = Date.now() + LOCK_WAIT_TIMEOUT_MS
  while (sql(`select count(*) from pg_stat_activity where application_name='${applicationName}' and wait_event='PgSleep'`) !== '1') {
    assert.ok(Date.now() < until, 'database fixture acquired lifecycle lock')
  }
  const cancellation = f.post('cancel-deletion', { requestId }, pageToken)
  await holder
  assert.equal((await cancellation).status, 403, 'deadline rechecked after blocked cancellation resumes')
  const results = await Promise.all([background('select public.run_account_deletion_jobs()'), background('select public.run_account_deletion_jobs()')])
  assert.equal(results.map(value => JSON.parse(value).completed).reduce((sum, value) => sum + value, 0), 1)
  assert.equal(sql(`select count(*) from auth.users where id='${account.id}'`), '0')
  assert.equal(JSON.parse(sql('select public.run_account_deletion_jobs()')).completed, 0, 'repeated execution stays idempotent')
}))

test('direct Data API mutation queued during scheduling rechecks lifecycle after the account lock', { skip: !enabled }, async () => fixture(async f => {
  const [account] = f.accounts
  await f.login(account)
  const context = await f.current()
  const initial = await f.invoke(async () => (await f.server.createClient()).auth.getSession())
  const client = bearer(initial.data.session.access_token)
  const proof = await require('../supabase/auth-gateway.ts').getAuthGateway('local')
    .signInWithPassword({ email: account.email, password: f.password })
  assert.equal(proof.error, null)
  const claims = await bearer(proof.data.session.access_token).auth.getClaims(proof.data.session.access_token)
  assert.equal(claims.error, null)
  const proofId = claims.data.claims.session_id
  assert.match(proofId, /^[0-9a-f-]{36}$/)
  const applicationName = 'account-schedule-race-' + randomUUID()
  const holder = background(`set application_name='${applicationName}'; begin; set local role service_role;
    select public.schedule_student_deletion('${context.sessionId}','${proofId}'); select pg_sleep(2); commit;`)
  const until = Date.now() + LOCK_WAIT_TIMEOUT_MS
  while (sql(`select count(*) from pg_stat_activity where application_name='${applicationName}' and wait_event='PgSleep'`) !== '1') {
    assert.ok(Date.now() < until, 'schedule reached the commit barrier')
  }
  const write = client.from('student_bookmarks').insert({ user_id: account.id, course_id: '40000000-0000-4000-8000-000000000001' })
  const result = await write
  await holder
  assert.equal(result.error?.code, '42501', 'queued direct write loses authorization after schedule commits')
  assert.equal(sql(`select count(*) from public.student_bookmarks where user_id='${account.id}'`), '0')
}))

test('concurrent privileged promotion commits before purge authorization and preserves the operator', { skip: !enabled }, async () => fixture(async f => {
  const [account] = f.accounts
  await f.login(account); await schedule(f)
  sql(`update private.account_deletion_jobs set requested_at=statement_timestamp()-interval '721 hours',
    deadline=statement_timestamp()-interval '1 hour',retry_at=statement_timestamp() where user_id='${account.id}'`)
  const applicationName = 'account-operator-race-' + randomUUID()
  const promotion = background(`set application_name='${applicationName}'; begin;
    update public.profiles set role='operator' where id='${account.id}'; select pg_sleep(2); commit;`)
  const until = Date.now() + LOCK_WAIT_TIMEOUT_MS
  while (sql(`select count(*) from pg_stat_activity where application_name='${applicationName}' and wait_event='PgSleep'`) !== '1') {
    assert.ok(Date.now() < until, 'operator promotion holds the profile lock')
  }
  const purge = background('select public.run_account_deletion_jobs()')
  await promotion
  const result = JSON.parse(await purge)
  assert.equal(result.completed, 0)
  assert.equal(result.failedThisRun, 1)
  assert.equal(sql(`select role from public.profiles where id='${account.id}'`), 'operator')
  assert.equal(sql(`select last_error_code from private.account_deletion_jobs where user_id='${account.id}'`), 'P0001')
  assert.equal(sql(`select count(*) from auth.users where id='${account.id}'`), '1')
}))
