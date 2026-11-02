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
  ['outside-list', 'Answers are available for courses in your current list.'],
  ['needs-selection', 'Confirm your courses for this semester to see answers.'],
]) test(`score-only result retains course identity, navigation and the correct ${reason} line`, async () => withTsx(() => {
  const { ScoreOnly } = require('./ScoreOnly.tsx')
  const markup = renderToStaticMarkup(React.createElement(ScoreOnly, { ...identity,
    attempt: { ...attempt, reviewUnavailableReason: reason }, canStartNew: false, starting: false, onRetake() {} }))
  assert.match(markup, /BUA 216.*Financial Management/)
  assert.match(markup, /2 of 5 correct/)
  assert.ok(markup.includes(line))
  assert.match(markup, /href="\/courses\/bua-216"/)
  assert.doesNotMatch(markup, /Review answers|Retake with new questions/)
  assert.equal(markup.includes('href="/profile-selection"'), reason === 'needs-selection')
  assert.equal(markup.includes('Confirm courses'), reason === 'needs-selection')
}))

test('score-only retake follows the server permission and the current bank size', async () => withTsx(() => {
  const { ScoreOnly } = require('./ScoreOnly.tsx')
  for (const [bankSize, label] of [[200, 'Retake with new questions'], [5, 'Practise again']]) {
    const markup = renderToStaticMarkup(React.createElement(ScoreOnly, { ...identity,
      attempt: { ...attempt, bankSize }, canStartNew: true, starting: false, onRetake() {} }))
    assert.ok(markup.includes(label))
    assert.doesNotMatch(markup, /Review answers/)
  }
}))

test('free-pass timeout shows the timeout line alongside its score, without an answer review', async () => withTsx(() => {
  const { DiscoveryExam } = require('../preview/[kind]/DiscoveryExam.tsx')
  const render = timedOut => renderToStaticMarkup(React.createElement(DiscoveryExam, { continuityToken: 't', courseSlug: 'bua-216',
    questions: [], deadlineAt: '2026-11-02T10:00:00Z', serverNow: '2026-11-02T11:00:00Z', savedSheet: null,
    initialResult: { score: 3, total: 50, timed_out: timedOut } }))
  assert.match(render(true), /3 of 50 correct.*Time ran out\..*Answers and explanations are included with full access\./s)
  assert.doesNotMatch(render(false), /Time ran out\./)
  assert.doesNotMatch(render(true), /correctOption|"explanation"\s*:|Review answers|input/)
}))
