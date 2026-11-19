// app/courses/ai-practice/[courseId]/journey.test.cjs — Browser sequence: checks, direct upload, progress and messages.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { checkFile, createGenerationRequests, describeResult, generateFromDocument, runUploadJourney } = require('./journey.ts')
const { AUTH_CONTINUITY_HEADER } = require('../../../../lib/auth/constants.ts')
const { entitlementSummarySchema } = require('../../../../lib/entitlements/contract.ts')
const { trialWording } = require('../../../../lib/entitlements/presentation.ts')

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
    requests: createGenerationRequests(sequence()), onPhase: phase => phases.push(phase), trial: trialWording(null) } }
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
  assert.equal((await runUploadJourney(file(), harness([{ ...reserved }, { status: 500 }]).deps)).title, 'Upload failed.')
  assert.equal((await runUploadJourney(file(), harness([{ ...reserved }, new Error('offline')]).deps)).title, 'Upload failed.')
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
  assert.deepEqual([outcome.title, outcome.message], ['We couldn’t create your questions.', 'Try again.'],
    'the title says what happened; the line under it only what to do')
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
  assert.equal((await generateFromDocument(DOC, deps)).title, 'Still preparing your questions.')
  assert.equal((await generateFromDocument(DOC, deps)).title, 'Still preparing your questions.')
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
    // A title that says it all has no second line: where Campus Bot opens, a course with its own materials, and a
    // changed sign-in (the page loads again, as it does when signed out).
    const oneLine = ['not-entitled', 'not-eligible', 'session-changed'].includes(status)
    assert.ok(outcome.title.length > 0, status)
    assert.equal(outcome.message.length > 0, !oneLine, `${status}: ${outcome.message}`)
  }
  assert.equal(describeResult({ status: 'session-changed', allowance: null }).signedOut, true)
  assert.equal(describeResult({ status: 'signed-out' }).signedOut, true)
  const blocked = describeResult({ status: 'not-entitled' })
  assert.deepEqual([blocked.title, blocked.message, blocked.retry, blocked.tone],
    ['Campus Bot is included with a plan.', '', 'none', 'info'], 'one line, and never the internal name')
  // Each message that used to say it twice keeps its title and adds only what is new.
  const said = (status, extra = {}) => { const { title, message } = describeResult({ status, allowance: null, ...extra }); return [title, message] }
  assert.deepEqual(said('flagged-for-review'), ['We couldn’t use this file.', 'Upload clear study notes for this course.'])
  assert.deepEqual(said('allowance-exhausted'), ['You’ve used your Campus Bot allowance.', 'Your course materials stay available.'])
  assert.deepEqual(said('upload-limit'), ['Daily upload limit reached.', 'Try again tomorrow.'])
  assert.deepEqual(said('pass-upload-limit'), ['Free pass uploads used.', ''])
  assert.deepEqual(said('capacity'), ['Campus Bot is busy.', 'Try again in a few minutes.'])
  assert.deepEqual(said('not-found'), ['We couldn’t find your file.', 'Choose it again.'])
  assert.deepEqual(said('upload-rejected', { reason: 'empty' })[0], 'We couldn’t use this file.')
  // A course with its own study materials: one line, and a link to that course when the page knows it.
  assert.deepEqual(said('not-eligible'), ['This course has study materials.', ''])
  assert.equal(describeResult({ status: 'not-eligible' }).link, undefined)
  assert.deepEqual(describeResult({ status: 'not-eligible' }, undefined, false, '/courses/business-statistics').link,
    { label: 'Go to course', href: '/courses/business-statistics' })
  // Regression F4: a trial grant is named by the policy the student's own grant was issued under, from the plan
  // summary, never by whether the database could issue a Discovery Pass. A historical seven-day trial stays a free
  // trial on a database from before the pass and on one that offers it; a pass is offered only to an account that
  // can still start one; without policy data the wording is neutral.
  const allowance = source => ({ state: 'expired', source, total: 10, used: 10, endsAt: null })
  const summary = { now: '2026-10-22T12:00:00+00:00', planned_launch_at: '2026-10-25T00:00:00+00:00', actual_launch_at: null,
    expiry_notice_hours: 24, tier: 'free', access: null,
    trial: { status: 'ended', starts_at: '2026-10-10T12:00:00+00:00', ends_at: '2026-10-17T12:00:00+00:00', available_from: null },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null } }
  const pre = { ...summary, trial_days: 7 }
  const post = { ...summary, trial_hours: 72, discovery: { cbt_questions: 50, ai_sets: 1, previews: [] } }
  const expired = describe => describeResult({ status: 'allowance-expired', allowance: allowance('trial') }, describe).message
  const notEntitled = (...args) => describeResult({ status: 'not-entitled' }, ...args).title
  for (const [label, wire] of [['pre-migration', pre], ['post-migration', post]]) {
    for (const status of ['ended', 'active']) {
      const sevenDay = trialWording(entitlementSummarySchema.parse({ ...wire, trial: { ...wire.trial, status,
        ...(wire === post ? { policy: 'seven-day' } : {}) } }))
      assert.deepEqual(sevenDay, { policy: 'seven-day', passAvailable: false }, `${label} ${status}: a seven-day grant`)
      assert.match(expired(sevenDay), /free trial has ended/, `${label} ${status}`)
      assert.doesNotMatch(expired(sevenDay), /Discovery/, `${label} ${status}: a seven-day trial is never a Discovery Pass`)
      assert.doesNotMatch(notEntitled(sevenDay), /Discovery|pass/i,
        `${label} ${status}: an account that had its trial is not offered a pass`)
    }
  }
  const pass = trialWording(entitlementSummarySchema.parse({ ...post, trial: { ...post.trial, status: 'active', policy: 'discovery' } }))
  assert.deepEqual(pass, { policy: 'discovery', passAvailable: false })
  assert.match(expired(pass), /Your free pass has ended/)
  const offered = trialWording(entitlementSummarySchema.parse({ ...post, trial: { status: 'available', policy: null,
    starts_at: null, ends_at: null, available_from: null } }))
  assert.deepEqual(offered, { policy: null, passAvailable: false }, 'not eligible until the server has read eligibility')
  const eligible = trialWording({ ...entitlementSummarySchema.parse({ ...post, trial: { status: 'available', policy: null,
    starts_at: null, ends_at: null, available_from: null } }), discovery_eligible: true })
  assert.deepEqual(eligible, { policy: null, passAvailable: true }, 'an eligible student can start a pass')
  assert.equal(notEntitled(eligible), 'Campus Bot opens with a free pass.')
  assert.deepEqual(describeResult({ status: 'not-entitled' }, eligible).link, { label: 'Get your free pass', href: '/access' },
    'the button names the pass the message offers')
  assert.deepEqual(describeResult({ status: 'not-entitled' }, eligible, true).link, { label: 'Plan & Access', href: '/access' },
    'once plans are on sale the message offers no pass')
  assert.deepEqual(describeResult({ status: 'not-entitled' }, offered).link, { label: 'Plan & Access', href: '/access' })
  assert.doesNotMatch(expired(pass), /Discovery/, 'the pass is called a free pass')
  assert.doesNotMatch(notEntitled(offered), /Discovery|pass/i, 'an ineligible student is not offered one')
  const neutral = trialWording(null)
  assert.deepEqual(neutral, { policy: null, passAvailable: false }, 'no plan summary: neutral')
  assert.match(expired(neutral), /Your trial access has ended/, 'without policy data the grant is named neutrally')
  assert.doesNotMatch(notEntitled(neutral), /Discovery|pass/i)
  assert.doesNotMatch(notEntitled(), /Discovery|pass/i, 'the default is the neutral wording')
  assert.match(describeResult({ status: 'allowance-expired', allowance: allowance('early_access') }, pass).message,
    /Campus Bot access has ended/, 'a free month that ended is named neutrally')
  // The copy switch: once plans are on sale, a student without access is pointed to a plan, pass or not.
  for (const wording of [eligible, offered, neutral]) {
    assert.equal(notEntitled(wording, true), 'Campus Bot is included when you subscribe.')
  }
  // No wording, on sale or not, uses our internal name for the free month.
  for (const wording of [eligible, offered, neutral]) {
    assert.doesNotMatch(notEntitled(wording) + notEntitled(wording, true), /Early Access/)
  }
  const broken = await generateFromDocument(DOC, harness([{ status: 502, json: 'not an object' }]).deps)
  assert.equal(broken.title, 'Campus Bot couldn’t prepare your questions.')
})

test('Campus Bot limits replace the generic allowance message: session, week and undelivered, with reset times', () => {
  // What has run out, then when it comes back.
  const session = describeResult({ status: 'campus-bot-limit', limit: 'session', resetsAt: '2026-11-03T14:30:00+01:00' })
  assert.deepEqual([session.title, session.message, session.retry, session.tone],
    ['You’ve used up Campus Bot for now.', 'It resets at 14:30.', 'none', 'info'])
  const week = describeResult({ status: 'campus-bot-limit', limit: 'week', resetsAt: '2026-11-09T00:00:00+01:00' })
  assert.deepEqual([week.title, week.message], ['You’ve used up Campus Bot for this week.', 'It resets Monday at 00:00.'])
  const undelivered = describeResult({ status: 'campus-bot-limit', limit: 'undelivered', resetsAt: null })
  assert.deepEqual([undelivered.title, undelivered.message],
    ['Campus Bot limit reached.', 'Campus Bot couldn’t finish your last few sets. Try again tomorrow.'])
  for (const outcome of [session, week, undelivered]) {
    assert.doesNotMatch(outcome.title + outcome.message, /allowance|token|\d+ sets?|this session/i)
  }
  // Without a reset time there is no second line: no invented time.
  const unknown = describeResult({ status: 'campus-bot-limit', limit: 'session', resetsAt: null })
  assert.deepEqual([unknown.title, unknown.message], ['You’ve used up Campus Bot for now.', ''])
})
