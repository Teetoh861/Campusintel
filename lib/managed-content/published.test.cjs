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
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'read_published_managed_content')
    assert.deepEqual(args, { p_course_id: COURSE_ID })
    reads++
    return result
  } }
  const mocks = {
    '@/lib/auth/config': { isStudentAuthEnabled: () => true },
    '@/lib/auth/student-state': { getStudentSessionUser: async () => {
      if (sessionError) throw sessionError
      return user
    } },
    '@/lib/supabase/server': { createClient: async () => client },
  }
  try {
    Module._load = function(name, ...args) { return mocks[name] || originalLoad.call(this, name, ...args) }
    delete require.cache[file]
    const { getPublishedManagedContent } = require(file)
    await run({ read: getPublishedManagedContent, set: state => {
      if ('user' in state) user = state.user
      if ('sessionError' in state) sessionError = state.sessionError
      if ('result' in state) result = state.result
    }, reads: () => reads })
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
