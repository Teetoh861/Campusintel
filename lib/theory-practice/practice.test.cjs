const { test } = require('node:test')
const assert = require('node:assert/strict')
const { theorySubmission, THEORY_ANSWER_MAX_LENGTH, THEORY_BODY_MAX_BYTES, countSelfRatings } = require('./contract.ts')
const { authoredRubricPoints } = require('./rubric.ts')
const { projectTheoryPractice } = require('./projection.ts')
const { rows, row, theoryId, answerId, rubricId, courseId, question, modelAnswer, rubric, command, longDraft } = require('./fixtures.cjs')

test('the disclosure request is question identity only; any answer field and caller authority are refused', () => {
  assert.equal(theorySubmission.safeParse(command()).success, true)
  assert.equal(THEORY_ANSWER_MAX_LENGTH, 20000, 'the client draft limit is unchanged')
  assert.ok(Buffer.byteLength(JSON.stringify({ ...command(), courseSlug: 'a'.repeat(128),
    publishedRevision: Number.MAX_SAFE_INTEGER })) < THEORY_BODY_MAX_BYTES, 'the largest valid request fits the bound')
  for (const invalid of [{ ...command(), answer: '' }, { ...command(), answer: ' ' }, { ...command(), answer: 'x' },
    { ...command(), answer: longDraft() }, { ...command(), draft: 'x' }, { ...command(), reflection: 'x' },
    { ...command(), answer: null }, { ...command(), userId: courseId },
    { ...command(), rubric: { body: 'Caller rubric' } }, { ...command(), publishedRevision: 0 },
    { ...command(), courseSlug: '../admin' }, { ...command(), itemId: 'legacy:1' }]) {
    assert.equal(theorySubmission.safeParse(invalid).success, false)
  }
})

test('only explicit authored list points are separated; prose and mark weights are preserved', () => {
  assert.deepEqual(authoredRubricPoints(rubric.body), rubric.points)
  const body = 'Award two marks for the definition.\nThen consider the example.\n\nUse judgment.'
  assert.deepEqual(authoredRubricPoints(body), [body])
  assert.deepEqual(authoredRubricPoints('Guidance\n- Point A\n  continuation\n- Point B\nClosing note'),
    ['- Point A\n  continuation', '- Point B'])
  assert.deepEqual(authoredRubricPoints('a) First\r\nb) Second'), ['a) First', 'b) Second'])
  assert.deepEqual(authoredRubricPoints('• Define it\n• Give an example'), ['• Define it', '• Give an example'])
})

test('published theory uses managed identities and exact official bodies and revisions', () => {
  const result = projectTheoryPractice(rows())
  assert.equal(result.length, 1)
  assert.deepEqual(result[0], { question, feedback: { question, modelAnswer, rubric } })
  const edited = rows()
  edited[0] = { ...edited[0], revision: 9, payload: { prompt: 'Edited published prompt', examTip: 'Authored tip' } }
  const current = projectTheoryPractice(edited)[0]
  assert.equal(current.question.publishedRevision, 9)
  assert.equal(current.question.prompt, 'Edited published prompt')
  assert.equal(current.question.examTip, 'Authored tip')
})

test('no rubric means no invented marking points; no answer means no practice feedback', () => {
  const noRubric = projectTheoryPractice(rows().filter(item => item.kind !== 'rubric'))[0]
  assert.equal(noRubric.feedback.rubric, null)
  assert.deepEqual(noRubric.feedback.modelAnswer, modelAnswer)
  const noAnswer = projectTheoryPractice(rows().filter(item => item.kind !== 'model_answer'))[0]
  assert.equal(noAnswer.feedback, null)
  assert.deepEqual(projectTheoryPractice([]), [])
  assert.equal(projectTheoryPractice(rows().filter(item => item.kind !== 'theory_question')), null)
})

test('malformed or ambiguous dependents fail closed instead of choosing a draft or fallback', () => {
  for (const invalid of [
    [...rows(), row('model_answer', rubricId, 1, { body: 'Competing answer' }, theoryId)],
    [...rows(), row('rubric', answerId, 1, { body: 'Competing rubric' }, theoryId)],
    [rows()[0], { ...rows()[1], payload: { body: '' } }],
    [rows()[0], { ...rows()[1], parent_item_id: courseId }],
    [rows()[0], { ...rows()[1], payload: { body: modelAnswer.body, generatedPoints: ['Invented'] } }],
  ]) assert.equal(projectTheoryPractice(invalid), null)
})

test('coverage counts use every student selection without imposing rubric mark weights', () => {
  assert.deepEqual(countSelfRatings(['A', 'B', 'C', 'D'], { 0: 'covered', 1: 'partly', 2: 'not-yet', 50: 'covered' }),
    { covered: 1, partly: 1, 'not-yet': 1, reviewed: 3, total: 4 })
  assert.deepEqual(countSelfRatings([], {}), { covered: 0, partly: 0, 'not-yet': 0, reviewed: 0, total: 0 })
})
