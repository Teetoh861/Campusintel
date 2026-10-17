// Test-only published theory fixtures. Never imported into application code.
const courseId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const theoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const answerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const rubricId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const slug = 'principles-business-administration'
const question = { itemId: theoryId, publishedRevision: 2, prompt: 'Explain management.', displayNumber: 1 }
const modelAnswer = { itemId: answerId, publishedRevision: 3, body: 'Published official model answer.\nWith its original wording.' }
const rubric = { itemId: rubricId, publishedRevision: 4,
  body: 'Marking guidance\n1. Define management (2 marks).\n2. Explain its purpose (3 marks).',
  points: ['1. Define management (2 marks).', '2. Explain its purpose (3 marks).'] }
const feedback = { question, modelAnswer, rubric }
const row = (kind, itemId, revision, payload, parentItemId = null) => ({ item_id: itemId,
  course_id: courseId, kind, question_id: null, source_key: kind === 'theory_question' ? 'theory:1' : null,
  parent_item_id: parentItemId, revision, payload })
const rows = () => [row('theory_question', theoryId, 2, { prompt: question.prompt }),
  row('model_answer', answerId, 3, { body: modelAnswer.body }, theoryId),
  row('rubric', rubricId, 4, { body: rubric.body }, theoryId)]
// The disclosure request carries question identity only; student answers never appear in it.
const command = () => ({ courseSlug: slug, itemId: theoryId, publishedRevision: 2 })
// A maximum-length draft with a recognisable marker, for proving it never leaves the page.
const longDraft = () => 'STUDENT-DRAFT-MARKER ' + 'x'.repeat(20000 - 'STUDENT-DRAFT-MARKER '.length)
module.exports = { courseId, theoryId, answerId, rubricId, slug, question, modelAnswer, rubric, feedback, rows, row, command, longDraft }
