// app/courses/[slug]/quiz/practice-client.test.cjs — What the device keeps and what the screens promise: storage is never
// trusted and never fatal; no line says "saved", "submitted" or a time the server has not confirmed.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PRACTICE_COPY, exitBodyFor, saveLineFor } = require('./practice-presentation.ts')
const storageModule = () => {
  delete require.cache[require.resolve('./practice-storage.ts')]
  return require('./practice-storage.ts')
}

const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const Q = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`

function withWindow(stores, run) {
  const saved = global.window
  global.window = stores
  try { return run() } finally { if (saved === undefined) delete global.window; else global.window = saved }
}
function memory() {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key), map }
}

test('flags stay on this device per attempt and survive a reload; unknown questions and bad records are dropped', () => {
  const local = memory(), session = memory()
  withWindow({ localStorage: local, sessionStorage: session }, () => {
    const s = storageModule()
    s.writeFlags(ATTEMPT, new Set([Q(1), Q(2)]))
    assert.deepEqual([...s.readFlags(ATTEMPT, [Q(1), Q(2), Q(3)])], [Q(1), Q(2)])
    assert.deepEqual([...s.readFlags(ATTEMPT, [Q(2)])], [Q(2)], 'a flag for a question outside the attempt is ignored')
    s.writeFlags(ATTEMPT, new Set())
    assert.equal(local.map.has(`practice-flags:${ATTEMPT}`), false)
    local.setItem(`practice-flags:${ATTEMPT}`, '{"not":"a list"}')
    assert.deepEqual([...s.readFlags(ATTEMPT, [Q(1)])], [])
  })
})

test('a start in flight and this tab\'s unsent choices are validated on every read', () => {
  const local = memory(), session = memory()
  withWindow({ localStorage: local, sessionStorage: session }, () => {
    const s = storageModule()
    const pending = { attemptId: ATTEMPT, intent: 'new', redoOf: null, expected: { questionCount: 50, durationSeconds: 1800 } }
    s.writePendingStart('financial-accounting-1', pending)
    assert.deepEqual(s.readPendingStart('financial-accounting-1'), pending)
    session.setItem('practice-start:financial-accounting-1', JSON.stringify({ ...pending, expected: { questionCount: 500 } }))
    assert.equal(s.readPendingStart('financial-accounting-1'), null)
    s.clearPendingStart('financial-accounting-1')
    s.writeUnsent(ATTEMPT, { answers: { [Q(1)]: 2, [Q(2)]: 7 }, dirty: [Q(1), Q(2), Q(9)] })
    assert.deepEqual(s.readUnsent(ATTEMPT, new Map([[Q(1), 4], [Q(2), 4]])),
      { answers: { [Q(1)]: 2 }, dirty: [Q(1), Q(2)] }, 'a choice outside its question\'s options, or an unknown question, is dropped')
    s.clearUnsent(ATTEMPT)
    assert.equal(s.readUnsent(ATTEMPT, new Map()), null)
    assert.equal(s.resultSeen(ATTEMPT), false)
    s.markResultSeen(ATTEMPT)
    assert.equal(s.resultSeen(ATTEMPT), true)
  })
})

test('storage that is missing or throws is never fatal', () => {
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') },
    removeItem() { throw new Error('blocked') } }
  for (const stores of [{}, { localStorage: throwing, sessionStorage: throwing },
    Object.defineProperties({}, { localStorage: { get() { throw new Error('denied') } },
      sessionStorage: { get() { throw new Error('denied') } } })]) {
    withWindow(stores, () => {
      const s = storageModule()
      s.writeFlags(ATTEMPT, new Set([Q(1)]))
      assert.deepEqual([...s.readFlags(ATTEMPT, [Q(1)])], [])
      s.writePendingStart('x', { attemptId: ATTEMPT, intent: 'new', redoOf: null, expected: { questionCount: 1, durationSeconds: 300 } })
      assert.equal(s.readPendingStart('x'), null)
      s.clearPendingStart('x')
      s.writeUnsent(ATTEMPT, { answers: {}, dirty: [] })
      assert.equal(s.readUnsent(ATTEMPT, new Map()), null)
      s.markResultSeen(ATTEMPT)
      assert.equal(s.resultSeen(ATTEMPT), false)
    })
  }
})

test('the attempt line never claims a save the server has not confirmed', () => {
  const base = { timeUp: false, submitFailing: false, refusal: null, clockSynced: true, clockFailures: 0, save: 'saved', answered: 3 }
  assert.deepEqual(saveLineFor(base), { text: 'All answers saved', retry: false })
  assert.equal(saveLineFor({ ...base, answered: 0 }), null, 'nothing answered, nothing to claim')
  assert.equal(saveLineFor({ ...base, save: 'saving' }).text, 'Saving…')
  assert.equal(saveLineFor({ ...base, save: 'unsaved' }).text, 'Not saved yet. We’ll keep trying.')
  assert.deepEqual(saveLineFor({ ...base, save: 'failed' }), { text: 'Your answers couldn’t be saved. They’re still on this device.', retry: true })
  assert.equal(saveLineFor({ ...base, clockSynced: false }).text, 'Checking the time left…')
  assert.match(saveLineFor({ ...base, clockSynced: false, clockFailures: 2 }).text, /^Reconnecting…/)
  assert.equal(saveLineFor({ ...base, timeUp: true }).text, PRACTICE_COPY.timeUp)
  assert.equal(saveLineFor({ ...base, timeUp: true, submitFailing: true }).text, PRACTICE_COPY.timeUpOffline)
  assert.equal(saveLineFor({ ...base, refusal: 'You signed in on another tab.' }).text, 'You signed in on another tab.')
  assert.equal(saveLineFor({ ...base, submitFailing: true }).text, 'Your answers are saved. Submission didn’t go through — try again.')
  assert.equal(saveLineFor({ ...base, submitFailing: true, save: 'unsaved' }).text,
    'Your answers are kept on this device. Submission didn’t go through — try again.')
  for (const state of ['saving', 'unsaved', 'failed', 'closed']) {
    assert.doesNotMatch(saveLineFor({ ...base, save: state })?.text ?? '', /saved$/i)
    assert.equal(exitBodyFor(state === 'closed' ? 'saving' : state, 3), PRACTICE_COPY.exitSaving)
  }
  assert.doesNotMatch(PRACTICE_COPY.timeUp + PRACTICE_COPY.timeUpOffline, /submitted/i,
    'time up waits for the server before saying the attempt was submitted')
  assert.doesNotMatch(Object.values(PRACTICE_COPY).join(' '), /timer has not started/i)
})
