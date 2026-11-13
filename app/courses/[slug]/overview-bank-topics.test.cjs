// app/courses/[slug]/overview-bank-topics.test.cjs — A course keeps its own syllabus topics in its overview. A course
// whose questions come from an official bank and that has none lists the bank's topic names, in order and with nothing
// added, unless Practice already lists them: the topics show once.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const overview = { title: 'Overview', body: 'Published overview body.',
  topics: [{ chapter: '1', description: 'Old chapter one' }, { chapter: '2', description: 'Old chapter two' }] }

test('a bank course with its own syllabus keeps it, whether or not Practice lists the bank topics', async () => withTsx(async () => {
  const { OverviewSection, overviewBankTopics } = require('./sections.tsx')
  const bank = ['An Overview of Leadership', 'Leadership Approaches and Practices', 'Public Sector Reforms']
  for (const practiceListsTopics of [true, false]) {
    const bankTopics = overviewBankTopics(bank, practiceListsTopics, overview.topics.length)
    assert.equal(bankTopics, undefined)
    const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, bankTopics, number: 4 }))
    assert.match(text(html), /Published overview body\. Syllabus topics CH 1 Old chapter one CH 2 Old chapter two/)
    assert.equal((html.match(/Syllabus topics/g) || []).length, 1, 'one topic list')
    assert.doesNotMatch(html, /Leadership/, 'no bank topic names in the overview')
  }
  // Even if given both, the overview shows the course's own syllabus and not the bank list.
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, bankTopics: bank, number: 4 }))
  assert.match(text(html), /Syllabus topics CH 1 Old chapter one CH 2 Old chapter two/)
  assert.doesNotMatch(html, /Leadership/)
}))

test('bank topic names fill a bank course overview without its own syllabus, numbered, in bank order', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const noTopics = { ...overview, topics: [] }
  const bankTopics = ['An Overview of Leadership', 'Leadership Approaches and Practices', 'Public Sector Reforms']
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview: noTopics, bankTopics, number: 4 }))
  assert.match(text(html), /Syllabus topics 01 An Overview of Leadership 02 Leadership Approaches and Practices 03 Public Sector Reforms/)
  assert.equal((html.match(/Syllabus topics/g) || []).length, 1, 'one topic list')
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

test('the bank topic list shows once: in Practice when it lists the topics, otherwise in the overview', async () => withTsx(async () => {
  const { OverviewSection, overviewBankTopics, studySections } = require('./sections.tsx')
  const bankTopics = ['Week 1', 'Week 2']
  assert.equal(overviewBankTopics(bankTopics, true, 0), undefined)
  assert.deepEqual(overviewBankTopics(bankTopics, false, 0), bankTopics, 'a failed topic read leaves the list in the overview')
  assert.equal(overviewBankTopics(undefined, false, 0), undefined, 'a course without a bank is unchanged')

  // A course created for its bank: Practice lists the topics, so there is no overview to repeat them.
  const study = { notes: false, cbtPractice: true, theory: false, overview: false }
  const practice = { href: '/courses/x/quiz', attemptSize: 50, timerSeconds: 2400 }
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0,
    bankTopics: overviewBankTopics(bankTopics, true, 0)?.length }), ['cbtPractice'])
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0,
    bankTopics: overviewBankTopics(bankTopics, false, 0)?.length }), ['cbtPractice', 'overview'])

  // A course with an overview but no syllabus of its own keeps the rest of its overview, without the list.
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview: { ...overview, topics: [] },
    bankTopics: overviewBankTopics(bankTopics, true, 0), number: 3 }))
  assert.doesNotMatch(html, /Syllabus topics|Week 1/)
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
