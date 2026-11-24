// scripts/campus-bot/review-samples.test.cjs — The human review sheet: the real prompts over the database's sample,
// one row per explanation and per scripted message, cells a spreadsheet never reads as formulas, the calculation check
// on calculation courses, and a live run that stops before an estimated worst case would pass its cap.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run, cell, twoQuestions, wrongAnswer, MESSAGES, WRONG_ANSWER } = require('./review-samples.cjs')
const { checkPending, readChatReply } = require('../../lib/campus-bot/ask.ts')
const { readExplanation, readVerdict } = require('../../lib/campus-bot/explain.ts')
const { callCampusBotModel } = require('../../lib/campus-bot/model-call.ts')
const { notesContextFromSearch, notesContextFromTopic } = require('../../lib/campus-bot/notes-context.ts')
const { buildAskPrompt, buildExplainCheckPrompt, buildExplainPrompt } = require('../../lib/campus-bot/prompts.ts')
const { createFakeCampusBotProvider } = require('../../lib/campus-bot/provider.ts')
const { answerLeak, answerWords, boldTerms, echoLeak, hasEmoji, questionOptions, stripLeadingVerdict, studentText, wordCount, wordsOf } =
  require('../../lib/campus-bot/reply-text.ts')
const { estimateCostUsd } = require('../../lib/ai-practice/pricing.ts')

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:57611', SUPABASE_SECRET_KEY: 'local-secret' }
const ITEM = '11111111-1111-4111-8111-111111111111'
const STATUS = { settings: { writing_model: 'haiku', explain_check_model: 'sonnet' },
  models: { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5' },
  caps: [{ step: 'chat', read: 14000, written: 800 }, { step: 'explain', read: 8000, written: 800 },
    { step: 'explain-check', read: 4000, written: 2000 }] }
const sample = calculation => ({ course: { key: 'principles-economics-1', code: 'ECO101', title: 'Principles of Economics I', calculation },
  questions: [{ item_id: ITEM, revision: 1, prompt: '=SUM(A1) What happens when price rises?', options: ['It rises', 'It falls'],
    correct_option: 1, chosen_option: 0, section: 'Demand', explanation: 'The law of demand.',
    passages: [{ item_id: ITEM, topic_number: 5, topic_title: 'Demand and Supply', heading: 'Recap', body: 'Price up, quantity down.' }] },
  { item_id: '22222222-2222-4222-8222-222222222222', revision: 1, prompt: 'Not in the notes?', options: ['a', 'b'],
    correct_option: 0, chosen_option: 1, section: null, explanation: null, passages: [] }],
  topics: [{ item_id: ITEM, number: 5, title: 'Demand and Supply', passages: [{ heading: 'What you must know', body: 'Demand falls as price rises.' }] }] })

// The check-question flow on each topic: a quick check, its own answer, then a wrong one.
const FLOW = 3

function harness(calculation, providerScript = {}, chatTransform = null) {
  const requests = []
  const transport = async (url, init) => {
    const fn = new URL(url).pathname.replace('/rest/v1/rpc/', '')
    const body = JSON.parse(init.body)
    requests.push({ fn, body, apikey: init.headers.apikey })
    // As the database answers: at most the questions and topics asked for.
    const full = sample(calculation)
    const reply = fn === 'admin_campus_bot_status' ? STATUS
      : { ...full, questions: full.questions.slice(0, body.p_questions), topics: full.topics.slice(0, body.p_topics) }
    return new Response(JSON.stringify(reply), { status: 200 })
  }
  const calls = []
  const fake = createFakeCampusBotProvider(() => providerScript)
  // A chat reply may be rewritten, as a model that breaks the rules would write it.
  const provider = { id: fake.id, model: fake.model, generate: async request => {
    calls.push(request)
    const response = await fake.generate(request)
    if (chatTransform === null || !request.outputSchema.required.includes('checkAnswer')) return response
    return { ...response, text: JSON.stringify(chatTransform(JSON.parse(response.text))) }
  } }
  const deps = { fakeProvider: () => provider, liveProvider: () => provider, callModel: callCampusBotModel, cost: estimateCostUsd,
    notesFromSearch: notesContextFromSearch, notesFromTopic: notesContextFromTopic, explainPrompt: buildExplainPrompt,
    checkPrompt: buildExplainCheckPrompt, askPrompt: buildAskPrompt, readExplanation, readVerdict, readChatReply, checkPending,
    studentText, wordCount, stripLeadingVerdict, answerLeak, answerWords, boldTerms, echoLeak, hasEmoji, questionOptions, wordsOf,
    now: () => new Date('2026-11-17T08:00:00Z') }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'campus-bot-review-'))
  const printed = []
  return { requests, calls, out, printed,
    run: (args, env = ENV) => run([...args, '--out', out], env, transport, line => printed.push(line), deps) }
}

test('a mock review: every sampled question and scripted message is a row, from the real prompts', async () => {
  const h = harness(false)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '4', '--topics', '1'])
  assert.deepEqual(h.requests.map(request => request.fn), ['admin_campus_bot_status', 'admin_campus_bot_review_sample'])
  assert.deepEqual(h.requests[1].body, { p_content_key: 'principles-economics-1', p_questions: 4, p_topics: 1 })
  assert.equal(result.rows.length, 2 + MESSAGES.length + FLOW)
  const [explained, uncovered] = result.rows
  assert.equal(explained.outcome, 'explained from Demand and Supply')
  assert.match(explained.text, /^Option B is right because/)
  assert.equal(explained.official, 'B. It falls')
  assert.equal(explained.chosen, 'A. It rises')
  assert.equal(uncovered.outcome, 'not covered: no notes found')
  assert.equal(h.calls.length, 1 + MESSAGES.length + FLOW, 'no call for a question without notes')
  assert.match(h.calls[0].system, /The official correct option is always right/)
  const contact = result.rows.find(row => row.asked.startsWith('My email'))
  assert.match(contact.asked, /\(sent as: My email is \[removed\] and my phone is \[removed\]\. Can you remember them\?\)$/)
  assert.doesNotMatch(h.calls.map(call => call.user).join('\n'), /test\.student@example\.com|08031234567/,
    'contact details never reach a prompt')
  assert.deepEqual(JSON.parse(h.printed[0]), { mode: 'mock', rows: 2 + MESSAGES.length + FLOW, explanations: 2,
    messages: MESSAGES.length + FLOW, estimated_usd: Number(result.spent.toFixed(6)), stopped_at_cap: false, sheet: result.file })
  // The stand-in marks as expected: nothing to report, and the one guard it exercises (the verdict word it opens with).
  assert.equal(h.printed[1], 'violations: wrong verdict 0, verdict word kept at the start 0, answer leaked 0, '
    + '"not covered" label on a verdict reply 0, reply refers to a check that isn\'t shown 0, check with two questions 0, '
    + 'request to be tested with no check 0, Not quite reply not starting "The answer is" 0, emoji written 0, '
    + 'field with its bold markers removed 0; guards fired: verdict-word-removed 2')
  const sheet = fs.readFileSync(result.file, 'utf8').trim().split('\n')
  assert.equal(sheet.length, 1 + 2 + MESSAGES.length + FLOW)
  assert.match(sheet[0], /"Campus Bot","verdict","expected verdict","check question","memory trick","bold terms","guards","removed by a guard \(reviewer only\)","words"/)
  assert.match(sheet[0], /"reviewer: pass or fail","reviewer notes"$/)
  assert.match(sheet[1], /^"explain","principles-economics-1","11111111-1111-4111-8111-111111111111","'=SUM\(A1\) What happens/,
    'a cell that starts like a formula is kept as text')
  assert.equal(path.basename(result.file), 'campus-bot-review-2026-11-17T08-00-00-000Z.csv')
})

test('a calculation course: each explanation goes to the checking model, and the sheet says how it went', async () => {
  const passed = harness(true)
  const ok = await passed.run(['--courses', 'principles-economics-1', '--topics', '0'])
  assert.equal(ok.rows[0].outcome, 'check passed')
  assert.deepEqual(passed.calls.map(call => call.model), ['claude-haiku-5-5', 'claude-sonnet-5-5'])
  assert.match(ok.rows[0].checkTokens, /^1700 in \/ 700 out$/)
  const failed = harness(true, { check: 'fail' })
  assert.equal((await failed.run(['--courses', 'principles-economics-1', '--topics', '0'])).rows[0].outcome,
    'check failed: the student is shown the notes topic')
})

test('a live run needs a key and a spending cap, and stops before its worst case would pass the cap', async () => {
  const h = harness(false)
  await assert.rejects(h.run(['--courses', 'principles-economics-1', '--live']), /--live needs --max-usd/)
  await assert.rejects(h.run(['--courses', 'principles-economics-1', '--live', '--max-usd', '6']), /at most 5/)
  await assert.rejects(h.run(['--courses', 'principles-economics-1', '--live', '--max-usd', '1']), /ANTHROPIC_API_KEY/)
  // Haiku at its explain caps costs at most (8,000 x 0.10 + 800 x 0.50) / 1,000,000 = $0.0012: a $0.002 cap fits one.
  const capped = await h.run(['--courses', 'principles-economics-1', '--live', '--max-usd', '0.002'],
    { ...ENV, ANTHROPIC_API_KEY: 'sk-test-not-a-key' })
  assert.equal(capped.stopped, true)
  assert.equal(h.calls.length, 1)
  assert.ok(capped.spent <= 0.002)
  assert.equal(JSON.parse(h.printed.at(-2)).stopped_at_cap, true)
  assert.match(h.printed.at(-1), /^violations: /, 'a run stopped at its cap still ends with the summary')
})

test('on a calculation course the writer and the checker are reserved together before the first call', async () => {
  // Writer at its caps $0.0012, checker (Sonnet 4,000 x 2 + 2,000 x 10) / 1,000,000 = $0.028. Each fits $0.029 alone;
  // together ($0.0292) they do not, so nothing is called.
  const h = harness(true)
  const capped = await h.run(['--courses', 'principles-economics-1', '--live', '--max-usd', '0.029'],
    { ...ENV, ANTHROPIC_API_KEY: 'sk-test-not-a-key' })
  assert.equal(capped.stopped, true)
  assert.equal(h.calls.length, 0)
  // With room for both, the pair runs.
  const h2 = harness(true)
  const room = await h2.run(['--courses', 'principles-economics-1', '--live', '--max-usd', '0.03', '--questions', '1',
    '--topics', '0'], { ...ENV, ANTHROPIC_API_KEY: 'sk-test-not-a-key' })
  assert.equal(h2.calls.length, 2)
  assert.ok(room.spent <= 0.03)
})

test('course keys and counts are checked before anything is asked of the database', async () => {
  const h = harness(false)
  await assert.rejects(h.run([]), /--courses needs/)
  await assert.rejects(h.run(['--courses', 'Principles Of Economics']), /--courses needs/)
  await assert.rejects(h.run(['--courses', 'principles-economics-1', '--questions', '51']), /from 0 to 50/)
  await assert.rejects(h.run(['--courses', 'principles-economics-1'], { ...ENV, NEXT_PUBLIC_SUPABASE_URL: 'http://db.example.com' }),
    /configuration unavailable/, 'a remote database only over HTTPS')
  assert.equal(h.requests.length, 0)
  assert.equal(cell('+1 234'), `"'+1 234"`)
  assert.equal(cell('say "hi"'), '"say ""hi"""')
  assert.equal(cell(null), '""')
})

test('the check-question flow on each topic: Campus Bot’s own question, answered rightly and then wrongly, each marked', async () => {
  const h = harness(false)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const [asked, right, wrong] = result.rows.slice(-FLOW)
  assert.deepEqual([asked.kind, asked.verdict, asked.check], ['check: ask', 'none', 'Which lesson of this topic states its main idea?'])
  assert.deepEqual([right.kind, right.asked, right.expected, right.verdict, right.guards],
    ['check: right answer', 'the first lesson', 'correct', 'correct', ['verdict-word-removed']])
  assert.deepEqual([wrong.kind, wrong.asked, wrong.expected, wrong.verdict], ['check: wrong answer', WRONG_ANSWER, 'not-quite', 'not-quite'])
  assert.match(wrong.text, /^The answer is/)
  assert.equal(wrong.memoryTrick, '**F**irst lesson, **f**irst idea.')
  // Both answers are sent after the question, with it as the Campus Bot turn's Quick check.
  for (const call of h.calls.slice(-2)) assert.match(call.user, /\nQuick check: Which lesson of this topic states its main idea\?\n<\/conversation>/)
  // With nothing removed, the sheet shows only the answer the reviewer's student typed, never a check's answer.
  const sheet = fs.readFileSync(result.file, 'utf8')
  assert.doesNotMatch(sheet, /build on it/, 'the next check question’s answer is in no column')
  assert.deepEqual(result.summary, { wrongVerdict: 0, verdictWordKept: 0, answerLeaked: 0, notCoveredOnVerdict: 0,
    refersToMissingCheck: 0, twoQuestions: 0, testedWithoutCheck: 0, notQuiteWithoutAnswer: 0, emoji: 0, boldRemoved: 0,
    guards: { 'verdict-word-removed': 2 } })
})

test('the violation summary counts what the student would have seen wrongly, and which guards caught the model', async () => {
  // A model that marks every answer correct, says it is outside the notes, and gives its next question's answer away.
  const h = harness(false, {}, json => json.verdict === 'none' ? json
    : { ...json, verdict: 'correct', inNotes: false, reply: `Yes. ${json.reply} They build on it.` })
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual(result.summary, { wrongVerdict: 1, verdictWordKept: 0, answerLeaked: 0, notCoveredOnVerdict: 2,
    refersToMissingCheck: 0, twoQuestions: 0, testedWithoutCheck: 0, notQuiteWithoutAnswer: 0, emoji: 0, boldRemoved: 0,
    guards: { 'verdict-word-removed': 2, 'in-notes-set': 2, 'check-answer-leaked': 2 } })
  assert.match(h.printed[1], /^violations: wrong verdict 1, verdict word kept at the start 0, answer leaked 0, "not covered" label on a verdict reply 2,/)
  assert.match(h.printed[1], /guards fired: in-notes-set 2, verdict-word-removed 2, check-answer-leaked 2$/)
  // What a guard removed is in the sheet, with the check's answer, so a reviewer can see why.
  const [, right] = result.rows.slice(-2)
  assert.equal(right.removed, 'check: What do the later lessons do with the main idea? (answer: build on it)')
  assert.match(fs.readFileSync(result.file, 'utf8'), /"check: What do the later lessons do with the main idea\? \(answer: build on it\)"/)
})

test('the summary counts a reply pointing at a missing check, a two-part check and a request to be tested with no check', async () => {
  // Every reply that asks a check says "answer the quick check below" and gives its answer away, so the check is removed.
  const h = harness(false, {}, json => json.verdict === 'none' && json.check
    ? { ...json, reply: `${json.reply} Answer the quick check below. It is ${json.checkAnswer}.` } : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  // The stand-in asks a check after every unmarked reply: all seven (six messages and the flow's request) lost it.
  assert.equal(result.summary.refersToMissingCheck, MESSAGES.length + 1, 'each reply lost its check and still points at it')
  assert.equal(result.summary.testedWithoutCheck, 2)
  assert.equal(result.rows.at(-1).kind, 'check: ask', 'with no check shown, the flow stops after asking')
  // A check that asks two things.
  const two = harness(false, {}, json => json.check === 'Which lesson of this topic states its main idea?'
    ? { ...json, check: 'Which lesson states the main idea, and how do the later lessons use it?' } : json)
  assert.equal((await two.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])).summary.twoQuestions,
    MESSAGES.length + 1, 'each unmarked reply showed the two-part check')
  for (const one of ['Is 31 a parameter or a statistic?', 'What do the later lessons do with the main idea?',
    'Which consonant is glottal?']) assert.equal(twoQuestions(one), false, one)
  for (const pair of ['How many phonemes does English have, and how are they split between consonants and vowels?',
    'Which consonant is the only glottal sound in English, and is it voiced or voiceless?', 'What is it? Why?']) {
    assert.equal(twoQuestions(pair), true, pair)
  }
})

test('the wrong answer is an option the question offers that is not the answer, otherwise an unrelated one', () => {
  const { questionOptions } = require('../../lib/campus-bot/reply-text.ts')
  const deps = { answerWords, wordsOf, questionOptions }
  // 15:00 line 25: a real option, never part of the question.
  assert.equal(wrongAnswer('Which **voicing** state, voiced or voiceless, does the sound /z/ have, with the vocal folds vibrating or not vibrating?',
    'voiced', deps), 'voiceless')
  assert.equal(wrongAnswer('Which condition concerns the room: physical, physiological or psychological?', 'physical', deps), 'physiological')
  assert.equal(wrongAnswer('Is 31 a **parameter** or a **statistic**?', 'a statistic', deps), 'a parameter')
  assert.equal(wrongAnswer('Is "Government should provide free healthcare" positive or normative?', 'normative', deps), 'positive')
  assert.equal(wrongAnswer('Is "A bar of chocolate costs ₦500" positive or normative?', 'positive', deps), 'normative')
  assert.equal(wrongAnswer('Which condition concerns the lecturer’s speech defects?', 'physiological condition', deps), WRONG_ANSWER)
})

test('the summary counts a Not quite reply that does not start "The answer is", emoji written, and bold markers removed', async () => {
  const h = harness(false, {}, json => json.verdict === 'not-quite'
    ? { ...json, reply: 'That answer does not fit. The answer is the first lesson 🙂.', memoryTrick: '**First** **lesson** **first** **idea** **now**' }
    : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([result.summary.notQuiteWithoutAnswer, result.summary.emoji, result.summary.boldRemoved], [1, 1, 1])
  const wrong = result.rows.at(-1)
  assert.equal(wrong.memoryTrick, 'First lesson first idea now', 'five spans: shown without its markers')
  assert.match(wrong.guards.join(' '), /emoji-removed.*memory-trick-bold-removed/)
  assert.match(h.printed[1], /Not quite reply not starting "The answer is" 1, emoji written 1, field with its bold markers removed 1;/)
  // The bold terms column lists what each field shows in bold.
  const bold = harness(false, {}, json => json.verdict === 'correct' ? { ...json, memoryTrick: '**F**irst lesson, **f**irst idea.' } : json)
  const right = (await bold.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])).rows.at(-2)
  assert.equal(right.bold, 'memory trick: F, f')
})

test('a lead-in with no check question is a failed row: its reason, its guard, and a request to be tested with no check', async () => {
  const h = harness(false, {}, json => json.verdict === 'none' ? { ...json, reply: 'Here’s one.', check: '', checkAnswer: '' } : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const asked = result.rows.at(-1)
  assert.deepEqual([asked.kind, asked.outcome, asked.guards], ['check: ask',
    'failed: a lead-in with no check question (released, not charged)', ['lead-in-without-check']])
  assert.equal(result.summary.testedWithoutCheck, 2)
})
