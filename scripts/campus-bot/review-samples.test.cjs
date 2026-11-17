// scripts/campus-bot/review-samples.test.cjs — The human review sheet: the real prompts over the database's sample,
// one row per explanation and per scripted message, cells a spreadsheet never reads as formulas, the calculation check
// on calculation courses, and a live run that stops before an estimated worst case would pass its cap.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run, cell, MESSAGES } = require('./review-samples.cjs')
const { readChatReply } = require('../../lib/campus-bot/ask.ts')
const { readExplanation, readVerdict } = require('../../lib/campus-bot/explain.ts')
const { callCampusBotModel } = require('../../lib/campus-bot/model-call.ts')
const { notesContextFromSearch, notesContextFromTopic } = require('../../lib/campus-bot/notes-context.ts')
const { buildAskPrompt, buildExplainCheckPrompt, buildExplainPrompt } = require('../../lib/campus-bot/prompts.ts')
const { createFakeCampusBotProvider } = require('../../lib/campus-bot/provider.ts')
const { studentText, wordCount } = require('../../lib/campus-bot/reply-text.ts')
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

function harness(calculation, providerScript = {}) {
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
  const provider = { id: fake.id, model: fake.model, generate: request => { calls.push(request); return fake.generate(request) } }
  const deps = { fakeProvider: () => provider, liveProvider: () => provider, callModel: callCampusBotModel, cost: estimateCostUsd,
    notesFromSearch: notesContextFromSearch, notesFromTopic: notesContextFromTopic, explainPrompt: buildExplainPrompt,
    checkPrompt: buildExplainCheckPrompt, askPrompt: buildAskPrompt, readExplanation, readVerdict, readChatReply, studentText,
    wordCount, now: () => new Date('2026-11-17T08:00:00Z') }
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
  assert.equal(result.rows.length, 2 + MESSAGES.length)
  const [explained, uncovered] = result.rows
  assert.equal(explained.outcome, 'explained from Demand and Supply')
  assert.match(explained.text, /^Option B is right because/)
  assert.equal(explained.official, 'B. It falls')
  assert.equal(explained.chosen, 'A. It rises')
  assert.equal(uncovered.outcome, 'not covered: no notes found')
  assert.equal(h.calls.length, 1 + MESSAGES.length, 'no call for a question without notes')
  assert.match(h.calls[0].system, /The official correct option is always right/)
  const contact = result.rows.find(row => row.asked.startsWith('My email'))
  assert.match(contact.asked, /\(sent as: My email is \[removed\] and my phone is \[removed\]\. Can you remember them\?\)$/)
  assert.doesNotMatch(h.calls.map(call => call.user).join('\n'), /test\.student@example\.com|08031234567/,
    'contact details never reach a prompt')
  assert.deepEqual(JSON.parse(h.printed[0]), { mode: 'mock', rows: 2 + MESSAGES.length, explanations: 2,
    messages: MESSAGES.length, estimated_usd: result.spent, stopped_at_cap: false, sheet: result.file })
  const sheet = fs.readFileSync(result.file, 'utf8').trim().split('\n')
  assert.equal(sheet.length, 1 + 2 + MESSAGES.length)
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
  assert.equal(JSON.parse(h.printed.at(-1)).stopped_at_cap, true)
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
