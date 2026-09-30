// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { PRODUCT_EVENTS, courseViewEvent } = require('./product-events.ts')

test('product event contract contains only implemented outcomes and one public course field', () => {
  assert.deepEqual(PRODUCT_EVENTS, {
    signupConfirmed: 'signup_confirmed',
    loginSucceeded: 'login_succeeded',
    courseViewed: 'course_viewed',
  })
  assert.deepEqual(courseViewEvent('financial-accounting-1'), {
    name: 'course_viewed', properties: { course_slug: 'financial-accounting-1' },
  })
})

test('server auth events send no identity, cookie, token, IP or student metadata', async () => {
  const originalLoad = Module._load
  const file = require.resolve('./server.ts')
  const calls = []
  try {
    Module._load = function(name, ...args) {
      if (name === '@vercel/analytics/server') return { track: async (...args) => {
        calls.push(args)
        if (calls.length === 3) throw new Error('analytics unavailable')
      } }
      return originalLoad.call(this, name, ...args)
    }
    delete require.cache[file]
    const { recordConfirmedSignup, recordSuccessfulLogin } = require(file)
    await recordConfirmedSignup()
    await recordSuccessfulLogin()
    await assert.doesNotReject(recordSuccessfulLogin())
    assert.deepEqual(calls.map(call => call[0]), [
      'signup_confirmed', 'login_succeeded', 'login_succeeded',
    ])
    for (const call of calls) {
      assert.equal(call[1], undefined)
      assert.deepEqual(call[2], { headers: { 'user-agent': 'CampusIntel product events' } })
    }
  } finally {
    Module._load = originalLoad
    delete require.cache[file]
  }
})

test('installed server transport does not forward ambient auth headers with product events', async () => {
  const originalFetch = global.fetch
  const previousEndpoint = process.env.VERCEL_WEB_ANALYTICS_ENDPOINT
  const contextKey = Symbol.for('@vercel/request-context')
  const previousContext = globalThis[contextKey]
  const file = require.resolve('./server.ts')
  const sent = []
  try {
    process.env.VERCEL_WEB_ANALYTICS_ENDPOINT = 'https://analytics.example.test/event'
    globalThis[contextKey] = { get: () => ({
      url: 'https://campusintell.test/api/auth/login',
      headers: {
        cookie: 'sb-auth-token=secret-cookie',
        'x-forwarded-for': '192.0.2.42',
        'user-agent': 'private-student-agent',
      },
    }) }
    global.fetch = async (url, init) => {
      sent.push({ url, headers: init.headers, body: JSON.parse(init.body) })
      return new Response('ok')
    }
    delete require.cache[file]
    await require(file).recordSuccessfulLogin()
    assert.equal(sent.length, 1)
    assert.equal(sent[0].body.en, 'login_succeeded')
    assert.equal(sent[0].body.ed, undefined)
    assert.doesNotMatch(JSON.stringify(sent), /secret-cookie|192\.0\.2\.42|private-student-agent/)
  } finally {
    global.fetch = originalFetch
    if (previousEndpoint === undefined) delete process.env.VERCEL_WEB_ANALYTICS_ENDPOINT
    else process.env.VERCEL_WEB_ANALYTICS_ENDPOINT = previousEndpoint
    if (previousContext === undefined) delete globalThis[contextKey]
    else globalThis[contextKey] = previousContext
    delete require.cache[file]
  }
})
