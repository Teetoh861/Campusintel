// lib/managed-content/bank-sizes.test.cjs — Practice bank sizes come from the count-only summary, once per reader call:
// never a question, one read for the whole list, and a plan ending mid-request marks only the courses it locked.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const A = '40000000-0000-4000-8000-000000000001'
const B = '40000000-0000-4000-8000-000000000007'

async function fixture(run) {
  const original = Module._load
  const file = require.resolve('./published.ts')
  const calls = []
  const state = { enabled: true, answer: ids => ({ data: ids.map(id => ({ course_id: id, bank_size: id === A ? 50 : 150 })),
    error: null }) }
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'published_cbt_summary', 'the only read is the count-only summary')
    calls.push(args.p_course_ids)
    const answer = state.answer(args.p_course_ids)
    if (answer instanceof Error) throw answer
    return answer
  } }
  try {
    Module._load = function(name, ...args) {
      if (name === 'server-only') return {}
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const { getPublishedCbtBankSizesWithVerifiedClient } = require(file)
    await run({ read: ids => getPublishedCbtBankSizesWithVerifiedClient(client, ids), calls, state })
  } finally { Module._load = original; delete require.cache[file] }
}

const sizes = result => result.status === 'ok' ? Object.fromEntries(result.sizes) : result

test('one read serves the whole list, deduplicated', async () => fixture(async f => {
  assert.deepEqual(sizes(await f.read([A, B, A])), { [A]: 50, [B]: 150 })
  assert.deepEqual(f.calls, [[A, B]])
  assert.deepEqual(sizes(await f.read([])), {}, 'nothing to ask, nothing asked')
  assert.equal(f.calls.length, 1)
}))

test('a plan that ends mid-request locks only the courses it no longer reads', async () => fixture(async f => {
  f.state.answer = ids => ids.length > 1 || ids[0] === B ? { data: null, error: { code: 'CI403' } }
    : { data: [{ course_id: A, bank_size: 50 }], error: null }
  assert.deepEqual(sizes(await f.read([A, B])), { [A]: 50, [B]: 'locked' })
  assert.deepEqual(f.calls, [[A, B], [A], [B]])
}))

test('signed out is signed out; failures and malformed answers are unavailable, never a count', async () => fixture(async f => {
  f.state.answer = () => ({ data: null, error: { code: '42501' } })
  assert.deepEqual(await f.read([A]), { status: 'signed-out' })
  for (const answer of [() => ({ data: null, error: { code: 'XX000' } }), () => new Error('network'),
    () => ({ data: [{ course_id: A, bank_size: -1 }], error: null }),
    () => ({ data: [{ course_id: A, bank_size: 5, prompt: 'leak' }], error: null }),
    () => ({ data: [], error: null })]) {
    f.state.answer = answer
    assert.deepEqual(sizes(await f.read([A])), { [A]: 'unavailable' })
  }
  f.state.enabled = false
  assert.deepEqual(sizes(await f.read([A])), { [A]: 'unavailable' })
  f.state.enabled = true
  const before = f.calls.length
  assert.deepEqual(sizes(await f.read(['not-a-uuid'])), { 'not-a-uuid': 'unavailable' })
  assert.equal(f.calls.length, before, 'a malformed id is never sent')
}))
