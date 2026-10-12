const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createRequestStoreForRender } = require('next/dist/server/async-storage/request-store')
const { filterInternalHeaders } = require('next/dist/server/lib/server-ipc/utils')
const { unstable_doesMiddlewareMatch } = require('next/experimental/testing/server')
const { fixture } = require('./session-generation-fixture.cjs')

const selector = 'ci-student-session-generation', g = 'a'.repeat(32), h = 'b'.repeat(32)
const invalidPair = selector + '=invalid'

test('one render request keeps every sequential, concurrent and mixed server client invalid', async () => fixture(async f => {
  f.jar.set('sb-fixture-auth-token', 'A'); f.jar.set('ci-student-auth-' + g, 'B')
  for (const pair of [`${selector}=%`, `${selector}=${g}; ${selector}=${g}`, `${selector}=${h}; ${selector}=${g}`]) {
    for (const housekeeping of [true, false]) {
      const raw = pair + `; sb-fixture-auth-token=A; ci-student-auth-${g}=B`
      f.rawCookieHeader(raw)
      const response = await f.proxy.refreshStudentSession(f.pageRequest())
      assert.equal(f.clients.at(-1).name, 'ci-student-auth-invalid')
      assert.deepEqual(f.clients.at(-1).options.cookies.getAll(), [])
      if (housekeeping) f.clients.at(-1).options.cookies.setAll([
        { name: 'ci-student-auth-invalid', value: '', options: { maxAge: 0 } },
      ], {})
      const store = f.renderResponse(response)
      const sequential = [await f.student.getStudentSessionContext(), await f.student.getStudentSessionContext()]
      assert.deepEqual(sequential, [null, null])
      assert.deepEqual(await Promise.all(Array.from({ length: 8 }, (_, i) =>
        f.student.getStudentSessionContext(i % 2 ? f.response() : undefined))), Array(8).fill(null))
      const direct = [await f.server.createClient(), await f.server.createClient(),
        await f.server.createClient(f.response()), await f.server.createClient(f.response())]
      direct.push(...await Promise.all(Array.from({ length: 8 }, (_, i) =>
        f.server.createClient(i % 2 ? f.response() : undefined))))
      for (const client of direct) {
        assert.equal(client.name, 'ci-student-auth-invalid')
        assert.deepEqual(client.options.cookies.getAll(), [])
        assert.equal((await client.auth.getUser()).data.user, null)
      }
      assert.equal((await require('../profile/student-profile.ts').getCurrentStudentProfile()).status, 'signed-out')
      assert.equal(store.cookies.get(selector).value, 'invalid')
      assert.equal(f.generation.resolveStudentSessionNamespaceFromCookieHeader(store.headers.get('cookie')).mode, 'invalid')
      assert.equal(response.cookies.get(selector), undefined, 'internal invalid representation never becomes Set-Cookie')
      const freshResponse = f.response(), fresh = await f.server.createFreshStudentSessionClient(freshResponse)
      await fresh.auth.setSession({ access_token: 'access-B', refresh_token: 'refresh-B' })
      assert.match(freshResponse.cookies.get(selector).value, /^[a-f0-9]{32}$/)
      assert.equal((await fresh.auth.getUser()).data.user.id, f.users.B.id)
      assert.equal(await f.student.getStudentSessionContext(), null, 'fresh transfer does not change this request authority')
    }
  }
}))

test('invalid downstream canonicalization keeps unrelated raw pairs and removes all ambiguous selector pairs', async () => fixture(async f => {
  const canonicalize = f.generation.canonicalizeStudentSessionCookieHeaderForDownstream
  const unrelated = ['x' + selector + '=' + g, selector + '-x=' + h, 'ci-recovery-grant=opaque',
    'sb-fixture-auth-token=original%2Fvalue', 'preference=%ZZ', 'flag']
  const resolve = f.generation.resolveStudentSessionNamespaceFromCookieHeader
  for (const pair of [`${selector}=%`, `${selector}=%ZZ`, `${selector}=`, `${selector}=invalid`,
    `${selector}=${g.toUpperCase()}`, `${selector}="${g}"`, `${selector} =${g}`,
    `${selector}=${g}; ${selector}=${g}`, `${selector}=${g}; ${selector}=${h}`]) {
    const raw = [...unrelated, pair].join('; '), downstream = canonicalize(raw, resolve(raw))
    assert.equal(resolve(downstream).mode, 'invalid')
    assert.deepEqual(downstream.split(';').map(pair => pair.trim()), [invalidPair, ...unrelated])
    assert.equal(canonicalize(downstream, resolve(downstream)), downstream, 'canonicalization is stable')
  }
  for (const raw of [null, '', unrelated.join('; '), `${selector}=${g}; sb-fixture-auth-token=A`]) {
    assert.equal(canonicalize(raw, resolve(raw)), raw, 'legacy/generated headers are untouched')
  }
}))

test('all protected/auth render paths match proxy; the public homepage retains raw invalid authority without middleware merging', async () => fixture(async f => {
  const config = require('../../proxy.ts').config
  for (const url of ['/account', '/dashboard', '/my-courses', '/profile-selection', '/courses',
    '/courses/test', '/courses/test/quiz', '/courses/test/materials', '/materials', '/bookmarks', '/admin',
    '/login', '/register', '/confirm-email', '/forgot-password', '/reset-password', '/resend-confirmation']) {
    assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }), true, url)
  }
  assert.equal(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: '/' }), false)
  for (const pair of [`${selector}=%`, `${selector}=${g}; ${selector}=${g}`, `${selector}=${h}; ${selector}=${g}`]) {
    const raw = `${pair}; sb-fixture-auth-token=A; ci-student-auth-${g}=B`
    const headers = { cookie: raw, 'x-middleware-set-cookie': 'untrusted=value' }
    filterInternalHeaders(headers)
    assert.equal(headers['x-middleware-set-cookie'], undefined, 'Next ingress removes client-supplied middleware headers')
    f.state.renderStore = createRequestStoreForRender({ headers }, undefined,
      { pathname: '/', search: '' }, {}, undefined, undefined, undefined, false)
    for (let i = 0; i < 4; i++) {
      assert.equal(await f.student.getStudentSessionContext(), null)
      f.clients.at(-1).options.cookies.setAll([{ name: 'ci-student-auth-invalid', value: '', options: { maxAge: 0 } }], {})
    }
    assert.equal(f.state.renderStore.headers.get('cookie'), raw, 'unproxied read-only render does not normalize shared Cookie authority')
  }
}))
