const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const { AUTH_API, AUTH_MESSAGES } = require('./constants.ts')

async function fixture(run) {
  const load = Module._load, extension = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const enabled = process.env.STUDENT_AUTH_ENABLED, originalError = console.error
  const logs = [], reads = []
  const unexpectedRead = async () => { reads.push('identity'); throw new Error('disabled Auth must not read identity') }
  try {
    process.env.STUDENT_AUTH_ENABLED = 'false'
    console.error = (...args) => logs.push(args)
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === '@/lib/auth/student-state') return {
        getStudentSessionContext: unexpectedRead, getStudentSessionUser: unexpectedRead, rejectExistingStudent: unexpectedRead,
      }
      if (name === '@/lib/supabase/server') return { createClient: unexpectedRead }
      return load.call(this, name, ...args)
    }
    await run({ logs, reads })
  } finally {
    Module._load = load
    if (extension) Module._extensions['.tsx'] = extension; else delete Module._extensions['.tsx']
    console.error = originalError
    if (enabled === undefined) delete process.env.STUDENT_AUTH_ENABLED; else process.env.STUDENT_AUTH_ENABLED = enabled
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('switched-off API routes and mutation contexts return their intentional outcome with no logs or references', async () => fixture(async f => {
  for (const flag of ['false', undefined]) {
    if (flag === undefined) delete process.env.STUDENT_AUTH_ENABLED; else process.env.STUDENT_AUTH_ENABLED = flag
    for (const endpoint of Object.values(AUTH_API)) {
      const file = require.resolve('../../app/api/auth/' + endpoint.split('/').at(-1) + '/route.ts')
      delete require.cache[file]
      const session = endpoint === AUTH_API.session
      const handler = require(file)[session ? 'GET' : 'POST']
      const response = await handler(new Request('https://campus.example.test' + endpoint,
        session ? {} : { method: 'POST', body: '{}' }))
      assert.equal(response.status, session ? 200 : 503, endpoint)
      assert.deepEqual(await response.json(), session ? { enabled: false, signedIn: false } : { error: AUTH_MESSAGES.comingSoon }, endpoint)
      assert.equal(response.headers.get('X-CampusIntell-Auth-Reference'), null, endpoint)
    }
    const { getLiveSessionContext, getAuthenticatedMutationContext } = require('./mutation-context.ts')
    const { NextResponse } = require('next/server')
    assert.deepEqual(await getLiveSessionContext(), { status: 'unavailable' })
    assert.deepEqual(await getAuthenticatedMutationContext(NextResponse.json({}), null), { status: 'unavailable' })
  }
  assert.deepEqual(f.logs, [])
  assert.deepEqual(f.reads, [])
}))

// Follow only the server entry/notice components; client forms and unrelated layout children never render.
async function messages(element) {
  if (Array.isArray(element)) return (await Promise.all(element.map(messages))).flat()
  if (!element || typeof element !== 'object' || !element.props) return []
  if (typeof element.type === 'function' && ['SignedOutGate', 'Content', 'AuthUnavailable'].includes(element.type.name)) {
    return messages(await element.type(element.props))
  }
  return [...(typeof element.props.message === 'string' ? [element.props.message] : []),
    ...await messages(element.props.children)]
}

test('every switched-off student page and access gate shows the existing notice without logging or reading identity', async () => fixture(async f => {
  const pages = ['login', 'register', 'forgot-password', 'resend-confirmation', 'account', 'profile-selection', 'account/deletion']
  for (const page of pages) {
    const file = require.resolve('../../app/' + page + '/page.tsx')
    delete require.cache[file]
    const rendered = await require(file).default({ searchParams: Promise.resolve({}) })
    assert.deepEqual(await messages(rendered), ['CampusIntell isn’t available right now. Please try again later.'], page)
  }
  const { StudentAccessGate } = require('../../components/auth/StudentAccessGate.tsx')
  const rendered = await StudentAccessGate({ returnPath: '/courses', children: 'protected content' })
  assert.deepEqual(await messages(rendered), [AUTH_MESSAGES.comingSoon])
  assert.deepEqual(f.logs, [])
  assert.deepEqual(f.reads, [])
}))
