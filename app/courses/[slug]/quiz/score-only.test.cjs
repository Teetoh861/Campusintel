const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')
const identity = { courseCode: 'BUA 216', courseTitle: 'Financial Management', courseHref: '/courses/bua-216', repositoryOnly: false }
const attempt = { id: 'attempt', mode: 'exam', status: 'submitted', reviewAvailable: false, questions: [],
  questionCount: 5, bankSize: 200, result: { score: 2, total: 5, timedOut: false } }

for (const [reason, line] of [
  ['needs-plan', 'Answers and explanations are included with full access.'],
  ['outside-list', 'Not in your courses this semester, so answers aren’t shown.'],
  ['needs-selection', 'Confirm your courses for this semester to see answers.'],
]) test(`score-only result retains course identity, navigation and the correct ${reason} line`, async () => withTsx(() => {
  const { ScoreOnly } = require('./ScoreOnly.tsx')
  const markup = renderToStaticMarkup(React.createElement(ScoreOnly, { ...identity,
    attempt: { ...attempt, reviewUnavailableReason: reason }, canStartNew: false, starting: false, onRetake() {} }))
  assert.match(markup, /BUA 216.*Financial Management/)
  assert.match(markup, /<h1[^>]*>Exam result<\/h1>/, 'an exam\'s result is never called a practice result')
  assert.match(markup, /2 of 5 correct/)
  assert.ok(markup.includes(line))
  assert.match(markup, /href="\/courses\/bua-216"/)
  assert.doesNotMatch(markup, /Review answers|Practise again|New questions/)
  // Confirm courses comes back to this result after the save.
  assert.equal(markup.includes(`href="/profile-selection?return=${encodeURIComponent('/courses/bua-216/quiz?attempt=attempt')}"`),
    reason === 'needs-selection')
  assert.equal(markup.includes('>Confirm your courses<'), reason === 'needs-selection')
}))

test('score-only offers its one retake as Practise again, whatever the bank size', async () => withTsx(() => {
  const { ScoreOnly } = require('./ScoreOnly.tsx')
  for (const bankSize of [200, 5]) {
    const markup = renderToStaticMarkup(React.createElement(ScoreOnly, { ...identity,
      attempt: { ...attempt, bankSize }, canStartNew: true, starting: false, onRetake() {} }))
    assert.ok(markup.includes('>Practise again<'))
    assert.doesNotMatch(markup, /Review answers|New questions|Same questions/)
  }
}))

test('free-pass timeout shows the timeout line alongside its score, without an answer review', async () => withTsx(() => {
  const { DiscoveryExam } = require('../preview/[kind]/DiscoveryExam.tsx')
  const render = timedOut => renderToStaticMarkup(React.createElement(DiscoveryExam, { continuityToken: 't', courseSlug: 'bua-216',
    courseHref: '/courses/bua-216', questions: [], deadlineAt: '2026-11-02T10:00:00Z', serverNow: '2026-11-02T11:00:00Z',
    savedSheet: null, initialResult: { score: 3, total: 50, timed_out: timedOut } }))
  assert.match(render(true), /Your score.*3 of 50 correct.*Time ran out\..*Answers and explanations are included with full access\./s)
  assert.doesNotMatch(render(true), /3\/50/, 'scores read the same on every screen')
  assert.doesNotMatch(render(false), /Time ran out\./)
  assert.doesNotMatch(render(true), /correctOption|"explanation"\s*:|Review answers|input|Subscribe/)
  // The exam has ended, so its way out is the ordinary one again; nothing hides the site's header any more.
  assert.match(render(false), /href="\/courses\/bua-216"[^>]*>Back to course<\/a>/)
  assert.doesNotMatch(render(false), /data-exam-open|>Exit</)
}))

test('the copy switch: once plans are on sale, a score names subscribing; closed keeps today\'s wording', async () => withTsx(() => {
  const { ScoreOnly } = require('./ScoreOnly.tsx')
  const { DiscoveryExam } = require('../preview/[kind]/DiscoveryExam.tsx')
  const score = plansOnSale => renderToStaticMarkup(React.createElement(ScoreOnly, { ...identity, plansOnSale,
    attempt: { ...attempt, reviewUnavailableReason: 'needs-plan' }, canStartNew: false, starting: false, onRetake() {} }))
  assert.match(score(true), /Answers and explanations are included when you subscribe\./)
  assert.match(score(false), /Answers and explanations are included with full access\./)
  // The button to Plan & Access is named as on a locked course: Subscribe once plans are on sale.
  assert.match(score(true), /href="\/access"[^>]*>Subscribe<\/a>/)
  assert.match(score(false), /href="\/access"[^>]*>See how to unlock<\/a>/)
  // A topic's practice keeps its own name.
  assert.match(renderToStaticMarkup(React.createElement(ScoreOnly, { ...identity, attempt: { ...attempt, mode: 'instant',
    reviewUnavailableReason: 'needs-plan' }, canStartNew: false, starting: false, onRetake() {} })), /<h1[^>]*>Practice result<\/h1>/)
  const exam = plansOnSale => renderToStaticMarkup(React.createElement(DiscoveryExam, { continuityToken: 't',
    courseSlug: 'bua-216', courseHref: '/courses/bua-216', questions: [], deadlineAt: '2026-11-02T10:00:00Z',
    serverNow: '2026-11-02T11:00:00Z',
    savedSheet: null, plansOnSale, initialResult: { score: 3, total: 50, timed_out: false } }))
  assert.match(exam(true), /included when you subscribe\..*href="\/access"[^>]*>Subscribe<\/a>/s)
  assert.doesNotMatch(exam(false), /Subscribe/)
}))
