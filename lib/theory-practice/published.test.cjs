const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { courseId, slug, rows, modelAnswer } = require('./fixtures.cjs')

async function fixture(run) {
  const original = Module._load, file = require.resolve('./published.ts')
  const client = { name: 'cookie-bound verified student' }, calls = []
  const repository = { repositoryCourseId: courseId, route: { slug, href: `/courses/${slug}`,
    course: { code: 'STATIC', title: 'Static title' } } }
  const state = { central: { status: 'ok', course: { code: 'INST', title: 'Institutional title', repository,
    content: { state: 'ready' } } }, published: { status: 'ok', content: rows() } }
  try {
    Module._load = function(name, ...args) {
      if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async (supplied, requested) => {
        assert.equal(supplied, client); assert.equal(requested, slug); calls.push('central'); return state.central
      } }
      if (name === '@/lib/managed-content/published') return { getPublishedManagedContentWithVerifiedClient: async (supplied, id) => {
        assert.equal(supplied, client); assert.equal(id, courseId); calls.push('published'); return state.published
      } }
      return original.call(this, name, ...args)
    }
    delete require.cache[file]
    const { getTheoryPracticeForVerifiedStudent } = require(file)
    await run({ state, calls, read: () => getTheoryPracticeForVerifiedStudent(client, slug) })
  } finally { Module._load = original; delete require.cache[file] }
}

test('central institutional identity and repository UUID own the published theory read', async () => fixture(async f => {
  const result = await f.read()
  assert.deepEqual(result.course, { slug, href: `/courses/${slug}`, code: 'INST', title: 'Institutional title' })
  assert.deepEqual(result.materials[0].feedback.modelAnswer, modelAnswer)
  assert.deepEqual(f.calls, ['central', 'published'])
  f.state.central = { status: 'repository-only', course: f.state.central.course }
  assert.equal((await f.read()).course.title, 'Static title')
}))

test('unresolved and unavailable courses cannot read theory directly', async () => fixture(async f => {
  for (const status of ['signed-out', 'not-found', 'invariant-failure', 'unavailable']) {
    f.state.central = { status }
    assert.deepEqual(await f.read(), { status })
  }
  assert.ok(f.calls.every(call => call === 'central'))
}))

test('withdrawal, read failures and projection errors never substitute repository answers', async () => fixture(async f => {
  f.state.published = { status: 'ok', content: [rows()[0]] }
  assert.equal((await f.read()).materials[0].feedback, null)
  f.state.published = { status: 'ok', content: [] }
  assert.deepEqual((await f.read()).materials, [])
  for (const status of ['unavailable', 'signed-out', 'invalid-course']) {
    f.state.published = { status }
    assert.deepEqual(await f.read(), { status: status === 'signed-out' ? 'signed-out' : 'unavailable' })
  }
  f.state.published = { status: 'ok', content: [{ ...rows()[0], payload: {} }] }
  assert.deepEqual(await f.read(), { status: 'unavailable' })
  f.state.central.course.content.state = 'temporarily-unavailable'
  f.calls.length = 0
  assert.deepEqual(await f.read(), { status: 'unavailable' })
  assert.deepEqual(f.calls, ['central'])
}))

test('a locked course stops before the published read; a database refusal mid-read is locked too', async () => fixture(async f => {
  f.state.central.course.content = { state: 'locked' }
  assert.deepEqual(await f.read(), { status: 'locked' })
  assert.deepEqual(f.calls, ['central'], 'no published theory is read for a locked course')
  f.state.central.course.content = { state: 'ready' }
  f.state.published = { status: 'locked' }
  assert.deepEqual(await f.read(), { status: 'locked' })
}))
