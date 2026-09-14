// lib/auth/routes.test.cjs — Auth requests must retain their root path on nested pages.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { AUTH_API, AUTH_PATHS, PASSWORD_RESET_DESTINATION } = require('./constants.ts')

test('every auth API and navigation destination resolves at the site root', () => {
  for (const base of ['https://campusintell.test/register/', 'https://campusintell.test/register/nested/']) {
    for (const endpoint of Object.values(AUTH_API)) {
      assert.match(endpoint, /^\/api\/auth\/[a-z-]+$/)
      assert.equal(new URL(endpoint, base).pathname, endpoint)
    }
    for (const path of [...Object.values(AUTH_PATHS), PASSWORD_RESET_DESTINATION]) {
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
