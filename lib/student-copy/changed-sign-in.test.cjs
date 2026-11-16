// lib/student-copy/changed-sign-in.test.cjs — One wording, on every student screen, for a page whose sign-in was
// replaced by a newer one in this browser: "You signed in on another tab." The screens take it from one constant, and
// none keeps an older wording for the same event. Being signed out is another event, said as "You’ve been signed out."
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { studentFiles, visibleText } = require('./scan.cjs')
const { AUTH_MESSAGES, SIGNED_IN_ON_ANOTHER_TAB } = require('../auth/constants.ts')

test('the screens that report a changed sign-in say it in the same words', () => {
  assert.equal(SIGNED_IN_ON_ANOTHER_TAB, 'You signed in on another tab.')
  const { PRACTICE_COPY } = require('../../app/courses/[slug]/quiz/practice-presentation.ts')
  assert.equal(PRACTICE_COPY.sessionChangedTitle, SIGNED_IN_ON_ANOTHER_TAB)
  assert.equal(PRACTICE_COPY.timeUpSessionChanged, 'Time is up. You signed in on another tab.')
  const campusBot = require('../../app/courses/ai-practice/[courseId]/journey.ts').describeResult({ status: 'session-changed' })
  assert.deepEqual([campusBot.title, campusBot.signedOut], [SIGNED_IN_ON_ANOTHER_TAB, true])
  const freePass = require('../../app/access/trial-flow.ts').describeResult
  assert.deepEqual(freePass({ status: 'session-changed' }),
    { next: 'refresh', message: { tone: 'error', text: SIGNED_IN_ON_ANOTHER_TAB } })
  assert.deepEqual(freePass({ status: 'signed-out' }),
    { next: 'refresh', message: { tone: 'error', text: 'You’ve been signed out.' } }, 'being signed out is another event, with its own words')
  const campusBotSignedOut = require('../../app/courses/ai-practice/[courseId]/journey.ts').describeResult({ status: 'signed-out' })
  assert.deepEqual([campusBotSignedOut.title, campusBotSignedOut.signedOut], ['You’ve been signed out.', true],
    'and Campus Bot says it in the same words as every other screen')
  assert.equal(AUTH_MESSAGES.sessionChanged, 'You signed in on another tab. Reload this page before continuing.')
})

test('no student screen keeps an older wording for it', () => {
  const older = /sign-in (?:has )?changed/i
  const found = studentFiles(process.cwd()).flatMap(file => visibleText(file).filter(({ text }) => older.test(text))
    .map(({ line, text }) => `${file}:${line} ${text}`))
  assert.deepEqual(found, [])
})
