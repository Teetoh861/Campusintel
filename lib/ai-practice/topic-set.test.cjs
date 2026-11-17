// lib/ai-practice/topic-set.test.cjs — "Quiz me on this topic" over an injected environment: a set written from one
// topic's notes, judged like every Campus Bot set, checked on a calculation course, settled and opened; every admission
// answer as the shared Campus Bot state; nothing undelivered charged; prompts that carry nothing about the student.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createFakeCampusBotProvider } = require('../campus-bot/provider.ts')
const { notesContextFromTopic } = require('../campus-bot/notes-context.ts')
const { ProviderError } = require('./provider.ts')
const { runTopicSet, TOPIC_SET_CHECK_TIMEOUT_MS, TOPIC_SET_WRITE_TIMEOUT_MS } = require('./topic-set.ts')
const { buildTopicCheckPrompt, buildTopicSetPrompt, confirmedLabels, TOPIC_SET_PROMPT_VERSION } = require('./topic-prompt.ts')
const { noteWords, topicPreparedSource } = require('./topic-source.ts')
const { toPersonalSetView } = require('./stored-set.ts')
const { quizPassLine } = require('./topic-presentation.ts')
const { assessGeneratedQuestions } = require('./service.ts')
const { validateQuestions } = require('./validate.ts')

const ITEM = '81000000-0000-4000-8000-000000000001'
const COURSE = '81000000-0000-4000-8000-000000000002'
const GENERATION = '81000000-0000-4000-8000-000000000003'
const REQUEST = '81000000-0000-4000-8000-000000000004'
const PASSAGES = [
  { heading: 'What you must know', body: 'Price elasticity of demand measures how strongly the quantity demanded of a good responds to a change in its own price, holding every other influence on demand constant for the period studied.' },
  { heading: '3.1 Measuring elasticity', body: 'The coefficient is the percentage change in quantity demanded divided by the percentage change in price, and economists read its absolute value when they classify demand as elastic or inelastic.' },
  { heading: '3.2 What makes demand elastic', body: 'Demand tends to be more elastic when close substitutes exist, when the good takes a large share of income, and when buyers have a long time to adjust their purchases.' },
]
const notes = () => notesContextFromTopic('Price Elasticity of Demand', PASSAGES, { itemId: ITEM, number: 3 })
// The caps the database admits each call with (the 'writing' and 'check' steps' read and written caps).
const WRITING = { model: 'claude-haiku-5-5', maxInputTokens: 20000, maxOutputTokens: 8000 }
const CHECK = { model: 'claude-sonnet-5-5', maxInputTokens: 10000, maxOutputTokens: 3000 }
const started = (extra = {}) => ({ state: 'started', generationId: GENERATION, writing: WRITING, check: null,
  course: { code: 'ECO101', title: 'Principles of Economics I' },
  topic: { itemId: ITEM, title: 'Price Elasticity of Demand', number: 3, revision: 4, pinned: false },
  notes: notes(), previousPrompts: [], ...extra })

function envFor(begun, { provider = null, finished = settlement => settlement.status, notice = 'plan' } = {}) {
  const calls = { begin: [], finish: [], notice: 0, plansOnSale: 0, problems: [] }
  const env = {
    provider,
    async begin(...args) { calls.begin.push(args); return typeof begun === 'function' ? begun() : begun },
    async finish(generationId, settlement) { calls.finish.push({ generationId, settlement }); return finished(settlement) },
    async notice() { calls.notice += 1; return notice },
    async plansOnSale() { calls.plansOnSale += 1; return true },
    reportProviderProblem(code) { calls.problems.push(code) },
  }
  return { env, calls }
}

// A provider that records each request and answers through the scripted stand-in used for browser checks.
function scripted(script = {}) {
  const fake = createFakeCampusBotProvider(() => script)
  const requests = []
  return { requests, provider: { id: fake.id, model: fake.model,
    async generate(request) { requests.push(request); return fake.generate(request) } } }
}
// A provider that answers one fixed reply (or throws).
function fixed(reply) {
  const requests = []
  return { requests, provider: { id: 'anthropic', model: 'claude-haiku-5-5', async generate(request) {
    requests.push(request)
    if (reply instanceof Error) throw reply
    const usage = { inputTokens: 6000, outputTokens: 3000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }
    if (typeof reply === 'string') return { kind: reply, model: request.model, usage }
    return { kind: 'completed', model: request.model, usage, text: JSON.stringify(reply) }
  } } }
}
const run = env => runTopicSet(env, { courseId: COURSE, itemId: ITEM, requestId: REQUEST })

test('a set is written from the topic’s notes with the admitted model, settled as delivered and opened by its id', async () => {
  const { requests, provider } = scripted()
  const { env, calls } = envFor(started(), { provider })
  assert.deepEqual(await run(env), { status: 'ready', setId: GENERATION })
  assert.deepEqual(calls.begin, [[REQUEST, COURSE, ITEM]])
  assert.equal(requests.length, 1, 'no check on a course that is not a calculation course')
  assert.equal(requests[0].model, 'claude-haiku-5-5')
  assert.equal(requests[0].maxOutputTokens, 8000)
  assert.equal(requests[0].effort, 'medium')
  const [{ generationId, settlement }] = calls.finish
  assert.equal(generationId, GENERATION)
  assert.equal(settlement.status, 'generated')
  assert.equal(settlement.reason, null)
  assert.equal(settlement.checkUsage, null)
  assert.equal(settlement.usage.model, 'claude-haiku-5-5')
  const set = settlement.questionSet
  assert.deepEqual([set.formatVersion, set.origin, set.visibility, set.verification], [1, 'ai-generated', 'personal', 'unverified'])
  assert.deepEqual({ kind: set.source.kind, courseId: set.source.courseId, itemId: set.source.itemId,
    revision: set.source.revision, title: set.source.title, number: set.source.number, pinned: set.source.pinned },
  { kind: 'notes-topic', courseId: COURSE, itemId: ITEM, revision: 4, title: 'Price Elasticity of Demand', number: 3,
    pinned: false })
  assert.equal(set.questions.length, 5)
  for (const question of set.questions) {
    assert.equal(question.grounding.documentId, ITEM, 'grounded in the notes topic, never an upload')
    assert.match(question.grounding.passageId, /^N[1-3]$/)
  }
  assert.equal(set.generation.promptVersion, TOPIC_SET_PROMPT_VERSION)
  assert.equal(set.generation.checkedBy, null)
  assert.equal('generatedAt' in set.generation, false, 'the database clock dates the set, not the server’s')
})

test('on a calculation course the checking model reads the set once; what it does not confirm is removed', async () => {
  const dropOne = scripted({ setCheck: 'drop-one' })
  const one = envFor(started({ check: CHECK }), { provider: dropOne.provider })
  assert.deepEqual(await run(one.env), { status: 'ready', setId: GENERATION })
  assert.deepEqual(dropOne.requests.map(request => [request.model, request.maxOutputTokens, request.effort]),
    [['claude-haiku-5-5', 8000, 'medium'], ['claude-sonnet-5-5', 3000, 'medium']])
  const { settlement } = one.calls.finish[0]
  assert.equal(settlement.questionSet.questions.length, 4)
  assert.equal(settlement.questionSet.generation.removedByCheck, 1)
  assert.equal(settlement.questionSet.generation.checkedBy, 'claude-sonnet-5-5')
  assert.equal(settlement.checkUsage.model, 'claude-sonnet-5-5', 'the check is settled from its own report')

  const fails = scripted({ setCheck: 'fail' })
  const none = envFor(started({ check: CHECK }), { provider: fails.provider })
  assert.deepEqual(await run(none.env), { status: 'failed' })
  assert.deepEqual([none.calls.finish[0].settlement.status, none.calls.finish[0].settlement.reason,
    none.calls.finish[0].settlement.questionSet], ['failed', 'check-failed', null])
  assert.ok(none.calls.finish[0].settlement.checkUsage, 'an unconfirmed set is recorded with both reports, and charged nothing')

  const silent = scripted({ setCheck: 'timeout' })
  const busy = envFor(started({ check: CHECK }), { provider: silent.provider })
  assert.deepEqual(await run(busy.env), { status: 'busy' }, 'a check that never answers fails closed')
  assert.deepEqual([busy.calls.finish[0].settlement.status, busy.calls.finish[0].settlement.reason],
    ['failed', 'check-failed'])
  assert.deepEqual(busy.calls.problems, ['timeout'])
})

// A topic whose passages are long enough for the input caps to matter.
const FILLER = 'Elasticity changes along a straight-line demand curve as price and quantity change together. '
const longNotes = () => notesContextFromTopic('Price Elasticity of Demand',
  PASSAGES.map(passage => ({ heading: passage.heading, body: `${passage.body} ${FILLER.repeat(40)}` })), { itemId: ITEM, number: 3 })

test('the whole prompt fits the input cap admitted: a long topic is sent from its start as far as fits, and the set records exactly that', async () => {
  const { promptTokenBound } = require('../campus-bot/model-call.ts')
  const long = longNotes()
  const build = count => buildTopicSetPrompt({ code: 'ECO101', title: 'Principles of Economics I' },
    'Price Elasticity of Demand', { passages: long.passages.slice(0, count) }, [])
  // Room for the first two passages, not the third.
  const cap = Math.floor((promptTokenBound(build(2)) + promptTokenBound(build(3))) / 2)
  const { requests, provider } = scripted()
  const { env, calls } = envFor(started({ notes: long, writing: { ...WRITING, maxInputTokens: cap } }), { provider })
  assert.deepEqual(await run(env), { status: 'ready', setId: GENERATION })
  assert.equal(requests.length, 1)
  assert.match(requests[0].user, /<passage id="N2"/)
  assert.equal(requests[0].user.includes('<passage id="N3"'), false, 'the last passage is left off')
  assert.ok(promptTokenBound(requests[0]) <= cap, 'the whole prompt is within the cap')
  const set = calls.finish[0].settlement.questionSet
  assert.equal(set.source.passageCount, 2, 'the set records the passages it was written from')
  assert.equal(set.source.sha256, topicPreparedSource({ passages: long.passages.slice(0, 2) }).sha256)
  assert.ok(set.questions.every(question => ['N1', 'N2'].includes(question.grounding.passageId)))

  // Not even the first passage fits: no call, and the reservation is released at no charge.
  const none = scripted()
  const tiny = envFor(started({ writing: { ...WRITING, maxInputTokens: 50 } }), { provider: none.provider })
  assert.deepEqual(await run(tiny.env), { status: 'failed' })
  assert.equal(none.requests.length, 0)
  assert.deepEqual([tiny.calls.finish[0].settlement.status, tiny.calls.finish[0].settlement.reason,
    tiny.calls.finish[0].settlement.usage], ['failed', 'notes-too-long', null])
})

test('the check’s prompt fits its own cap: cited passages are shortened from their ends, and a set that cannot be checked within it is not shown', async () => {
  const { checkPromptWithin } = require('./topic-set.ts')
  const { promptTokenBound } = require('../campus-bot/model-call.ts')
  const long = longNotes()
  // The set the writer makes from these notes; then its check in full, and with every cited passage emptied.
  const first = scripted()
  const written = envFor(started({ notes: long }), { provider: first.provider })
  await run(written.env)
  const questions = written.calls.finish[0].settlement.questionSet.questions
  const whole = buildTopicCheckPrompt(questions, long)
  const full = promptTokenBound(whole)
  const bare = promptTokenBound(buildTopicCheckPrompt(questions,
    { passages: long.passages.map(passage => ({ ...passage, text: '' })) }))
  assert.equal(checkPromptWithin(questions, long, { ...CHECK, maxInputTokens: full }).user, whole.user, 'whole when it fits')
  const cap = Math.floor((full + bare) / 2)
  const shortened = checkPromptWithin(questions, long, { ...CHECK, maxInputTokens: cap })
  assert.ok(shortened !== null && promptTokenBound(shortened) <= cap)
  assert.equal([...shortened.user.matchAll(/<question label="Q\d">/g)].length, 5, 'every question is still checked')
  assert.ok(shortened.user.length < whole.user.length)
  assert.equal(checkPromptWithin(questions, long, { ...CHECK, maxInputTokens: bare - 1 }), null,
    'the questions alone do not fit')

  // In a run: checked within its cap, or not shown at all, the check never called.
  const fits = scripted()
  const ok = envFor(started({ notes: long, check: { ...CHECK, maxInputTokens: cap } }), { provider: fits.provider })
  assert.deepEqual(await run(ok.env), { status: 'ready', setId: GENERATION })
  assert.ok(promptTokenBound(fits.requests[1]) <= cap)
  const small = scripted()
  const no = envFor(started({ notes: long, check: { ...CHECK, maxInputTokens: bare - 1 } }), { provider: small.provider })
  assert.deepEqual(await run(no.env), { status: 'failed' })
  assert.equal(small.requests.length, 1, 'only the writer was called')
  assert.deepEqual([no.calls.finish[0].settlement.status, no.calls.finish[0].settlement.reason,
    no.calls.finish[0].settlement.checkUsage], ['failed', 'check-failed', null])
})

test('the student’s last questions on the topic go with the request, and a repeat is never kept', async () => {
  const first = scripted()
  const firstRun = envFor(started(), { provider: first.provider })
  await run(firstRun.env)
  const earlier = firstRun.calls.finish[0].settlement.questionSet.questions.map(question => question.prompt)
  const again = scripted()
  const second = envFor(started({ previousPrompts: earlier }), { provider: again.provider })
  assert.deepEqual(await run(second.env), { status: 'ready', setId: GENERATION })
  assert.match(again.requests[0].user, /<asked_before>\n- Set 1, question 1:/)
  const fresh = second.calls.finish[0].settlement.questionSet.questions.map(question => question.prompt)
  assert.equal(fresh.some(prompt => earlier.includes(prompt)), false)

  // A reply that repeats an earlier question loses that question, and a set left with fewer than three is no set.
  const source = topicPreparedSource(notes())
  const reply = { assessment: { sufficientMaterial: true, relatedToCourse: true, appropriate: true, confidence: 'high',
    assessmentNote: 'ok' }, questions: firstRun.calls.finish[0].settlement.questionSet.questions.slice(0, 3).map(question => ({
    prompt: question.prompt, options: question.options, correctOptionIndex: question.correctOption,
    explanation: question.explanation, section: question.section, sourcePassageId: question.grounding.passageId,
    sourceQuote: question.grounding.quote })) }
  const judged = assessGeneratedQuestions(reply, source, ITEM, 5, [earlier[0]])
  assert.deepEqual(judged, { kind: 'failed', reason: 'invalid-output' }, 'two left of five is not a set')
  const { rejected } = validateQuestions(reply.questions, source, ITEM, 5, [earlier[0].toUpperCase()])
  assert.deepEqual(rejected, [{ index: 0, reason: 'duplicate-question' }], 'repeats are found however they are written')
})

test('nothing delivered is nothing charged: an outage reads as busy, anything else as a set that could not be made', async () => {
  const cases = [
    [new ProviderError('timeout'), { status: 'busy' }, ['failed', 'timeout', false]],
    [new ProviderError('overloaded'), { status: 'busy' }, ['failed', 'provider-unavailable', false]],
    ['refused', { status: 'failed' }, ['flagged_for_review', 'provider-refusal', true]],
    ['truncated', { status: 'failed' }, ['failed', 'truncated-output', true]],
    [{ not: 'a set' }, { status: 'failed' }, ['failed', 'invalid-output', true]],
    [{ assessment: { sufficientMaterial: false, relatedToCourse: true, appropriate: true, confidence: 'low',
      assessmentNote: 'thin' }, questions: [] }, { status: 'failed' }, ['insufficient_source', 'low-confidence', true]],
  ]
  for (const [reply, result, [status, reason, reported]] of cases) {
    const { provider } = fixed(reply)
    const { env, calls } = envFor(started(), { provider })
    assert.deepEqual(await run(env), result, reason)
    const { settlement } = calls.finish[0]
    assert.deepEqual([settlement.status, settlement.reason, settlement.questionSet], [status, reason, null], reason)
    assert.equal(settlement.usage !== null, reported, `${reason}: usage is recorded only when the provider reported it`)
  }
  const unconfigured = envFor(started())
  assert.deepEqual(await run(unconfigured.env), { status: 'disabled' })
  assert.deepEqual([unconfigured.calls.finish[0].settlement.status, unconfigured.calls.finish[0].settlement.reason],
    ['failed', 'not-configured'], 'a reservation without a provider is released at once')
})

test('admission answers become the states the Campus Bot area shows', async () => {
  const cases = [
    [{ state: 'session-limit', resetsAt: '2026-11-17T15:00:00Z' }, { status: 'limit', limit: 'session', resetsAt: '2026-11-17T15:00:00Z' }],
    [{ state: 'week-limit', resetsAt: null }, { status: 'limit', limit: 'week', resetsAt: null }],
    [{ state: 'pass-used' }, { status: 'limit', limit: 'pass', resetsAt: null }],
    [{ state: 'undelivered-limit' }, { status: 'limit', limit: 'undelivered', resetsAt: null }],
    [{ state: 'not-entitled' }, { status: 'not-entitled', notice: 'free-pass' }],
    [{ state: 'locked' }, { status: 'locked', plansOnSale: true }],
    [{ state: 'busy' }, { status: 'in-progress' }],
    [{ state: 'capacity' }, { status: 'busy' }],
    [{ state: 'request-conflict' }, { status: 'invalid-request' }],
    [{ state: 'not-found' }, { status: 'not-found' }],
    [{ state: 'too-short' }, { status: 'not-found' }],
    [{ state: 'signed-out' }, { status: 'signed-out' }],
    [{ state: 'disabled' }, { status: 'disabled' }],
    [{ state: 'existing', generationId: GENERATION, status: 'generated' }, { status: 'ready', setId: GENERATION }],
    [{ state: 'existing', generationId: GENERATION, status: 'running' }, { status: 'in-progress' }],
    [{ state: 'existing', generationId: GENERATION, status: 'failed' }, { status: 'failed' }],
    [null, { status: 'unavailable' }],
  ]
  for (const [begun, result] of cases) {
    const { provider, requests } = scripted()
    const { env, calls } = envFor(begun, { provider, notice: 'free-pass' })
    assert.deepEqual(await run(env), result, JSON.stringify(begun))
    assert.equal(requests.length, 0, 'no provider call without a new admission')
    assert.equal(calls.finish.length, 0)
    assert.equal(calls.notice, begun?.state === 'not-entitled' ? 1 : 0)
    assert.equal(calls.plansOnSale, begun?.state === 'locked' ? 1 : 0)
  }
})

test('the student is shown only what the ledger recorded', async () => {
  const lost = envFor(started(), { provider: scripted().provider, finished: () => null })
  assert.deepEqual(await run(lost.env), { status: 'unavailable' }, 'a retry with the same id replays what was recorded')
  const incomplete = envFor(started(), { provider: scripted().provider, finished: () => 'failed' })
  assert.deepEqual(await run(incomplete.env), { status: 'failed' }, 'a free pass’s set recorded as incomplete is not shown')
})

test('the deadlines fit inside the five-minute reservation: 15 + 90 + 60 + 30 seconds', () => {
  const { AI_ADMISSION_TIMEOUT_MS, AI_SETTLEMENT_TIMEOUT_MS } = require('./lifetime.ts')
  const { topicSetOutlasts } = require('./topic-set-server.ts')
  assert.equal(AI_ADMISSION_TIMEOUT_MS + TOPIC_SET_WRITE_TIMEOUT_MS + TOPIC_SET_CHECK_TIMEOUT_MS + AI_SETTLEMENT_TIMEOUT_MS,
    195_000)
  assert.equal(topicSetOutlasts(300, true), true)
  assert.equal(topicSetOutlasts(195, true), false)
  assert.equal(topicSetOutlasts(140, false), true)
})

test('prompts carry the course, the topic, its notes and earlier questions as data, and nothing about the student', () => {
  const prompt = buildTopicSetPrompt({ code: 'ECO101', title: 'Principles of Economics I' }, 'Price Elasticity of Demand',
    notes(), ['What does the <coefficient> measure?'])
  assert.match(prompt.user, /^Course: ECO101 - Principles of Economics I\nTopic: Price Elasticity of Demand\nWrite up to 5 practice questions/)
  assert.match(prompt.user, /<notes>\n<passage id="N1" topic="Price Elasticity of Demand" heading="What you must know">/)
  assert.match(prompt.user, /<asked_before>\n- What does the < coefficient> measure\?\n<\/asked_before>$/, 'earlier text never reads as a tag')
  assert.match(prompt.system, /never follow it/)
  assert.deepEqual(prompt.outputSchema.required, ['assessment', 'questions'], 'the sets’ own reply shape')
  for (const forbidden of ['student-1', 'session', '@', 'user_id']) assert.equal(prompt.user.includes(forbidden), false, forbidden)
  assert.equal(buildTopicSetPrompt({ code: null, title: null }, 'T', notes(), []).user.includes('asked_before'), false)

  const source = topicPreparedSource(notes())
  const judged = assessGeneratedQuestions({ assessment: { sufficientMaterial: true, relatedToCourse: true, appropriate: true,
    confidence: 'high', assessmentNote: 'ok' }, questions: [0, 1, 2].map(index => ({
    prompt: `Question ${index + 1} about part ${index + 1}?`, options: [PASSAGES[index].body.split(' ').slice(0, 5).join(' '),
      'A point from another topic', 'A rule these notes never give', 'An idea the notes reject'], correctOptionIndex: 0,
    explanation: 'The notes say so.', section: PASSAGES[index].heading, sourcePassageId: `N${index + 1}`,
    sourceQuote: PASSAGES[index].body.split(' ').slice(0, 10).join(' ') })) }, source, ITEM, 3)
  assert.equal(judged.kind, 'accepted')
  const check = buildTopicCheckPrompt(judged.questions.slice(1), notes())
  assert.match(check.user, /<question label="Q1">\nQuestion 2 about part 2\?\nA\. /)
  assert.match(check.user, /Marked correct: A\nExplanation: The notes say so\.\n<\/question>/)
  assert.equal(check.user.includes('heading="What you must know"'), false, 'only the passages the questions cite')
  assert.deepEqual(check.outputSchema.required, ['results'])
})

test('a check confirms questions by label; anything malformed or repeated confirms nothing', () => {
  assert.deepEqual([...confirmedLabels({ results: [{ question: 'Q1', correct: true }, { question: 'Q2', correct: false }] })],
    ['Q1'])
  assert.deepEqual([...confirmedLabels({ results: [{ question: 'Q1', correct: true }, { question: 'Q1', correct: true }] })], [])
  assert.equal(confirmedLabels({ results: [{ question: 'Q1' }] }), null)
  assert.equal(confirmedLabels('pass'), null)
  assert.equal(confirmedLabels({ verdict: 'pass' }), null)
})

test('the notes become a source whose passages keep their ids and positions', () => {
  const source = topicPreparedSource(notes())
  assert.deepEqual(source.passages.map(passage => passage.id), ['N1', 'N2', 'N3'])
  for (const passage of source.passages) assert.equal(source.text.slice(passage.start, passage.end), passage.text)
  assert.equal(source.charCount, source.text.length)
  assert.match(source.sha256, /^[0-9a-f]{64}$/)
  assert.equal(topicPreparedSource(notes()).sha256, source.sha256)
})

test('a note’s words are counted from the parts Campus Bot reads, never a guide topic’s theory question', () => {
  assert.equal(noteWords({ title: 'T', body: 'one two three', noteType: 'topic_note', keyPoints: ['four five', 'six'],
    examTip: 'seven' }), 7)
  assert.equal(noteWords({ title: 'T', body: 'one two', noteType: 'calculator_trick', example: 'three', formula: 'a = b' }), 6)
  const span = text => [{ text }]
  assert.equal(noteWords({ title: 'T', body: 'x', noteType: 'guide_topic', number: 1, mustKnow: span('one two'),
    introMore: [{ type: 'paragraph', text: span('three') }],
    lessons: [{ number: '1.1', title: 'Not counted here', mustKnow: [{ type: 'list', ordered: false, items: [{ text: span('four'),
      blocks: [{ type: 'table', header: [span('five')], rows: [[span('six seven')]] }] }] }],
      explainMore: [{ type: 'preformatted', text: 'eight nine' }] }],
    recap: [{ type: 'paragraph', text: span('ten') }],
    theory: { itemId: ITEM, question: [{ type: 'paragraph', text: span('never counted at all') }] } }), 10)
})

test('a stored topic set reads back with its topic; a set from an upload keeps its file name', () => {
  const { provider } = scripted()
  return (async () => {
    const { env, calls } = envFor(started(), { provider })
    await run(env)
    const stored = JSON.parse(JSON.stringify(calls.finish[0].settlement.questionSet))
    const view = toPersonalSetView(GENERATION, '2026-11-17T10:00:00Z', stored)
    assert.deepEqual(view.topic, { itemId: ITEM, title: 'Price Elasticity of Demand', number: 3 })
    assert.equal(view.fileName, null)
    assert.equal(view.questions.length, 5)
    assert.equal(toPersonalSetView(GENERATION, 'x', { ...stored, source: { ...stored.source, itemId: 'nope' } }), null)
    const upload = { ...stored, source: { documentId: ITEM, fileName: 'week-3.pdf' },
      questions: stored.questions.map(question => ({ ...question, grounding: { ...question.grounding, passageId: 'P2' } })) }
    assert.deepEqual([toPersonalSetView(GENERATION, 'x', upload).fileName, toPersonalSetView(GENERATION, 'x', upload).topic],
      ['week-3.pdf', null])
  })()
})

test('the free pass line shows only for a pass with its set unused', () => {
  const pass = { state: 'active', source: 'trial', total: 1, used: 0, endsAt: 'x', sourceCharLimit: 20000 }
  assert.equal(quizPassLine(pass), '1 of 1 Campus Bot set left on your free pass.')
  assert.equal(quizPassLine({ ...pass, total: 2, used: 0 }), '2 of 2 Campus Bot sets left on your free pass.')
  assert.equal(quizPassLine({ ...pass, used: 1 }), null)
  assert.equal(quizPassLine({ ...pass, sourceCharLimit: undefined }), null, 'a trial from before the pass')
  assert.equal(quizPassLine({ ...pass, source: 'paid', total: null }), null)
  assert.equal(quizPassLine({ state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null }), null)
  assert.equal(quizPassLine(null), null)
})

test('the stand-in provider writes sets the sets’ own checks accept, and scripts every other outcome', async () => {
  const source = topicPreparedSource(notes())
  const user = buildTopicSetPrompt({ code: 'ECO101', title: 'Economics' }, 'Elasticity', notes(), []).user
  const reply = async script => createFakeCampusBotProvider(() => script).generate({ system: '', user,
    outputSchema: { required: ['assessment', 'questions'] }, maxOutputTokens: 8000, signal: new AbortController().signal })
  const ok = await reply({})
  const judged = assessGeneratedQuestions(JSON.parse(ok.text), source, ITEM, 5)
  assert.equal(judged.kind, 'accepted')
  assert.equal(judged.questions.length, 5)
  assert.equal(assessGeneratedQuestions(JSON.parse((await reply({ set: 'few' })).text), source, ITEM, 5).kind, 'failed')
  assert.equal((await reply({ set: 'refused' })).kind, 'refused')
  await assert.rejects(reply({ set: 'timeout' }), ProviderError)
})
