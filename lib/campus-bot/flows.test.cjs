// lib/campus-bot/flows.test.cjs — Explain and Ask Campus Bot over a scripted provider and a recording environment: what
// each outcome settles as (charged or not), what a student is told, when the stronger model checks, and that nothing
// is shown unless it was first recorded. No provider is called.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { askCampusBot, checkPending, readChatReply, recentTurns, CHAT_TIMEOUT_MS } = require('./ask.ts')
const { explainQuestion, readExplanation, EXPLAIN_CHECK_TIMEOUT_MS, EXPLAIN_WRITE_TIMEOUT_MS } = require('./explain.ts')
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
  assert.deepEqual(inside.record.finish[0].reply, { text: result.text, inNotes: true, verdict: 'none', check: result.check,
    memoryTrick: null })
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
  const keptReply = { text: 'The answer is Sample.', inNotes: true, verdict: 'not-quite', check: 'And for a population?',
    memoryTrick: 'Statistic goes with Sample, Parameter goes with Population.' }
  const kept = askEnv({ state: 'answered', reply: keptReply })
  assert.deepEqual(await askCampusBot(kept.env, ASK), { status: 'answered', ...keptReply },
    'the same reply as before, with its badge, memory trick and check question')
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

// The server's guards on a marked reply (task B1-B4): each is deterministic, whatever the model wrote.
const QUICK = [{ role: 'student', text: 'Ask me a quick question.' },
  { role: 'bot', text: 'A statistic describes a sample.', check: 'What does a parameter describe?' }]
const modelReply = fields => ({ verdict: 'none', inNotes: true, reply: 'Your notes say so.', memoryTrick: '', check: '',
  checkAnswer: '', ...fields })
/** An environment whose provider answers with exactly this JSON. */
function askWith(json) {
  const made = askEnv(chatStarted)
  made.env.provider = { id: 'anthropic', model: 'claude-haiku-5-5', async generate(request) {
    made.calls.push(request)
    return { kind: 'completed', text: JSON.stringify(json), model: 'claude-haiku-5-5',
      usage: { inputTokens: 10, outputTokens: 10, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } }
  } }
  return made
}

test('Ask guard: a verdict without a check question waiting is no verdict', async () => {
  const unasked = askWith(modelReply({ verdict: 'correct', reply: 'Yes, a parameter describes a population.' }))
  const result = await askCampusBot(unasked.env, { ...ASK, history: [{ role: 'bot', text: 'Hi.' }] })
  assert.equal(result.verdict, 'none')
  assert.equal(result.text, 'Yes, a parameter describes a population.', 'an unmarked reply keeps its words')
  assert.equal(unasked.record.finish[0].reply.verdict, 'none')
  // Only the latest Campus Bot turn counts: an older check question has had its answer.
  assert.equal(checkPending([...QUICK, { role: 'student', text: 'A population.' }, { role: 'bot', text: 'Right.' }]), false)
  assert.equal(checkPending([...QUICK, { role: 'student', text: 'Hmm' }]), true)
  assert.equal(checkPending([]), false)
  const answered = askWith(modelReply({ verdict: 'correct', reply: 'A parameter describes the population.' }))
  assert.equal((await askCampusBot(answered.env, { ...ASK, message: 'A population', history: QUICK })).verdict, 'correct')
  assert.equal(readChatReply(modelReply({ verdict: 'not-quite' }), false).guards[0], 'verdict-without-check')
})

test('Ask guard: a marked reply never opens with a verdict word, so it can never say "Yes" to a wrong answer', async () => {
  const wrong = askWith(modelReply({ verdict: 'not-quite', reply: 'Yes! the answer is a population, not a sample.' }))
  const result = await askCampusBot(wrong.env, { ...ASK, message: 'A sample', history: QUICK })
  assert.deepEqual([result.verdict, result.text], ['not-quite', 'The answer is a population, not a sample.'])
  assert.equal(wrong.record.finish[0].reply.text, result.text, 'what is kept is what was shown')
  const read = json => readChatReply(modelReply(json), true)
  assert.deepEqual(read({ verdict: 'correct', reply: 'Correct — it describes the whole population.' }).guards, ['verdict-word-removed'])
  assert.equal(read({ verdict: 'correct', reply: 'Correct — it describes the whole population.' }).reply.text,
    'It describes the whole population.')
  // Only verdict words go: a reply about the topic that merely starts with such a word is left as written.
  assert.equal(read({ verdict: 'correct', reply: 'No two samples are the same, so the parameter is the population.' }).reply.text,
    'No two samples are the same, so the parameter is the population.')
  assert.equal(read({ verdict: 'none', reply: 'Yes, a parameter describes a population.' }).reply.text,
    'Yes, a parameter describes a population.', 'an unmarked reply is not touched')
  assert.equal(read({ verdict: 'correct', reply: 'Correct!' }), null, 'a reply that is only a verdict is no reply')
})

test('Ask guard: a reply that gives the check question’s answer away loses the check, and the student still gets the reply', async () => {
  const leak = askEnv(chatStarted, { chat: 'leak' })
  const result = await askCampusBot(leak.env, ASK)
  assert.equal(result.status, 'answered')
  assert.equal(result.check, null)
  assert.match(result.text, /first lesson/)
  const read = json => readChatReply(modelReply(json), false)
  const cases = [
    [{ check: 'What does a parameter describe?', checkAnswer: '' }, 'check-without-answer'],
    [{ check: 'What does a parameter describe?', checkAnswer: ' The  POPULATION. ', reply: 'A parameter describes the\npopulation as a whole.' },
      'check-answer-leaked'],
    [{ check: 'q'.repeat(301), checkAnswer: 'x' }, 'check-too-long'],
  ]
  for (const [json, guard] of cases) {
    const out = read(json)
    assert.deepEqual([out.reply.check, out.guards], [null, [guard]], guard)
    assert.equal(out.removed.check, plainCheck(json.check), `${guard}: the reviewer sees the check removed`)
    assert.equal(out.reply.text.length > 0, true)
  }
  const kept = read({ check: 'What does a parameter describe?', checkAnswer: 'the population' })
  assert.deepEqual([kept.reply.check, kept.guards, kept.removed], ['What does a parameter describe?', [], { check: null, memoryTrick: null }])
  const trick = read({ memoryTrick: 'm'.repeat(201) })
  assert.deepEqual([trick.reply.memoryTrick, trick.guards], [null, ['memory-trick-too-long']])
  assert.equal(read({ memoryTrick: ' **Statistic** goes with `Sample`. ' }).reply.memoryTrick, '**Statistic** goes with Sample.',
    'plain text, like the reply, keeping its bold terms')
})
const plainCheck = check => check.trim()

test('Ask guard: a question that offers its answer as an option keeps everything (mock 8: "a parameter or a statistic?")', () => {
  const out = readChatReply(modelReply({ verdict: 'correct', reply: 'A parameter describes the whole population.',
    memoryTrick: 'Statistic goes with Sample, Parameter goes with Population.', check: 'Is 31 a parameter or a statistic?',
    checkAnswer: 'a statistic' }), true)
  assert.deepEqual([out.reply.check, out.reply.memoryTrick, out.guards],
    ['Is 31 a parameter or a statistic?', 'Statistic goes with Sample, Parameter goes with Population.', []])
  // But not when a sentence of the reply already pairs the answer with the question's own example (the final live runs).
  const named = readChatReply(modelReply({ reply: 'A statistic describes a sample.', check: 'Is the sample mean a statistic or a parameter?',
    checkAnswer: 'statistic' }), false)
  assert.deepEqual([named.reply.check, named.guards], [null, ['check-echoes-reply']])
})

test('Ask guard: a memory trick that alone gives the answer away is dropped, and the check question kept', () => {
  const out = readChatReply(modelReply({ reply: 'Here’s one.', check: 'Which English consonant is the only glottal sound?',
    checkAnswer: '/h/', memoryTrick: 'Only /h/ is glottal, so glottal means h.' }), false)
  assert.deepEqual([out.reply.check, out.reply.memoryTrick, out.guards, out.removed],
    ['Which English consonant is the only glottal sound?', null, ['memory-trick-gave-answer'],
      { check: null, memoryTrick: 'Only /h/ is glottal, so glottal means h.' }])
  // When the reply gives it away as well, the check goes and the memory trick may stay.
  const both = readChatReply(modelReply({ reply: 'The only glottal sound is /h/.', check: 'Which consonant is glottal?',
    checkAnswer: '/h/', memoryTrick: 'Glottal means /h/.' }), false)
  assert.deepEqual([both.reply.check, both.reply.memoryTrick, both.guards], [null, 'Glottal means /h/.', ['check-answer-leaked']])
})

test('Ask guard: a check question loses the label it opened with; the page adds its own', () => {
  for (const [given, kept] of [
    ['Quick check: Which of the four language skills is receptive?', 'Which of the four language skills is receptive?'],
    ['Try another: is 31 a parameter or a statistic?', 'Is 31 a parameter or a statistic?'],
    ['Question: What is scarcity?', 'What is scarcity?'],
    ['Quick check - Try another: What is scarcity?', 'What is scarcity?'],
  ]) {
    const out = readChatReply(modelReply({ check: given, checkAnswer: 'x' }), false)
    assert.deepEqual([out.reply.check, out.guards], [kept, ['check-label-removed']], given)
  }
  const plain = readChatReply(modelReply({ check: 'Checking costs: what is the opportunity cost?', checkAnswer: 'x' }), false)
  assert.deepEqual([plain.reply.check, plain.guards], ['Checking costs: what is the opportunity cost?', []],
    'a question that merely starts with such a word keeps it')
})

test('Ask guard: the check question’s answer is never in the result, the settlement or the stored reply', async () => {
  const marked = askWith(modelReply({ verdict: 'not-quite', reply: 'The answer is a population.',
    memoryTrick: 'Parameter goes with Population.', check: 'What does a statistic describe?', checkAnswer: 'a sample' }))
  const result = await askCampusBot(marked.env, { ...ASK, message: 'A sample', history: QUICK })
  assert.deepEqual(Object.keys(result).sort(), ['check', 'inNotes', 'memoryTrick', 'status', 'text', 'verdict'])
  assert.deepEqual(Object.keys(marked.record.finish[0].reply).sort(), ['check', 'inNotes', 'memoryTrick', 'text', 'verdict'])
  assert.doesNotMatch(JSON.stringify([result, marked.record]), /checkAnswer|a sample/)
  // A model answer without every field is not a reply: released and not charged, as today.
  for (const missing of ['verdict', 'memoryTrick', 'check', 'checkAnswer']) {
    const json = modelReply({})
    delete json[missing]
    const bad = askWith(json)
    assert.deepEqual(await askCampusBot(bad.env, ASK), { status: 'failed' }, missing)
    assert.equal(bad.record.finish[0].outcome, 'failed')
  }
  const odd = askWith(modelReply({ verdict: 'maybe' }))
  assert.deepEqual(await askCampusBot(odd.env, ASK), { status: 'failed' })
})

test('Ask: the stand-in’s check-question flow — a quick check, then a right answer and a wrong one, each marked', async () => {
  const first = askEnv(chatStarted)
  const asked = await askCampusBot(first.env, { ...ASK, message: 'Ask me a quick question' })
  assert.deepEqual([asked.verdict, asked.check], ['none', 'Which lesson of this topic states its main idea?'])
  const history = [{ role: 'student', text: 'Ask me a quick question' }, { role: 'bot', text: asked.text, check: asked.check }]
  const right = askEnv(chatStarted)
  const marked = await askCampusBot(right.env, { ...ASK, message: 'the first lesson', history })
  assert.match(right.calls[0].user, /\nQuick check: Which lesson of this topic states its main idea\?\n<\/conversation>/)
  assert.deepEqual([marked.verdict, marked.memoryTrick, marked.check],
    ['correct', '**F**irst lesson, **f**irst idea.', 'What do the later lessons do with the main idea?'])
  assert.doesNotMatch(marked.text, /^(Yes|That’s right)/)
  const wrong = askEnv(chatStarted)
  const notQuite = await askCampusBot(wrong.env, { ...ASK, message: 'the last one', history })
  assert.equal(notQuite.verdict, 'not-quite')
  assert.match(notQuite.text, /^The answer is the \*\*first lesson\*\*\./)
})

test('Ask guard: a multi-word answer is compared by the words the question does not already hold (13:08 line 16)', () => {
  const read = json => readChatReply(modelReply(json), false)
  // "condition" is in the question; "physiological" alone is in the memory trick: the trick goes, the check stays.
  const line16 = read({ reply: 'The answer is the physical condition, which concerns the room.',
    check: 'Which condition concerns the lecturer’s speech defects and pronunciation problems?', checkAnswer: 'physiological condition',
    memoryTrick: 'Physical goes with environment, physiological goes with lecturer.' })
  assert.deepEqual([line16.reply.check !== null, line16.reply.memoryTrick, line16.guards], [true, null, ['memory-trick-gave-answer']])
  // All of the remaining words in the reply: the check goes.
  const inReply = read({ reply: 'Physiological problems belong to the lecturer.', check: 'Which condition concerns the lecturer?',
    checkAnswer: 'the physiological condition' })
  assert.deepEqual([inReply.reply.check, inReply.guards], [null, ['check-answer-leaked']])
  // Only some of them: nothing is dropped. Whole words only: "statistics" is not "statistic".
  assert.deepEqual(read({ reply: 'Opportunity matters.', check: 'What is it called?', checkAnswer: 'opportunity cost' }).guards, [])
  assert.deepEqual(read({ reply: 'Statistics describe data.', check: 'What describes a sample?', checkAnswer: 'a statistic' }).guards, [])
})

test('Ask guard: emoji go from every field; text symbols the notes use stay', async () => {
  const out = readChatReply(modelReply({ verdict: 'none', reply: 'Great question 🙂 Supply → price ≠ demand ¶ ₦500 👍🏽.',
    check: 'Is ₦500 a price ✅?', checkAnswer: 'yes', memoryTrick: 'Price ❤️ demand 👨‍👩‍👧.' }), false)
  assert.deepEqual([out.reply.text, out.reply.check, out.reply.memoryTrick],
    ['Great question Supply → price ≠ demand ¶ ₦500.', 'Is ₦500 a price?', 'Price demand.'])
  assert.deepEqual(out.guards, ['emoji-removed'])
  const settled = askWith(modelReply({ reply: 'Your notes say so 🎉' }))
  await askCampusBot(settled.env, ASK)
  assert.equal(settled.record.finish[0].reply.text, 'Your notes say so', 'nothing with an emoji is stored')
})

test('Ask guard: an answer to the check question is always in the notes (13:04 line 49, 13:08 line 25)', () => {
  const out = readChatReply(modelReply({ verdict: 'not-quite', inNotes: false, reply: 'The answer is normative.' }), true)
  assert.deepEqual([out.reply.inNotes, out.guards], [true, ['in-notes-set']])
  assert.equal(readChatReply(modelReply({ verdict: 'none', inNotes: false }), false).reply.inNotes, false,
    'a question outside the notes still says so')
})

test('Ask: bold key words are kept when they pair up (3 in the reply and the check, 4 in a memory trick), checked as if they were not there', () => {
  const read = (json, pending = false) => readChatReply(modelReply(json), pending)
  const ok = read({ reply: 'A **parameter** describes a **population**.', check: 'Is 31 a **parameter** or a **statistic**?',
    checkAnswer: 'statistic', memoryTrick: '**S**tatistic goes with **S**ample, a **parameter** with a population.' })
  assert.deepEqual([ok.reply.text, ok.reply.check, ok.reply.memoryTrick, ok.guards],
    ['A **parameter** describes a **population**.', 'Is 31 a **parameter** or a **statistic**?',
      '**S**tatistic goes with **S**ample, a **parameter** with a population.', []])
  // Unpaired, or more than the field allows: that field shows none, and the guard says so.
  const bad = read({ reply: 'A **parameter describes a population.',
    memoryTrick: '**one** **two** **three** **four** **five**' })
  assert.deepEqual([bad.reply.text, bad.reply.memoryTrick, bad.guards],
    ['A parameter describes a population.', 'one two three four five', ['reply-bold-removed', 'memory-trick-bold-removed']])
  // Four is the memory trick's limit only: a reply or a check question with four loses them.
  const four = read({ reply: 'Four **terms** in **one** **short** **sentence**.',
    check: 'Is **31** a **parameter**, a **statistic** or a **sample**?', checkAnswer: 'statistic' })
  assert.deepEqual([four.reply.text, four.reply.check, four.guards],
    ['Four terms in one short sentence.', 'Is 31 a parameter, a statistic or a sample?',
      ['reply-bold-removed', 'check-bold-removed']])
  // The guards see no markers: an opener in bold goes, and the rest keeps its bold.
  const opened = read({ verdict: 'correct', reply: '**Spot on!** The answer is a **statistic**.' }, true)
  assert.deepEqual([opened.reply.text, opened.guards], ['The answer is a **statistic**.', ['verdict-word-removed']])
  // A check label or answer in bold is found as if it were plain.
  const leak = read({ reply: 'It is a **statistic**.', check: 'What is 31 here?', checkAnswer: 'statistic' })
  assert.deepEqual([leak.reply.check, leak.guards], [null, ['check-answer-leaked']])
})

test('Explain: an explanation keeps no emoji and no bold markers, and keeps the notes’ text symbols', () => {
  const read = readExplanation({ supported: true, passage: 'N1', explanation: 'B is **right** 🎉: price ↑ → demand ↓, ≠ ₦0 👍🏽.' },
    notes, question)
  assert.equal(read.kind, 'explained')
  assert.equal(read.text, 'B is right: price ↑ → demand ↓, ≠ ₦0.')
})

// Final live runs (23 Nov 2026, "14:10" and "15:00"): a Try another that only echoes what the reply just said.
test('Ask guard: an option question about what the reply just said loses its check (15:00 lines 15, 16, 24; 14:10 lines 9, 16)', () => {
  const read = (json, pending = true) => readChatReply(modelReply({ verdict: 'correct', ...json }), pending)
  const echoes = [
    ['15:00 line 24', { reply: '/z/ is voiced, because the vocal folds vibrate under air pressure while the sound is made. Compare it with /s/, which is voiceless with the glottis held open.',
      check: 'Is /s/ voiced or voiceless?', checkAnswer: 'voiceless' }],
    ['15:00 line 15', { reply: 'The **physical** condition covers the environment, such as a noisy or ill-ventilated room. A physical condition is about the place, while the **physiological** condition concerns the lecturer’s speech and the psychological condition concerns the listener’s emotional state.',
      check: 'Is a speech defect in the lecturer a physiological or psychological condition?', checkAnswer: 'physiological' }],
    ['15:00 line 16', { verdict: 'not-quite', reply: 'The answer is **physical**, because the condition concerns the environment, such as a noisy or ill-ventilated room. Physiological conditions refer to the lecturer’s speech defects, pronunciation and intonation.',
      check: 'Is a lecturer’s speech defect a physical or physiological condition?', checkAnswer: 'physiological' }],
    ['14:10 line 9', { verdict: 'none', reply: 'Here is one from the notes: a noisy or ill-ventilated room is a **physical** condition that inhibits listening, because it is part of the environment.',
      check: 'Is a noisy lecture hall a physical or psychological condition?', checkAnswer: 'physical' }, false],
    ['14:10 line 16', { verdict: 'not-quite', reply: 'The answer is **listening**, the receptive skill of taking spoken words in. Listening is the ability to receive, perceive and decode the meaning of spoken words, so it is the receptive skill, while speaking and writing are productive skills.',
      check: 'Is speaking a receptive or a productive skill?', checkAnswer: 'productive' }],
  ]
  for (const [line, json, pending] of echoes) {
    const out = read(json, pending)
    assert.deepEqual([out.reply.check, out.guards.includes('check-echoes-reply')], [null, true], line)
    assert.equal(out.removed.check, json.check, `${line}: the reviewer sees the check removed`)
  }
  // Only the memory trick echoes it: the trick goes, the question stays.
  const trick = read({ reply: 'Voicing is about the vocal folds.', check: 'Is /s/ voiced or voiceless?', checkAnswer: 'voiceless',
    memoryTrick: 'Hiss like /s/: voiceless.' })
  assert.deepEqual([trick.reply.check, trick.reply.memoryTrick, trick.guards], ['Is /s/ voiced or voiceless?', null, ['memory-trick-echoes-check']])
})

test('Ask guard: a Try another that applies the point to a new example keeps its check (mock 8; 15:00 lines 48, 49)', () => {
  const read = json => readChatReply(modelReply({ verdict: 'correct', ...json }), true)
  const mock8 = read({ reply: 'A statistic describes a sample.', checkAnswer: 'statistic',
    check: 'A company surveys 50 of its 500 staff and finds their average age is 31. Is 31 a parameter or a statistic?' })
  assert.deepEqual([mock8.reply.check !== null, mock8.guards], [true, []])
  const line48 = read({ reply: 'The statement uses the word should and makes a value judgement about what government ought to do, so it is **normative**. It cannot be proven true or false with evidence, unlike a **positive** statement that describes what is or will be.',
    check: 'Is "A rise in the price of petrol will lead to a fall in the quantity bought" positive or normative?', checkAnswer: 'positive' })
  assert.equal(line48.reply.check, 'Is "A rise in the price of petrol will lead to a fall in the quantity bought" positive or normative?')
  const line49 = read({ verdict: 'not-quite', reply: 'The answer is **normative**, because the statement says what government **should** do, which is a value judgement. Positive statements describe what is or will be and can be tested with evidence, but this one cannot be proven true or false.',
    check: 'Is "Higher interest rates lead to reduced borrowing" positive or normative?', checkAnswer: 'positive',
    memoryTrick: 'Should and ought signal normative; is and will be signal positive.' })
  assert.deepEqual([line49.reply.check !== null, line49.reply.memoryTrick !== null, line49.guards], [true, true, []])
})

test('Ask guard: a final instruction in the check question goes (14:10 lines 14, 38; 15:00 line 38)', () => {
  for (const [given, kept] of [
    ['Which of the four language skills is receptive and means taking spoken words in? Answer with a single word.',
      'Which of the four language skills is receptive and means taking spoken words in?'],
    ['Which economist defined economics as the study of choices under scarcity, the definition called the most widely quoted in the notes? Answer with the surname only.',
      'Which economist defined economics as the study of choices under scarcity, the definition called the most widely quoted in the notes?'],
    ['According to Lionel Robbins, what are the two things that scarcity is set against, the unlimited wants and the limited resources? Give the one word for the limited resources.',
      'According to Lionel Robbins, what are the two things that scarcity is set against, the unlimited wants and the limited resources?'],
  ]) {
    const out = readChatReply(modelReply({ check: given, checkAnswer: 'x' }), false)
    assert.deepEqual([out.reply.check, out.guards], [kept, ['check-instruction-removed']], given.slice(0, 40))
  }
})

test('Ask guard: a memory trick whose bold first letters do not match keeps its words, without the bold (15:00 line 40)', () => {
  const read = memoryTrick => readChatReply(modelReply({ memoryTrick }), false)
  const forced = read('**R**obbins goes with **S**carcity, since both start with the same kind of key idea.')
  assert.deepEqual([forced.reply.memoryTrick, forced.guards],
    ['Robbins goes with Scarcity, since both start with the same kind of key idea.', ['memory-trick-unmatched-bold-removed']])
  assert.equal(read('**S**tatistic goes with **S**ample.').reply.memoryTrick, '**S**tatistic goes with **S**ample.')
  assert.equal(read('**P**hysical is the **P**lace.').reply.memoryTrick, '**P**hysical is the **P**lace.')
  assert.equal(read('Should and ought signal **normative**.').reply.memoryTrick, 'Should and ought signal **normative**.',
    'bold words, not letters, are not a letter match to check')
})

test('Ask: mock 8’s memory trick shows bold as she drew it, all four first letters', () => {
  const trick = '**S**tatistic goes with **S**ample, **P**arameter goes with **P**opulation'
  const out = readChatReply(modelReply({ verdict: 'correct', reply: 'A statistic describes a sample.',
    check: 'A company surveys 50 of its 500 staff and finds their average age is 31. Is 31 a parameter or a statistic?',
    checkAnswer: 'statistic', memoryTrick: trick }), true)
  assert.deepEqual([out.reply.memoryTrick, out.guards], [trick, []])
  // A fifth bold span is one too many: the trick is shown, without bold.
  const five = readChatReply(modelReply({ memoryTrick: `${trick}, **R**ight?` }), false)
  assert.deepEqual([five.reply.memoryTrick, five.guards],
    ['Statistic goes with Sample, Parameter goes with Population, Right?', ['memory-trick-bold-removed']])
})

test('Ask guard: a reply that contrasts the options keeps a three-option Try another; only the example would echo it', () => {
  const check = 'Is 31 a parameter, a statistic or a sample?'
  const contrast = readChatReply(modelReply({ verdict: 'correct', checkAnswer: 'statistic', check,
    reply: 'A statistic describes a sample, while a parameter describes a population.' }), true)
  assert.deepEqual([contrast.reply.check, contrast.guards], [check, []], 'the options are not key words')
  const echo = readChatReply(modelReply({ verdict: 'correct', checkAnswer: 'statistic', check,
    reply: 'The 31 in the survey is a statistic.' }), true)
  assert.deepEqual([echo.reply.check, echo.guards], [null, ['check-echoes-reply']], 'the example (31) still echoes')
})

// Last live run (24 Nov 2026, "05:53"): useful memory tricks with unmatched bold letters were dropped.
test('Ask guard: tricks with unmatched bold letters stay as plain text (05:53 lines 15, 16, 47); one that gives the answer away still goes', () => {
  const read = (json, pending = true) => readChatReply(modelReply(json), pending)
  const lines = [
    ['line 15', { verdict: 'correct', checkAnswer: 'receptive',
      reply: 'Listening is a **receptive** skill, so you take language in rather than produce it. Speaking is productive, because you send language out.',
      check: 'Which of the two groups does **reading** belong to: receptive or productive?',
      memoryTrick: '**R**eceptive goes with **L**istening, **P**roductive goes with **S**peaking.' },
      'Receptive goes with Listening, Productive goes with Speaking.'],
    ['line 16', { verdict: 'not-quite', checkAnswer: 'productive',
      reply: 'The answer is **listening**, because it is receptive: you take language in. Speaking is productive, since you produce language. Listening means you receive, perceive and decode the meaning of what is said.',
      check: 'Is note-taking a receptive or productive skill in this course?',
      memoryTrick: '**L**istening and **R**eading are receptive, while **S**peaking and **W**riting are productive.' },
      'Listening and Reading are receptive, while Speaking and Writing are productive.'],
    ['line 47', { verdict: 'not-quite', checkAnswer: 'positive',
      reply: 'The answer is **normative**, because the statement says what the government should do, which is a value judgement rather than a fact that data could check. Words like "should" and "ought" are the clearest signs of a normative statement.',
      check: 'Is "A rise in the price of petrol will lead to a fall in the quantity bought" positive or normative?',
      memoryTrick: '**S**hould signals **N**ormative, while facts that data can test are **P**ositive.' },
      'Should signals Normative, while facts that data can test are Positive.'],
  ]
  for (const [line, json, plain] of lines) {
    const out = read(json)
    assert.deepEqual([out.reply.memoryTrick, out.reply.check, out.guards],
      [plain, json.check, ['memory-trick-unmatched-bold-removed']], line)
  }
  // Unmatched letters, and the answer given away: the trick still goes.
  const giveaway = read({ verdict: 'none', check: 'Which consonant is the only glottal sound?', checkAnswer: '/h/',
    memoryTrick: '**G**lottal means **/h/**.' }, false)
  assert.deepEqual([giveaway.reply.check, giveaway.reply.memoryTrick, giveaway.guards, giveaway.removed.memoryTrick],
    ['Which consonant is the only glottal sound?', null, ['memory-trick-unmatched-bold-removed', 'memory-trick-gave-answer'],
      'Glottal means /h/.'])
})

test('Ask: a reply that is only a lead-in with no check question is a failed reply, released and not charged (05:53 line 38)', async () => {
  // Line 38: "Here's one." and no check question at all.
  const line38 = askWith(modelReply({ reply: 'Here’s one.', check: '', checkAnswer: '' }))
  assert.deepEqual(await askCampusBot(line38.env, { ...ASK, message: 'Ask me one quick question to check I understand this topic.' }),
    { status: 'failed' }, 'the student sees the Try again card')
  assert.deepEqual([line38.record.finish[0].outcome, line38.record.finish[0].reply], ['failed', undefined],
    'settled as failed: released and not charged')
  assert.deepEqual(readChatReply(modelReply({ reply: 'Here’s one.' }), false),
    { reply: null, guards: ['lead-in-without-check'], removed: { check: null, memoryTrick: null } })
  // A lead-in whose check question a guard removed: the same.
  const removed = readChatReply(modelReply({ reply: 'Sure, here’s a quick question:',
    check: 'Which skill takes spoken language in?', checkAnswer: '' }), false)
  assert.deepEqual([removed.reply, removed.guards, removed.removed.check],
    [null, ['check-without-answer', 'lead-in-without-check'], 'Which skill takes spoken language in?'])
  // A lead-in with its check question is an ordinary reply.
  const asked = readChatReply(modelReply({ reply: 'Here’s one.', check: 'Which skill takes spoken language in?', checkAnswer: 'listening' }), false)
  assert.deepEqual([asked.reply.text, asked.reply.check, asked.guards], ['Here’s one.', 'Which skill takes spoken language in?', []])
  // A short reply of another kind, with no check question, is shown as it is.
  const welcome = askWith(modelReply({ reply: 'You’re welcome.' }))
  assert.deepEqual(await askCampusBot(welcome.env, { ...ASK, message: 'Thanks!' }),
    { status: 'answered', text: 'You’re welcome.', inNotes: true, verdict: 'none', check: null, memoryTrick: null })
  assert.equal(welcome.record.finish[0].outcome, 'answered')
})
