// lib/managed-content/published.test.cjs — Published reads use the live account session.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

async function fixture(run) {
  const originalLoad = Module._load
  const file = require.resolve('./published.ts')
  let user = { id: '11111111-1111-4111-8111-111111111111' }
  let sessionError = null
  let result = { data: [], error: null }
  let reads = 0
  let authChecks = 0
  let clients = 0
  let enabled = true
  let bridge = { data: { id: COURSE_ID, content_key: 'financial-accounting-1' }, error: null }
  let bridgeReads = 0
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'read_published_managed_content')
    assert.deepEqual(args, { p_course_id: COURSE_ID })
    reads++
    if (result instanceof Error) throw result
    return result
  }, from: table => {
    assert.equal(table, 'courses')
    return { select: fields => {
      assert.equal(fields, 'id,content_key')
      return { eq: (field, key) => {
        assert.equal(field, 'content_key')
        assert.equal(key, 'financial-accounting-1')
        return { maybeSingle: async () => { bridgeReads++; return bridge } }
      } }
    } }
  } }
  const mocks = {
    '@/lib/auth/config': { isStudentAuthEnabled: () => enabled },
    '@/lib/auth/student-state': { getStudentSessionUser: async () => {
      authChecks++
      if (sessionError) throw sessionError
      return user
    } },
    '@/lib/supabase/server': { createClient: async () => { clients++; return client } },
  }
  try {
    Module._load = function(name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    delete require.cache[file]
    const { getPublishedManagedContent, getPublishedManagedCourse,
      getPublishedManagedContentWithVerifiedClient } = require(file)
    await run({ read: getPublishedManagedContent, readCourse: getPublishedManagedCourse,
      readVerified: courseId => getPublishedManagedContentWithVerifiedClient(client, courseId), set: state => {
      if ('user' in state) user = state.user
      if ('sessionError' in state) sessionError = state.sessionError
      if ('result' in state) result = state.result
      if ('bridge' in state) bridge = state.bridge
      if ('enabled' in state) enabled = state.enabled
    }, reads: () => reads, authChecks: () => authChecks, clients: () => clients,
    bridgeReads: () => bridgeReads })
  } finally {
    Module._load = originalLoad
    delete require.cache[file]
  }
}

const COURSE_ID = '40000000-0000-4000-8000-000000000007'
const ROW = {
  item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  course_id: COURSE_ID,
  kind: 'cbt_question',
  question_id: 'df67ccc9-5d16-4ab5-be67-4ff195cf39c8',
  source_key: 'legacy-cbt-1',
  parent_item_id: null,
  revision: 2,
  payload: { prompt: 'Published wording', options: ['A', 'B'], correctOption: 1 },
}

test('server published-read boundary validates the live session and returned course identity', async () => fixture(async f => {
  assert.deepEqual(await f.read('not-a-uuid'), { status: 'invalid-course' })
  assert.equal(f.reads(), 0)
  f.set({ user: null })
  assert.deepEqual(await f.read(COURSE_ID), { status: 'signed-out' })
  assert.equal(f.reads(), 0)
  f.set({ user: { id: ROW.item_id }, sessionError: new Error('stale session') })
  assert.deepEqual(await f.read(COURSE_ID), { status: 'unavailable' })
  assert.equal(f.reads(), 0)
  f.set({ sessionError: null, result: { data: [ROW], error: null } })
  assert.deepEqual(await f.read(COURSE_ID), { status: 'ok', content: [ROW] })
  f.set({ result: { data: [{ ...ROW, course_id: ROW.item_id }], error: null } })
  assert.deepEqual(await f.read(COURSE_ID), { status: 'unavailable' })
  f.set({ result: { data: [], error: new Error('database unavailable') } })
  assert.deepEqual(await f.read(COURSE_ID), { status: 'unavailable' })
}))

test('already-verified client reads the published-only RPC without another auth check', async () => fixture(async f => {
  assert.deepEqual(await f.readVerified('not-a-uuid'), { status: 'invalid-course' })
  assert.equal(f.reads(), 0)
  f.set({ result: { data: [ROW], error: null } })
  assert.deepEqual(await f.readVerified(COURSE_ID), { status: 'ok', content: [ROW] })
  assert.equal(f.clients(), 0)
  assert.equal(f.authChecks(), 0)
  assert.equal(f.reads(), 1)
  f.set({ result: { data: null, error: new Error('RLS denied') } })
  assert.deepEqual(await f.readVerified(COURSE_ID), { status: 'unavailable' })
  f.set({ result: new Error('RPC failed') })
  assert.deepEqual(await f.readVerified(COURSE_ID), { status: 'unavailable' })
  f.set({ enabled: false })
  assert.deepEqual(await f.readVerified(COURSE_ID), { status: 'unavailable' })
  assert.equal(f.reads(), 3, 'disabled auth stops before RPC')
  assert.equal(f.clients(), 0)
  assert.equal(f.authChecks(), 0)
}))

test('content_key resolves to the repository UUID and no managed failure falls back to code content', async () => fixture(async f => {
  assert.deepEqual(await f.readCourse('../unsafe'), { status: 'invalid-course' })
  assert.equal(f.bridgeReads(), 0)
  f.set({ user: null })
  assert.deepEqual(await f.readCourse('financial-accounting-1'), { status: 'signed-out' })
  assert.equal(f.bridgeReads(), 0)
  f.set({ user: { id: ROW.item_id }, bridge: { data: null, error: null } })
  assert.deepEqual(await f.readCourse('financial-accounting-1'), { status: 'unavailable' })
  f.set({ bridge: { data: { id: ROW.item_id, content_key: 'wrong-key' }, error: null } })
  assert.deepEqual(await f.readCourse('financial-accounting-1'), { status: 'unavailable' })
  f.set({ bridge: { data: { id: COURSE_ID, content_key: 'financial-accounting-1' }, error: null },
    result: { data: [ROW], error: null } })
  assert.deepEqual(await f.readCourse('financial-accounting-1'),
    { status: 'ok', courseId: COURSE_ID, content: [ROW] })
  f.set({ result: { data: [], error: new Error('managed read unavailable') } })
  assert.deepEqual(await f.readCourse('financial-accounting-1'), { status: 'unavailable' })
}))
