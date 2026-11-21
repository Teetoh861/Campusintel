const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NextResponse } = require('next/server')
const { fixture } = require('./session-generation-database-fixture.cjs')
const { assertInvalidDownstream } = require('./session-generation-fixture.cjs')

const enabled = process.env.SESSION_GENERATION_DB_TEST === '1'

async function assertSharedRequestIdentity(f, response, account, storageName) {
  await f.render(response, async store => {
    const clientStart = f.clients.length
    const contexts = [await f.student.getStudentSessionContext(), await f.student.getStudentSessionContext()]
    contexts.push(...await Promise.all(Array.from({ length: 6 }, (_, i) =>
      f.student.getStudentSessionContext(i % 2 ? NextResponse.json({}) : undefined))))
    for (const context of contexts) assert.equal(context?.user.id ?? null, account?.id ?? null)
    const direct = [await f.server.createClient(), await f.server.createClient(),
      await f.server.createClient(NextResponse.json({})), await f.server.createClient(NextResponse.json({}))]
    direct.push(...await Promise.all(Array.from({ length: 6 }, (_, i) =>
      f.server.createClient(i % 2 ? NextResponse.json({}) : undefined))))
    for (const client of direct) assert.equal((await client.auth.getUser()).data.user?.id ?? null, account?.id ?? null)
    const profile = await require('../profile/student-profile.ts').getCurrentStudentProfile()
    if (account) { assert.equal(profile.status, 'complete'); assert.equal(profile.firstName, account.actor === 'A' ? 'Legacy A' : 'Generated B') }
    else assert.deepEqual(profile, { status: 'signed-out' }, 'neither protected profile is readable')
    for (const options of f.clients.slice(clientStart)) {
      assert.equal(options.cookieOptions?.name, storageName)
      if (!account) assert.deepEqual(options.cookies.getAll(), [])
    }
    const namespace = f.generation.resolveStudentSessionNamespaceFromCookieHeader(store.headers.get('cookie'))
    assert.equal(namespace.storageName, storageName)
    if (!account) { assert.equal(namespace.mode, 'invalid'); assert.equal(store.cookies.get(f.generation.STUDENT_SESSION_GENERATION_COOKIE).value, 'invalid') }
    assert.equal(response.cookies.get(f.generation.STUDENT_SESSION_GENERATION_COOKIE), undefined, 'ordinary proxy never writes browser selector')
  })
}

test('one real render request keeps sequential/concurrent clients and protected profile reads closed for malformed and duplicate selectors',
  { skip: !enabled }, async () => fixture(async f => {
    await f.legacy(f.accounts[0]); await f.completeProfile('Legacy A')
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '%'); await f.login(f.accounts[1])
    await f.completeProfile('Generated B')
    const selector = f.generation.STUDENT_SESSION_GENERATION_COOKIE, g = f.selected()
    const other = g[0] === 'a' ? 'b'.repeat(32) : 'a'.repeat(32)
    f.jar.delete(selector)
    for (const pair of [`${selector}=%`, `${selector}=${g}; ${selector}=${g}`, `${selector}=${other}; ${selector}=${g}`]) {
      for (const housekeeping of [true, false]) {
        const raw = pair + '; ' + f.cookieHeader(), response = await f.native(false, raw)
        assert.equal(f.clients.at(-1).cookieOptions.name, 'ci-student-auth-invalid')
        assert.deepEqual(f.clients.at(-1).cookies.getAll(), [])
        if (pair.endsWith('%')) assert.equal(f.pageRequest(raw).cookies.get(selector), undefined, 'real incoming Next view drops percent')
        if (housekeeping) f.clients.at(-1).cookies.setAll([{ name: 'ci-student-auth-invalid', value: '', options: { maxAge: 0 } }], {})
        assertInvalidDownstream(f, response, raw)
        await assertSharedRequestIdentity(f, response, null, 'ci-student-auth-invalid')
      }
    }
  }))

test('real legacy absence and canonical generation retain the same live owner across multiple render clients',
  { skip: !enabled }, async () => fixture(async f => {
    await f.legacy(f.accounts[0]); await f.completeProfile('Legacy A')
    const legacy = await f.native()
    await assertSharedRequestIdentity(f, legacy, f.accounts[0], undefined); f.apply(legacy)
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '%'); await f.login(f.accounts[1])
    await f.completeProfile('Generated B')
    const selected = f.selected(), generated = await f.native()
    assert.ok([...f.jar.keys()].some(name => name.startsWith('sb-')), 'legacy cookies remain physically present')
    await assertSharedRequestIdentity(f, generated, f.accounts[1], f.generation.resolveStudentSessionNamespace(selected).storageName)
    assert.equal(f.selected(), selected)
  }))

test('raw undecodable selector dropped by real Next parsing cannot revive legacy Auth through proxy or either server client',
  { skip: !enabled }, async () => fixture(async f => {
    await f.legacy(f.accounts[0])
    assert.equal((await f.current()).user.id, f.accounts[0].id)
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '%')
    const request = f.pageRequest()
    assert.equal(request.cookies.get(f.generation.STUDENT_SESSION_GENERATION_COOKIE), undefined)
    assert.equal(f.generation.resolveStudentSessionNamespaceFromCookieHeader(request.headers.get('cookie')).mode, 'invalid')
    const response = await f.native(false)
    assert.equal(response.headers.get('set-cookie'), null)
    assertInvalidDownstream(f, response, request.headers.get('cookie'))
    assert.equal(await f.current(), null, 'response-bound lookup cannot recover legacy A')
    const render = await f.invoke(async () => (await f.server.createClient()).auth.getUser())
    assert.equal(render.data.user, null, 'render client cannot recover legacy A')
    const forwarded = response.headers.get('x-middleware-request-cookie')
    assert.equal(await f.current(forwarded), null, 'proxy must preserve malformed raw presence for its downstream handler')
  }))

test('real legacy credentials stay inaccessible for malformed/noncanonical/duplicate raw selectors, but true absence still works',
  { skip: !enabled }, async () => fixture(async f => {
    await f.legacy(f.accounts[0])
    const selector = f.generation.STUDENT_SESSION_GENERATION_COOKIE, generation = 'a'.repeat(32)
    for (const value of ['%', '%ZZ', '', generation.toUpperCase(), generation.slice(1), generation + 'a',
      `"${generation}"`, generation + 'junk', '%61' + generation.slice(1)]) {
      f.jar.set(selector, value)
      assert.equal(await f.current(), null, value)
      const response = await f.native(false)
      assert.equal(response.headers.get('set-cookie'), null)
      assert.equal(await f.current(response.headers.get('x-middleware-request-cookie')), null)
    }
    f.jar.set(selector, generation)
    assert.equal(await f.current(), null, 'a canonical but empty selected namespace cannot recover the live legacy session')
    assert.equal((await f.native(false)).headers.get('set-cookie'), null)
    f.jar.delete(selector)
    const legacy = f.cookieHeader()
    for (const pair of [`${selector}=${generation}; ${selector}=${generation}`, `${selector}=%; ${selector}=${generation}`]) {
      assert.equal(await f.current(pair + '; ' + legacy), null)
      assert.equal((await f.native(false, pair + '; ' + legacy)).headers.get('set-cookie'), null)
    }
    for (const prefix of ['', `x${selector}=${generation}; `, `${selector}-x=${generation}; `]) {
      assert.equal((await f.current(prefix + legacy)).user.id, f.accounts[0].id)
    }
  }))

test('successful fresh login repairs malformed raw selection while keeping delayed legacy cookies inert',
  { skip: !enabled }, async () => fixture(async f => {
    await f.legacy(f.accounts[0])
    const held = await f.native()
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '%')
    const invalid = await f.native(false), forwarded = assertInvalidDownstream(f, invalid, f.cookieHeader())
    const response = await f.login(f.accounts[1], forwarded), selected = f.selected()
    assert.match(selected, /^[a-f0-9]{32}$/)
    const root = f.generation.resolveStudentSessionNamespace(selected).storageName
    assert.ok(f.cookiesOf(response).some(cookie => cookie.name === root || cookie.name.startsWith(root + '.')))
    f.apply(held)
    assert.equal(f.selected(), selected)
    assert.equal((await f.current()).user.id, f.accounts[1].id)
  }))

test('real native A refresh is inert after logout tombstone and login B; stale A mutation/logout cannot affect B',
  { skip: !enabled }, async () => fixture(async f => {
    const [a, b] = f.accounts
    await f.login(a)
    const ga = f.selected(), tokenA = await f.pageToken(), held = await f.native()
    const nameA = f.generation.resolveStudentSessionNamespace(ga).storageName
    assert.ok(f.cookiesOf(held).length > 0)
    assert.ok(f.cookiesOf(held).every(cookie => cookie.name === nameA || cookie.name.startsWith(nameA + '.')))
    const oldCookieNames = [...f.jar.keys()].filter(name => name === nameA || name.startsWith(nameA + '.'))
    assert.ok(oldCookieNames.length > 0, 'the browser contains A Auth cookies before logout')
    const logout = await f.post('logout', {}, tokenA)
    assert.equal(logout.status, 200); f.apply(logout)
    for (const name of oldCookieNames) {
      assert.ok(logout.headers.getSetCookie().some(header => header.startsWith(name + '=') && /; Max-Age=0(?:;|$)/.test(header)))
      assert.equal(f.jar.has(name), false, 'production logout removes each Auth-cookie key from the browser jar')
    }
    const blank = f.selected(); assert.notEqual(blank, ga)
    f.apply(held); assert.equal(f.selected(), blank); assert.equal(await f.current(), null)
    for (const cookie of f.cookiesOf(held)) assert.equal(f.jar.get(cookie.name), cookie.value, 'late A Auth cookies physically reappear')
    const repeated = await f.post('logout', {})
    assert.equal(repeated.status, 200); f.apply(repeated)
    const repeatedBlank = f.selected(); assert.notEqual(repeatedBlank, blank)
    f.apply(held); assert.equal(await f.current(), null, 'already-signed-out cleanup remains a tombstone')
    await f.login(b)
    const gb = f.selected(); assert.notEqual(gb, ga); assert.notEqual(gb, blank); assert.notEqual(gb, repeatedBlank)
    const selectedCookies = [...f.jar].filter(([name]) => name.startsWith(f.generation.resolveStudentSessionNamespace(gb).storageName))
    f.apply(held)
    assert.equal(f.selected(), gb)
    for (const [name, value] of selectedCookies) assert.ok(f.jar.get(name) === value, 'B cookie unchanged by late A response')
    assert.equal((await f.current()).user.id, b.id)
    const status = await f.invoke(() => require('../../app/api/auth/session/route.ts').GET(new Request('http://localhost:3000/api/auth/session')))
    assert.deepEqual(await status.json(), { enabled: true, signedIn: true })
    assert.equal(f.cookiesOf(status).some(cookie => cookie.name === f.generation.STUDENT_SESSION_GENERATION_COOKIE), false)
    const profile = require('../../app/api/profile-selection/route.ts')
    const before = await f.invoke(profile.GET), state = await before.json()
    assert.equal(state.status, 'incomplete'); assert.equal(state.revision, 0)
    const stale = await f.invoke(() => profile.PUT(new Request('http://localhost:3000/api/profile-selection', {
      method: 'PUT', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json', 'x-campus-account-continuity': tokenA },
      body: JSON.stringify({ first_name: 'Must not save', expectedRevision: 0, departmentId: state.options.departments[0].id,
        academicLevelId: state.options.academicLevels[0].id, academicPeriodId: state.options.academicPeriods[0].id }),
    })))
    assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { status: 'session-changed' }); f.apply(stale)
    const after = await f.invoke(profile.GET)
    assert.deepEqual(await after.json(), state, 'stale A whole form performs no B mutation')
    const refusedLogout = await f.post('logout', {}, tokenA)
    assert.equal(refusedLogout.status, 409)
    assert.equal(f.cookiesOf(refusedLogout).some(cookie => cookie.name === f.generation.STUDENT_SESSION_GENERATION_COOKIE), false)
    f.apply(refusedLogout); assert.equal(f.selected(), gb); assert.equal((await f.current()).user.id, b.id)
  }))

test('real legacy SDK session authenticates and refreshes; malformed/empty selectors cannot recover legacy or obsolete cookies',
  { skip: !enabled }, async () => fixture(async f => {
    const [a, b] = f.accounts
    await f.legacy(a)
    assert.equal((await f.current()).user.id, a.id)
    const held = await f.native()
    assert.ok(f.cookiesOf(held).every(cookie => cookie.name.startsWith('sb-')))
    const token = await f.pageToken(), logout = await f.post('logout', {}, token)
    assert.equal(logout.status, 200); f.apply(logout); f.apply(held)
    assert.equal(await f.current(), null, 'blank generation ignores late legacy cookies')
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '../malformed')
    assert.equal(await f.current(), null, 'malformed selector cannot read legacy')
    const response = await f.login(b), gb = f.selected()
    assert.match(gb, /^[a-f0-9]{32}$/)
    assert.ok(f.cookiesOf(response).some(cookie => cookie.name.startsWith(f.generation.resolveStudentSessionNamespace(gb).storageName)))
    assert.equal((await f.current()).user.id, b.id)
  }))

test('real confirmation transfer selects fresh generation and the same jar authenticates through response-bound and render clients',
  { skip: !enabled }, async () => fixture(async f => {
    const old = 'a'.repeat(32)
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, old)
    const response = await f.confirmation(f.accounts[1])
    assert.equal(response.status, 200); f.apply(response)
    assert.notEqual(f.selected(), old)
    assert.equal((await f.current()).user.id, f.accounts[1].id)
    const rendered = await f.invoke(async () => (await f.server.createClient()).auth.getUser())
    assert.equal(rendered.error, null); assert.equal(rendered.data.user.id, f.accounts[1].id)
  }))

test('real confirmation can replace internal invalid authority with an explicitly fresh response generation',
  { skip: !enabled }, async () => fixture(async f => {
    await f.legacy(f.accounts[0])
    f.jar.set(f.generation.STUDENT_SESSION_GENERATION_COOKIE, '%')
    const invalid = await f.native(false), forwarded = assertInvalidDownstream(f, invalid, f.cookieHeader())
    const response = await f.confirmation(f.accounts[1], forwarded)
    assert.equal(response.status, 200)
    assert.match(f.cookiesOf(response).find(cookie => cookie.name === f.generation.STUDENT_SESSION_GENERATION_COOKIE).value, /^[a-f0-9]{32}$/)
    f.apply(response)
    assert.equal((await f.current()).user.id, f.accounts[1].id)
  }))
