const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_MESSAGES } = require('./constants.ts')
const { getBucket } = require('./rate-limit.ts')
const { AuthUnavailableError, authUnavailableMessage, createAuthDiagnostic } = require('./unavailable.ts')
const { withAuthDiagnostics } = require('./route-boundary.ts')
const { authError, authJson } = require('./response.ts')

const REF = /^[A-HJ-NP-Z2-9]{8}$/
const EMAIL = 'student@example.test', ADDRESS = '203.0.113.42', PASSWORD = 'fixture-private-password'
const SECRET = 'sb_secret_private_fixture_never_log', INTERNAL = 'private-fixture-hmac-material-32-characters'

async function fixture(run) {
  const load = Module._load, fetch = global.fetch, originalError = console.error, env = { ...process.env }
  const routeFile = require.resolve('../../app/api/auth/register/route.ts')
  const calls = [], logs = []
  let rpcError = null
  try {
    Object.assign(process.env, { STUDENT_AUTH_ENABLED: 'true', NODE_ENV: 'production', VERCEL: '1',
      VERCEL_DEPLOYMENT_ID: 'dpl_Fixture', NEXT_PUBLIC_SITE_URL: 'https://campus.example.test',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:9', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      SUPABASE_SECRET_KEY: SECRET, AUTH_INTERNAL_SECRET: INTERNAL })
    console.error = (...args) => logs.push(args)
    global.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input.url)
      const headers = new Headers(init.headers), body = JSON.parse(init.body)
      calls.push({ path: url.pathname, headers, body, signal: init.signal })
      if (url.pathname === '/rest/v1/rpc/consume_auth_rate_limit') {
        return rpcError ? Response.json(rpcError, { status: 404 }) : Response.json(true)
      }
      assert.equal(url.pathname, '/auth/v1/signup', 'no unmocked provider request')
      return Response.json({ user: { id: '00000000-0000-4000-8000-000000000001' }, session: null })
    }
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/student-state') return { rejectExistingStudent: async () => null }
      return load.call(this, name, ...args)
    }
    delete require.cache[routeFile]
    const post = require(routeFile).POST
    const signup = (header = ADDRESS, email = EMAIL) => post(new Request('https://campus.example.test/api/auth/register', {
      method: 'POST', headers: { origin: 'https://campus.example.test', 'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.99', ...(header === undefined || header === null ? {} : { 'x-vercel-forwarded-for': header }) },
      body: JSON.stringify({ email, password: PASSWORD }),
    }))
    await run({ signup, calls, logs, rpcFailure: value => { rpcError = value } })
  } finally {
    Module._load = load; global.fetch = fetch; console.error = originalError; delete require.cache[routeFile]
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env)
  }
}

function diagnostic(log, step) {
  assert.equal(log[0], step === 'requester-address' ? 'CampusIntell auth address unknown' : 'CampusIntell auth unavailable')
  assert.deepEqual(Object.keys(log[1]).sort(), ['route', 'step', 'code', 'reference', 'deployment', 'durationMs'].sort())
  assert.equal(log[1].step, step)
  assert.match(log[1].reference, REF)
  assert.ok(Number.isInteger(log[1].durationMs) && log[1].durationMs >= 0)
  for (const secret of [EMAIL, ADDRESS, PASSWORD, SECRET, INTERNAL, '123456', 'fixture-token', 'fixture-cookie']) {
    assert.equal(JSON.stringify(log).includes(secret), false, 'no personal data or credentials in diagnostic')
  }
}

test('a platform list uses its first valid address in both admission and Auth forwarding', async () => fixture(async f => {
  const response = await f.signup(`invalid, ${ADDRESS}, 203.0.113.43`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), null)
  assert.equal(f.calls[0].body.p_origin, getBucket('REGISTER', 'origin', ADDRESS))
  assert.equal(f.calls[1].headers.get('sb-forwarded-for'), ADDRESS)
  assert.equal(f.logs.length, 0)
}))

test('missing and invalid platform headers sign up through one shared bucket, never forward unknown or trust XFF', async () => fixture(async f => {
  for (const [header, email] of [[null, EMAIL], ['invalid', 'second@example.test'], ['bad, also-bad', 'third@example.test']]) {
    const response = await f.signup(header, email)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { message: 'Check your email for a new code.' })
    assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), null)
  }
  const limits = f.calls.filter(c => c.path.includes('consume_auth_rate_limit'))
  assert.equal(new Set(limits.map(c => c.body.p_origin)).size, 1)
  assert.equal(limits[0].body.p_origin, getBucket('REGISTER', 'origin', 'unknown'))
  for (const call of f.calls.filter(c => c.path.includes('/auth/'))) assert.equal(call.headers.get('sb-forwarded-for'), null)
  assert.deepEqual(f.logs.map(log => log[1].code), ['missing', 'invalid', 'list'])
  for (const log of f.logs) diagnostic(log, 'requester-address')
}))

test('a failed real PostgREST limiter returns the same reference as its single safe diagnostic', async () => fixture(async f => {
  f.rpcFailure({ code: 'PGRST202', message: `${EMAIL} ${ADDRESS} ${PASSWORD} ${SECRET} 123456 fixture-token fixture-cookie`, details: INTERNAL })
  const response = await f.signup()
  const body = await response.json()
  assert.equal(response.status, 503)
  assert.equal(body.error, AUTH_MESSAGES.unavailable)
  assert.equal(f.calls.length, 1, 'Auth is not called after admission fails')
  assert.equal(f.logs.length, 1)
  diagnostic(f.logs[0], 'rate-limit')
  assert.equal(f.logs[0][1].code, 'PGRST202')
  assert.equal(f.logs[0][1].deployment, 'dpl_Fixture')
  assert.equal(body.reference, f.logs[0][1].reference)
  assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), body.reference)
}))

test('ordinary outcomes never receive a support header or unavailable log', async () => fixture(async f => {
  for (const [error, status] of [[AUTH_MESSAGES.credentials, 400], [AUTH_MESSAGES.code, 400],
    [AUTH_MESSAGES.limited, 429], [AUTH_MESSAGES.weakPassword, 400], [AUTH_MESSAGES.sessionChanged, 409]]) {
    const response = await withAuthDiagnostics('/api/auth/login', async () => authJson({ error }, status))
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error })
    assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), null)
  }
  const response = await withAuthDiagnostics('/api/auth/register', async () => {
    const result = authJson({ success: true })
    result.headers.set('X-CampusIntell-Auth-Reference', 'ABCD2345')
    return result
  })
  assert.deepEqual(await response.json(), { success: true })
  assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), null)
  assert.equal(f.logs.length, 0)
}))

test('missing configuration and malformed RPC codes remain bounded', async () => fixture(async f => {
  delete process.env.AUTH_INTERNAL_SECRET
  let response = await f.signup()
  assert.equal(response.status, 503)
  diagnostic(f.logs[0], 'configuration')
  assert.equal(f.calls.length, 0)
  process.env.AUTH_INTERNAL_SECRET = INTERNAL
  f.rpcFailure({ code: EMAIL, message: PASSWORD })
  response = await f.signup()
  assert.equal(response.status, 503)
  diagnostic(f.logs[1], 'rate-limit')
  assert.equal(f.logs[1][1].code, null)
}))

test('direct 503s, unexpected exceptions and concurrent routes each have one independent reference', async () => fixture(async f => {
  const responses = await Promise.all([
    withAuthDiagnostics('/api/auth/login', async () => new Response('{}', { status: 503, headers: { 'Cache-Control': 'private, no-store' } })),
    withAuthDiagnostics('/api/auth/register', async () => { throw new Error(`${EMAIL} ${SECRET}`) }),
    withAuthDiagnostics('/api/auth/session', async () => authError(new AuthUnavailableError('identity', EMAIL, 'bad_jwt'), '/api/auth/session')),
  ])
  assert.equal(f.logs.length, 3)
  const references = []
  for (const response of responses) {
    const body = await response.json()
    assert.equal(body.error, AUTH_MESSAGES.unavailable)
    const [log] = f.logs.filter(log => log[1].reference === body.reference)
    assert.ok(log)
    diagnostic(log, log[1].step)
    references.push(body.reference)
  }
  assert.equal(new Set(references).size, 3)
  assert.deepEqual(f.logs.map(log => log[1].step).sort(), ['identity', 'unexpected', 'unexpected'])
}))

test('failed page guards log once with an eight-character support reference and omit submitted paths', async () => fixture(async f => {
  const context = createAuthDiagnostic(`/courses/${EMAIL}?token=fixture-token`)
  const error = new AuthUnavailableError('identity', `${EMAIL} ${SECRET}`, 'bad_jwt')
  const message = authUnavailableMessage('/courses/private', error, context)
  assert.equal(message, AUTH_MESSAGES.unavailable)
  authUnavailableMessage('/courses/private', error, context)
  assert.equal(f.logs.length, 1)
  assert.equal(f.logs[0][1].route, '/courses/[slug]')
  diagnostic(f.logs[0], 'identity')
}))

test('every auth route logs its unavailable outcome once and returns that exact reference', async () => fixture(async f => {
  const { AUTH_API } = require('./constants.ts'), actualRequest = require('./request.ts')
  const load = Module._load
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/request') return { ...actualRequest,
        readAuthRequest: async () => { throw new AuthUnavailableError('configuration') } }
      if (name === '@/lib/auth/student-state') return {
        getStudentSessionUser: async () => { throw new AuthUnavailableError('identity') },
        getStudentSessionContext: async () => { throw new AuthUnavailableError('identity') },
      }
      return load.call(this, name, ...args)
    }
    for (const route of Object.values(AUTH_API)) {
      const file = require.resolve('../../app/api/auth/' + route.split('/').at(-1) + '/route.ts')
      delete require.cache[file]
      const handler = require(file)[route === AUTH_API.session ? 'GET' : 'POST']
      const before = f.logs.length
      const response = await handler(new Request('https://campus.example.test' + route,
        route === AUTH_API.session ? {} : { method: 'POST', body: '{}' }))
      const body = await response.json()
      assert.equal(response.status, 503, route)
      assert.equal(f.logs.length, before + 1, route + ': one unavailable diagnostic')
      const log = f.logs.at(-1)
      diagnostic(log, route === AUTH_API.session ? 'identity' : 'configuration')
      assert.equal(log[1].route, route)
      assert.equal(body.reference, log[1].reference)
      assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), body.reference)
      delete require.cache[file]
    }
  } finally { Module._load = load }
}))

test('failed student page guards show only the message while logging their reference', async () => fixture(async f => {
  const fs = require('node:fs'), ts = require('typescript')
  const load = Module._load, extension = Module._extensions['.tsx']
  const cases = [
    ['../../components/auth/SignedOutGate.tsx', 'SignedOutGate', { route: '/login', children: null }, '/login', 'configuration'],
    ['../../components/auth/StudentAccessGate.tsx', 'StudentAccessGate', { returnPath: '/courses/fixture', children: null }, '/courses/[slug]', 'identity'],
    ['../../app/account/page.tsx', 'default', {}, '/account', 'configuration'],
    ['../../app/profile-selection/page.tsx', 'default', {}, '/profile-selection', 'identity'],
    ['../../app/account/deletion/page.tsx', 'default', {}, '/account/deletion', 'configuration'],
  ]
  const { elementNodes } = require('../test/element-walker.cjs')
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === '@/lib/supabase/server') return { createClient: async () => { throw new AuthUnavailableError('configuration') } }
      if (name === '@/lib/auth/student-state') return {
        getStudentSessionContext: async () => { throw new AuthUnavailableError('identity') },
      }
      return load.call(this, name, ...args)
    }
    for (const [relative, exported, props, route, step] of cases) {
      const file = require.resolve(relative)
      delete require.cache[file]
      const before = f.logs.length
      const rendered = await require(file)[exported](props)
      const log = f.logs.at(-1)
      const message = elementNodes(rendered).find(node => typeof node.props.message === 'string')?.props.message
      assert.equal(message, AUTH_MESSAGES.unavailable, relative)
      assert.equal(f.logs.length, before + 1, relative)
      assert.equal(log[1].route, route)
      diagnostic(log, step)
      delete require.cache[file]
    }
    assert.equal(f.logs.length, cases.length)
  } finally { Module._load = load; Module._extensions['.tsx'] = extension }
}))
