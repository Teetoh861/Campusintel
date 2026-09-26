// Permanent server-domain and HTTP-boundary checks with a user-scoped provider fixture.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const Module = require('node:module')

async function fixture(run) {
  const originalLoad = Module._load
  const oldAuthFlag = process.env.STUDENT_AUTH_ENABLED
  const oldSiteUrl = process.env.NEXT_PUBLIC_SITE_URL
  process.env.STUDENT_AUTH_ENABLED = 'true'
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000'
  const loaded = []
  const id = {
    student: randomUUID(), otherStudent: randomUUID(),
    department: randomUUID(), otherDepartment: randomUUID(), inactiveDepartment: randomUUID(),
    level: randomUUID(), inactiveLevel: randomUUID(),
    period: randomUUID(), inactivePeriod: randomUUID(),
  }
  const state = {
    enabled: true, signedOut: false, revoked: false, revokeBeforeWrite: false, authFailure: false,
    sessionId: 'fixture-session',
    profileFailure: false, referenceFailure: null, writeFailure: false, missingProfile: false,
    profile: { department_id: null, academic_level_id: null, academic_period_id: null },
    otherProfile: { department_id: null, academic_level_id: null, academic_period_id: null },
  }
  const calls = []
  const references = {
    departments: [
      { id: id.otherDepartment, display_name: 'Later', is_active: true, sort_order: 20 },
      { id: id.inactiveDepartment, display_name: 'Former', is_active: false, sort_order: 30 },
      { id: id.department, display_name: 'First', is_active: true, sort_order: 10 },
    ],
    academic_levels: [
      { id: id.inactiveLevel, display_name: 'Former level', is_active: false, sort_order: 20 },
      { id: id.level, display_name: 'Current level', is_active: true, sort_order: 10 },
    ],
    academic_periods: [
      { id: id.inactivePeriod, display_name: 'Former period', is_active: false, sort_order: 20 },
      { id: id.period, display_name: 'Current period', is_active: true, sort_order: 10 },
    ],
  }
  const client = {
    auth: {
      getUser: async () => {
        calls.push(['getUser'])
        if (state.authFailure) return { data: { user: null }, error: { message: 'private provider failure' } }
        if (state.signedOut) return { data: { user: null }, error: { name: 'AuthSessionMissingError' } }
        if (state.revoked) return { data: { user: null }, error: { code: 'session_expired' } }
        return { data: { user: { id: id.student } }, error: null }
      },
      getClaims: async () => { calls.push(['getClaims']); return { data: { claims: { sub: id.student, session_id: state.sessionId } }, error: null } },
    },
    from: table => {
      calls.push(['from', table])
      if (table === 'profiles') return {
        select: columns => ({
          eq: (field, value) => ({ maybeSingle: async () => {
            calls.push(['read', columns, field, value])
            if (state.profileFailure) return { data: null, error: { message: 'private database failure' } }
            return { data: value === id.student && !state.missingProfile ? { ...state.profile } : null, error: null }
          } }),
        }),
        update: values => ({
          eq: (field, value) => ({
            select: columns => ({ maybeSingle: async () => {
              calls.push(['write', values, field, value, columns])
              if (state.writeFailure) return { data: null, error: { message: 'private write failure' } }
              if (value !== id.student || state.missingProfile) return { data: null, error: null }
              state.profile = { ...state.profile, ...values }
              return { data: { ...state.profile }, error: null }
            } }),
          }),
        }),
      }
      return {
        select: columns => ({ order: async (field, options) => {
          calls.push(['references', table, columns, field, options])
          if (state.referenceFailure === table) return { data: null, error: { message: 'private catalogue failure' } }
          if (table === 'academic_periods' && state.revokeBeforeWrite) state.revoked = true
          const rows = references[table].toSorted((a, b) => a.sort_order - b.sort_order)
          return { data: rows.map(({ id, display_name, is_active }) => ({ id, display_name, is_active })), error: null }
        } }),
      }
    },
  }
  const mocks = {
    '@/lib/auth/account-continuity': { matchesAccountContinuityToken: (token, userId, sessionId) => token === `page:${userId}:${sessionId}` },
    '@/lib/supabase/server': { createClient: async response => {
      calls.push(['createClient'])
      if (response) response.cookies.set('sb-fixture', 'rotated', { httpOnly: true })
      return client
    } },
    '@/lib/auth/config': { isStudentAuthEnabled: () => state.enabled, getAuthOrigin: () => 'http://localhost:3000' },
  }
  try {
    Module._load = function (name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    const load = file => {
      const path = require.resolve(file)
      loaded.push(path)
      delete require.cache[path]
      return require(path)
    }
    load('../auth/student-state.ts')
    const domain = load('./student-profile.ts')
    const route = load('../../app/api/profile-selection/route.ts')
    const valid = () => ({ departmentId: id.department, academicLevelId: id.level, academicPeriodId: id.period })
    const put = async (body, pageToken = `page:${id.student}:fixture-session`) => {
      const response = await route.PUT(new Request('http://localhost:3000/api/profile-selection', {
        method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json',
          ...(pageToken === null ? {} : { 'x-campus-account-continuity': pageToken }) },
        body: JSON.stringify(body),
      }))
      return { response, body: await response.json() }
    }
    const get = async () => {
      const response = await route.GET()
      return { response, body: await response.json() }
    }
    await run({ id, state, calls, domain, references, put, get, valid })
  } finally {
    Module._load = originalLoad
    for (const file of loaded) delete require.cache[file]
    if (oldAuthFlag === undefined) delete process.env.STUDENT_AUTH_ENABLED
    else process.env.STUDENT_AUTH_ENABLED = oldAuthFlag
    if (oldSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
    else process.env.NEXT_PUBLIC_SITE_URL = oldSiteUrl
  }
}

test('a stale page token cannot save its draft into another live account', async () => fixture(async f => {
  const stale = await f.put(f.valid(), `page:${f.id.otherStudent}:fixture-session`)
  assert.equal(stale.response.status, 409)
  assert.deepEqual(stale.body, { status: 'session-changed' })
  assert.equal(f.calls.some(call => call[0] === 'from'), false)
  assert.deepEqual(f.state.profile, { department_id: null, academic_level_id: null, academic_period_id: null })
  f.calls.length = 0
  const current = await f.put(f.valid(), `page:${f.id.student}:fixture-session`)
  assert.equal(current.response.status, 200)
  assert.equal(current.body.status, 'complete')
  assert.match(current.response.headers.get('set-cookie'), /sb-fixture=rotated/)
  assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 2)
}))

test('missing, malformed and previous-session continuity stop before profile or reference access', async () => fixture(async f => {
  const rejected = [null, '', 'not-a-token', `page:${f.id.otherStudent}:fixture-session`]
  for (const token of rejected) {
    f.calls.length = 0
    const result = await f.put(f.valid(), token)
    assert.equal(result.response.status, 409)
    assert.deepEqual(result.body, { status: 'session-changed' })
    assert.deepEqual(f.calls.slice(0, 2).map(call => call[0]), ['createClient', 'getUser'])
    assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 1)
    assert.equal(f.calls.some(call => call[0] === 'from'), false)
    if (token === null) assert.equal(f.calls.some(call => call[0] === 'getClaims'), false)
  }
  f.calls.length = 0
  f.state.sessionId = 'new-session'
  const stale = await f.put(f.valid())
  assert.equal(stale.response.status, 409)
  assert.deepEqual(stale.body, { status: 'session-changed' })
  assert.equal(f.calls.some(call => call[0] === 'from'), false)
  assert.deepEqual(f.state.profile, { department_id: null, academic_level_id: null, academic_period_id: null })
}))

test('signed-out continuity rejection remains signed-out after the live session check', async () => fixture(async f => {
  f.state.signedOut = true
  for (const token of [null, 'not-a-token', `page:${f.id.otherStudent}:fixture-session`]) {
    f.calls.length = 0
    const result = await f.put(f.valid(), token)
    assert.equal(result.response.status, 401)
    assert.deepEqual(result.body, { status: 'signed-out' })
    assert.deepEqual(f.calls.slice(0, 2).map(call => call[0]), ['createClient', 'getUser'])
    assert.equal(f.calls.some(call => call[0] === 'getClaims' || call[0] === 'from'), false)
  }
}))

test('live current-user read distinguishes incomplete, complete, and missing profile', async () => fixture(async f => {
  const incomplete = await f.get()
  assert.equal(incomplete.response.status, 200)
  assert.equal(incomplete.body.status, 'incomplete')
  assert.deepEqual(f.calls.filter(call => call[0] === 'read'), [
    ['read', 'department_id,academic_level_id,academic_period_id', 'id', f.id.student],
  ])
  assert.equal(f.calls.filter(call => call[0] === 'createClient').length, 1)
  assert.equal(incomplete.response.headers.get('cache-control'), 'private, no-store')
  assert.match(incomplete.response.headers.get('set-cookie'), /sb-fixture=rotated/)

  Object.assign(f.state.profile, {
    department_id: f.id.department, academic_level_id: f.id.level, academic_period_id: f.id.period,
  })
  const complete = await f.get()
  assert.equal(complete.body.status, 'complete')
  assert.deepEqual(complete.body.selection, {
    department: { id: f.id.department, label: 'First', isActive: true },
    academicLevel: { id: f.id.level, label: 'Current level', isActive: true },
    academicPeriod: { id: f.id.period, label: 'Current period', isActive: true },
  })
  f.state.missingProfile = true
  const missing = await f.get()
  assert.deepEqual(missing.body, { status: 'missing-profile' })
  assert.equal(missing.response.status, 409)
}))

test('reference choices are database-ordered, active-only, and stripped to presentation data', async () => fixture(async f => {
  const { body } = await f.get()
  assert.deepEqual(body.options, {
    departments: [{ id: f.id.department, label: 'First' }, { id: f.id.otherDepartment, label: 'Later' }],
    academicLevels: [{ id: f.id.level, label: 'Current level' }],
    academicPeriods: [{ id: f.id.period, label: 'Current period' }],
  })
  assert.deepEqual(f.calls.filter(call => call[0] === 'references').map(call => [call[1], call[3], call[4]]), [
    ['departments', 'sort_order', { ascending: true }],
    ['academic_levels', 'sort_order', { ascending: true }],
    ['academic_periods', 'sort_order', { ascending: true }],
  ])
  assert.equal(JSON.stringify(body).includes('sort_order'), false)
  assert.equal(JSON.stringify(body).includes('display_name'), false)
}))

test('active save writes all three IDs atomically to the live owner, then returns a complete view', async () => fixture(async f => {
  const saved = await f.put(f.valid())
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.status, 'complete')
  assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 2)
  assert.deepEqual(f.calls.filter(call => call[0] === 'write'), [[
    'write', { department_id: f.id.department, academic_level_id: f.id.level, academic_period_id: f.id.period },
    'id', f.id.student, 'department_id,academic_level_id,academic_period_id',
  ]])
  assert.deepEqual(f.state.otherProfile, { department_id: null, academic_level_id: null, academic_period_id: null })
}))

test('partial, tampered, nonexistent and inactive selections never reach a write', async () => fixture(async f => {
  const invalid = [
    {}, [], null, 'selection',
    { ...f.valid(), academicPeriodId: null },
    { departmentId: f.id.department, academicLevelId: f.id.level },
    { ...f.valid(), userId: f.id.otherStudent },
    { ...f.valid(), user_id: f.id.otherStudent },
    { ...f.valid(), id: f.id.otherStudent },
    { ...f.valid(), profileId: f.id.otherStudent },
    { ...f.valid(), role: 'operator' },
    { ...f.valid(), departmentId: 'not-a-uuid' },
    { ...f.valid(), departmentId: randomUUID() },
    { ...f.valid(), academicLevelId: randomUUID() },
    { ...f.valid(), academicPeriodId: randomUUID() },
    { ...f.valid(), departmentId: f.id.inactiveDepartment },
    { ...f.valid(), academicLevelId: f.id.inactiveLevel },
    { ...f.valid(), academicPeriodId: f.id.inactivePeriod },
  ]
  for (const input of invalid) {
    const result = await f.put(input)
    assert.equal(result.response.status, 400)
    assert.deepEqual(result.body, { status: 'invalid-selection' })
  }
  assert.equal(f.calls.some(call => call[0] === 'write'), false)
  assert.equal(f.calls.some(call => call[0] === 'read' && call[3] === f.id.otherStudent), false)
  assert.deepEqual(f.state.otherProfile, { department_id: null, academic_level_id: null, academic_period_id: null })
}))

test('revoked but unexpired JWT and mid-request revocation stop before protected writes', async () => fixture(async f => {
  f.state.signedOut = true
  assert.deepEqual((await f.get()).body, { status: 'signed-out' })
  f.state.signedOut = false
  f.state.revoked = true
  assert.deepEqual((await f.get()).body, { status: 'signed-out' })
  assert.deepEqual((await f.put(f.valid())).body, { status: 'signed-out' })
  assert.equal(f.calls.some(call => call[0] === 'from'), false)
  assert.equal(f.calls.some(call => call[0] === 'getClaims'), false)

  f.state.revoked = false
  f.state.revokeBeforeWrite = true
  f.calls.length = 0
  const result = await f.put(f.valid())
  assert.equal(result.response.status, 401)
  assert.deepEqual(result.body, { status: 'signed-out' })
  assert.equal(f.calls.filter(call => call[0] === 'getUser').length, 2)
  assert.equal(f.calls.some(call => call[0] === 'write'), false)
}))

test('inactive historical selection remains readable but is not selectable again', async () => fixture(async f => {
  Object.assign(f.state.profile, {
    department_id: f.id.inactiveDepartment, academic_level_id: f.id.level, academic_period_id: f.id.period,
  })
  const historical = await f.get()
  assert.equal(historical.body.status, 'complete')
  assert.deepEqual(historical.body.selection.department, {
    id: f.id.inactiveDepartment, label: 'Former', isActive: false,
  })
  assert.equal(historical.body.options.departments.some(option => option.id === f.id.inactiveDepartment), false)
  const rejected = await f.put({ ...f.valid(), departmentId: f.id.inactiveDepartment })
  assert.deepEqual(rejected.body, { status: 'invalid-selection' })
  assert.equal(f.calls.some(call => call[0] === 'write'), false)
}))

test('provider, database, catalogue and storage invariants have controlled states', async () => fixture(async f => {
  f.state.authFailure = true
  assert.deepEqual((await f.get()).body, { status: 'unavailable' })
  assert.equal(f.calls.some(call => call[0] === 'from'), false)
  f.state.authFailure = false
  f.state.profileFailure = true
  assert.deepEqual((await f.get()).body, { status: 'unavailable' })
  f.state.profileFailure = false
  f.state.referenceFailure = 'academic_levels'
  assert.deepEqual((await f.get()).body, { status: 'unavailable' })
  f.state.referenceFailure = null
  f.references.academic_levels.length = 0
  assert.deepEqual((await f.get()).body, { status: 'unavailable' })
  f.references.academic_levels.push({ id: f.id.level, display_name: 'Current level', is_active: true, sort_order: 10 })
  f.state.writeFailure = true
  const failedWrite = await f.put(f.valid())
  assert.equal(failedWrite.response.status, 503)
  assert.deepEqual(failedWrite.body, { status: 'unavailable' })
  f.state.writeFailure = false
  f.state.profile.department_id = f.id.department
  assert.deepEqual((await f.get()).body, { status: 'invariant-failure' })
  f.state.profile = { department_id: null, academic_level_id: null, academic_period_id: null }
  f.state.missingProfile = true
  assert.deepEqual((await f.put(f.valid())).body, { status: 'missing-profile' })
}))

test('disabled, cross-origin and malformed requests fail closed without provider data access', async () => fixture(async f => {
  f.state.enabled = false
  assert.deepEqual((await f.get()).body, { status: 'unavailable' })
  assert.deepEqual((await f.put(f.valid())).body, { status: 'unavailable' })
  assert.equal(f.calls.some(call => call[0] === 'createClient'), false)
  f.state.enabled = true
  const route = require('../../app/api/profile-selection/route.ts')
  const crossOrigin = await route.PUT(new Request('http://localhost:3000/api/profile-selection', {
    method: 'PUT', headers: { origin: 'https://evil.test', 'content-type': 'application/json' },
    body: JSON.stringify(f.valid()),
  }))
  assert.equal(crossOrigin.status, 403)
  assert.deepEqual(await crossOrigin.json(), { status: 'invalid-request' })
  const malformed = await route.PUT(new Request('http://localhost:3000/api/profile-selection', {
    method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: '{',
  }))
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { status: 'invalid-request' })
  assert.equal(f.calls.some(call => call[0] === 'from'), false)
}))
