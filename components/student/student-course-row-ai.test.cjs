// Missing materials stay a plain course row; the protected destination owns every further action.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const COURSE = '41111111-1111-4111-8111-111111111111'
const unbuilt = { institutionalCourseId: COURSE, code: 'MKT 201', title: 'Principles of Marketing', isFree: false,
  applicability: [], repository: { state: 'unlinked' }, content: { state: 'not-built', reason: 'unlinked' } }
const shelved = { state: 'shelved', repositoryCourseId: 'repository', contentKey: 'marketing', isShared: false,
  route: { slug: 'principles-of-marketing', href: '/courses/principles-of-marketing', course: { title: unbuilt.title } } }
const empty = { state: 'no-published-learning', study: { notes: false, cbtPractice: false, theory: false, overview: true } }

async function subject(run) {
  return withTsx(() => run(require('./StudentCourseRow.tsx')))
}

test('a missing-material course opens its own course page whenever one exists', async () => subject(({ presentStudentCourseRow }) => {
  assert.deepEqual(presentStudentCourseRow({ ...unbuilt, repository: shelved, content: empty }), {
    code: 'MKT 201', title: 'Principles of Marketing', unavailable: 'missing', href: '/courses/principles-of-marketing',
  })
}))

test('without a course page the whole row opens protected Campus Bot practice', async () => subject(({ presentStudentCourseRow }) => {
  assert.deepEqual(presentStudentCourseRow(unbuilt), { code: 'MKT 201', title: 'Principles of Marketing',
    unavailable: 'missing', href: `/courses/ai-practice/${COURSE}` })
}))

test('a missing-material row has one target, code, title and one plain status, without an inline action or tag', async () => subject(({ StudentCourseRow }) => {
  for (const repository of [unbuilt.repository, shelved]) {
    const html = renderToStaticMarkup(React.createElement(StudentCourseRow, { course: { ...unbuilt, repository,
      content: repository === shelved ? empty : unbuilt.content }, progress: 'Old progress' }))
    assert.equal((html.match(/<a\b/g) ?? []).length, 1)
    assert.match(html, /MKT 201/)
    assert.match(html, /Principles of Marketing/)
    assert.match(html, /<p>No study materials yet<\/p>/)
    assert.doesNotMatch(html, /Practise from your notes|Campus Bot|student-ai-practice|student-status-rail|underline|Old progress|<button\b/)
  }
}))

test('temporary failures do not turn into practice links', async () => subject(({ presentStudentCourseRow }) => {
  const temporary = { ...unbuilt, repository: { state: 'unshelved-repository', repositoryCourseId: COURSE,
    contentKey: 'marketing', isShared: false } }
  assert.deepEqual(presentStudentCourseRow(temporary), { code: 'MKT 201', title: 'Principles of Marketing', unavailable: 'temporary' })
}))
