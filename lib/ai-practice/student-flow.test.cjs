// lib/ai-practice/student-flow.test.cjs — Journey authorization, eligibility, allowance and failure paths.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { executeAiPracticeCommand, isAiPracticeEligible } = require('./student-flow.ts')
const { toPersonalSetView } = require('./stored-set.ts')
const { ProviderError } = require('./provider.ts')
const { createFixtureProvider, fixtureText } = require('./fixtures/fixture-provider.cjs')

const USER = '21111111-1111-4111-8111-111111111111'
const COURSE = '41111111-1111-4111-8111-111111111111'
const DOC = '51111111-1111-4111-8111-111111111111'
const REQUEST = '61111111-1111-4111-8111-111111111111'
const PDF = 'application/pdf'

const offering = () => ({
  department: { id: randomUUID(), label: 'Business Administration', isActive: true },
  academicLevel: { id: randomUUID(), label: '300 Level', isActive: true },
  academicPeriod: { id: randomUUID(), label: 'First Semester', isActive: true },
})
const course = (overrides = {}) => ({ institutionalCourseId: COURSE, code: 'MKT 201', title: 'Principles of Marketing',
  isFree: false, applicability: [offering()], repository: { state: 'unlinked' }, content: { state: 'not-built', reason: 'unlinked' },
  ...overrides })
const builtCourse = () => course({ repository: { state: 'shelved', repositoryCourseId: COURSE, contentKey: 'mkt',
  isShared: false, route: { slug: 'mkt', href: '/courses/mkt', course: {} } },
  content: { state: 'ready', study: { notes: true, cbtPractice: true, theory: false, overview: false } } })
const notes = () => fixtureText('marketing-mix-notes.txt')
const reply = () => JSON.parse(fixtureText('marketing-mix.response.json'))

const LEASE_MS = 120_000

/** In-memory environment that records every side effect for assertions. */
function makeEnv(overrides = {}) {
  const calls = []
  let claims = 0
  const state = {
    document: { id: DOC, institutionalCourseId: COURSE, storagePath: `${USER}/${DOC}`, fileName: 'notes.pdf',
      mediaType: PDF, status: 'awaiting_upload', rejectionReason: null, sourceText: null },
    // Mirrors claim_ai_practice_extraction: one conditional update, so the check and the claim are one step.
    claim: null,
    now: 0,
    generation: null,
    allowance: { state: 'active', source: 'trial', total: 10, used: 2, endsAt: '2026-10-23T00:00:00.000Z' },
  }
  const env = {
    userId: USER,
    readCourse: async () => ({ status: 'ok', course: course() }),
    reserveDocument: async (...args) => { calls.push(['reserve', ...args]); return { status: 'created', documentId: DOC, storagePath: `${USER}/${DOC}` } },
    signUpload: async path => { calls.push(['sign', path]); return `https://storage.test/upload/${path}?token=t` },
    getDocument: async id => id === DOC ? { ...state.document } : null,
    claimExtraction: async () => {
      calls.push(['claim'])
      if (state.document.status !== 'awaiting_upload') return { state: 'settled' }
      if (state.claim && state.claim.until > state.now) return { state: 'busy' }
      state.claim = { id: `claim-${claims += 1}`, until: state.now + LEASE_MS }
      return { state: 'claimed', claimId: state.claim.id }
    },
    releaseExtraction: async (id, claimId) => {
      calls.push(['release', claimId])
      if (state.claim?.id === claimId) state.claim = null
    },
    downloadUpload: async () => new Uint8Array([1, 2, 3]),
    settleDocument: async (id, claimId, result) => {
      calls.push(['settle', result.rejection ?? 'ready'])
      if (state.document.status !== 'awaiting_upload' || state.claim?.id !== claimId) return false
      Object.assign(state.document, 'rejection' in result
        ? { status: 'rejected', rejectionReason: result.rejection } : { status: 'ready', sourceText: result.text })
      state.claim = null
      return true
    },
    removeUpload: async (id, path) => { calls.push(['remove', path]) },
    allowance: async () => state.allowance,
    beginGeneration: async (requestId, documentId) => {
      calls.push(['begin', requestId, documentId])
      state.generation = { id: 'g1', status: 'running', createdAt: '2026-10-16T10:00:00.000Z', questionSet: null }
      return { state: 'started', generationId: 'g1' }
    },
    finishGeneration: async (id, status, reason, set, usage) => {
      calls.push(['finish', status, reason, usage === null ? null : usage.model])
      Object.assign(state.generation, { status, questionSet: set })
      if (status === 'generated') state.allowance = { ...state.allowance, used: state.allowance.used + 1 }
      return true
    },
    getGeneration: async id => state.generation && state.generation.id === id ? { ...state.generation } : null,
    extract: async () => ({ status: 'ok', text: notes() }),
    provider: createFixtureProvider(reply(), { model: 'claude-sonnet-5-5' }),
    timeoutMs: 5000,
    reportProviderProblem: (code, diagnostic) => calls.push(['problem', code, diagnostic]),
    ...overrides,
  }
  return { env, calls, state }
}
const reserve = (overrides = {}) => ({ operation: 'reserve-upload', courseId: COURSE, fileName: 'notes.pdf',
  mediaType: PDF, byteSize: 1000, ...overrides })
const run = (env, command) => executeAiPracticeCommand(env, command)

test('eligibility follows the read model: only honestly unbuilt institutional courses', () => {
  assert.equal(isAiPracticeEligible(course()), true)
  assert.equal(isAiPracticeEligible(builtCourse()), false)
  assert.equal(isAiPracticeEligible(course({ repository: { state: 'unshelved-repository' } })), false)
  assert.equal(isAiPracticeEligible({ ...builtCourse(), content: { state: 'temporarily-unavailable', reason: 'projection-failed' } }), false)
  assert.equal(isAiPracticeEligible({ ...builtCourse(), content: { state: 'no-published-learning', study: {} } }), true)
})

test('eligibility requires one fully active offering, including for an unbuilt course', () => {
  assert.equal(isAiPracticeEligible(course({ applicability: [] })), false)
  const inactive = ['department', 'academicLevel', 'academicPeriod'].map(dimension => {
    const tuple = offering()
    return { ...tuple, [dimension]: { ...tuple[dimension], isActive: false } }
  })
  for (const applicability of [...inactive.map(tuple => [tuple]), inactive]) {
    assert.equal(isAiPracticeEligible(course({ applicability })), false)
  }
  assert.equal(isAiPracticeEligible(course({ applicability: [...inactive, offering()] })), true,
    'a remaining active offering keeps the course eligible')
})

for (const [code, institutionalCourseId] of [
  ['BUA302', '50000000-0000-4000-8000-000000000145'],
  ['BUA325', '50000000-0000-4000-8000-000000000149'],
]) {
  test(`${code} without offerings rejects new AI actions and preserves historical uploads`, async () => {
    const retired = course({ code, institutionalCourseId, applicability: [] })
    for (const [command, document] of [
      [reserve({ courseId: institutionalCourseId }), {}],
      [{ operation: 'process-upload', documentId: DOC }, {}],
      [{ operation: 'process-upload', documentId: DOC }, { status: 'ready', sourceText: notes() }],
      [{ operation: 'generate', documentId: DOC, requestId: REQUEST }, { status: 'ready', sourceText: notes() }],
      [{ operation: 'generate', documentId: DOC, requestId: REQUEST }, {}],
    ]) {
      const { env, state, calls } = makeEnv({ readCourse: async id => {
        assert.equal(id, institutionalCourseId, 'document actions use the stored course identity')
        return { status: 'ok', course: retired }
      } })
      Object.assign(state.document, { institutionalCourseId }, document)
      const history = structuredClone(state)
      assert.deepEqual(await run(env, command), { status: 'not-eligible' }, command.operation)
      assert.deepEqual(calls, [], 'no upload, extraction, deletion or usage write')
      assert.equal(env.provider.calls.length, 0, 'no provider request')
      assert.deepEqual(state, history, 'historical documents, generations and allowance stay unchanged')
    }
  })
}

test('an unbuilt course offered elsewhere retains upload, extraction and generation access', async () => {
  const elsewhere = offering()
  elsewhere.department = { ...elsewhere.department, label: 'Finance', id: '10000000-0000-4000-8000-000000000002' }
  for (const code of ['BUS254', 'BUA302', 'BUA325']) {
    const { env } = makeEnv({ readCourse: async () => ({ status: 'ok', course: course({ code, applicability: [elsewhere] }) }) })
    assert.equal((await run(env, reserve())).status, 'upload-reserved', code)
    assert.equal((await run(env, { operation: 'process-upload', documentId: DOC })).status, 'upload-ready', code)
    assert.equal((await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST })).status, 'generated', code)
  }
})

test('reserving an upload signs the server-derived path only for an eligible course', async () => {
  const { env, calls } = makeEnv()
  assert.deepEqual(await run(env, reserve()), { status: 'upload-reserved', documentId: DOC,
    uploadUrl: `https://storage.test/upload/${USER}/${DOC}?token=t` })
  assert.deepEqual(calls[0], ['reserve', COURSE, 'notes.pdf', PDF, 1000])
  const built = makeEnv({ readCourse: async () => ({ status: 'ok', course: builtCourse() }) })
  assert.deepEqual(await run(built.env, reserve()), { status: 'not-eligible' })
  assert.equal(built.calls.length, 0)
})

test('reservation refuses mismatched extensions, missing courses, limits and spent allowance', async () => {
  assert.deepEqual(await run(makeEnv().env, reserve({ fileName: 'notes.exe.pdf.txt' })), { status: 'invalid-request' })
  assert.deepEqual(await run(makeEnv({ readCourse: async () => ({ status: 'not-found' }) }).env, reserve()), { status: 'not-found' })
  assert.deepEqual(await run(makeEnv({ readCourse: async () => ({ status: 'signed-out' }) }).env, reserve()), { status: 'signed-out' })
  assert.deepEqual(await run(makeEnv({ reserveDocument: async () => ({ status: 'upload-limit' }) }).env, reserve()),
    { status: 'upload-limit' })
  const spent = makeEnv({ allowance: async () => ({ state: 'active', source: 'trial', total: 10, used: 10, endsAt: null }) })
  assert.equal((await run(spent.env, reserve())).status, 'allowance-exhausted')
  assert.equal(spent.calls.length, 0, 'no upload slot is created when nothing could be generated')
  assert.equal((await run(makeEnv({ allowance: async () => ({ state: 'expired', source: 'trial', total: 10, used: 3, endsAt: null }) }).env,
    reserve())).status, 'allowance-expired')
  assert.deepEqual(await run(makeEnv({ signUpload: async () => null }).env, reserve()), { status: 'unavailable' })
})

test('the database refusal wins over a stale allowance display and opens no slot', async () => {
  for (const status of ['not-entitled', 'allowance-exhausted', 'allowance-expired', 'signed-out']) {
    const { env, calls } = makeEnv({ reserveDocument: async () => ({ status }) })
    assert.equal((await run(env, reserve())).status, status)
    assert.ok(!calls.some(call => call[0] === 'sign'), `${status}: no signed upload URL`)
  }
  assert.deepEqual(await run(makeEnv({ reserveDocument: async () => ({ status: 'invalid-course' }) }).env, reserve()),
    { status: 'not-found' })
})

test('without an accepted server-issued grant nothing is reserved, uploaded or generated', async () => {
  const none = { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null }
  const blocked = makeEnv({ allowance: async () => none })
  assert.deepEqual(await run(blocked.env, reserve()), { status: 'not-entitled' })
  assert.equal(blocked.calls.length, 0, 'no upload slot and no signed URL without a grant')
  // The database is authoritative: even if the display read is stale, admission refuses and the provider is not called.
  const provider = createFixtureProvider(reply())
  const { env, calls } = await readyEnv({ provider, beginGeneration: async () => ({ state: 'not-entitled' }) })
  assert.deepEqual(await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST }), { status: 'not-entitled' })
  assert.equal(provider.calls.length, 0)
  assert.ok(!calls.some(call => call[0] === 'finish'), 'no usage is recorded')
})

test('processing extracts, stores normalized text and deletes the raw upload', async () => {
  const { env, calls, state } = makeEnv()
  assert.deepEqual(await run(env, { operation: 'process-upload', documentId: DOC }), { status: 'upload-ready', documentId: DOC })
  assert.deepEqual(calls.map(call => call[0]), ['claim', 'settle', 'remove'])
  assert.ok(state.document.sourceText.startsWith('Principles of Marketing'))
  assert.equal(state.claim, null, 'settling clears the claim')
  assert.deepEqual(await run(env, { operation: 'process-upload', documentId: DOC }), { status: 'upload-ready', documentId: DOC },
    'processing is idempotent')
})

test('processing rejections are recorded, explained and still remove the upload', async () => {
  const cases = [
    [{ downloadUpload: async () => 'missing' }, 'missing-upload'],
    [{ extract: async () => ({ status: 'rejected', reason: 'encrypted' }) }, 'encrypted'],
    [{ extract: async () => ({ status: 'ok', text: 'Too short to use.' }) }, 'too-short'],
    [{ extract: async () => ({ status: 'ok', text: 'word '.repeat(20_000) }) }, 'too-much-text'],
  ]
  for (const [override, reason] of cases) {
    const { env, calls } = makeEnv(override)
    assert.deepEqual(await run(env, { operation: 'process-upload', documentId: DOC }), { status: 'upload-rejected', reason })
    assert.deepEqual(calls.map(call => call[0]), ['claim', 'settle', 'remove'], reason)
  }
  const outage = makeEnv({ downloadUpload: async () => 'error' })
  assert.deepEqual(await run(outage.env, { operation: 'process-upload', documentId: DOC }), { status: 'unavailable' })
  assert.deepEqual(outage.calls, [['claim'], ['release', 'claim-1']],
    'a storage outage never permanently rejects the file, and lets go of its claim for the retry')
  assert.equal(outage.state.claim, null)
  const saturated = makeEnv({ extract: async () => ({ status: 'unavailable' }) })
  assert.deepEqual(await run(saturated.env, { operation: 'process-upload', documentId: DOC }), { status: 'unavailable' })
  assert.deepEqual(saturated.calls, [['claim'], ['release', 'claim-1']],
    'a busy or missing parser never judges the file; the upload stays for the retry')
  assert.equal(saturated.state.document.status, 'awaiting_upload')
})

test('eight concurrent process requests launch exactly one extraction', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let extractions = 0
  const { env, state } = makeEnv({ extract: async () => { extractions += 1; await gate; return { status: 'ok', text: notes() } } })
  const results = Array.from({ length: 8 }, () => run(env, { operation: 'process-upload', documentId: DOC }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(extractions, 1, 'only the claim holder extracts')
  release()
  const statuses = (await Promise.all(results)).map(result => result.status)
  assert.equal(extractions, 1)
  assert.deepEqual(statuses.filter(status => status === 'upload-ready').length, 1)
  assert.deepEqual(statuses.filter(status => status === 'busy').length, 7, 'competing callers are told it is busy')
  assert.equal(state.document.status, 'ready')
})

test('a crashed extraction is recovered once its lease expires, and the stale holder cannot settle', async () => {
  const { env, state, calls } = makeEnv()
  // A previous request claimed the upload and died without settling or releasing.
  state.claim = { id: 'claim-crashed', until: LEASE_MS }
  assert.deepEqual(await run(env, { operation: 'process-upload', documentId: DOC }), { status: 'busy' })
  assert.ok(!calls.some(call => call[0] === 'settle'), 'nothing is extracted while the lease is live')
  state.now = LEASE_MS
  assert.deepEqual(await run(env, { operation: 'process-upload', documentId: DOC }), { status: 'upload-ready', documentId: DOC })
  assert.equal(await env.settleDocument(DOC, 'claim-crashed', { rejection: 'corrupt' }), false,
    'the crashed holder lost its claim to the takeover')
})

test('an unexpected extraction error releases the claim instead of stranding it', async () => {
  const { env, state, calls } = makeEnv({ extract: async () => { throw new Error('boom') } })
  await assert.rejects(run(env, { operation: 'process-upload', documentId: DOC }), /boom/)
  assert.deepEqual(calls.at(-1), ['release', 'claim-1'])
  assert.equal(state.claim, null)
})

test('a claim refused by the database stops before any download', async () => {
  for (const [claim, status] of [[{ state: 'signed-out' }, 'signed-out'], [{ state: 'not-found' }, 'not-found'], [null, 'unavailable']]) {
    let downloads = 0
    const { env } = makeEnv({ claimExtraction: async () => claim, downloadUpload: async () => { downloads += 1; return new Uint8Array([1]) } })
    assert.deepEqual(await run(env, { operation: 'process-upload', documentId: DOC }), { status })
    assert.equal(downloads, 0, status)
  }
})

test('another student document is invisible', async () => {
  const { env, calls } = makeEnv({ getDocument: async () => null })
  for (const command of [{ operation: 'process-upload', documentId: DOC },
    { operation: 'generate', documentId: DOC, requestId: REQUEST }]) {
    assert.deepEqual(await run(env, command), { status: 'not-found' })
  }
  assert.equal(calls.length, 0)
})

async function readyEnv(overrides) {
  const made = makeEnv(overrides)
  await run(made.env, { operation: 'process-upload', documentId: DOC })
  made.calls.length = 0
  return made
}

test('a successful generation is accounted, stored and returned as a personal set', async () => {
  const { env, calls, state } = await readyEnv()
  const result = await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST })
  assert.equal(result.status, 'generated')
  assert.equal(result.set.questions.length, 5)
  assert.ok(result.set.questions.every(question => question.sourceQuote.length > 0))
  assert.deepEqual(calls, [['begin', REQUEST, DOC], ['finish', 'generated', null, 'claude-sonnet-5-5']])
  assert.equal(state.generation.questionSet.verification, 'unverified')
  assert.equal(state.generation.questionSet.visibility, 'personal')
  assert.equal(result.allowance.used, 3)
})

test('failed, thin or flagged generations release the reservation and say so', async () => {
  const cases = [
    [createFixtureProvider(null, { error: new ProviderError('timeout') }), 'generation-failed', 'failed', 'timeout'],
    [createFixtureProvider({ ...reply(), assessment: { ...reply().assessment, confidence: 'low' } }),
      'insufficient-source', 'insufficient_source', 'low-confidence'],
    [createFixtureProvider(null, { kind: 'refused' }), 'flagged-for-review', 'flagged_for_review', 'provider-refusal'],
    [createFixtureProvider('not json'), 'generation-failed', 'failed', 'invalid-output'],
  ]
  for (const [provider, status, stored, reason] of cases) {
    const { env, calls, state } = await readyEnv({ provider })
    const result = await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST })
    assert.equal(result.status, status)
    assert.equal(calls.at(-1)[1], stored)
    assert.equal(calls.at(-1)[2], reason)
    assert.equal(state.allowance.used, 2, `${status} consumes nothing`)
  }
})

test('provider failures are reported privately to operators without reaching the student', async () => {
  const diagnostic = { httpStatus: 401, errorType: 'authentication_error', requestId: 'req_011CPrivate', transportCode: null }
  for (const code of ['authentication', 'permission', 'billing', 'unsupported-model', 'transport', 'internal']) {
    const { env, calls } = await readyEnv({ provider: createFixtureProvider(null, { error: new ProviderError(code, diagnostic) }) })
    const result = await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST })
    assert.equal(result.status, 'generation-failed')
    assert.deepEqual(calls.find(call => call[0] === 'problem'), ['problem', code, diagnostic])
    const visible = JSON.stringify(result)
    assert.ok(!visible.includes(code) && !visible.includes('req_011CPrivate') && !visible.includes('authentication_error'))
    assert.ok(!calls.some(call => call[0] === 'finish' && JSON.stringify(call).includes('req_011CPrivate')),
      'diagnostics are not stored in student-readable rows')
  }
})

test('admission refusals pass through without calling the provider', async () => {
  for (const state of ['busy', 'capacity', 'not-entitled', 'allowance-exhausted', 'allowance-expired', 'signed-out']) {
    const provider = createFixtureProvider(reply())
    const { env } = await readyEnv({ provider, beginGeneration: async () => ({ state }) })
    assert.equal((await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST })).status, state)
    assert.equal(provider.calls.length, 0)
  }
  const { env } = await readyEnv({ provider: null })
  assert.deepEqual(await run(env, { operation: 'generate', documentId: DOC, requestId: REQUEST }), { status: 'unavailable' })
})

test('a replayed request returns the recorded result without generating again', async () => {
  const provider = createFixtureProvider(reply())
  const made = await readyEnv({ provider })
  await run(made.env, { operation: 'generate', documentId: DOC, requestId: REQUEST })
  made.env.beginGeneration = async () => ({ state: 'existing', generationId: 'g1' })
  const replay = await run(made.env, { operation: 'generate', documentId: DOC, requestId: REQUEST })
  assert.equal(replay.status, 'generated')
  assert.equal(provider.calls.length, 1)
  assert.equal(replay.allowance.used, 3, 'the replay is not charged again')
  assert.ok(!made.calls.slice(2).some(call => call[0] === 'finish'), 'a replay records nothing')
})

test('replaying a request whose generation was closed as abandoned reports a failure, not busy', async () => {
  const provider = createFixtureProvider(reply())
  const made = await readyEnv({ provider, beginGeneration: async () => ({ state: 'existing', generationId: 'g1' }) })
  made.state.generation = { id: 'g1', status: 'failed', createdAt: '2026-10-16T10:00:00.000Z', questionSet: null }
  const replay = await run(made.env, { operation: 'generate', documentId: DOC, requestId: REQUEST })
  assert.equal(replay.status, 'generation-failed')
  assert.equal(provider.calls.length, 0)
})

test('a course that gains verified content stops offering AI generation', async () => {
  const made = await readyEnv()
  made.env.readCourse = async () => ({ status: 'ok', course: builtCourse() })
  assert.deepEqual(await run(made.env, { operation: 'generate', documentId: DOC, requestId: REQUEST }), { status: 'not-eligible' })
})

test('stored sets are re-validated on read; tampered labels are never shown', () => {
  const stored = { formatVersion: 1, origin: 'ai-generated', visibility: 'personal', verification: 'unverified',
    source: { fileName: 'a.pdf' }, questions: [{ id: `ai_${'a'.repeat(24)}`, prompt: 'Q?', options: ['A', 'B', 'C', 'D'],
      correctOption: 1, explanation: 'E', section: 'S', grounding: { documentId: DOC, sourceSha256: 'b'.repeat(64),
        passageId: 'P1', passageStart: 0, passageEnd: 10, quote: 'quoted text' } }] }
  assert.equal(toPersonalSetView('g', 't', stored).questions[0].sourceQuote, 'quoted text')
  assert.equal(toPersonalSetView('g', 't', { ...stored, verification: 'verified' }), null)
  assert.equal(toPersonalSetView('g', 't', { ...stored, questions: [] }), null)
  assert.equal(toPersonalSetView('g', 't', null), null)
})
