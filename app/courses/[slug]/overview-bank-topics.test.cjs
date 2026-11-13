// app/courses/[slug]/overview-bank-topics.test.cjs — A course keeps its own syllabus topics in its overview. The topics
// of its question bank are never listed there: they are on the Practise by topic page, which the Practice card opens.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const overview = { title: 'Overview', body: 'Published overview body.',
  topics: [{ chapter: '1', description: 'Old chapter one' }, { chapter: '2', description: 'Old chapter two' }] }

test('a course keeps its own syllabus topics in its overview, with their descriptions', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, number: 4 }))
  assert.match(text(html), /Published overview body\. Syllabus topics CH 1 Old chapter one CH 2 Old chapter two/)
  assert.equal((html.match(/Syllabus topics/g) || []).length, 1, 'one topic list')
}))

test('the overview never lists a bank course\'s practice topics, whether or not it has a syllabus of its own', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const bankTopics = ['An Overview of Leadership', 'Leadership Approaches and Practices', 'Public Sector Reforms']
  // Even if handed the bank's topics, as the page once did, the overview shows none of them.
  for (const given of [overview, { ...overview, topics: [] }]) {
    const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview: given, bankTopics, number: 4 }))
    assert.doesNotMatch(html, /Leadership|Public Sector/)
    assert.match(text(html), /Published overview body\./, 'the rest of the overview stays')
    assert.equal((html.match(/Syllabus topics/g) || []).length, given.topics.length > 0 ? 1 : 0)
  }
}))

test('a course created for its bank has no overview: its topics are on the page the Practice card opens', async () => withTsx(async () => {
  const { studySections } = require('./sections.tsx')
  const study = { notes: false, cbtPractice: true, theory: false, overview: false }
  const practice = { href: '/courses/x/quiz', bankSize: 120, attemptSize: 50, timerSeconds: 2400 }
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0 }), ['cbtPractice'])
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0, bankTopics: 2 }), ['cbtPractice'],
    'a count of bank topics makes no overview')
  assert.deepEqual(studySections({ study: null, learning: null, practice: null, textbooks: 0 }), [])
  // Nothing on the course page reads the bank's topic names.
  for (const file of ['page.tsx', 'sections.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /OFFICIAL_BANK_SECTIONS|overviewBankTopics|bankTopics/, file)
  }
}))

test('every imported course has its bank topics, which its practice draws from', async () => withTsx(async () => {
  const { OFFICIAL_BANK_SECTIONS } = require('../../../lib/data/official-bank-sections.ts')
  const { OFFICIAL_BANK_COURSES } = require('../../../lib/data/official-bank-courses.ts')
  const existing = ['entrepreneurship-innovation', 'financial-accounting-1', 'introduction-financial-management',
    'leadership-governance', 'principles-business-administration', 'principles-business-administration-2',
    'quantitative-analysis-management', 'use-of-english']
  assert.deepEqual(Object.keys(OFFICIAL_BANK_SECTIONS).sort(),
    [...existing, ...OFFICIAL_BANK_COURSES.map(course => course.slug)].sort())
  assert.equal(OFFICIAL_BANK_COURSES.length, 19)
}))

test('the overview lists the course outcomes and how it is assessed, and leaves out what it does not have', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { number: 3, overview: { title: 'Overview', body: 'Body.',
    outcomes: ['Listen effectively in lectures.', 'Write a well-formed paragraph.'],
    assessment: ['The exam is objective (CBT).', 'Every topic is examinable.'] } }))
  assert.match(text(html), /Course outcomes 01 Listen effectively in lectures\. 02 Write a well-formed paragraph\./)
  assert.match(text(html), /How you’re assessed The exam is objective \(CBT\)\. Every topic is examinable\./)
  const bare = renderToStaticMarkup(React.createElement(OverviewSection, { number: 3, overview: { title: 'Overview', body: 'Body.' } }))
  assert.doesNotMatch(bare, /Course outcomes|How you’re assessed/)
}))
