// scripts/campus-bot/review-samples.test.cjs — The human review sheet: the real prompts over the database's sample,
// one row per explanation and per scripted message, cells a spreadsheet never reads as formulas, the calculation check
// on calculation courses, and a live run that stops before an estimated worst case would pass its cap.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run, cell, twoQuestions, wrongAnswer, MESSAGES, WRONG_ANSWER, FLASHCARDS_REQUEST } = require('./review-samples.cjs')
const { checkPending, readChatReply } = require('../../lib/campus-bot/ask.ts')
const { readExplanation, readVerdict } = require('../../lib/campus-bot/explain.ts')
const { readFlashcards } = require('../../lib/campus-bot/flashcards.ts')
const { callCampusBotModel, fitNotesPrompt } = require('../../lib/campus-bot/model-call.ts')
const { notesContextFromSearch, notesContextFromTopic } = require('../../lib/campus-bot/notes-context.ts')
const { buildAskPrompt, buildExplainCheckPrompt, buildExplainPrompt, buildFlashcardsPrompt, EXPLAIN_AGAIN_MESSAGE } =
  require('../../lib/campus-bot/prompts.ts')
const { createFakeCampusBotProvider } = require('../../lib/campus-bot/provider.ts')
const { announcesQuestion, answerLeak, answerWords, boldTerms, comparable, echoLeak, hasEmoji, isLeadIn, mentionsCheck,
  questionOptions, removeSentences, stripLeadingVerdict, studentText, wordCount, wordsOf } = require('../../lib/campus-bot/reply-text.ts')
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
  topics: [{ item_id: ITEM, number: 5, title: 'Demand and Supply', passages: [{ heading: 'What you must know',
    body: 'Demand falls as price rises, other things being equal. Supply rises as price rises. The market clears where '
      + 'the demand curve meets the supply curve, at the equilibrium price and quantity. A shortage pushes the price up, '
      + 'and a surplus pushes it down until buyers and sellers agree again.' }] }] })

// On each topic after the scripted messages: flashcards asked for in words, then Make flashcards.
const FLASHCARD_ROWS = 2
// The check-question flow on each topic: a quick check, its own answer, a wrong one, then Explain again.
const FLOW = 4

function harness(calculation, providerScript = {}, chatTransform = null, flashcardsTransform = null, topicPassages = null,
  overrides = {}) {
  const requests = []
  const transport = async (url, init) => {
    const fn = new URL(url).pathname.replace('/rest/v1/rpc/', '')
    const body = JSON.parse(init.body)
    requests.push({ fn, body, apikey: init.headers.apikey })
    // As the database answers: at most the questions and topics asked for.
    const full = sample(calculation)
    if (topicPassages !== null) full.topics[0].passages = topicPassages
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
    if (flashcardsTransform !== null && request.outputSchema.required.includes('cards')) {
      return { ...response, text: JSON.stringify(flashcardsTransform(JSON.parse(response.text))) }
    }
    if (chatTransform === null || !request.outputSchema.required.includes('checkAnswer')) return response
    return { ...response, text: JSON.stringify(chatTransform(JSON.parse(response.text))) }
  } }
  const deps = { fakeProvider: () => provider, liveProvider: () => provider, callModel: callCampusBotModel, cost: estimateCostUsd,
    notesFromSearch: notesContextFromSearch, notesFromTopic: notesContextFromTopic, explainPrompt: buildExplainPrompt,
    checkPrompt: buildExplainCheckPrompt, askPrompt: buildAskPrompt, readExplanation, readVerdict, readChatReply, checkPending,
    studentText, wordCount, stripLeadingVerdict, answerLeak, answerWords, boldTerms, echoLeak, hasEmoji, questionOptions, wordsOf,
    flashcardsPrompt: buildFlashcardsPrompt, readFlashcards, fitNotesPrompt, explainAgainMessage: EXPLAIN_AGAIN_MESSAGE,
    comparable, mentionsCheck, announcesQuestion, removeSentences, isLeadIn, now: () => new Date('2026-11-17T08:00:00Z'),
    ...overrides }
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
  assert.equal(result.rows.length, 2 + MESSAGES.length + FLASHCARD_ROWS + FLOW)
  const [explained, uncovered] = result.rows
  assert.equal(explained.outcome, 'explained from Demand and Supply')
  assert.match(explained.text, /^Option B is right because/)
  assert.equal(explained.official, 'B. It falls')
  assert.equal(explained.chosen, 'A. It rises')
  assert.equal(uncovered.outcome, 'not covered: no notes found')
  assert.equal(h.calls.length, 1 + MESSAGES.length + FLASHCARD_ROWS + FLOW, 'no call for a question without notes')
  assert.match(h.calls[0].system, /The official correct option is always right/)
  const contact = result.rows.find(row => row.asked.startsWith('My email'))
  assert.match(contact.asked, /\(sent as: My email is \[removed\] and my phone is \[removed\]\. Can you remember them\?\)$/)
  assert.doesNotMatch(h.calls.map(call => call.user).join('\n'), /test\.student@example\.com|08031234567/,
    'contact details never reach a prompt')
  assert.deepEqual(JSON.parse(h.printed[0]), { mode: 'mock', rows: 2 + MESSAGES.length + FLASHCARD_ROWS + FLOW,
    explanations: 2, messages: MESSAGES.length + 1 + FLOW, flashcards: 1, estimated_usd: Number(result.spent.toFixed(6)),
    stopped_at_cap: false, sheet: result.file })
  // The stand-in marks as expected: nothing to report but the not quite it gives Explain again on purpose (so a browser
  // check shows the server never marking it), and the guards it exercises.
  assert.equal(h.printed[1], 'violations: wrong verdict 0, verdict word kept at the start 0, answer leaked 0, '
    + '"not covered" label on a verdict reply 0, reply refers to a check that isn\'t shown 0, check with two questions 0, '
    + 'request to be tested with no check 0, Not quite reply not starting "The answer is" 0, emoji written 0, '
    + 'field with its bold markers removed 0, Explain again marked by the model 1, Explain again repeating the last '
    + 'reply 0, flashcards asked for in words with a check question 0, flashcards asked for in words not naming Make '
    + 'flashcards 0, flashcards failed 0, flashcards dropped for grounding 0, warning: sets under 8 cards 0, '
    + 'Explain again with a check 0, Explain again mentioning the chat 0, reply mentioning the check 0; '
    + 'guards fired: verdict-word-removed 2, explain-again-verdict-removed 1')
  const sheet = fs.readFileSync(result.file, 'utf8').trim().split('\n')
  assert.equal(sheet.filter(line => line.startsWith('"')).length, 1 + 2 + MESSAGES.length + FLASHCARD_ROWS + FLOW,
    'one line per row (a set of flashcards is one quoted cell over several lines)')
  assert.match(sheet[0], /"Campus Bot","verdict","expected verdict","check question","memory trick","bold terms","guards","removed by a guard \(reviewer only\)","words","cards"/)
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
  const [asked, right, wrong, again] = result.rows.slice(-FLOW)
  assert.deepEqual([asked.kind, asked.verdict, asked.check], ['check: ask', 'none', 'Which lesson of this topic states its main idea?'])
  assert.deepEqual([right.kind, right.asked, right.expected, right.verdict, right.guards],
    ['check: right answer', 'the first lesson', 'correct', 'correct', ['verdict-word-removed']])
  assert.deepEqual([wrong.kind, wrong.asked, wrong.expected, wrong.verdict], ['check: wrong answer', WRONG_ANSWER, 'not-quite', 'not-quite'])
  assert.match(wrong.text, /^The answer is/)
  assert.equal(wrong.memoryTrick, '**F**irst lesson, **f**irst idea.')
  // Both answers are sent after the question, with it as the Campus Bot turn's Quick check.
  for (const call of h.calls.slice(-3, -1)) assert.match(call.user, /\nQuick check: Which lesson of this topic states its main idea\?\n<\/conversation>/)
  // Then Explain again, after the Not quite: the server's fixed message after the whole exchange, never marked, with
  // Explain again's instruction in the prompt, and (fix round 4) no check question: the Try another that was waiting ends.
  assert.deepEqual([again.kind, again.asked, again.verdict, again.rawVerdict, again.check, again.guards],
    ['check: explain again', `Explain again (sent as: ${EXPLAIN_AGAIN_MESSAGE})`, 'none', 'not-quite', '',
      ['explain-again-verdict-removed']])
  assert.equal('waiting' in again, false, 'the row no longer carries a waiting question')
  assert.match(h.calls.at(-1).system, /- The student tapped Explain again\./)
  assert.doesNotMatch(h.calls.at(-2).system, /tapped Explain again/, 'and only there')
  assert.match(h.calls.at(-1).user, /\nStudent: The capital of France\.\nCampus Bot: The answer is the \*\*first lesson\*\*\. .*\nQuick check: What do the later lessons do with the main idea\?\n<\/conversation>\n\n<student_message>\nPlease explain that again in a simpler way\.\n<\/student_message>$/)
  assert.equal(again.previous, wrong.text)
  // With nothing removed, the sheet shows only the answer the reviewer's student typed, never a check's answer.
  const sheet = fs.readFileSync(result.file, 'utf8')
  assert.doesNotMatch(sheet, /build on it/, 'the next check question’s answer is in no column')
  assert.deepEqual(result.summary, { wrongVerdict: 0, verdictWordKept: 0, answerLeaked: 0, notCoveredOnVerdict: 0,
    refersToMissingCheck: 0, twoQuestions: 0, testedWithoutCheck: 0, notQuiteWithoutAnswer: 0, emoji: 0, boldRemoved: 0,
    explainAgainMarked: 1, explainAgainRepeated: 0, flashcardsRequestCheck: 0, flashcardsRequestUnnamed: 0,
    flashcardsFailed: 0, flashcardsUngrounded: 0, flashcardsFew: 0, explainAgainWithCheck: 0, replyMentionsCheck: 0,
    explainAgainMentionsChat: 0,
    guards: { 'verdict-word-removed': 2, 'explain-again-verdict-removed': 1 } })
})

test('the violation summary counts what the student would have seen wrongly, and which guards caught the model', async () => {
  // A model that marks every answer correct, says it is outside the notes, and gives its next question's answer away.
  const h = harness(false, {}, json => json.verdict === 'none' ? json
    : { ...json, verdict: 'correct', inNotes: false, reply: `Yes. ${json.reply} They build on it.` })
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  // Explain again, marked by the model too, is shown unmarked, and with no check question.
  assert.deepEqual(result.summary, { wrongVerdict: 1, verdictWordKept: 0, answerLeaked: 0, notCoveredOnVerdict: 2,
    refersToMissingCheck: 0, twoQuestions: 0, testedWithoutCheck: 0, notQuiteWithoutAnswer: 0, emoji: 0, boldRemoved: 0,
    explainAgainMarked: 1, explainAgainRepeated: 0, flashcardsRequestCheck: 0, flashcardsRequestUnnamed: 0,
    flashcardsFailed: 0, flashcardsUngrounded: 0, flashcardsFew: 0, explainAgainWithCheck: 0, replyMentionsCheck: 0,
    explainAgainMentionsChat: 0,
    guards: { 'verdict-word-removed': 2, 'in-notes-set': 2, 'check-answer-leaked': 2, 'explain-again-verdict-removed': 1 } })
  assert.equal(result.rows.at(-1).check, '')
  assert.match(h.printed[1], /^violations: wrong verdict 1, verdict word kept at the start 0, answer leaked 0, "not covered" label on a verdict reply 2,/)
  assert.match(h.printed[1], /guards fired: in-notes-set 2, verdict-word-removed 2, check-answer-leaked 2, explain-again-verdict-removed 1$/)
  // What a guard removed is in the sheet, with the check's answer, so a reviewer can see why.
  const [, right] = result.rows.slice(-3, -1)
  assert.equal(right.removed, 'check: What do the later lessons do with the main idea? (answer: build on it)')
  assert.match(fs.readFileSync(result.file, 'utf8'), /"check: What do the later lessons do with the main idea\? \(answer: build on it\)"/)
})

test('the summary counts a reply pointing at a missing check, a two-part check and a request to be tested with no check', async () => {
  // Every reply that asks a check says "try the question below" and gives its answer away, so the check is removed.
  const h = harness(false, {}, json => json.verdict === 'none' && json.check
    ? { ...json, reply: `${json.reply} Try the question below. It is ${json.checkAnswer}.` } : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  // The stand-in asks a check after every unmarked reply: all seven (six messages and the flow's request) lost it.
  assert.equal(result.summary.refersToMissingCheck, MESSAGES.length + 1, 'each reply lost its check and still points at it')
  assert.equal(result.summary.testedWithoutCheck, 2)
  assert.equal(result.rows.at(-1).kind, 'check: ask', 'with no check shown, the flow stops after asking')
  // Fix round 4 (3D): a sentence naming "the quick check" or "the check question" goes before anything is shown, so only
  // the guard says it was there.
  const quick = harness(false, {}, json => json.verdict === 'none' && json.check
    ? { ...json, reply: `${json.reply} Answer the quick check below. It is ${json.checkAnswer}.` } : json)
  const quickRun = await quick.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([quickRun.summary.refersToMissingCheck, quickRun.summary.replyMentionsCheck,
    quickRun.summary.guards['reply-check-mention-removed']], [0, 0, MESSAGES.length + 1])
  // A check that asks two things.
  const two = harness(false, {}, json => json.check === 'Which lesson of this topic states its main idea?'
    ? { ...json, check: 'Which lesson states the main idea, and how do the later lessons use it?' } : json)
  // Fix round 3 (4C.4): the new guard drops a check that asks two things, so none is shown; the guard says so.
  const twoRun = await two.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([twoRun.summary.twoQuestions, twoRun.summary.guards['check-two-questions']], [0, MESSAGES.length + 1],
    'each unmarked reply lost its two-part check')
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
  // Only the reply to the wrong answer (the stand-in's starts "No."), not the Explain again after it.
  const h = harness(false, {}, json => json.verdict === 'not-quite' && json.reply.startsWith('No.')
    ? { ...json, reply: 'That answer does not fit. The answer is the first lesson 🙂.', memoryTrick: '**First** **lesson** **first** **idea** **now**' }
    : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([result.summary.notQuiteWithoutAnswer, result.summary.emoji, result.summary.boldRemoved], [1, 1, 1])
  const wrong = result.rows.at(-2)
  assert.equal(wrong.memoryTrick, 'First lesson first idea now', 'five spans: shown without its markers')
  assert.match(wrong.guards.join(' '), /emoji-removed.*memory-trick-bold-removed/)
  assert.match(h.printed[1], /Not quite reply not starting "The answer is" 1, emoji written 1, field with its bold markers removed 1,/)
  // The bold terms column lists what each field shows in bold.
  const bold = harness(false, {}, json => json.verdict === 'correct' ? { ...json, memoryTrick: '**F**irst lesson, **f**irst idea.' } : json)
  const right = (await bold.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])).rows.at(-3)
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

test('Make flashcards on each topic: each card as "term | meaning", the count and the guards, from the notes alone', async () => {
  const h = harness(false)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const row = result.rows.find(each => each.kind === 'flashcards')
  assert.deepEqual([row.asked, row.outcome, row.cards, row.guards, row.removed, row.notes],
    ['Make flashcards', '8 cards', 8, [], '', '1 of 1 passages'])
  assert.equal(row.text.split('\n').length, 8)
  assert.ok(row.text.split('\n').every(line => / \| /.test(line)), 'each card on its own line as term | meaning')
  const call = h.calls.find(each => each.outputSchema.required.includes('cards'))
  assert.match(call.user, /<notes>/)
  assert.doesNotMatch(call.user, /<conversation>|<student_message>/, 'the notes alone, as the server sends them')
  assert.equal(call.maxOutputTokens, 800, 'at the chat step’s caps')
  const sheet = fs.readFileSync(result.file, 'utf8')
  assert.match(sheet, /"flashcards","principles-economics-1","topic 5: Demand and Supply","Make flashcards",/)
  // Asked for in words, Campus Bot points to the button and asks no check question.
  const asked = result.rows.find(each => each.asked === FLASHCARDS_REQUEST)
  assert.deepEqual([asked.kind, asked.check], ['flashcards: asked in words', ''])
  assert.match(asked.text, /Make flashcards/)
})

test('flashcards violations: dropped for grounding, a set under 8 (a warning), a failure, and a request in words answered wrongly', async () => {
  // Five good cards and two that name what the notes do not contain.
  const ungrounded = harness(false, {}, null, json => ({ cards: [...json.cards.slice(0, 5),
    { term: 'Price elasticity', meaning: 'How far demand responds to price.' },
    { term: 'Giffen goods', meaning: 'Goods bought more as their price rises.' }] }))
  const one = await ungrounded.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([one.summary.flashcardsUngrounded, one.summary.flashcardsFew, one.summary.flashcardsFailed], [2, 1, 0])
  const row = one.rows.find(each => each.kind === 'flashcards')
  assert.deepEqual([row.cards, row.guards], [5, ['term-not-in-notes']])
  assert.match(row.removed, /^Price elasticity \| How far demand responds to price\. \(term-not-in-notes\)\nGiffen goods \| /)
  assert.match(ungrounded.printed[1], /flashcards failed 0, flashcards dropped for grounding 2, warning: sets under 8 cards 1,/)
  // Three cards left: no set, released and not charged.
  const few = harness(false, { flashcards: 'few' })
  const two = await few.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const failed = two.rows.find(each => each.kind === 'flashcards')
  assert.deepEqual([failed.outcome, failed.cards, two.summary.flashcardsFailed, two.summary.flashcardsFew],
    ['failed: fewer than 4 cards left (released, not charged)', 0, 1, 0])
  const refused = harness(false, { flashcards: 'timeout' })
  assert.equal((await refused.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1']))
    .summary.flashcardsFailed, 1)
  // Asked for in words, a reply that asks a check question and never names the button.
  const words = harness(false, {}, json => json.reply.startsWith('Tap Make flashcards')
    ? { ...json, reply: 'Here are the key ideas to revise.', check: 'Which lesson of this topic states its main idea?',
      checkAnswer: 'the first lesson' } : json)
  const three = await words.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([three.summary.flashcardsRequestCheck, three.summary.flashcardsRequestUnnamed], [1, 1])
})

test('Explain again violations: a verdict the model wrote, and a reply that repeats the one it explains again', async () => {
  // The model repeats its Not quite reply word for word, without a verdict.
  const h = harness(false, {}, json => json.reply.startsWith('Put simply')
    ? { ...json, verdict: 'none', reply: 'The answer is the **first lesson**. The notes state the main idea there, before the later lessons add detail.' }
    : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  assert.deepEqual([result.summary.explainAgainMarked, result.summary.explainAgainRepeated], [0, 1])
  assert.match(h.printed[1], /Explain again marked by the model 0, Explain again repeating the last reply 1,/)
})

test('a long topic: every chat row carries as much of the notes as fits the chat step’s cap, as the server sends it', async () => {
  // Twelve passages of 3,000 characters: the whole topic is over the 14,000-token cap, so the server sends fewer.
  const passages = Array.from({ length: 12 }, (_, index) => ({ heading: `Lesson ${index + 1}`,
    body: `Lesson ${index + 1} of demand and supply. `.repeat(75).trim() }))
  const h = harness(false, {}, null, null, passages)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const chats = result.rows.filter(row => row.kind !== 'flashcards')
  assert.ok(chats.every(row => /^\d+ of 12 passages$/.test(row.notes) && !row.notes.startsWith('12 ')), JSON.stringify(chats.map(row => row.notes)))
  assert.equal(result.rows.filter(row => /^failed/.test(row.outcome)).length, 0, 'no row fails for a prompt over the cap')
  assert.ok(h.calls.every(call => (call.system.length + call.user.length + JSON.stringify(call.outputSchema).length) / 2 + 400 <= 14000))
  assert.equal(result.rows.at(-1).kind, 'check: explain again', 'so the flow reaches Explain again on the longest topics too')
})

test('fix round 4: Explain again rows never show a check question; the summary counts one shown (expected 0) and one about the chat', async () => {
  const run = async (transform, overrides = {}) => {
    const h = harness(false, {}, json => json.reply.startsWith('Put simply') ? transform(json) : json, null, null, overrides)
    const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
    return { h, result, row: result.rows.at(-1) }
  }
  // As the stand-in writes it: no check question, so the Try another that was waiting ends.
  const plain = await run(json => json)
  assert.deepEqual([plain.row.check, plain.row.guards, plain.result.summary.explainAgainWithCheck],
    ['', ['explain-again-verdict-removed'], 0])
  assert.match(plain.h.printed[1], /, Explain again with a check 0, Explain again mentioning the chat 0, reply mentioning the check 0; /)
  // A question the model writes anyway goes, and the guard is counted; the row never shows it.
  const own = await run(json => ({ ...json, check: 'Which lesson states the main idea?', checkAnswer: 'the first lesson' }))
  assert.deepEqual([own.row.check, own.result.summary.explainAgainWithCheck, own.result.summary.guards['explain-again-check-removed']],
    ['', 0, 1])
  // Were a check ever shown on Explain again, the count would say so (a reader that ignores Explain again).
  const leaky = await run(json => ({ ...json, check: 'Which lesson states the main idea?', checkAnswer: 'the first lesson' }),
    { readChatReply: (json, pending) => readChatReply(json, pending) })
  assert.deepEqual([leaky.row.check, leaky.result.summary.explainAgainWithCheck], ['Which lesson states the main idea?', 1])
  assert.match(leaky.h.printed[1], /, Explain again with a check 1, /)
  // Run 3, row 41: about the chat, so it fails, released and not charged; the row and the summary say so.
  const chat = await run(json => ({ ...json, reply: 'Put simply, your last reply said the main idea comes first.' }))
  assert.deepEqual([chat.row.outcome, chat.row.guards.at(-1), chat.result.summary.explainAgainMentionsChat],
    ['failed: Explain again mentioning the chat (released, not charged)', 'explain-again-mentions-chat', 1])
  assert.match(chat.h.printed[1], /Explain again with a check 0, Explain again mentioning the chat 1, reply mentioning the check 0; guards fired: .*explain-again-mentions-chat 1/)
})

test('fix round 4: "reply mentioning the check" counts shown replies after the guards; a reply left empty is a failed row', async () => {
  // The guards remove such sentences, so the count is 0 (run 4 rows 117 and 66, as the server now shows them).
  const talk = harness(false, {}, json => json.verdict === 'correct'
    ? { ...json, reply: `${json.reply} Since the answer is in the notes, the check question is about the same branch.` }
    : json.verdict === 'not-quite' && json.reply.startsWith('No.') ? { ...json, check: '', checkAnswer: '',
      reply: `${json.reply} Next, let's check how voicing works.` } : json)
  const talked = await talk.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const [right, wrong] = talked.rows.slice(-3, -1)
  assert.doesNotMatch(right.text, /check question/)
  assert.doesNotMatch(wrong.text, /let's check/)
  assert.deepEqual([right.guards.includes('reply-check-mention-removed'), wrong.guards.includes('reply-check-mention-removed'),
    talked.summary.replyMentionsCheck, talked.summary.guards['reply-check-mention-removed']], [true, true, 0, 2])
  // Were one ever shown, the count would say so: a reader that adds such a sentence after the guards.
  const added = harness(false, {}, null, null, null, { readChatReply: (json, pending, explainAgain) => {
    const read = readChatReply(json, pending, explainAgain)
    return read?.reply ? { ...read, reply: { ...read.reply, text: `${read.reply.text} Now try the quick check.` } } : read
  } })
  const addedRun = await added.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const shown = addedRun.rows.filter(row => row.answer).length
  assert.equal(addedRun.summary.replyMentionsCheck, shown)
  assert.match(added.printed[1], new RegExp(`, reply mentioning the check ${shown}; `))
  // A reply that was only talk about the check: nothing is left, so the row fails, released and not charged.
  const empty = harness(false, {}, json => json.verdict === 'correct'
    ? { ...json, reply: 'Since the answer is in the notes, the check question is about the same branch.' } : json)
  const emptyRun = await empty.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const failed = emptyRun.rows.find(row => row.kind === 'check: right answer')
  assert.deepEqual([failed.outcome, failed.guards.at(-1)],
    ['failed: nothing left after removing talk about the check (released, not charged)', 'reply-check-mention-removed'])
})

test('fix round 3: the new check guards are counted by name in the summary', async () => {
  const h = harness(false, {}, json => json.check === 'Which lesson of this topic states its main idea?'
    ? { ...json, check: 'In the word PREsent, is the stress on the first syllable?' } : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  // Since run 5 the word is written in lower case and the check kept, under its own guard.
  assert.deepEqual([result.summary.guards['check-stress-capitals-lowered'], result.summary.guards['check-stress-capitals']],
    [MESSAGES.length + 1, undefined])
  assert.match(h.printed[1], /guards fired: .*check-stress-capitals-lowered 7/)
  assert.ok(result.rows.some(row => row.check === 'In the word present, is the stress on the first syllable?'))
})

test('fix round 4: the new guards are counted by name, and a check shown plain is not a field with its bold removed', async () => {
  // Every check in bold (3B), every Try another talked about (3D), and a check written on Explain again (3A).
  const h = harness(false, {}, json => json.reply.startsWith('Put simply')
    ? { ...json, check: 'Which lesson states the main idea?', checkAnswer: 'the first lesson' }
    : json.check ? { ...json, check: json.check.replace(/^(\S+ \S+)/, '**$1**'),
      reply: `${json.reply} The check question is about this topic.` } : json)
  const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const checked = result.rows.filter(row => typeof row.check === 'string' && row.check !== '')
  assert.ok(checked.length > 0 && checked.every(row => !row.check.includes('**')), 'every check shown plain')
  assert.deepEqual([result.summary.guards['check-bold-removed'], result.summary.guards['reply-check-mention-removed'],
    result.summary.guards['explain-again-check-removed'], result.summary.boldRemoved],
  [checked.length, checked.length, 1, 0])
  assert.match(h.printed[1], /field with its bold markers removed 0,/)
  assert.match(h.printed[1], new RegExp(`guards fired: .*reply-check-mention-removed ${checked.length}.*check-bold-removed ${checked.length}`))
  assert.match(h.printed[1], /explain-again-check-removed 1/)
})

test('"reply mentioning the check" skips a lead-in the server keeps because a check is shown ("Here\'s a quick check.")', async () => {
  // Each request answered "Here's a quick check." with its question: the server keeps the lead-in, so nothing is counted.
  const kept = harness(false, {}, json => json.verdict === 'none' && json.check ? { ...json, reply: 'Here\'s a quick check.' } : json)
  const keptRun = await kept.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
  const leadIns = keptRun.rows.filter(row => row.answer?.text === 'Here\'s a quick check.')
  assert.ok(leadIns.length > 0 && leadIns.every(row => row.answer.check !== null && row.guards.length === 0), 'shown with their checks')
  assert.equal(keptRun.summary.replyMentionsCheck, 0)
  assert.match(kept.printed[1], /, reply mentioning the check 0; /)
  // Shown with no check question, or beside other talk about the check, it would count (readers that let it through).
  const through = text => harness(false, {}, null, null, null, { readChatReply: (json, pending, explainAgain) => {
    const read = readChatReply(json, pending, explainAgain)
    return read?.reply ? { ...read, reply: { ...read.reply, ...text(read.reply) } } : read
  } })
  for (const text of [() => ({ text: 'Here\'s a quick check.', check: null }),
    reply => ({ text: `Here's a quick check. The check question is about ${reply.check ? 'this topic' : 'nothing'}.` })]) {
    const h = through(text)
    const result = await h.run(['--courses', 'principles-economics-1', '--questions', '0', '--topics', '1'])
    assert.equal(result.summary.replyMentionsCheck, result.rows.filter(row => row.answer).length)
  }
})
