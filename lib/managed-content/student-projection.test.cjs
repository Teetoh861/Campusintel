// lib/managed-content/student-projection.test.cjs — Published learning rows drive student views without legacy fallback.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { projectStudentLearning } = require('./student-projection.ts')
const { getUsableManagedQuiz } = require('./quiz.ts')
const { getQuizConfigurationByCourseSlug } = require('../data/quizzes.ts')

const courseId = '40000000-0000-4000-8000-000000000007'
const theoryId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const questionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const row = (kind, payload, extra = {}) => ({
  item_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', course_id: courseId,
  kind, question_id: null, source_key: null, parent_item_id: null,
  revision: 1, payload, ...extra,
})
const overview = row('course_overview', { title: 'Managed overview', body: 'Published managed body',
  topics: [{ chapter: 'Managed topic', description: 'Managed description' }],
  examFocus: ['Managed exam focus'], keyTakeaways: [{ title: 'Managed takeaway', description: 'Remember this' }],
  formulaSheet: [{ name: 'Managed formula', formula: 'a+b', explanation: 'Add inputs' }] }, { revision: 2 })
const theory = row('theory_question', { prompt: 'Published theory wording', examTip: 'Published tip' },
  { item_id: theoryId, source_key: 'theory:1', revision: 2 })
const cbt = row('cbt_question', { prompt: 'New operator question', options: ['No', 'Yes'],
  correctOption: 1, section: 'New section' }, { question_id: questionId, revision: 3 })

test('overview, theory and CBT show their published managed revision and stable question UUID', () => {
  const result = projectStudentLearning([overview, theory, cbt])
  assert.equal(result.status, 'ok')
  assert.equal(result.learning.overview.body, 'Published managed body')
  assert.equal(result.learning.overview.topics[0].chapter, 'Managed topic')
  assert.deepEqual(result.learning.theoryQuestions,
    [{ itemId: theoryId, prompt: 'Published theory wording', displayNumber: 1, examTip: 'Published tip' }])
  assert.equal(result.learning.quizQuestions[0].questionId, questionId)
  assert.equal(result.learning.quizQuestions[0].publishedRevision, 3)
  assert.equal(result.learning.quizQuestions[0].question, 'New operator question')
  assert.equal(cbt.source_key, null, 'new CBT questions do not require legacy source_key')
  const config = getQuizConfigurationByCourseSlug('financial-accounting-1')
  const usable = getUsableManagedQuiz('financial-accounting-1', config, result.learning.quizQuestions)
  assert.equal(usable.bankSize, 1)
  assert.equal(usable.attemptSize, 1)
  assert.equal(usable.questions[0].questionId, questionId)
  assert.ok(usable.sections.includes('New section'))
})

test('legacy theory numbering survives publication order and new theory needs no legacy key', () => {
  const second = { ...theory, item_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    source_key: 'theory:2', payload: { prompt: 'Second legacy prompt' } }
  const created = { ...theory, item_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    source_key: null, payload: { prompt: 'New operator prompt' } }
  const questions = projectStudentLearning([second, created, theory]).learning.theoryQuestions
  assert.deepEqual(questions.map(question => question.prompt),
    ['Published theory wording', 'Second legacy prompt', 'New operator prompt'])
  assert.deepEqual(questions.map(question => question.displayNumber), [1, 2, undefined])
})

test('unpublished overview, theory and CBT disappear instead of returning repository content', () => {
  const withoutOverview = projectStudentLearning([theory, cbt])
  assert.equal(withoutOverview.learning.overview, null)
  const withoutTheory = projectStudentLearning([overview, cbt])
  assert.deepEqual(withoutTheory.learning.theoryQuestions, [])
  const withoutCbt = projectStudentLearning([overview, theory])
  assert.deepEqual(withoutCbt.learning.quizQuestions, [])
  assert.equal(getUsableManagedQuiz('financial-accounting-1',
    getQuizConfigurationByCourseSlug('financial-accounting-1'), withoutCbt.learning.quizQuestions), null)
})

test('invalid published payload, duplicate identity and orphaned dependent content fail closed', () => {
  assert.deepEqual(projectStudentLearning([row('cbt_question', { prompt: 'No answer' },
    { question_id: questionId })]), { status: 'unavailable' })
  assert.deepEqual(projectStudentLearning([overview, { ...overview, item_id: theoryId }]),
    { status: 'unavailable' })
  assert.deepEqual(projectStudentLearning([cbt, { ...cbt, item_id: theoryId }]),
    { status: 'unavailable' })
  assert.deepEqual(projectStudentLearning([row('model_answer', { body: 'Stale answer' },
    { parent_item_id: theoryId })]), { status: 'unavailable' })
})

const plainNote = row('note', { title: 'Plain note', body: 'Plain published body' },
  { item_id: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', revision: 2 })
const topicNote = row('note', { title: 'Topic note', body: 'Topic body', noteType: 'topic_note',
  keyPoints: ['First key point', 'Second key point'], examTip: 'Published exam tip' },
{ item_id: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2', revision: 1 })
const calculatorTrick = row('note', { title: 'Break-Even Point Calculation', body: 'Divide fixed cost by contribution.',
  noteType: 'calculator_trick', example: 'FC = ₦1,000,000; P − v = ₦2,000 → BEQ = 500 units',
  formula: 'BEQ = FC ÷ (P − v) × 1' }, { item_id: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', revision: 3 })

test('plain, topic and calculator notes project through the editor contract with payloads preserved exactly', () => {
  const result = projectStudentLearning([overview, plainNote, topicNote, calculatorTrick, theory, cbt])
  assert.equal(result.status, 'ok')
  assert.deepEqual(result.learning.notes, [
    { itemId: plainNote.item_id, publishedRevision: 2, title: 'Plain note', body: 'Plain published body' },
    { itemId: topicNote.item_id, publishedRevision: 1, ...topicNote.payload },
    { itemId: calculatorTrick.item_id, publishedRevision: 3, ...calculatorTrick.payload },
  ])
  assert.equal(result.learning.notes[2].formula, 'BEQ = FC ÷ (P − v) × 1')
  assert.equal(result.learning.notes[2].example, calculatorTrick.payload.example)
  assert.equal(result.learning.overview.formulaSheet[0].formula, 'a+b')
  assert.equal(result.learning.overview.body, 'Published managed body')
  assert.equal(result.learning.theoryQuestions.length, 1)
  assert.equal(result.learning.quizQuestions.length, 1)
  assert.equal(result.learning.quizQuestions[0].questionId, questionId)
})

test('notes are absent without publication and never substitute for an overview', () => {
  assert.deepEqual(projectStudentLearning([overview, theory, cbt]).learning.notes, [])
  const notesOnly = projectStudentLearning([plainNote])
  assert.equal(notesOnly.status, 'ok')
  assert.equal(notesOnly.learning.overview, null)
  assert.equal(notesOnly.learning.notes.length, 1)
  assert.deepEqual(notesOnly.learning.theoryQuestions, [])
  assert.deepEqual(notesOnly.learning.quizQuestions, [])
})

test('invalid note payloads and duplicate note identities fail closed', () => {
  for (const payload of [
    { title: 'No body' },
    { title: 'Topic', body: 'Body', noteType: 'topic_note', keyPoints: [] },
    { title: 'Trick', body: 'Body', noteType: 'calculator_trick' },
    { title: 'Extra', body: 'Body', unknownField: 'rejected by the strict contract' },
    { title: '   ', body: 'Blank title' },
  ]) {
    assert.deepEqual(projectStudentLearning([overview, row('note', payload)]), { status: 'unavailable' }, JSON.stringify(payload))
  }
  assert.deepEqual(projectStudentLearning([plainNote, { ...topicNote, item_id: plainNote.item_id }]),
    { status: 'unavailable' })
})
