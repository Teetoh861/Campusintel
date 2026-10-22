// lib/entitlements/discovery.test.cjs — The Discovery Pass client boundary: commands carry no time, duration, score or
// balance, the exam's answer key can never cross before grading, and every database answer maps to one explicit result.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { discoveryCommandSchema, discoveryResultSchema, kindFromSegment, PREVIEW_SEGMENT } =
  require('./discovery-contract.ts')
const { discoveryResultFrom, examSecondsFor, readDiscoveryPreview } = require('./discovery.ts')

const ITEM = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-20T14:05:00.000Z'
const ENDS = '2026-10-23T14:05:00.000Z'
const DEADLINE = '2026-10-20T14:35:00.000Z'
const question = { item_id: ITEM, prompt: 'What is a sole trader?', options: ['A', 'B', 'C', 'D'], section: 'General' }
const exam = (result = null, extra = {}) => ({ state: 'ready', now: NOW, ends_at: ENDS,
  preview: { kind: 'cbt', deadline_at: DEADLINE, questions: [{ ...question, ...extra }],
    saved: result === null ? { revision: 0, answers: {} } : null, result } })

test('commands name only a course, an action and a chosen topic: time, duration, score or balance is refused', () => {
  const open = { action: 'open', courseSlug: 'business-statistics', kind: 'cbt' }
  assert.equal(discoveryCommandSchema.safeParse(open).success, true)
  for (const extra of [{ now: NOW }, { deadline: DEADLINE }, { examSeconds: 99999 }, { minutes: 600 }, { remaining: 5 },
    { hours: 480 }, { questions: 390 }]) {
    assert.equal(discoveryCommandSchema.safeParse({ ...open, ...extra }).success, false, `refuses ${Object.keys(extra)[0]}`)
  }
  for (const kind of ['theory', 'study_guide', 'everything']) {
    assert.equal(discoveryCommandSchema.safeParse({ ...open, kind }).success, false, `no "${kind}" exam`)
  }
  assert.equal(discoveryCommandSchema.safeParse({ action: 'open-topic', courseSlug: 'x', itemId: ITEM }).success, true)
  assert.equal(discoveryCommandSchema.safeParse({ action: 'open-topic', courseSlug: 'x' }).success, false,
    'a topic must be chosen')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'open-topic', courseSlug: 'x', itemId: ITEM, all: true })
    .success, false)
  const TAB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const delta = { tab: TAB, sequence: 3, baseRevision: 2, changes: { [ITEM]: 2 } }
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta }).success, true,
    'a submission carries this tab\'s pending changes over the revision it last received')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta, sequence: 0, changes: {} })
    .success, true, 'a tab with nothing pending submits an empty delta: the database grades the sheet it holds')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta, score: 50 }).success, false,
    'a client score is refused')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta, answers: { [ITEM]: 2 } })
    .success, false, 'a whole sheet is refused: only changed questions cross')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta,
    changes: { 'not-a-uuid': 0 } }).success, false)
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta,
    changes: { [ITEM]: 9 } }).success, false, 'an option index beyond eight options is refused')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta,
    changes: { [ITEM]: null } }).success, true, 'a cleared choice is sent as null')
  const fifty = Object.fromEntries(Array.from({ length: 50 }, (_, i) =>
    [`11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, i % 4]))
  assert.equal(discoveryCommandSchema.safeParse({ action: 'submit-exam', courseSlug: 'x', ...delta, changes: fifty }).success,
    true, 'fifty changed questions are accepted')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'save-answers', courseSlug: 'x', ...delta, changes: fifty }).success,
    true, 'the open exam saves its changed questions at a sequence')
  for (const extra of [{ savedAt: NOW }, { deadline: DEADLINE }, { final: true }, { answers: fifty }]) {
    assert.equal(discoveryCommandSchema.safeParse({ action: 'save-answers', courseSlug: 'x', ...delta, ...extra })
      .success, false, `a save carries no ${Object.keys(extra)[0]}`)
  }
  assert.equal(discoveryCommandSchema.safeParse({ action: 'save-answers', courseSlug: 'x', ...delta, changes: {} }).success,
    false, 'a save with nothing changed is not a save')
  for (const sequence of [undefined, 0, -1, 1.5, 1_000_001, '1']) {
    assert.equal(discoveryCommandSchema.safeParse({ action: 'save-answers', courseSlug: 'x', ...delta, sequence }).success,
      false, `a save needs a whole sequence from 1 to a million, not ${sequence}`)
  }
  for (const baseRevision of [undefined, -1, 1.5, 1_000_001, '1']) {
    assert.equal(discoveryCommandSchema.safeParse({ action: 'save-answers', courseSlug: 'x', ...delta, baseRevision }).success,
      false, `a save names the whole revision it is based on, not ${baseRevision}`)
  }
  for (const tab of [undefined, 'tab-1', 1]) {
    assert.equal(discoveryCommandSchema.safeParse({ action: 'save-answers', courseSlug: 'x', ...delta, tab }).success, false,
      `a save names its tab by id, not ${tab}`)
  }
  assert.equal(discoveryCommandSchema.safeParse({ action: 'sync-exam', courseSlug: 'x', tab: TAB }).success, true,
    'a sync names only the course and the tab')
  assert.equal(discoveryCommandSchema.safeParse({ action: 'sync-exam', courseSlug: 'x', tab: TAB, changes: {} }).success, false)
})

test('an ungraded exam maps to questions only; an answer key in the reply fails closed', () => {
  const ready = discoveryResultFrom(exam())
  assert.equal(ready.status, 'ready')
  assert.equal(ready.now, NOW, 'the server clock is passed through for the countdown')
  assert.equal(ready.preview.deadline_at, DEADLINE, 'the deadline is the database one')
  assert.doesNotMatch(JSON.stringify(ready), /correct|explanation/)
  for (const leak of [{ correct_option: 1 }, { correctOption: 1 }, { explanation: 'because' }]) {
    assert.deepEqual(discoveryResultFrom(exam(null, leak)), { status: 'unavailable' },
      `a question carrying ${Object.keys(leak)[0]} is never passed on`)
  }
  const graded = discoveryResultFrom(exam({ score: 1, total: 1, timed_out: false,
    answers: [{ item_id: ITEM, selected: 2, correct_option: 2, explanation: null }] }))
  assert.equal(graded.status === 'ready' && graded.preview.kind === 'cbt' && graded.preview.result.score, 1)
})

test('the study guide offers titles only before opening, then exactly one complete topic', () => {
  const offer = discoveryResultFrom({ state: 'available', now: NOW, ends_at: ENDS,
    topics: [{ item_id: ITEM, title: 'Data Sources and Variables' }] })
  assert.deepEqual(offer, { status: 'available', now: NOW, endsAt: ENDS,
    topics: [{ item_id: ITEM, title: 'Data Sources and Variables' }] })
  assert.equal(discoveryResultFrom({ state: 'available', now: NOW, ends_at: ENDS,
    topics: [{ item_id: ITEM, title: 'T', body: 'the whole topic' }] }).status, 'unavailable',
  'a title carrying a body is never passed on')
  const note = { title: 'Data Sources', body: 'Primary and secondary data…' }
  const topic = discoveryResultFrom({ state: 'ready', now: NOW, ends_at: ENDS,
    preview: { kind: 'study_guide', items: [{ item_id: ITEM, revision: 1, note }] } })
  assert.equal(topic.status, 'ready')
  assert.equal(discoveryResultFrom({ state: 'ready', now: NOW, ends_at: ENDS, preview: { kind: 'study_guide',
    items: [{ item_id: ITEM, revision: 1, note }, { item_id: ITEM, revision: 1, note }] } }).status, 'unavailable',
  'more than one topic is never passed on')
  assert.equal(discoveryResultFrom({ state: 'ready', now: NOW, ends_at: ENDS, preview: { kind: 'theory',
    items: [{ item_id: ITEM, revision: 1, prompt: 'p', exam_tip: null, model_answer: 'a' }] } }).status, 'unavailable',
  'a theory preview is not part of the pass and never reaches the page')
})

test('every database state maps to one client result', () => {
  assert.deepEqual(discoveryResultFrom({ state: 'used-elsewhere', now: NOW, ends_at: ENDS, content_key: 'business-statistics' }),
    { status: 'used-elsewhere', endsAt: ENDS, courseCode: 'BUA203', courseSlug: 'business-statistics' })
  assert.deepEqual(discoveryResultFrom({ state: 'used-elsewhere', now: NOW, ends_at: ENDS, content_key: 'unknown-key' }),
    { status: 'used-elsewhere', endsAt: ENDS, courseCode: null, courseSlug: null })
  for (const state of ['signed-out', 'free-course', 'full-access', 'no-pass', 'expired', 'nothing-to-preview',
    'not-opened', 'invalid-request']) {
    assert.deepEqual(discoveryResultFrom({ state }), { status: state })
  }
  assert.deepEqual(discoveryResultFrom({ state: 'invalid-course' }), { status: 'not-found' })
  assert.deepEqual(discoveryResultFrom({ state: 'not-offered' }), { status: 'not-found' },
    'a course offered in no active catalogue has no previews')
  assert.deepEqual(discoveryResultFrom({ state: 'not-enough-time', now: NOW, ends_at: ENDS }),
    { status: 'not-enough-time', now: NOW, endsAt: ENDS })
  assert.deepEqual(discoveryResultFrom({ state: 'saved', now: NOW, deadline_at: DEADLINE, revision: 4, answers: { [ITEM]: 1 } }),
    { status: 'saved', now: NOW, deadlineAt: DEADLINE, revision: 4, answers: { [ITEM]: 1 } },
    'a save answer carries the clock, the deadline and the whole sheet that stands')
  assert.deepEqual(discoveryResultFrom({ state: 'stale', now: NOW, deadline_at: DEADLINE, revision: 6, answers: { [ITEM]: 1 } }),
    { status: 'stale', now: NOW, deadlineAt: DEADLINE, revision: 6, answers: { [ITEM]: 1 } })
  assert.deepEqual(discoveryResultFrom({ state: 'saved', now: NOW, revision: 4 }), { status: 'unavailable' },
    'a save answer without the deadline and the sheet fails closed')
  for (const broken of [null, undefined, {}, { state: 'ready' }, { state: 'granted-everything' }]) {
    assert.deepEqual(discoveryResultFrom(broken), { status: 'unavailable' })
  }
  assert.equal(discoveryResultSchema.safeParse({ status: 'expired' }).success, true)
})

test('the exam length is the course’s own CBT duration from server configuration', () => {
  assert.equal(examSecondsFor('principles-business-administration'), 30 * 60)
  assert.equal(examSecondsFor('business-statistics'), 40 * 60)
  assert.equal(examSecondsFor('no-such-course'), null)
})

test('a page read never opens anything, and a database failure reads as unavailable', async () => {
  const calls = []
  const env = { read: async (...args) => { calls.push(args); return { state: 'available', now: NOW, ends_at: ENDS,
    topics: null } }, open: async () => { throw new Error('a read must never open') },
  submit: async () => { throw new Error('unused') } }
  assert.deepEqual(await readDiscoveryPreview('s', 'c', 'cbt', 1800, env),
    { status: 'available', now: NOW, endsAt: ENDS, topics: null })
  assert.deepEqual(calls, [['c', 'cbt', 1800]], 'the read carries the server exam length so the database can say it fits')
  assert.deepEqual(await readDiscoveryPreview('s', 'c', 'cbt', 1800,
    { ...env, read: async () => { throw new Error('down') } }), { status: 'unavailable' })
})

test('preview URL segments round-trip; theory and unknown segments are not pages', () => {
  for (const [kind, segment] of Object.entries(PREVIEW_SEGMENT)) assert.equal(kindFromSegment(segment), kind)
  for (const segment of ['theory', 'study_guide', 'all']) assert.equal(kindFromSegment(segment), null)
})
