// lib/bookmarks/server.test.cjs — Session, identity, and replay boundary tests.
// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE } = require('./contract.ts')

const ownerA = '11111111-1111-4111-8111-111111111111'
const ownerB = '22222222-2222-4222-8222-222222222222'
const importId = '33333333-3333-4333-8333-333333333333'
const built = new Map([
  ['first-content', '40000000-0000-4000-8000-000000000001'],
  ['second-content', '40000000-0000-4000-8000-000000000002'],
])

function fixture(registry = built) {
  let owner = ownerA
  let session = 'session-a'
  let switchedOnSecondCheck = false
  let sessionChecks = 0
  let failRead = false
  let failWrite = false
  let skipWrite = false
  let enabled = true
  const rows = []
  const appliedImports = new Map()
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      assert.equal(name, 'reconcile_student_bookmarks')
      if (failWrite) return { data: null, error: { message: 'database failed' } }
      if (skipWrite) return { data: true, error: null }
      const key = `${owner}:${args.p_reconciliation_id}`
      const payload = [...new Set(args.p_course_ids)].sort()
      if (appliedImports.has(key)) {
        assert.deepEqual(appliedImports.get(key), payload)
        return { data: false, error: null }
      }
      appliedImports.set(key, payload)
      for (const courseId of payload) if (!rows.some(row =>
        row.user_id === owner && row.course_id === courseId)) rows.push({ user_id: owner, course_id: courseId })
      return { data: true, error: null }
    },
    from(table) {
      calls.push(['from', table])
      if (table === 'courses') return { select: () => ({
        in: async (column, values) => ({ data: [...registry].filter(([key, id]) =>
          values.includes(column === 'id' ? id : key)).map(([content_key, id]) => ({ id, content_key })), error: null }),
      }) }
      assert.equal(table, 'student_bookmarks')
      return {
        select: () => ({ eq: (_, user) => ({ order: async () => failRead
          ? { data: null, error: { message: 'database failed' } }
          : { data: rows.filter(row => row.user_id === user).map(row => ({ course_id: row.course_id })), error: null } }) }),
        upsert: async (added, options) => {
          calls.push(['upsert', added, options])
          if (failWrite) return { error: { message: 'database failed' } }
          if (skipWrite) return { error: null }
          for (const row of added) if (!rows.some(saved =>
            saved.user_id === row.user_id && saved.course_id === row.course_id)) rows.push(row)
          return { error: null }
        },
        delete: () => ({ eq: (_, user) => ({ eq: async (_, course) => {
          calls.push(['delete', user, course])
          if (failWrite) return { error: { message: 'database failed' } }
          if (skipWrite) return { error: null }
          const index = rows.findIndex(row => row.user_id === user && row.course_id === course)
          if (index !== -1) rows.splice(index, 1)
          return { error: null }
        } }) }),
      }
    },
  }
  const mocks = {
    '@/lib/auth/config': { getAuthSecretKey: () => 'server-only-test-secret', isStudentAuthEnabled: () => enabled },
    '@/lib/auth/account-continuity': {
      issueAccountContinuityToken: (id, sid) => `${id}:${sid}`,
      matchesAccountContinuityToken: (token, id, sid) => token === `${id}:${sid}`,
    },
    '@/lib/auth/student-state': { getStudentSessionContext: async () => {
      sessionChecks++
      if (switchedOnSecondCheck && sessionChecks === 2) owner = ownerB
      return owner === null ? null : { user: { id: owner }, sessionId: session }
    } },
    '@/lib/data/courses': { getCourseByContentKey: key => registry.has(key) ? { contentKey: key } : undefined,
      courses: [...registry].map(([contentKey]) => ({ contentKey })) },
    '@/lib/supabase/server': { createClient: async () => client },
  }
  const original = Module._load
  Module._load = function (name, ...args) {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    return original.call(this, name, ...args)
  }
  let server
  try {
    delete require.cache[require.resolve('./server.ts')]
    server = require('./server.ts')
  } finally { Module._load = original }
  return { server, rows, calls,
    setOwner(value) { owner = value }, setSession(value) { session = value },
    switchOnSecondCheck() { switchedOnSecondCheck = true; sessionChecks = 0 },
    failRead() { failRead = true }, failWrite() { failWrite = true },
    skipWrite() { skipWrite = true },
    disable() { enabled = false },
  }
}

test('live signed-out status never reads account data', async () => {
  const f = fixture()
  f.setOwner(null)
  assert.deepEqual(await f.server.getCurrentBookmarks({}), { status: 'signed-out' })
  assert.equal(f.calls.length, 0)
  f.disable()
  assert.deepEqual(await f.server.getCurrentBookmarks({}), { status: 'signed-out' })
})

test('account reads and writes use only the cookie-bound permanent owner and course UUID', async () => {
  const f = fixture()
  const context = await f.server.getCurrentBookmarks({})
  assert.equal(context.status, 'ready')
  assert.equal(context.courseKeys.length, 0)
  assert.equal('userId' in context, false)
  const result = await f.server.writeCurrentBookmarks(
    { action: 'add', contentKey: 'first-content' }, {}, context.continuityToken)
  assert.equal(result.status, 'ready')
  assert.deepEqual(f.rows, [{ user_id: ownerA, course_id: built.get('first-content') }])
  assert.deepEqual(f.calls.find(call => call[0] === 'upsert')[2],
    { onConflict: 'user_id,course_id', ignoreDuplicates: true })
  f.setOwner(ownerB)
  const other = await f.server.getCurrentBookmarks({})
  assert.deepEqual(other.courseKeys, [])
  assert.equal((await f.server.writeCurrentBookmarks(
    { action: 'remove', contentKey: 'first-content' }, {}, context.continuityToken)).status,
    'session-changed')
  assert.equal(f.rows.length, 1)
})

test('merge uses pinned stable course IDs and rejects client-chosen ownership', async () => {
  const f = fixture()
  assert.equal(f.server.bookmarkCommand.safeParse({ action: 'add', contentKey: 'first-content', user_id: ownerB }).success, false)
  assert.equal(f.server.bookmarkCommand.safeParse({ action: 'merge', courseIds: [built.get('first-content')] }).success, false)
  assert.equal(f.server.bookmarkCommand.safeParse({ action: 'merge', reconciliationId: importId,
    courseIds: [built.get('first-content')], user_id: ownerB }).success, false)
  const context = await f.server.getCurrentBookmarks({})
  assert.deepEqual(context.courseIds, [...built].map(([contentKey, courseId]) => ({ contentKey, courseId })))
  const merged = await f.server.writeCurrentBookmarks({ action: 'merge',
    reconciliationId: importId,
    courseIds: [built.get('first-content'), built.get('first-content'), built.get('second-content')] },
    {}, context.continuityToken)
  assert.equal(merged.status, 'ready')
  assert.deepEqual(merged.courseKeys, ['first-content', 'second-content'])
  assert.equal(f.rows.length, 2)
  assert.deepEqual(f.calls.find(call => call[0] === 'rpc')[2], {
    p_reconciliation_id: importId,
    p_course_ids: [built.get('first-content'), built.get('first-content'), built.get('second-content')],
  })
  assert.equal((await f.server.writeCurrentBookmarks({ action: 'add',
    contentKey: 'unknown' }, {}, merged.continuityToken)).status, 'invalid-request')
})

test('a replayed server merge acknowledges current state without restoring a later deletion', async () => {
  const f = fixture()
  const context = await f.server.getCurrentBookmarks({})
  const command = { action: 'merge', reconciliationId: importId, courseIds: [built.get('first-content')] }
  assert.equal((await f.server.writeCurrentBookmarks(command, {}, context.continuityToken)).status, 'ready')
  f.rows.splice(0, 1)
  const replay = await f.server.writeCurrentBookmarks(command, {}, context.continuityToken)
  assert.equal(replay.status, 'ready')
  assert.deepEqual(replay.courseKeys, [])
  assert.deepEqual(f.rows, [])
  assert.equal(f.calls.filter(call => call[0] === 'rpc').length, 2)
})

test('session changes and database failures never report saved bookmark state', async () => {
  const f = fixture()
  const context = await f.server.getCurrentBookmarks({})
  f.switchOnSecondCheck()
  assert.equal((await f.server.writeCurrentBookmarks({ action: 'add',
    contentKey: 'first-content' }, {}, context.continuityToken)).status, 'session-changed')
  assert.equal(f.rows.length, 0)
  f.setOwner(ownerA)
  f.failWrite()
  assert.equal((await f.server.writeCurrentBookmarks({ action: 'add',
    contentKey: 'first-content' }, {}, context.continuityToken)).status, 'unavailable')
  assert.equal(f.rows.length, 0)
  f.failRead()
  assert.equal((await f.server.getCurrentBookmarks({})).status, 'unavailable')
})

test('a successful HTTP-style write without the intended durable state is not acknowledged', async () => {
  const f = fixture()
  const context = await f.server.getCurrentBookmarks({})
  f.skipWrite()
  const result = await f.server.writeCurrentBookmarks({ action: 'add',
    contentKey: 'first-content' }, {}, context.continuityToken)
  assert.equal(result.status, 'unavailable')
  assert.deepEqual(f.rows, [])
})

test('one merge request is bounded, but an account can reconcile more courses than one request', async () => {
  const many = new Map(Array.from({ length: MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE + 8 }, (_, index) =>
    [`large-${index}-content`, `50000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`]))
  const ids = [...many.values()]
  const f = fixture(many)
  assert.equal(f.server.bookmarkCommand.safeParse({ action: 'merge', reconciliationId: importId,
    courseIds: ids }).success, false, 'an oversized single request is rejected')
  const context = await f.server.getCurrentBookmarks({})
  assert.equal(context.courseIds.length, ids.length)
  const first = { action: 'merge', reconciliationId: importId,
    courseIds: ids.slice(0, MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE) }
  const second = { action: 'merge', reconciliationId: '44444444-4444-4444-8444-444444444444',
    courseIds: ids.slice(MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE) }
  assert.equal(f.server.bookmarkCommand.safeParse(first).success, true)
  assert.equal((await f.server.writeCurrentBookmarks(first, {}, context.continuityToken)).status, 'ready')
  const merged = await f.server.writeCurrentBookmarks(second, {}, context.continuityToken)
  assert.equal(merged.status, 'ready')
  assert.deepEqual([...merged.courseKeys].sort(), [...many.keys()].sort())
  const replay = await f.server.writeCurrentBookmarks(first, {}, context.continuityToken)
  assert.equal(replay.status, 'ready')
  assert.equal(replay.courseKeys.length, ids.length)
  assert.equal(f.rows.length, ids.length)
})
