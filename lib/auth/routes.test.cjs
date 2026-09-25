// lib/auth/routes.test.cjs — Auth requests must retain their root path on nested pages.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_API, AUTH_PATHS, PASSWORD_RESET_DESTINATION, STUDENT_HOME_PATH } = require('./constants.ts')

test('every auth API and navigation destination resolves at the site root', () => {
  for (const base of ['https://campusintell.test/register/', 'https://campusintell.test/register/nested/']) {
    for (const endpoint of Object.values(AUTH_API)) {
      assert.match(endpoint, /^\/api\/auth\/[a-z-]+$/)
      assert.equal(new URL(endpoint, base).pathname, endpoint)
    }
    for (const path of [...Object.values(AUTH_PATHS), PASSWORD_RESET_DESTINATION, STUDENT_HOME_PATH]) {
      assert.ok(path.startsWith('/') && !path.startsWith('//'))
      assert.equal(new URL(path, base).pathname, path.split('?')[0])
    }
  }
})

test('actual submit hook calls root endpoints from nested pages and rejects relative paths', async () => {
  const originalLoad = Module._load
  const originalFetch = global.fetch
  const file = require.resolve('../../components/auth/useAuthSubmit.ts')
  const calls = []
  let base
  try {
    Module._load = function(name, ...args) {
      if (name === 'react') return { useRef: value => ({ current: value }), useState: value => [value, () => {}] }
      return originalLoad.call(this, name, ...args)
    }
    delete require.cache[file]
    const { useAuthSubmit } = require(file)
    global.fetch = async (endpoint, options) => {
      calls.push({ endpoint, url: new URL(endpoint, base), method: options.method })
      return Response.json({ message: 'ok' })
    }
    for (base of ['https://campusintell.test/register/', 'https://campusintell.test/register/nested/']) {
      for (const endpoint of Object.values(AUTH_API).filter(value => value !== AUTH_API.session)) {
        await useAuthSubmit().submit(endpoint, {})
        assert.equal(calls.at(-1).endpoint, endpoint)
        assert.equal(calls.at(-1).url.pathname, endpoint)
        assert.equal(calls.at(-1).method, 'POST')
      }
    }
    const count = calls.length
    for (const endpoint of ['api/auth/resend-confirmation', '../api/auth/login', '//other.test/api/auth/login']) {
      assert.equal(await useAuthSubmit().submit(endpoint, {}), null)
    }
    assert.equal(calls.length, count)
  } finally {
    global.fetch = originalFetch
    Module._load = originalLoad
    delete require.cache[file]
  }
})

test('actual submit hook blocks malformed 200 responses and only notifies after validated session changes', async () => {
  const originalLoad = Module._load, originalFetch = global.fetch, originalWindow = global.window
  const file = require.resolve('../../components/auth/useAuthSubmit.ts')
  const { AUTH_MESSAGES, EMAIL_CONFIRMATION_REQUIRED } = require('./constants.ts')
  let payload, status = 200, notifications = 0, redirects = 0, lastRedirect
  const errors = []
  try {
    Module._load = function(name, ...args) {
      if (name === 'react') return { useRef: value => ({ current: value }), useState: value => [value, next => { if (typeof next === 'string') errors.push(next) }] }
      if (name === '@/lib/auth/client-events') return { notifyStudentChange: () => { notifications++ } }
      return originalLoad.call(this, name, ...args)
    }
    global.window = { location: { replace: destination => { redirects++; lastRedirect = destination } } }
    global.fetch = async () => Response.json(payload, { status })
    delete require.cache[file]
    const { useAuthSubmit } = require(file)
    const endpoints = Object.values(AUTH_API).filter(path => path !== AUTH_API.session)
    for (const endpoint of endpoints) {
      for (const bad of [{}, [], { error: AUTH_MESSAGES.unavailable }, { verified: false }, { next: 'https://evil.test' }, { message: 'ok' }]) {
        payload = bad
        assert.equal(await useAuthSubmit().submit(endpoint, {}), null)
        assert.equal(errors.at(-1), AUTH_MESSAGES.unavailable)
      }
    }
    assert.equal(notifications, 0); assert.equal(redirects, 0)
    const valid = [
      [AUTH_API.register, { message: AUTH_MESSAGES.email }, 0],
      [AUTH_API.resend, { message: AUTH_MESSAGES.email }, 0],
      [AUTH_API.forgot, { message: AUTH_MESSAGES.recovery }, 0],
      [AUTH_API.login, { code: EMAIL_CONFIRMATION_REQUIRED }, 0],
      [AUTH_API.verifyRecovery, { verified: true }, 0],
      [AUTH_API.cancelRecovery, { success: true }, 0],
      [AUTH_API.login, { next: '/courses' }, 1],
      [AUTH_API.confirm, { next: '/account' }, 2],
      [AUTH_API.reset, { next: PASSWORD_RESET_DESTINATION }, 3],
      [AUTH_API.logout, { success: true }, 4],
    ]
    for (const [endpoint, value, expected] of valid) {
      payload = value
      assert.ok(await useAuthSubmit().submit(endpoint, {}))
      assert.equal(notifications, expected)
    }
    for (const code of ['EXISTING_STUDENT_SESSION', 'RECOVERY_RESTART_REQUIRED']) {
      payload = { code, error: AUTH_MESSAGES.unavailable }
      status = 503
      assert.equal(await useAuthSubmit().submit(AUTH_API.reset, {}), null)
    }
    assert.equal(redirects, 0)
    status = 409; payload = { code: 'EXISTING_STUDENT_SESSION', next: '/dashboard' }
    assert.equal(await useAuthSubmit().submit(AUTH_API.login, {}), null)
    assert.equal(redirects, 1)
    assert.equal(lastRedirect, STUDENT_HOME_PATH)
    assert.equal(notifications, 4)
  } finally {
    Module._load = originalLoad; global.fetch = originalFetch
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow
    delete require.cache[file]
  }
})
