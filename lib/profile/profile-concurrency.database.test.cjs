const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, createHmac } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { AsyncLocalStorage } = require('node:async_hooks')
const Module = require('node:module')
const { createClient } = require('@supabase/supabase-js')

// Explicit opt-in; all Auth fixtures and queries stay on local Supabase.
const enabled = process.env.PROFILE_CONCURRENCY_DB_TEST === '1'
function db(sql) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_Campusintel', 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, 'Local SQL fixture operation failed')
  return result.stdout.trim()
}
function token(config, user, session) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', role: 'authenticated',
    sub: user, session_id: session, iss: `${config.API_URL}/auth/v1`,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${body}.${createHmac('sha256', config.JWT_SECRET).update(body).digest('base64url')}`
}
async function fixture(run) {
  const status = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(status.status, 0, 'Local Supabase must already be running')
  const config = JSON.parse(status.stdout)
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1', 'never contact hosted Supabase')
  const user = randomUUID(), other = randomUUID(), sessionA = randomUUID(), sessionB = randomUUID(), otherSession = randomUUID()
  const load = Module._load, cache = new Map(Object.entries(require.cache)), context = new AsyncLocalStorage()
  try {
    db(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',id::text || '@example.test',
        'x',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
      from (values ('${user}'::uuid),('${other}'::uuid)) u(id);
      update auth.users set confirmation_token='',recovery_token='',email_change_token_new='',
        email_change_token_current='',email_change='',reauthentication_token='' where id in ('${user}','${other}');
      insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values
        ('${sessionA}','${user}',now(),now(),now()+interval '1 hour'),
        ('${sessionB}','${user}',now(),now(),now()+interval '1 hour'),
        ('${otherSession}','${other}',now(),now(),now()+interval '1 hour');`)
    const configMock = { isStudentAuthEnabled: () => true, getAuthSecretKey: () => config.SERVICE_ROLE_KEY,
      isTrustedAuthOrigin: origin => origin === 'http://localhost:3000' }
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/config' || (name === './config' && args[0]?.filename.includes('/lib/auth/'))) return configMock
      if (name === '@/lib/supabase/server') return { createClient: async () => context.getStore().client }
      return load.call(this, name, ...args)
    }
    for (const file of ['./student-profile.ts', './selection.ts', '../auth/student-state.ts',
      '../auth/account-continuity.ts', '../auth/request.ts', '../../app/api/profile-selection/route.ts']) delete require.cache[require.resolve(file)]
    const route = require('../../app/api/profile-selection/route.ts')
    const { issueAccountContinuityToken } = require('../auth/account-continuity.ts')
    const makeTab = (account, session) => {
      const jwt = token(config, account, session)
      const client = createClient(config.API_URL, config.ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false },
      })
      const getUser = client.auth.getUser.bind(client.auth), getClaims = client.auth.getClaims.bind(client.auth)
      client.auth.getUser = () => getUser(jwt); client.auth.getClaims = () => getClaims(jwt)
      const page = issueAccountContinuityToken(account, session)
      const invoke = async action => {
        const response = await context.run({ client }, action)
        return { response, body: await response.json() }
      }
      return { client, session, get: () => invoke(route.GET), put: (body, pageToken = page) => invoke(() => route.PUT(new Request(
        'http://localhost:3000/api/profile-selection', { method: 'PUT',
          headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-campus-account-continuity': pageToken },
          body: JSON.stringify(body) }))) }
    }
    const a = makeTab(user, sessionA), b = makeTab(user, sessionB), stranger = makeTab(other, otherSession)
    const initial = await a.get()
    assert.equal(initial.body.status, 'incomplete'); assert.equal(initial.body.revision, 0)
    const options = initial.body.options
    assert.ok(options.academicPeriods.length >= 2)
    const base = { first_name: 'Ada', departmentId: options.departments[0].id,
      academicLevelId: options.academicLevels[0].id, academicPeriodId: options.academicPeriods[0].id }
    // Owner-controlled fixture insertion models an existing complete revision-zero row.
    db(`begin; delete from public.profiles where id='${user}';
      insert into public.profiles(id,first_name,department_id,academic_level_id,academic_period_id)
      values ('${user}','Ada','${base.departmentId}','${base.academicLevelId}','${base.academicPeriodId}'); commit;`)
    const durable = () => JSON.parse(db(`select jsonb_build_object('first_name',first_name,'departmentId',department_id,
      'academicLevelId',academic_level_id,'academicPeriodId',academic_period_id,'revision',revision)::text
      from public.profiles where id='${user}';`))
    await run({ a, b, stranger, user, base, options, durable })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    db(`delete from auth.users where id in ('${user}','${other}');`)
  }
}

test('real route/RLS rejects stale whole form and allows deliberate reload/resubmit; lost-response replay cannot overwrite',
  { skip: !enabled }, async () => fixture(async f => {
    const [pageA, pageB] = await Promise.all([f.a.get(), f.b.get()])
    assert.equal(pageA.body.revision, 0); assert.equal(pageB.body.revision, 0)
    const semester2 = f.options.academicPeriods[1].id
    const newer = { ...f.base, academicPeriodId: semester2, expectedRevision: 0 }
    const saved = await f.a.put(newer)
    assert.equal(saved.response.status, 200); assert.equal(saved.body.revision, 1)
    const winner = { ...f.base, academicPeriodId: semester2, revision: 1 }
    assert.deepEqual(f.durable(), winner)
    const stale = await f.b.put({ ...f.base, first_name: 'Amara', expectedRevision: 0 })
    assert.equal(stale.response.status, 409); assert.deepEqual(stale.body, { status: 'conflict' })
    assert.deepEqual(f.durable(), winner)
    const reload = await f.b.get()
    assert.equal(reload.body.revision, 1); assert.equal(reload.body.firstName, 'Ada')
    assert.equal(reload.body.selection.academicPeriod.id, semester2)
    const deliberate = { ...f.base, first_name: 'Amara', academicPeriodId: semester2, expectedRevision: 1 }
    const saved2 = await f.b.put(deliberate)
    assert.equal(saved2.response.status, 200); assert.equal(saved2.body.revision, 2)
    const final = { ...f.base, first_name: 'Amara', academicPeriodId: semester2, revision: 2 }
    assert.deepEqual(f.durable(), final)
    // Discard the accepted response; exact manual replay carries the old revision.
    const lost = await f.b.put(deliberate)
    assert.equal(lost.response.status, 409); assert.deepEqual(f.durable(), final)
  }))

test('two independently authenticated tabs pass preflight R then race conditional UPDATE: one whole-form winner',
  { skip: !enabled }, async () => fixture(async f => {
    let arrived = 0, release
    const gate = new Promise(resolve => { release = resolve })
    const writes = []
    // Test-only transport orchestration holds both real updates until both requests
    // have completed their actual RLS preflight, references, and second Auth check.
    for (const tab of [f.a, f.b]) {
      const from = tab.client.from.bind(tab.client)
      tab.client.from = table => {
        const relation = from(table)
        if (table === 'profiles') {
          const update = relation.update.bind(relation)
          relation.update = values => {
            const query = update(values), single = query.maybeSingle.bind(query)
            query.maybeSingle = async () => {
              writes.push(values)
              if (++arrived === 2) release()
              await gate
              return single()
            }
            return query
          }
        }
        return relation
      }
    }
    const formA = { ...f.base, first_name: 'Winner A', academicPeriodId: f.options.academicPeriods[1].id, expectedRevision: 0 }
    const formB = { ...f.base, first_name: 'Winner B', expectedRevision: 0 }
    const results = await Promise.all([f.a.put(formA), f.b.put(formB)])
    assert.equal(arrived, 2); assert.equal(writes.length, 2)
    assert.deepEqual(results.map(result => result.response.status).sort(), [200, 409])
    const winner = results[0].response.status === 200 ? formA : formB
    const { expectedRevision, ...fields } = winner
    assert.deepEqual(f.durable(), { ...fields, revision: 1 })
    assert.equal(results.find(result => result.response.status === 200).body.revision, 1)
    assert.deepEqual(results.find(result => result.response.status === 409).body, { status: 'conflict' })
  }))

test('revision grants no authority; foreign identity and stale page are rejected and direct cross-owner CAS matches zero rows',
  { skip: !enabled }, async () => fixture(async f => {
    const before = f.durable()
    const tampered = await f.stranger.put({ ...f.base, expectedRevision: 0, userId: f.user })
    assert.equal(tampered.response.status, 400)
    const own = await f.stranger.put({ ...f.base, first_name: 'Own profile', expectedRevision: 0 })
    assert.equal(own.response.status, 200)
    const cross = await f.stranger.client.from('profiles').update({ first_name: 'Attack' })
      .eq('id', f.user).eq('revision', 0).select('revision')
    assert.equal(cross.error, null); assert.deepEqual(cross.data, [])
    assert.deepEqual(f.durable(), before)
    const wrongPage = await f.b.put({ ...f.base, expectedRevision: 0 }, 'invalid-page')
    assert.equal(wrongPage.response.status, 409); assert.deepEqual(wrongPage.body, { status: 'session-changed' })
    assert.deepEqual(f.durable(), before)
  }))

test('durable expiry/revocation immediately before CAS loses RLS visibility, returns signed-out, never retries UPDATE',
  { skip: !enabled }, async () => {
    for (const mode of ['expire', 'delete']) await fixture(async f => {
      const before = f.durable(), from = f.a.client.from.bind(f.a.client)
      let updates = 0
      f.a.client.from = table => {
        const relation = from(table)
        if (table === 'profiles') {
          const update = relation.update.bind(relation)
          relation.update = values => {
            updates++
            if (mode === 'expire') db(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.a.session}';`)
            else db(`delete from auth.sessions where id='${f.a.session}';`)
            return update(values)
          }
        }
        return relation
      }
      const result = await f.a.put({ ...f.base, first_name: 'Must not save', expectedRevision: 0 })
      assert.equal(result.response.status, 401); assert.deepEqual(result.body, { status: 'signed-out' })
      assert.equal(updates, 1); assert.deepEqual(f.durable(), before)
    })
  })
