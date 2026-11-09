// app/courses/[slug]/overview-bank-topics.test.cjs — A course whose questions come from an official bank lists the
// bank's topic names, in order and with nothing added, as its syllabus topics; any other course keeps its overview's.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const overview = { title: 'Overview', body: 'Published overview body.',
  topics: [{ chapter: '1', description: 'Old chapter one' }, { chapter: '2', description: 'Old chapter two' }] }

test('bank topic names replace the overview topics, numbered, in bank order, with no descriptions', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const bankTopics = ['An Overview of Leadership', 'Leadership Approaches and Practices', 'Public Sector Reforms']
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, bankTopics, number: 4 }))
  assert.match(text(html), /Syllabus topics 01 An Overview of Leadership 02 Leadership Approaches and Practices 03 Public Sector Reforms/)
  assert.equal((html.match(/Syllabus topics/g) || []).length, 1, 'one topic list')
  assert.doesNotMatch(html, /Old chapter|CH \d/, 'the old overview topics and their descriptions are gone')
  assert.match(text(html), /Published overview body\./, 'the rest of the overview stays')
}))

test('a course without a bank keeps its overview topics with their descriptions', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, number: 4 }))
  assert.match(text(html), /Syllabus topics CH 1 Old chapter one CH 2 Old chapter two/)
}))

test('a course created for its bank has an overview of bank topic names only: no lede, no body', async () => withTsx(async () => {
  const { OverviewSection, studySections } = require('./sections.tsx')
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview: null,
    bankTopics: ['Week 1', 'Week 2'], number: 2 }))
  assert.match(text(html), /Syllabus topics 01 Week 1 02 Week 2$/)
  assert.doesNotMatch(html, /Explore the topics|student-reading/, 'no intro text')
  assert.deepEqual(studySections({ study: null, learning: null, practice: null, textbooks: 0, bankTopics: 2 }), ['overview'])
  assert.deepEqual(studySections({ study: null, learning: null, practice: null, textbooks: 0 }), [], 'no topics, no overview')
}))

test('the topic list shows once: in Practice when it lists the topics, otherwise in the overview', async () => withTsx(async () => {
  const { OverviewSection, overviewBankTopics, studySections } = require('./sections.tsx')
  const bankTopics = ['Week 1', 'Week 2']
  assert.deepEqual(overviewBankTopics(bankTopics, true), [])
  assert.deepEqual(overviewBankTopics(bankTopics, false), bankTopics, 'a failed topic read leaves the list in the overview')
  assert.equal(overviewBankTopics(undefined, true), undefined, 'a course without a bank is unchanged')

  // A course created for its bank: Practice lists the topics, so there is no overview to repeat them.
  const study = { notes: false, cbtPractice: true, theory: false, overview: false }
  const practice = { href: '/courses/x/quiz', attemptSize: 50, timerSeconds: 2400 }
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0,
    bankTopics: overviewBankTopics(bankTopics, true).length }), ['cbtPractice'])
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0,
    bankTopics: overviewBankTopics(bankTopics, false).length }), ['cbtPractice', 'overview'])

  // An existing course keeps the rest of its overview, without the list and without its old stored topics.
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview,
    bankTopics: overviewBankTopics(bankTopics, true), number: 3 }))
  assert.doesNotMatch(html, /Syllabus topics|Week 1|Old chapter/)
  assert.match(text(html), /Published overview body\./)
}))

test('every imported course has its bank topics for the overview', async () => withTsx(async () => {
  const { OFFICIAL_BANK_SECTIONS } = require('../../../lib/data/official-bank-sections.ts')
  const { OFFICIAL_BANK_COURSES } = require('../../../lib/data/official-bank-courses.ts')
  const existing = ['entrepreneurship-innovation', 'financial-accounting-1', 'introduction-financial-management',
    'leadership-governance', 'principles-business-administration', 'principles-business-administration-2',
    'quantitative-analysis-management', 'use-of-english']
  assert.deepEqual(Object.keys(OFFICIAL_BANK_SECTIONS).sort(),
    [...existing, ...OFFICIAL_BANK_COURSES.map(course => course.slug)].sort())
  assert.equal(OFFICIAL_BANK_COURSES.length, 19)
}))
