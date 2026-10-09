// next.config.test.cjs — Resolve referrer policies through the installed Next.js header pipeline.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readdirSync } = require('node:fs')
const { IncomingMessage, ServerResponse } = require('node:http')
const { Socket } = require('node:net')
const Module = require('node:module')
const { unstable_getResponseFromNextConfig } = require('next/experimental/testing/server')
const { NodeNextResponse } = require('next/dist/server/base-http/node')
const { sendResponse } = require('next/dist/server/send-response')

async function configuredResponse(path) {
  const { default: nextConfig } = await import('./next.config.mjs')
  return unstable_getResponseFromNextConfig({ url: `https://campusintell.test${path}`, nextConfig })
}

async function outboundResponse(path, response) {
  const configured = await configuredResponse(path)
  const socket = new Socket()
  const outgoing = new ServerResponse(new IncomingMessage(socket))
  try {
    configured.headers.forEach((value, key) => outgoing.setHeader(key, value))
    // HEAD exercises Next's real header sender without binding a port or streaming a body.
    await sendResponse({ method: 'HEAD' }, new NodeNextResponse(outgoing), response)
    return { status: outgoing.statusCode, headers: new Headers(outgoing.getHeaders()) }
  } finally { socket.destroy() }
}

test('normal pages retain their referrer policy and other security headers', async () => {
  for (const path of ['/', '/courses', '/account', '/login', '/apiary', '/api-example']) {
    const { headers } = await configuredResponse(path)
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path)
    assert.equal(headers.get('strict-transport-security'), 'max-age=63072000; includeSubDomains; preload')
    assert.equal(headers.get('x-frame-options'), 'DENY')
    assert.equal(headers.get('x-content-type-options'), 'nosniff')
    assert.equal(headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()')
    assert.match(headers.get('content-security-policy'), /frame-ancestors 'none'/)
  }
})

test('API config overrides the page policy for every handler, nested path and API root', async () => {
  const handlerPaths = readdirSync('app/api', { recursive: true })
    .filter(file => file.endsWith('/route.ts'))
    .map(file => `/api/${file.slice(0, -'/route.ts'.length).replace('[slug]', 'financial-accounting-1')}`)
  assert.ok(handlerPaths.includes('/api/profile-selection'))
  assert.ok(handlerPaths.includes('/api/auth/session'))
  for (const path of [...handlerPaths, '/api', '/api/', '/api/not-a-route', '/api/auth/session?check=1']) {
    const { headers } = await configuredResponse(path)
    assert.equal(headers.get('referrer-policy'), 'no-referrer', path)
    assert.equal(headers.get('x-frame-options'), 'DENY', path)
  }
})

test('private profile response ultimately keeps no-referrer, status and private cache headers', async () => {
  const original = Module._load
  const file = require.resolve('./app/api/profile-selection/route.ts')
  try {
    Module._load = function (name, ...args) {
      if (name === '@/lib/profile/student-profile') {
        return { getCurrentStudentProfile: async () => ({ status: 'signed-out' }) }
      }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const response = await require(file).GET()
    const outbound = await outboundResponse('/api/profile-selection', response)
    assert.equal(outbound.status, 401)
    assert.equal(outbound.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(outbound.headers.get('cache-control'), 'private, no-store')
    assert.deepEqual(await response.json(), { status: 'signed-out' })
  } finally {
    Module._load = original
    delete require.cache[file]
  }
})

test('auth responses keep their referrer and cache protections after config headers are applied', async () => {
  const { authJson } = require('./lib/auth/response.ts')
  const response = authJson({ error: 'Unavailable' }, 503)
  const outbound = await outboundResponse('/api/auth/login', response)
  assert.equal(outbound.status, 503)
  assert.equal(outbound.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(outbound.headers.get('cache-control'), 'private, no-store')
  assert.equal(outbound.headers.get('pragma'), 'no-cache')
  assert.equal(outbound.headers.get('expires'), '0')
  assert.deepEqual(await response.json(), { error: 'Unavailable' })
})

test('retired API routes gain the central policy without changing their response contract', async () => {
  for (const path of ['login', 'logout']) {
    const response = require(`./app/api/admin/${path}/route.ts`).POST()
    const outbound = await outboundResponse(`/api/admin/${path}`, response)
    assert.equal(outbound.status, 410)
    assert.equal(outbound.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(outbound.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'This endpoint is retired.' })
  }
})
