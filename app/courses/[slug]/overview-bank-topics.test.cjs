// app/courses/[slug]/overview-bank-topics.test.cjs — The course overview lists no topics: not the syllabus its stored
// overview carries, and not the topics of its question bank. Topics are in Notes and on the Practise by topic page. The
// overview keeps its text, outcomes, assessment, key takeaways, exam focus and formula sheet.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const topics = [{ chapter: '1', description: 'Old chapter one' }, { chapter: '2', description: 'Old chapter two' }]
const overview = { title: 'Overview', body: 'Published overview body.', topics }

test('the stored syllabus topics are not listed; the rest of the overview stays', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const full = { ...overview, outcomes: ['Listen effectively.'], assessment: ['The exam is objective (CBT).'],
    keyTakeaways: [{ title: 'Takeaway', description: 'Remember this' }], examFocus: ['Focus area'],
    formulaSheet: [{ name: 'Break-even', formula: 'BEQ = FC / (P − v)', explanation: 'Contribution' }] }
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview: full, number: 4 }))
  assert.doesNotMatch(html, /Syllabus topics|Old chapter|>CH \d/)
  assert.equal(text(html), '04 / Course overview Course overview Published overview body. Course outcomes 01 Listen effectively. '
    + 'How you’re assessed The exam is objective (CBT). Key takeaways 01 Takeaway Remember this Exam focus 01 Focus area '
    + 'Formula sheet Break-even BEQ = FC / (P − v) Contribution')
  assert.doesNotMatch(html, /Explore the topics|student-meta/, 'no line about topics the overview no longer lists')
}))

test('the overview never lists a bank course\'s practice topics either', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const bankTopics = ['An Overview of Leadership', 'Leadership Approaches and Practices', 'Public Sector Reforms']
  // Even if handed the bank's topics, as the page once did, the overview shows none of them.
  for (const given of [overview, { ...overview, topics: [] }]) {
    const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview: given, bankTopics, number: 4 }))
    assert.doesNotMatch(html, /Leadership|Public Sector|Syllabus topics/)
    assert.match(text(html), /Published overview body\./, 'the rest of the overview stays')
  }
}))

test('an overview with nothing left to show has no section; a course created for its bank has none', async () => withTsx(async () => {
  const { overviewShown, studySections } = require('./sections.tsx')
  const study = { notes: false, cbtPractice: true, theory: false, overview: false }
  const practice = { href: '/courses/x/quiz', bankSize: 120, attemptSize: 50, timerSeconds: 2400 }
  const sectionsWith = stored => studySections({ study, practice, textbooks: 0,
    learning: { overview: stored, notes: [], theoryQuestions: [], theoryPractice: false, theoryPracticeItems: [] } })
  assert.deepEqual(sectionsWith(overview), ['cbtPractice', 'overview'], 'its text is enough')
  assert.deepEqual(sectionsWith({ title: 'Overview', body: '  ', topics }), ['cbtPractice'], 'only a syllabus list: nothing to show')
  assert.deepEqual(sectionsWith({ title: 'Overview', body: '', examFocus: ['Focus area'] }), ['cbtPractice', 'overview'])
  assert.deepEqual(sectionsWith(null), ['cbtPractice'])
  assert.equal(overviewShown(undefined), false)
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0 }), ['cbtPractice'])
  assert.deepEqual(studySections({ study, learning: null, practice, textbooks: 0, bankTopics: 2 }), ['cbtPractice'],
    'a count of bank topics makes no overview')
  assert.deepEqual(studySections({ study: null, learning: null, practice: null, textbooks: 0 }), [])
  // Nothing on the course page reads the bank's topic names or the stored syllabus.
  for (const file of ['page.tsx', 'sections.tsx']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /OFFICIAL_BANK_SECTIONS|overviewBankTopics|bankTopics|overview\.topics|Syllabus topics/, file)
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
