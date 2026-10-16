// lib/ai-practice/practice-boundary.test.cjs — Personal sets stay outside official attempts and content.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parseContentPayload } = require('@/lib/operator/editor-contract')
const { attemptWriteSchema } = require('@/lib/quiz-attempts/input')
const { generatePracticeSet } = require('./service.ts')
const { scorePersonalAttempt, toPersonalPracticeItems, toPromotionCandidatePayload } = require('./practice-boundary.ts')
const { createFixtureProvider, fixtureText } = require('./fixtures/fixture-provider.cjs')

async function generatedSet() {
  const outcome = await generatePracticeSet({
    course: { courseId: 'demo-principles-of-marketing', code: 'DEMO 201', title: 'Principles of Marketing' },
    source: { documentId: '7c1d2f3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f', fileName: 'week-3-notes.txt',
      extractedText: fixtureText('marketing-mix-notes.txt') },
    questionCount: 5,
  }, { provider: createFixtureProvider(JSON.parse(fixtureText('marketing-mix.response.json'))), timeoutMs: 5000 })
  assert.equal(outcome.status, 'generated')
  return outcome.set
}

test('personal items reuse display fields but carry no official identity', async () => {
  const items = toPersonalPracticeItems(await generatedSet())
  assert.equal(items.length, 5)
  for (const item of items) {
    assert.equal(item.origin, 'ai-personal-unverified')
    assert.deepEqual(Object.keys(item).sort(), ['correctAnswer', 'explanation', 'id', 'options', 'origin',
      'question', 'section', 'sourceQuote'])
    for (const official of ['questionId', 'itemId', 'publishedRevision']) assert.equal(official in item, false)
  }
})

test('the official attempt contract rejects personal questions', async () => {
  const items = toPersonalPracticeItems(await generatedSet())
  const start = { operation: 'start', attemptId: '0f9e8d7c-6b5a-4c3d-9e2f-1a0b9c8d7e6f',
    courseContentKey: 'demo-principles-of-marketing',
    questions: items.map((item, ordinal) => ({ questionId: item.id, ordinal, publishedRevision: 1 })) }
  assert.equal(attemptWriteSchema.safeParse(start).success, false)
})

test('personal scoring is local, total and tolerant of bad answers', async () => {
  const items = toPersonalPracticeItems(await generatedSet())
  const answers = { [items[0].id]: items[0].correctAnswer, [items[1].id]: (items[1].correctAnswer + 1) % 4,
    [items[2].id]: 9, [items[3].id]: 1.5, __proto__: { [items[4].id]: items[4].correctAnswer } }
  const score = scorePersonalAttempt(items, answers)
  assert.deepEqual({ total: score.total, answered: score.answered, correct: score.correct },
    { total: 5, answered: 2, correct: 1 })
  assert.deepEqual(score.results.map(result => result.selected), [items[0].correctAnswer,
    (items[1].correctAnswer + 1) % 4, null, null, null])
})

test('a promotion candidate validates against the operator cbt_question contract', async () => {
  const set = await generatedSet()
  for (const question of set.questions) {
    const payload = toPromotionCandidatePayload(question)
    assert.deepEqual(parseContentPayload('cbt_question', payload), payload)
  }
})

test('the module never touches official content, operator tools or official attempts', () => {
  const allowedRpcs = new Set(['create_ai_practice_document', 'claim_ai_practice_extraction',
    'release_ai_practice_extraction', 'settle_ai_practice_document', 'note_ai_practice_upload_removed', 'get_my_ai_allowance', 'begin_ai_practice_generation',
    'finish_ai_practice_generation', 'list_ai_practice_uploads_to_remove', 'purge_expired_ai_practice'])
  const allowedTables = new Set(['ai_practice_documents', 'ai_practice_generations'])
  for (const file of fs.readdirSync(__dirname).filter(name => name.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.ok(!/from '@\/lib\/(managed-content|quiz-attempts|operator)/.test(source), file)
    assert.ok(!/\/api\/(quiz-attempts|admin)/.test(source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')), file)
    for (const [, name] of source.matchAll(/\.rpc\('([a-z_]+)'/g)) assert.ok(allowedRpcs.has(name), `${file}: rpc ${name}`)
    for (const [, table] of source.matchAll(/\.from\('([a-z_]+)'\)/g)) assert.ok(allowedTables.has(table), `${file}: table ${table}`)
  }
})
