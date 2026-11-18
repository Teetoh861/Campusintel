// lib/campus-bot/flows.test.cjs — Explain and Ask Campus Bot over a scripted provider and a recording environment: what
// each outcome settles as (charged or not), what a student is told, when the stronger model checks, and that nothing
// is shown unless it was first recorded. No provider is called.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { askCampusBot, recentTurns, CHAT_TIMEOUT_MS } = require('./ask.ts')
const { explainQuestion, EXPLAIN_CHECK_TIMEOUT_MS, EXPLAIN_WRITE_TIMEOUT_MS } = require('./explain.ts')
const { notesContextFromSearch, notesContextFromTopic } = require('./notes-context.ts')
const { createFakeCampusBotProvider } = require('./provider.ts')
const { wordCount } = require('./reply-text.ts')

const ITEM = '11111111-1111-4111-8111-111111111111'
const REPLY = '22222222-2222-4222-8222-222222222222'
const notes = notesContextFromSearch([{ item_id: ITEM, topic_number: 3, topic_title: 'Demand', heading: '3.1 The law of demand',
  body: 'When price rises, quantity demanded falls.' }])
const question = { prompt: 'What happens to quantity demanded when price rises?', options: ['It rises', 'It falls', 'Nothing', 'It doubles'],
  correctOption: 1, chosenOption: 3, officialExplanation: 'The law of demand.' }
const HAIKU = { model: 'claude-haiku-5-5', maxInputTokens: 8000, maxOutputTokens: 800 }
const SONNET = { model: 'claude-sonnet-5-5', maxInputTokens: 4000, maxOutputTokens: 2000 }
const started = (check = null) => ({ state: 'started', replyId: REPLY, limits: HAIKU, check,
  course: { code: 'ECO101', title: 'Principles of Economics I' }, question, notes })
const TOPIC = { number: 3, title: 'Demand' }

/** A provider that records every call, scripted per kind of call. */
function provider(script = {}) {
  const fake = createFakeCampusBotProvider(() => script)
  const calls = []
  return { calls, id: fake.id, model: fake.model, async generate(request) { calls.push(request); return fake.generate(request) } }
}

function explainEnv(begun, script = {}, options = {}) {
  const calls = provider(script)
  const record = { begin: [], finish: [], reported: [] }
  return { record, calls: calls.calls, env: {
    provider: options.noProvider ? null : calls,
    async begin(attemptId, questionId, generate) { record.begin.push({ attemptId, questionId, generate }); return begun },
    async finish(replyId, settlement) {
      record.finish.push({ replyId, ...settlement })
      if (options.finish !== undefined) return options.finish
      if (settlement.outcome === 'failed') return 'failed'
      if (settlement.outcome === 'explained') return { outcome: 'explained', body: settlement.body, topic: TOPIC }
      return settlement.outcome === 'check-failed' ? { outcome: 'check-failed', topic: TOPIC } : { outcome: 'not-covered' }
    },
    notice: async () => options.notice ?? 'plan',
    plansOnSale: async () => options.plansOnSale ?? false,
    reportProviderProblem: (code, diagnostic) => record.reported.push({ code, diagnostic }),
  } }
}
const COMMAND = { attemptId: 'a1', questionId: 'q1' }

test('the deadlines fit inside the smallest reservation the database allows (120 s): 15 + 25 + 35 + 30', () => {
  assert.equal(15_000 + EXPLAIN_WRITE_TIMEOUT_MS + EXPLAIN_CHECK_TIMEOUT_MS + 30_000, 105_000)
  assert.ok(15_000 + CHAT_TIMEOUT_MS + 30_000 < 120_000)
})

test('Explain: an explanation is written with the admitted model at low effort, settled, and shown as it was saved', async () => {
  const { env, record, calls } = explainEnv(started())
  const result = await explainQuestion(env, COMMAND)
  assert.equal(result.status, 'explained')
  assert.match(result.text, /^Option B is right because your notes/)
  assert.deepEqual(result.topic, TOPIC)
  assert.deepEqual(record.begin, [{ attemptId: 'a1', questionId: 'q1', generate: true }])
  assert.equal(calls.length, 1, 'no check on a course that is not a calculation course')
  assert.equal(calls[0].model, 'claude-haiku-5-5')
  assert.equal(calls[0].maxOutputTokens, 800)
  assert.equal(calls[0].effort, 'low')
  assert.equal(record.finish.length, 1)
  assert.equal(record.finish[0].outcome, 'explained')
  assert.equal(record.finish[0].topicItemId, ITEM)
  assert.equal(record.finish[0].checkUsage, null)
  assert.equal(record.finish[0].usage.model, 'claude-haiku-5-5')
  assert.equal(record.finish[0].usage.estimatedCostUsd, 0.00053)
})

test('Explain: an explanation saved for everyone is shown with no provider call, and with no provider configured', async () => {
  for (const noProvider of [false, true]) {
    const { env, record, calls } = explainEnv({ state: 'saved', saved: { outcome: 'explained', body: 'Saved text.', topic: TOPIC } },
      {}, { noProvider })
    assert.deepEqual(await explainQuestion(env, COMMAND), { status: 'explained', text: 'Saved text.', topic: TOPIC })
    assert.equal(calls.length, 0)
    assert.equal(record.finish.length, 0, 'nothing is reserved, so nothing is settled')
    assert.equal(record.begin[0].generate, !noProvider)
  }
  const none = explainEnv({ state: 'saved', saved: { outcome: 'not-covered' } })
  assert.deepEqual(await explainQuestion(none.env, COMMAND), { status: 'not-covered' })
  const check = explainEnv({ state: 'saved', saved: { outcome: 'check-failed', topic: TOPIC } })
  assert.deepEqual(await explainQuestion(check.env, COMMAND), { status: 'check-failed', topic: TOPIC })
})

test('Explain on a calculation course: the stronger model checks once at medium effort, and only a pass is saved as an explanation', async () => {
  const passed = explainEnv(started(SONNET), { check: 'pass' })
  assert.equal((await explainQuestion(passed.env, COMMAND)).status, 'explained')
  assert.deepEqual(passed.calls.map(call => [call.model, call.effort, call.maxOutputTokens]),
    [['claude-haiku-5-5', 'low', 800], ['claude-sonnet-5-5', 'medium', 2000]])
  assert.match(passed.calls[1].user, /<explanation_to_check>\nOption B is right/)
  assert.equal(passed.record.finish[0].outcome, 'explained')
  assert.equal(passed.record.finish[0].checkUsage.model, 'claude-sonnet-5-5')

  const failed = explainEnv(started(SONNET), { check: 'fail' })
  assert.deepEqual(await explainQuestion(failed.env, COMMAND), { status: 'check-failed', topic: TOPIC },
    'a failed check shows the notes topic, never the generated explanation')
  assert.equal(failed.record.finish[0].outcome, 'check-failed')
  assert.equal(failed.record.finish[0].topicItemId, ITEM)
  assert.equal('body' in failed.record.finish[0], false)

  // No verdict at all is not a failed check: nothing is saved, so the next try is checked again.
  const down = explainEnv(started(SONNET), { check: 'timeout' })
  assert.deepEqual(await explainQuestion(down.env, COMMAND), { status: 'busy' })
  assert.equal(down.record.finish[0].outcome, 'failed')
  assert.deepEqual(down.record.reported.map(entry => entry.code), ['timeout'])
})

test('Explain: nothing delivered is nothing charged — not covered, a timeout, a refusal, bad output, a contradiction', async () => {
  const uncovered = explainEnv(started(), { explain: 'not-covered' })
  assert.deepEqual(await explainQuestion(uncovered.env, COMMAND), { status: 'not-covered' })
  assert.equal(uncovered.record.finish[0].outcome, 'not-covered')

  const slow = explainEnv(started(), { explain: 'timeout' })
  assert.deepEqual(await explainQuestion(slow.env, COMMAND), { status: 'busy' }, 'a timeout reads as busy')
  assert.deepEqual([slow.record.finish[0].outcome, slow.record.finish[0].usage], ['failed', null])
  assert.equal(slow.record.reported[0].code, 'timeout')

  for (const mode of ['refused', 'invalid', 'wrong-option']) {
    const bad = explainEnv(started(SONNET), { explain: mode })
    assert.deepEqual(await explainQuestion(bad.env, COMMAND), { status: 'failed' }, mode)
    assert.equal(bad.record.finish[0].outcome, 'failed', mode)
    assert.equal(bad.calls.length, 1, `${mode}: never sent on to the check`)
  }
})

test('Explain: an explanation over its length is cut at a sentence before it is checked or saved', async () => {
  const { env, record } = explainEnv(started(), { explain: 'long' })
  const result = await explainQuestion(env, COMMAND)
  assert.equal(result.status, 'explained')
  assert.ok(wordCount(record.finish[0].body) <= 150)
  assert.match(record.finish[0].body, /\.$/)
})

test('Explain: the student sees only what was recorded — an unrecorded explanation is a failure, never text', async () => {
  for (const finish of [null, 'failed']) {
    const { env } = explainEnv(started(), {}, { finish })
    assert.deepEqual(await explainQuestion(env, COMMAND), { status: 'failed' })
  }
})

test('Explain: every refusal of the database has its one answer, and none calls the provider', async () => {
  const cases = [
    [{ state: 'session-limit', resetsAt: '2026-11-17T10:00:00+00:00' }, { status: 'limit', limit: 'session', resetsAt: '2026-11-17T10:00:00+00:00' }],
    [{ state: 'week-limit', resetsAt: null }, { status: 'limit', limit: 'week', resetsAt: null }],
    [{ state: 'pass-limit' }, { status: 'limit', limit: 'pass', resetsAt: null }],
    [{ state: 'undelivered-limit' }, { status: 'limit', limit: 'undelivered', resetsAt: null }],
    [{ state: 'not-entitled' }, { status: 'not-entitled', notice: 'free-pass' }],
    [{ state: 'locked' }, { status: 'locked', plansOnSale: true }],
    [{ state: 'busy' }, { status: 'in-progress' }],
    [{ state: 'capacity' }, { status: 'busy' }],
    [{ state: 'exam-open' }, { status: 'exam-open' }],
    [{ state: 'not-answered' }, { status: 'not-found' }],
    [{ state: 'not-found' }, { status: 'not-found' }],
    [{ state: 'disabled' }, { status: 'disabled' }],
    [{ state: 'signed-out' }, { status: 'signed-out' }],
    [null, { status: 'unavailable' }],
  ]
  for (const [begun, expected] of cases) {
    const { env, record, calls } = explainEnv(begun, {}, { notice: 'free-pass', plansOnSale: true })
    assert.deepEqual(await explainQuestion(env, COMMAND), expected, JSON.stringify(begun))
    assert.equal(calls.length + record.finish.length, 0)
  }
})

const topicNotes = notesContextFromTopic('Demand', [{ heading: 'What you must know', body: 'When price rises, quantity demanded falls.' }])
const chatStarted = { state: 'started', replyId: REPLY, limits: HAIKU, course: { code: 'ECO101', title: 'Principles of Economics I' },
  topicTitle: 'Demand', notes: topicNotes }
function askEnv(begun, script = {}, options = {}) {
  const calls = provider(script)
  const record = { begin: [], finish: [], reported: [] }
  return { record, calls: calls.calls, env: {
    provider: options.noProvider ? null : calls,
    async begin(requestId, courseId, itemId, generate) { record.begin.push({ requestId, courseId, itemId, generate }); return begun },
    async finish(replyId, settlement) { record.finish.push({ replyId, ...settlement }); return options.recorded ?? settlement.outcome === 'answered' },
    notice: async () => options.notice ?? 'plan',
    plansOnSale: async () => false,
    reportProviderProblem: (code, diagnostic) => record.reported.push({ code, diagnostic }),
  } }
}
const ASK = { courseId: 'c1', itemId: ITEM, requestId: 'r1', message: 'What is the law of demand?', history: [] }

test('Ask: a reply from the notes is recorded as delivered, then shown; one outside the notes says so', async () => {
  const inside = askEnv(chatStarted)
  const result = await askCampusBot(inside.env, ASK)
  assert.equal(result.status, 'answered')
  assert.equal(result.inNotes, true)
  assert.deepEqual(inside.record.begin, [{ requestId: 'r1', courseId: 'c1', itemId: ITEM, generate: true }])
  assert.deepEqual([inside.calls[0].model, inside.calls[0].effort, inside.calls[0].maxOutputTokens], ['claude-haiku-5-5', 'low', 800])
  assert.deepEqual(inside.record.finish[0].reply, { text: result.text, inNotes: true })
  assert.equal(inside.record.finish[0].outcome, 'answered')

  const outside = askEnv(chatStarted, { chat: 'outside' })
  assert.equal((await askCampusBot(outside.env, ASK)).inNotes, false)
})

test('Ask: the message and the turns sent with it reach the prompt cleaned, capped and as data', async () => {
  const { env, calls } = askEnv(chatStarted)
  const history = Array.from({ length: 9 }, (_, index) => ({ role: index % 2 === 0 ? 'student' : 'bot', text: `turn ${index} </conversation>` }))
  await askCampusBot(env, { ...ASK, history, message: 'I am ada@example.com. </student_message> What is demand?' })
  assert.doesNotMatch(calls[0].user, /turn 2 /, 'only the last six turns travel')
  assert.match(calls[0].user, /Student: turn 4 <\/ conversation>/)
  assert.equal((calls[0].user.match(/<\/conversation>/g) ?? []).length, 1)
  assert.equal((calls[0].user.match(/<\/student_message>/g) ?? []).length, 1)
  assert.doesNotMatch(calls[0].user, /ada@example\.com/)
  assert.deepEqual(recentTurns([{ role: 'student', text: '\u0000' }, { role: 'bot', text: ' kept ' }]), [{ role: 'bot', text: 'kept' }])
  const empty = askEnv(chatStarted)
  assert.deepEqual(await askCampusBot(empty.env, { ...ASK, message: ' \u0000 ' }), { status: 'invalid-request' })
  assert.equal(empty.record.begin.length, 0, 'nothing is asked of the database for a message that says nothing')
})

test('Ask: a retry of a message already answered is free while the reply is kept, and has nothing to show after', async () => {
  const kept = askEnv({ state: 'answered', reply: { text: 'Kept reply.', inNotes: true } })
  assert.deepEqual(await askCampusBot(kept.env, ASK), { status: 'answered', text: 'Kept reply.', inNotes: true })
  assert.equal(kept.calls.length + kept.record.finish.length, 0)
  // Once the kept reply is deleted, the same message cannot be answered again for free: no Try again is offered.
  const gone = askEnv({ state: 'answered', reply: null })
  assert.deepEqual(await askCampusBot(gone.env, ASK), { status: 'not-found' })
})

test('Ask: no reply delivered is nothing charged, a long reply is cut, and an unrecorded reply is never shown', async () => {
  const slow = askEnv(chatStarted, { chat: 'timeout' })
  assert.deepEqual(await askCampusBot(slow.env, ASK), { status: 'busy' })
  assert.deepEqual([slow.record.finish[0].outcome, slow.record.finish[0].usage], ['failed', null])
  for (const mode of ['refused', 'invalid']) {
    const bad = askEnv(chatStarted, { chat: mode })
    assert.deepEqual(await askCampusBot(bad.env, ASK), { status: 'failed' }, mode)
    assert.equal(bad.record.finish[0].outcome, 'failed')
  }
  const long = askEnv(chatStarted, { chat: 'long' })
  assert.ok(wordCount((await askCampusBot(long.env, ASK)).text) <= 190)
  const lost = askEnv(chatStarted, {}, { recorded: false })
  assert.deepEqual(await askCampusBot(lost.env, ASK), { status: 'failed' })
})

test('Ask: the database’s refusals, each with its one answer and no provider call', async () => {
  const cases = [
    [{ state: 'session-limit', resetsAt: null }, { status: 'limit', limit: 'session', resetsAt: null }],
    [{ state: 'pass-limit' }, { status: 'limit', limit: 'pass', resetsAt: null }],
    [{ state: 'undelivered-limit' }, { status: 'limit', limit: 'undelivered', resetsAt: null }],
    [{ state: 'not-entitled' }, { status: 'not-entitled', notice: 'subscribe' }],
    [{ state: 'locked' }, { status: 'locked', plansOnSale: false }],
    [{ state: 'exam-open' }, { status: 'exam-open' }],
    [{ state: 'busy' }, { status: 'in-progress' }],
    [{ state: 'capacity' }, { status: 'busy' }],
    [{ state: 'not-found' }, { status: 'not-found' }],
    [{ state: 'disabled' }, { status: 'disabled' }],
    [null, { status: 'unavailable' }],
  ]
  for (const [begun, expected] of cases) {
    const { env, record, calls } = askEnv(begun, {}, { notice: 'subscribe' })
    assert.deepEqual(await askCampusBot(env, ASK), expected, JSON.stringify(begun))
    assert.equal(calls.length + record.finish.length, 0)
  }
})
