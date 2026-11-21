const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AUTH_CONTINUITY_HEADER } = require('../auth/constants.ts')
const { revealTheoryAnswer } = require('./client.ts')
const { feedback, command, longDraft } = require('./fixtures.cjs')
const { THEORY_BODY_MAX_BYTES } = require('./contract.ts')
const signal = () => new AbortController().signal

test('draft submission uses the page continuity token and accepts only matching validated feedback', async () => {
  const result = await revealTheoryAnswer(command(''), 'page-token', signal(), async (url, options) => {
    assert.equal(url, '/api/theory-practice')
    assert.equal(options.method, 'POST')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.credentials, 'same-origin')
    assert.equal(options.headers[AUTH_CONTINUITY_HEADER], 'page-token')
    assert.deepEqual(JSON.parse(options.body), command())
    return Response.json({ status: 'ready', feedback })
  })
  assert.deepEqual(result, { status: 'ready', feedback })
})

test('a 20,000-character draft or any extra runtime field is never placed in the request', async () => {
  const sent = []
  const draft = longDraft()
  const result = await revealTheoryAnswer({ ...command(), answer: draft, reflection: 'private reflection' }, 'page-token', signal(),
    async (url, options) => { sent.push({ url, options }); return Response.json({ status: 'ready', feedback }) })
  assert.deepEqual(result, { status: 'ready', feedback })
  assert.equal(sent.length, 1)
  const wire = JSON.stringify({ url: sent[0].url, headers: sent[0].options.headers, body: sent[0].options.body })
  assert.doesNotMatch(wire, /STUDENT-DRAFT-MARKER|private reflection|x{100}/)
  assert.deepEqual(Object.keys(JSON.parse(sent[0].options.body)).sort(), ['courseSlug', 'itemId', 'publishedRevision'])
  assert.ok(Buffer.byteLength(sent[0].options.body) < THEORY_BODY_MAX_BYTES)
})

test('malformed, foreign and stale feedback and unexpected failures preserve a retriable state', async () => {
  for (const body of [null, { status: 'ready' }, { status: 'ready', feedback: {} },
    { status: 'ready', feedback: { ...feedback, question: { ...feedback.question, publishedRevision: 1 } } },
    { status: 'ready', feedback: { ...feedback, question: { ...feedback.question, itemId: feedback.modelAnswer.itemId } } },
    { status: 'unknown' }]) {
    assert.deepEqual(await revealTheoryAnswer(command(), 'page-token', signal(), async () => Response.json(body)), { status: 'unavailable' })
  }
  assert.deepEqual(await revealTheoryAnswer(command(), 'page-token', signal(), async () => { throw new Error('network failure') }), { status: 'unavailable' })
  assert.deepEqual(await revealTheoryAnswer(command(), 'page-token', signal(), async () => new Response('not-json')), { status: 'unavailable' })
})

test('known refusals stay explicit and error responses cannot smuggle a model answer', async () => {
  for (const status of ['signed-out', 'session-changed', 'incomplete', 'invalid-request', 'not-found', 'content-changed']) {
    assert.deepEqual(await revealTheoryAnswer(command(), 'page-token', signal(), async () => Response.json({ status }, { status: 409 })), { status })
  }
  assert.deepEqual(await revealTheoryAnswer(command(), 'page-token', signal(), async () => Response.json({ status: 'ready', feedback }, { status: 503 })), { status: 'unavailable' })
})
