// app/courses/ai-practice/[courseId]/journey.test.cjs — Browser sequence: checks, direct upload, progress and messages.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkFile, createGenerationRequests, describeResult, generateFromDocument, runUploadJourney } = require('./journey.ts')
const { AUTH_CONTINUITY_HEADER } = require('../../../../lib/auth/constants.ts')

const COURSE = '41111111-1111-4111-8111-111111111111'
const DOC = '51111111-1111-4111-8111-111111111111'
const DOC_2 = '52222222-2222-4222-8222-222222222222'
const set = { generationId: 'g1', createdAt: '2026-10-16', fileName: 'notes.pdf', questions: [] }
const file = (name = 'notes.pdf', size = 1000) => Object.assign(new Blob([new Uint8Array(size)]), { name })
const sequence = () => { let next = 0; return () => `r${next += 1}` }

function harness(responses) {
  const requests = []
  const phases = []
  const fetch = async (url, init) => {
    const body = init.body instanceof Blob ? '[file]' : JSON.parse(init.body)
    requests.push({ url, method: init.method, headers: init.headers, body })
    const next = typeof responses === 'function' ? responses(body) : responses.shift()
    if (next instanceof Error) throw next
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.json }
  }
  return { requests, phases, deps: { fetch, continuityToken: 'token-1', courseId: COURSE,
    requests: createGenerationRequests(sequence()), onPhase: phase => phases.push(phase) } }
}

/**
 * The server's ledger as far as idempotency goes: begin_ai_practice_generation commits one generation, one
 * provider call and one allowance unit per request id, and replays the recorded result for a repeated id.
 */
function ledger() {
  const recorded = new Map()
  const state = { providerCalls: 0, charged: 0 }
  return { state, generate(requestId, { running = false } = {}) {
    if (running) return { status: 409, json: { status: 'busy' } }
    if (!recorded.has(requestId)) {
      state.providerCalls += 1
      state.charged += 1
      recorded.set(requestId, { status: 'generated', set: { ...set, generationId: `g${state.providerCalls}` }, allowance: null })
    }
    return { status: 200, json: recorded.get(requestId) }
  } }
}

test('the happy path reserves, uploads straight to storage, reads, then generates', async () => {
  const { deps, requests, phases } = harness([
    { status: 200, json: { status: 'upload-reserved', documentId: DOC, uploadUrl: 'https://storage.test/sign?token=x' } },
    { status: 200 },
    { status: 200, json: { status: 'upload-ready', documentId: DOC } },
    { status: 200, json: { status: 'generated', set, allowance: null } },
  ])
  const outcome = await runUploadJourney(file(), deps)
  assert.deepEqual(outcome, { kind: 'generated', set, allowance: null })
  assert.deepEqual(phases, ['uploading', 'reading', 'generating'])
  assert.deepEqual(requests.map(request => [request.url, request.method]), [['/api/ai-practice', 'POST'],
    ['https://storage.test/sign?token=x', 'PUT'], ['/api/ai-practice', 'POST'], ['/api/ai-practice', 'POST']])
  assert.deepEqual(requests[0].body, { operation: 'reserve-upload', courseId: COURSE, fileName: 'notes.pdf',
    mediaType: 'application/pdf', byteSize: 1000 })
  assert.equal(requests[0].headers[AUTH_CONTINUITY_HEADER], 'token-1')
  assert.equal(requests[1].headers['Content-Type'], 'application/pdf')
  assert.equal(requests[1].headers[AUTH_CONTINUITY_HEADER], undefined, 'no app credential is sent to storage')
  assert.deepEqual(requests[3].body, { operation: 'generate', documentId: DOC, requestId: 'r1' })
})

test('unsupported, empty and oversized files never leave the device', async () => {
  for (const [candidate, text] of [[file('notes.doc'), /PDF, Word/], [file('notes.txt', 0), /any text/],
    [file('notes.pdf', 5 * 1024 * 1024 + 1), /larger than 5 MB/]]) {
    const { deps, requests } = harness([])
    const outcome = await runUploadJourney(candidate, deps)
    assert.match(outcome.message, text)
    assert.equal(requests.length, 0)
  }
  assert.equal(checkFile({ name: 'Notes.DOCX', size: 10 }), null)
})

test('upload transport failures and storage size refusals are explained', async () => {
  const reserved = { status: 200, json: { status: 'upload-reserved', documentId: DOC, uploadUrl: 'https://s/u' } }
  assert.match((await runUploadJourney(file(), harness([reserved, { status: 413 }]).deps)).message, /5 MB/)
  assert.equal((await runUploadJourney(file(), harness([{ ...reserved }, { status: 500 }]).deps)).title, 'Upload failed')
  assert.equal((await runUploadJourney(file(), harness([{ ...reserved }, new Error('offline')]).deps)).title, 'Upload failed')
})

test('a rejected file shows the specific reason and stops before generation', async () => {
  const { deps, requests } = harness([
    { status: 200, json: { status: 'upload-reserved', documentId: DOC, uploadUrl: 'https://s/u' } }, { status: 200 },
    { status: 200, json: { status: 'upload-rejected', reason: 'encrypted' } }])
  const outcome = await runUploadJourney(file(), deps)
  assert.match(outcome.message, /password-protected/)
  assert.equal(requests.length, 3)
})

test('a failed generation keeps the document so retry does not re-upload', async () => {
  const { deps } = harness([{ status: 200, json: { status: 'generation-failed', allowance: null } }])
  const outcome = await generateFromDocument(DOC, deps)
  assert.equal(outcome.documentId, DOC)
  assert.match(outcome.message, /did not use any of your AI allowance/)
})

test('a reply lost after the server committed is retried as the same request: one provider call, one charge', async () => {
  for (const loss of [new TypeError('Failed to fetch'), { status: 504, json: 'gateway timeout page' }]) {
    const server = ledger()
    let first = true
    const { deps, requests } = harness(body => {
      const reply = server.generate(body.requestId)
      // The generation commits and is charged; only the response never reaches the browser.
      if (first) { first = false; return loss }
      return reply
    })
    const lost = await generateFromDocument(DOC, deps)
    assert.equal(lost.kind, 'problem')
    assert.equal(lost.documentId, DOC, 'the student is offered "Try again" on the same file')
    const retried = await generateFromDocument(DOC, deps)
    assert.deepEqual(retried, { kind: 'generated', set: { ...set, generationId: 'g1' }, allowance: null })
    assert.deepEqual(requests.map(request => request.body.requestId), ['r1', 'r1'], 'the original id is kept')
    assert.deepEqual(server.state, { providerCalls: 1, charged: 1 })
  }
})

test('a busy reply keeps the request id until the running generation is recorded', async () => {
  const server = ledger()
  const replies = [{ running: true }, { running: true }, {}]
  const { deps, requests } = harness(body => server.generate(body.requestId, replies.shift()))
  assert.equal((await generateFromDocument(DOC, deps)).title, 'Your questions are still being prepared')
  assert.equal((await generateFromDocument(DOC, deps)).title, 'Your questions are still being prepared')
  assert.equal((await generateFromDocument(DOC, deps)).kind, 'generated')
  assert.deepEqual(requests.map(request => request.body.requestId), ['r1', 'r1', 'r1'])
  assert.deepEqual(server.state, { providerCalls: 1, charged: 1 })
})

test('a new id is issued only when the student starts a new generation', async () => {
  const replies = [{ status: 200, json: { status: 'generation-failed', allowance: null } },
    { status: 200, json: { status: 'generated', set, allowance: null } }, { status: 503, json: { status: 'unavailable' } },
    { status: 200, json: { status: 'generated', set, allowance: null } }]
  const { deps, requests } = harness(replies)
  // A recorded failure used nothing; trying again is a new generation, so it gets a new id.
  await generateFromDocument(DOC, deps)
  await generateFromDocument(DOC, deps)
  // A different upload is a different generation; its own outage keeps its own id.
  await generateFromDocument(DOC_2, deps)
  await generateFromDocument(DOC_2, deps)
  assert.deepEqual(requests.map(request => [request.body.documentId, request.body.requestId]),
    [[DOC, 'r1'], [DOC, 'r2'], [DOC_2, 'r3'], [DOC_2, 'r3']])
})

test('the upload journey and its later "Try again" share one request id', async () => {
  const { deps, requests } = harness([
    { status: 200, json: { status: 'upload-reserved', documentId: DOC, uploadUrl: 'https://s/u' } }, { status: 200 },
    { status: 200, json: { status: 'upload-ready', documentId: DOC } }, new TypeError('offline'),
    { status: 200, json: { status: 'generated', set, allowance: null } }])
  const first = await runUploadJourney(file(), deps)
  assert.equal(first.documentId, DOC)
  assert.equal((await generateFromDocument(first.documentId, deps)).kind, 'generated')
  const generates = requests.filter(request => request.body.operation === 'generate')
  assert.deepEqual(generates.map(request => request.body.requestId), ['r1', 'r1'])
})

test('every server result has student-safe copy; unknown or broken replies degrade to a retry', async () => {
  for (const status of ['insufficient-source', 'flagged-for-review', 'allowance-exhausted', 'allowance-expired', 'not-entitled', 'busy',
    'capacity', 'upload-limit', 'not-eligible', 'session-changed', 'disabled', 'not-found', 'unavailable', 'invalid-request']) {
    const outcome = describeResult({ status, allowance: null })
    assert.equal(outcome.kind, 'problem')
    assert.ok(outcome.title.length > 0 && outcome.message.length > 0, status)
  }
  assert.equal(describeResult({ status: 'signed-out' }).signedOut, true)
  const blocked = describeResult({ status: 'not-entitled' })
  assert.deepEqual([blocked.title, blocked.retry, blocked.tone], ['AI practice is not included in your account', 'none', 'info'])
  // Only a trial grant is called a trial; Early Access copy stays neutral.
  const allowance = source => ({ state: 'expired', source, total: 10, used: 10, endsAt: null })
  assert.match(describeResult({ status: 'allowance-expired', allowance: allowance('trial') }).message, /AI trial has ended/)
  assert.match(describeResult({ status: 'allowance-expired', allowance: allowance('early_access') }).message,
    /AI access has ended/)
  const broken = await generateFromDocument(DOC, harness([{ status: 502, json: 'not an object' }]).deps)
  assert.equal(broken.title, 'Something went wrong')
})
