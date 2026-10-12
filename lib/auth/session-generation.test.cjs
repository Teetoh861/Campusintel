const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, applyResponseCookies, assertInvalidDownstream } = require('./session-generation-fixture.cjs')
const G = 'a'.repeat(32), H = 'b'.repeat(32)
const selector = 'ci-student-session-generation'
const storage = generation => `ci-student-auth-${generation}`

test('undecodable raw selector omitted by Next cannot authenticate or refresh a valid legacy session', async () => fixture(async f => {
  f.jar.set('sb-fixture-auth-token', 'A'); f.jar.set(selector, '%')
  const request = f.pageRequest()
  assert.ok(request.headers.get('cookie').includes(selector + '=%'))
  assert.equal(request.cookies.get(selector), undefined, 'real Next parsing drops the undecodable value')
  assert.equal(await f.student.getStudentSessionContext(f.response()), null)
  assert.equal(f.clients.at(-1).name, 'ci-student-auth-invalid')
  assert.deepEqual(f.clients.at(-1).options.cookies.getAll(), [])
  const proxy = await f.proxy.refreshStudentSession(request)
  assert.equal(proxy.cookies.getAll().length, 0, 'legacy A cannot refresh')
  assertInvalidDownstream(f, proxy, request.headers.get('cookie'))
  assert.equal(f.generation.resolveStudentSessionNamespaceFromCookieHeader(request.headers.get('cookie')).mode, 'invalid')
}))

test('raw selector resolution distinguishes absence, exact canonical values, malformed values and duplicates', async () => fixture(async f => {
  const resolve = f.generation.resolveStudentSessionNamespaceFromCookieHeader
  for (const header of [null, '', 'other=value', `x${selector}=${G}`, `${selector}-x=${G}`, `${selector.toUpperCase()}=${G}`]) {
    assert.deepEqual(resolve(header), { mode: 'legacy' })
  }
  assert.deepEqual(resolve(`other=value;  ${selector}=${G} ; unrelated=x`), { mode: 'generation', storageName: storage(G) })
  for (const value of ['%', '%ZZ', '', G.toUpperCase(), G.slice(1), G + 'a', `"${G}"`, G + 'junk',
    '%61' + G.slice(1), G.slice(0, 16) + ' ' + G.slice(16), G + '=', ' ' + G, G + '\u00a0', G + '\n']) {
    assert.deepEqual(resolve(`${selector}=${value}; other=x`), { mode: 'invalid', storageName: 'ci-student-auth-invalid' }, value)
  }
  for (const header of [`${selector}=${G}; ${selector}=${G}`, `${selector}=${G}; ${selector}=${H}`,
    `${selector}=%; ${selector}=${G}`, selector, `${selector} =${G}`]) {
    assert.equal(resolve(header).mode, 'invalid', header)
  }
}))

test('server and proxy reject noncanonical and duplicate raw selectors regardless of the parsed cookie view', async () => fixture(async f => {
  f.jar.set('sb-fixture-auth-token', 'A'); f.jar.set(storage(G), 'B')
  const legacy = 'sb-fixture-auth-token=A'
  for (const value of ['%', '%ZZ', '', G.toUpperCase(), G.slice(1), G + 'a', `"${G}"`, G + 'junk', '%61' + G.slice(1)]) {
    f.rawCookieHeader(`${selector}=${value}; ${legacy}; ${storage(G)}=B`)
    assert.equal(await f.student.getStudentSessionContext(f.response()), null, value)
    assert.equal(f.clients.at(-1).name, 'ci-student-auth-invalid')
    const request = f.pageRequest(), response = await f.proxy.refreshStudentSession(request)
    assert.equal(response.cookies.getAll().length, 0)
    assertInvalidDownstream(f, response, request.headers.get('cookie'))
    assert.equal(f.clients.at(-1).name, 'ci-student-auth-invalid')
  }
  for (const header of [`${selector}=${G}; ${selector}=${G}`, `${selector}=${H}; ${selector}=${G}`]) {
    f.rawCookieHeader(`${header}; ${legacy}; ${storage(G)}=B`)
    assert.equal(await f.student.getStudentSessionContext(), null)
    assert.equal((await f.proxy.refreshStudentSession(f.pageRequest())).cookies.getAll().length, 0)
  }
}))

test('true raw absence and similarly named cookies preserve legacy compatibility', async () => fixture(async f => {
  for (const other of ['', `x${selector}=${G}; `, `${selector}-x=${G}; `, `${selector.toUpperCase()}=${G}; `]) {
    f.rawCookieHeader(other + 'sb-fixture-auth-token=A')
    assert.equal((await f.student.getStudentSessionContext()).user.id, f.users.A.id)
    assert.equal(f.clients.at(-1).options.cookieOptions, undefined)
    assert.equal((await f.proxy.refreshStudentSession(f.pageRequest())).cookies.get('sb-fixture-auth-token').value, 'rotated-A')
  }
}))

test('fresh session transfer binds its minted namespace without rereading a malformed incoming selector', async () => fixture(async f => {
  f.jar.set('sb-fixture-auth-token', 'A'); f.jar.set(selector, '%')
  const response = f.response(); f.order.length = 0
  const client = await f.server.createFreshStudentSessionClient(response)
  assert.equal(f.order.includes('raw headers'), false, 'fresh transfer never reads incoming selector authority')
  const fresh = response.cookies.get(selector).value
  assert.match(fresh, /^[a-f0-9]{32}$/); assert.equal(client.name, storage(fresh))
  await client.auth.setSession({ access_token: 'access-B', refresh_token: 'refresh-B' })
  assert.equal(response.cookies.get(storage(fresh)).value, 'B')
  f.apply(response)
  assert.equal((await f.student.getStudentSessionContext()).user.id, f.users.B.id)
}))

test('invalid-mode SDK housekeeping cannot normalize away raw selector evidence before downstream server lookup', async () => fixture(async f => {
  f.rawCookieHeader(`${selector}=%; sb-fixture-auth-token=A`)
  const request = f.pageRequest(), response = await f.proxy.refreshStudentSession(request)
  const raw = request.headers.get('cookie')
  f.clients.at(-1).options.cookies.setAll([{ name: 'ci-student-auth-invalid', value: '', options: { maxAge: 0 } }], {})
  const forwarded = response.headers.get('x-middleware-request-cookie')
  assert.equal(forwarded, assertInvalidDownstream(f, response, raw))
  assert.equal(f.generation.resolveStudentSessionNamespaceFromCookieHeader(forwarded).mode, 'invalid')
  assert.equal(response.cookies.get(selector), undefined)
}))

test('both server clients snapshot raw authority before the actual Next render-store cookie merge', async () => fixture(async f => {
  f.jar.set('sb-fixture-auth-token', 'A'); f.jar.set(storage(G), 'B'); f.jar.set(storage(H), 'A')
  const resolve = f.generation.resolveStudentSessionNamespaceFromCookieHeader
  f.generation.resolveStudentSessionNamespaceFromCookieHeader = raw => { f.order.push('namespace resolution'); return resolve(raw) }
  for (const pair of [`${selector}=%`, `${selector}=${G}; ${selector}=${G}`, `${selector}=${H}; ${selector}=${G}`]) {
    for (const bound of [false, true]) {
      const raw = `${pair}; sb-fixture-auth-token=A; ${storage(G)}=B; ${storage(H)}=A`
      f.rawCookieHeader(raw)
      const response = await f.proxy.refreshStudentSession(f.pageRequest())
      assert.equal(response.headers.get('set-cookie'), null, 'invalid proxy cannot refresh any session')
      f.clients.at(-1).options.cookies.setAll([{ name: 'ci-student-auth-invalid', value: '', options: { maxAge: 0 } }], {})
      assertInvalidDownstream(f, response, raw)
      const store = f.renderResponse(response)
      assert.equal(resolve(store.headers.get('cookie')).mode, 'invalid')
      f.order.length = 0
      const live = await f.student.getStudentSessionContext(bound ? f.response() : undefined), client = f.clients.at(-1)
      assert.deepEqual(f.order, ['raw headers', 'namespace resolution', 'cookies materialization', 'SDK client'])
      assert.equal(resolve(store.headers.get('cookie')).mode, 'invalid', 'Next normalization preserves invalid authority')
      assert.equal(client.name, 'ci-student-auth-invalid'); assert.deepEqual(client.options.cookies.getAll(), [])
      assert.equal(live, null); assert.equal((await client.auth.getUser()).data.user, null)
    }
  }
}))

test('cookie jar applies raw deletion attributes, preserves empty cookies, and allows late replacements in arrival order', () => {
  const jar = new Map([['zero', 'old'], ['expired', 'old'], ['negative', 'old']])
  const now = Date.UTC(2026, 0, 1)
  const response = (...cookies) => {
    const headers = new Headers()
    for (const cookie of cookies) headers.append('set-cookie', cookie)
    return new Response(null, { headers })
  }
  applyResponseCookies(jar, response(
    'empty=; Path=/',
    'zero=; Path=/; Max-Age=0',
    'expired=still-nonempty; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'negative=still-nonempty; Path=/; Max-Age=-1',
    'max-age-wins=current; Path=/; Max-Age=100; Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'future=current; Path=/; Expires=Tue, 01 Jan 2030 00:00:00 GMT',
    'encoded=has%3Dequals; Path=/',
  ), now)
  assert.equal(jar.has('empty'), true); assert.equal(jar.get('empty'), '')
  for (const name of ['zero', 'expired', 'negative']) assert.equal(jar.has(name), false)
  assert.equal(jar.get('max-age-wins'), 'current'); assert.equal(jar.get('future'), 'current')
  assert.equal(jar.get('encoded'), 'has=equals')
  applyResponseCookies(jar, response('zero=late-old-value; Path=/', 'future=replaced; Path=/'), now)
  assert.equal(jar.get('zero'), 'late-old-value'); assert.equal(jar.get('future'), 'replaced')
  assert.equal([...jar.values()].includes(undefined), false)
})

test('absence alone selects legacy; strict 128-bit namespace selection fails closed for every malformed selector', async () => fixture(async f => {
  f.jar.set('sb-fixture-auth-token', 'A')
  assert.equal((await f.student.getStudentSessionContext()).user.id, f.users.A.id)
  assert.equal(f.clients.at(-1).options.cookieOptions, undefined)
  const legacy = await f.proxy.refreshStudentSession(f.pageRequest())
  assert.equal(legacy.cookies.get('sb-fixture-auth-token').value, 'rotated-A')
  assert.equal(legacy.cookies.get(selector), undefined)
  for (const value of ['', '../legacy', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'x'.repeat(500)]) {
    f.jar.set(selector, value); f.jar.set('ci-student-auth-invalid', 'A')
    assert.equal(await f.student.getStudentSessionContext(f.response()), null)
    assert.equal(f.clients.at(-1).name, 'ci-student-auth-invalid')
    assert.deepEqual(f.clients.at(-1).options.cookies.getAll(), [])
    assert.equal((await f.proxy.refreshStudentSession(f.pageRequest())).cookies.getAll().length, 0)
  }
}))

test('Server Component and response-bound clients select the same request namespace; valid empty generations never fall back', async () => fixture(async f => {
  f.jar.set(selector, G); f.jar.set(storage(G), 'A'); f.jar.set('sb-fixture-auth-token', 'B')
  const boundResponse = f.response(), bound = await f.server.createClient(boundResponse), component = await f.server.createClient()
  assert.equal(bound.name, storage(G)); assert.equal(component.name, storage(G))
  await bound.auth.getClaims()
  assert.equal(boundResponse.cookies.get(storage(G)).httpOnly, true)
  assert.equal(boundResponse.cookies.get(storage(G)).secure, true)
  assert.equal(boundResponse.headers.get('X-Refresh-Test'), 'preserved')
  assert.equal(boundResponse.cookies.get(selector), undefined)
  await component.auth.getClaims()
  assert.equal(f.jar.get(storage(G)), 'rotated-A')
  f.jar.set(storage(G), 'A'); f.state.readOnlyCookies = true
  const readOnly = await f.server.createClient()
  await readOnly.auth.getClaims()
  assert.equal(f.jar.get(storage(G)), 'A', 'read-only render does not persist cookies')
  assert.equal(readOnly.options.cookies.getAll().find(cookie => cookie.name === storage(G)).value, 'rotated-A',
    'request-local SDK jar stays coherent despite read-only store')
  f.state.readOnlyCookies = false
  f.jar.set(selector, H)
  assert.equal(await f.student.getStudentSessionContext(), null)
}))

test('held native A refresh cannot resurrect after logout or replace B after fresh login; stale A continuity is rejected', async () => fixture(async f => {
  f.jar.set(selector, G); f.jar.set(storage(G), 'A')
  const tokenA = f.continuity.issueAccountContinuityToken(f.users.A.id, 'session-A')
  const held = await f.proxy.refreshStudentSession(f.pageRequest())
  assert.deepEqual(held.cookies.getAll().map(cookie => cookie.name), [storage(G)])
  const logout = await f.post('logout', {}, tokenA)
  assert.equal(logout.status, 200); f.apply(logout)
  assert.ok(logout.headers.getSetCookie().some(header => header.startsWith(storage(G) + '=') && /; Max-Age=0(?:;|$)/.test(header)))
  assert.equal(f.jar.has(storage(G)), false, 'actual logout deletion removes the Auth key instead of storing undefined')
  const blank = f.jar.get(selector)
  assert.match(blank, /^[a-f0-9]{32}$/); assert.notEqual(blank, G)
  f.apply(held)
  assert.equal(f.jar.get(storage(G)), 'rotated-A', 'a delayed old cookie can physically reappear')
  assert.equal(f.jar.get(selector), blank)
  assert.equal(await f.student.getStudentSessionContext(), null)
  const login = await f.post('login', { email: 'b@example.test', password: 'unit-password' })
  assert.equal(login.status, 200); f.apply(login)
  const current = f.jar.get(selector)
  assert.notEqual(current, blank); assert.equal(f.jar.get(storage(current)), 'B')
  f.apply(held)
  assert.equal(f.jar.get(selector), current)
  assert.equal((await f.student.getStudentSessionContext()).user.id, f.users.B.id)
  assert.equal((await f.mutation.getAuthenticatedMutationContext(f.response(), tokenA)).status, 'session-changed')
  const before = f.calls.filter(call => call === 'signOut').length
  const staleLogout = await f.post('logout', {}, tokenA)
  assert.equal(staleLogout.status, 409); assert.equal(staleLogout.cookies.get(selector), undefined)
  assert.equal(f.calls.filter(call => call === 'signOut').length, before)
  f.apply(staleLogout); assert.equal(f.jar.get(selector), current)
}))

test('login and confirmation transfer to fresh namespaces; failed transfers discard selector and session writes together', async () => {
  for (const route of ['login', 'confirm-email']) await fixture(async f => {
    f.jar.set(selector, G)
    const body = route === 'login' ? { email: 'a@example.test', password: 'unit-password' } : { email: 'a@example.test', code: '123456' }
    f.state.transferError = true
    const failed = await f.post(route, body)
    assert.equal(failed.status, 503); assert.equal(failed.headers.get('set-cookie'), null)
    assert.equal(f.jar.get(selector), G)
    f.state.transferError = false
    const saved = await f.post(route, body), issued = saved.cookies.get(selector)
    assert.equal(saved.status, 200); assert.match(issued.value, /^[a-f0-9]{32}$/); assert.notEqual(issued.value, G)
    assert.equal(issued.httpOnly, true); assert.equal(issued.sameSite, 'lax'); assert.equal(issued.secure, true); assert.equal(issued.path, '/')
    assert.equal(issued.maxAge, f.generation.STUDENT_SESSION_GENERATION_LIFETIME_SECONDS)
    assert.equal(saved.cookies.get(storage(issued.value)).value, 'A')
    assert.equal(JSON.stringify(await saved.json()).includes(issued.value), false)
    f.apply(saved); assert.equal((await f.student.getStudentSessionContext()).user.id, f.users.A.id)
  })
})

test('logout errors do not advance selector; legitimate current B rotations survive session-changed logout', async () => fixture(async f => {
  f.jar.set(selector, G); f.jar.set(storage(G), 'B')
  f.state.rotateLookup = true
  const stale = await f.post('logout', {}, f.continuity.issueAccountContinuityToken(f.users.A.id, 'session-A'))
  assert.equal(stale.status, 409); assert.equal(stale.cookies.get(selector), undefined)
  assert.equal(stale.cookies.get(storage(G)).value, 'rotated-B')
  f.state.signoutError = true
  const failed = await f.post('logout', {}, f.continuity.issueAccountContinuityToken(f.users.B.id, 'session-B'))
  assert.equal(failed.status, 503); assert.equal(failed.cookies.get(selector), undefined)
}))

test('confirmed reset selects blank generation; unconsumed grants and password failures cannot advance it', async () => fixture(async f => {
  f.jar.set(selector, G)
  const body = { email: 'a@example.test', password: 'unit-new-password' }
  f.state.grant = false
  const missing = await f.post('reset-password', body)
  assert.equal(missing.status, 400); assert.equal(missing.cookies.get(selector), undefined)
  f.state.grant = true; f.state.resetError = true
  const failure = await f.post('reset-password', body)
  assert.equal(failure.status, 400); assert.equal(failure.cookies.get(selector), undefined)
  f.state.resetError = false
  const saved = await f.post('reset-password', body)
  assert.equal(saved.status, 200); f.apply(saved)
  assert.notEqual(f.jar.get(selector), G)
  assert.equal(await f.student.getStudentSessionContext(), null)
}))

test('cleanup accepts only exact generated roots and canonical chunks, preserving lookalikes and the fresh namespace', async () => fixture(async f => {
  const suffixes = ['', '.0', '.1', '.9', '.10', '.123']
  const obsolete = suffixes.map(suffix => storage(G) + suffix)
  const preserved = ['.00', '.01', '.001', '.000', '.01x', '.x1', '.-1', '.', '.not-a-chunk', '-evil', '.1.evil']
    .map(suffix => storage(G) + suffix)
    .concat(['ci-student-auth-not-a-generation.0', 'ci-recovery-grant', 'sb-unrelated-auth-token', 'application-preference'])
  f.jar.set(selector, G)
  for (const name of obsolete) f.jar.set(name, 'obsolete')
  for (const name of preserved) f.jar.set(name, 'preserved')
  const response = f.response(), client = await f.server.createFreshStudentSessionClient(response)
  const fresh = response.cookies.get(selector).value
  assert.notEqual(fresh, G); assert.equal(client.name, storage(fresh))
  const current = suffixes.map(suffix => storage(fresh) + suffix)
  for (const name of current) assert.equal(response.cookies.get(name), undefined, 'no deletion targets the fresh namespace')
  client.options.cookies.setAll(current.map(name => ({ name, value: 'new-session', options: { maxAge: 100 } })), {})
  for (const name of obsolete) assert.equal(response.cookies.get(name).maxAge, 0, name)
  for (const name of preserved) assert.equal(response.cookies.get(name), undefined, name)
  for (const name of current) assert.equal(response.cookies.get(name).maxAge, 100, name)
  f.apply(response)
  for (const name of obsolete) assert.equal(f.jar.has(name), false, name)
  for (const name of preserved) assert.equal(f.jar.get(name), 'preserved', name)
  for (const name of current) assert.equal(f.jar.get(name), 'new-session', name)
  assert.equal(f.jar.get(selector), fresh)
}))

test('transition cleanup removes only visible generated roots/chunks; 1000 old responses rewrite one inert namespace', async () => fixture(async f => {
  f.jar.set(selector, G); f.jar.set(storage(G), 'A'); f.jar.set(storage(H) + '.0', 'old-chunk')
  f.jar.set('sb-unrelated-auth-token', 'unrelated'); f.jar.set(storage(G) + '-lookalike', 'unrelated')
  const request = f.pageRequest(), issued = f.response()
  const next = await f.generation.advanceStudentSessionGeneration(issued)
  assert.equal(issued.cookies.get(storage(G)).maxAge, 0)
  assert.equal(issued.cookies.get(storage(H) + '.0').maxAge, 0)
  assert.equal(issued.cookies.get('sb-unrelated-auth-token'), undefined)
  assert.equal(issued.cookies.get(storage(G) + '-lookalike'), undefined)
  f.apply(issued)
  const names = new Set()
  for (let count = 0; count < 1000; count++) {
    const late = await f.proxy.refreshStudentSession(request)
    for (const cookie of late.cookies.getAll()) names.add(cookie.name)
    assert.equal(late.cookies.get(selector), undefined); f.apply(late)
  }
  assert.deepEqual([...names], [storage(G)])
  assert.equal(f.jar.get(selector), next)
  assert.equal(await f.student.getStudentSessionContext(), null)
}))
