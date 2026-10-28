// lib/entitlements/exam-tab.test.cjs — A tab keeps one identity and its sequence across reloads, so reloads never use up
// an exam's tab capacity; a duplicated tab (which copies session storage) is told apart and takes a new identity; and an
// autosave resumed under a kept identity sends above anything that identity already used.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EXAM_TAB, claimExamTab, claimExamTabOnce, readTabRecord } = require('./exam-tab.ts')
const { ExamAutosave } = require('./exam-autosave.ts')

const KEY = 'practice-attempt:11111111-1111-4111-8111-111111111111'
const ID = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`

function storage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), map,
    copy() { return storage(Object.fromEntries(map)) } }
}

/** Pages of one browser: each channel delivers to the others, asynchronously, as BroadcastChannel does. */
function bus() {
  const channels = new Set()
  return name => {
    const channel = { name, onmessage: null, closed: false,
      postMessage(message) {
        for (const other of channels) {
          if (other !== channel && other.name === name && !other.closed) queueMicrotask(() => other.onmessage?.({ data: message }))
        }
      },
      close() { this.closed = true; channels.delete(this) } }
    channels.add(channel)
    return channel
  }
}

function page(options) {
  let next = options.firstId ?? 1
  return claimExamTab({ key: KEY, storage: options.storage, channel: options.channel ?? null,
    newId: () => ID(next++), schedule: (run, ms) => setTimeout(run, Math.min(ms, 30)) })
}

test('a reload reuses the identity and its last sequence: twenty reloads use one identity', async () => {
  const session = storage()
  const channel = bus()
  const first = await page({ storage: session, channel, firstId: 1 })
  assert.equal(first.tab, ID(1))
  first.remember(4)
  first.release() // the page unloads
  const seen = new Set([first.tab])
  for (let reload = 0; reload < 20; reload++) {
    const again = await page({ storage: session, channel, firstId: 100 + reload })
    seen.add(again.tab)
    assert.ok(again.sequence >= 4, 'the sequence continues above what was used before the reload')
    again.remember(again.sequence + 1)
    again.release()
  }
  assert.deepEqual([...seen], [ID(1)], 'one identity across twenty reloads')
  assert.equal(readTabRecord(session, KEY).sequence, 24)
})

test('a duplicated tab copies storage but is told apart: it takes a new identity at sequence zero', async () => {
  const session = storage()
  const channel = bus()
  const original = await page({ storage: session, channel, firstId: 1 })
  original.remember(7)
  const duplicate = await page({ storage: session.copy(), channel, firstId: 50 })
  assert.notEqual(duplicate.tab, original.tab)
  assert.equal(duplicate.sequence, 0)
  assert.equal(original.tab, ID(1), 'the original keeps its identity')
  // Two pages claiming the same stored identity at the same moment both take new ones: never a shared identity.
  const shared = storage({ [`exam-tab:${KEY}`]: JSON.stringify({ tab: ID(9), sequence: 3 }) })
  const [a, b] = await Promise.all([page({ storage: shared.copy(), channel, firstId: 60 }),
    page({ storage: shared.copy(), channel, firstId: 70 })])
  assert.notEqual(a.tab, b.tab)
  assert.ok(a.tab !== ID(9) && b.tab !== ID(9))
})

test('without a channel or storage nothing can be told apart, so a new identity is taken; bad records are ignored', async () => {
  const session = storage({ [`exam-tab:${KEY}`]: JSON.stringify({ tab: ID(9), sequence: 3 }) })
  assert.equal((await page({ storage: session, channel: null, firstId: 1 })).tab, ID(1))
  assert.equal((await page({ storage: null, channel: bus(), firstId: 2 })).tab, ID(2))
  for (const bad of ['not json', JSON.stringify({ tab: 'tab-1', sequence: 1 }), JSON.stringify({ tab: ID(1), sequence: -1 }),
    JSON.stringify({ tab: ID(1), sequence: EXAM_TAB.maxSequence + 1 }), JSON.stringify({ tab: ID(1), sequence: 1.5 })]) {
    assert.equal(readTabRecord(storage({ [`exam-tab:${KEY}`]: bad }), KEY), null, bad)
  }
  const throwing = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(readTabRecord(throwing, KEY), null)
  const claimed = await page({ storage: throwing, channel: bus(), firstId: 3 })
  assert.equal(claimed.tab, ID(3))
  claimed.remember(2)
})

test('remember only ever moves the sequence forward', async () => {
  const session = storage()
  const claimed = await page({ storage: session, channel: bus(), firstId: 1 })
  claimed.remember(5)
  claimed.remember(3)
  claimed.remember(Number.NaN)
  assert.equal(readTabRecord(session, KEY).sequence, 5)
})

test('an autosave resumed under a kept identity sends above its last sequence and reports saved without a send', async () => {
  const sends = []
  const sequences = []
  const timers = []
  const options = (extra) => ({ tab: ID(1), server: { revision: 4, answers: { [ID(20)]: 1 } },
    remaining: () => 60_000, send: async delta => { sends.push(delta); return { kind: 'saved', revision: 5, answers: {} } },
    schedule: run => { timers.push(run); return timers.length }, cancel() {}, onChange() {},
    onSequence: sequence => sequences.push(sequence), ...extra })
  const idle = new ExamAutosave(options({ startSequence: 6 }))
  assert.equal(idle.snapshot().state, 'saved')
  assert.equal(idle.snapshot().revision, 6)
  assert.deepEqual(sequences, [])
  assert.equal(idle.change({ [ID(20)]: 2 }), 7, 'the next change takes the sequence after the kept one')
  assert.deepEqual(sequences, [7], 'recorded before any request carries it')
  // A reload with unsent changes: they go at the next sequence after the kept one.
  const restored = new ExamAutosave(options({ startSequence: 9, restored: { answers: { [ID(20)]: 3 }, dirty: [ID(20)] } }))
  assert.deepEqual(sequences, [7, 10])
  timers.at(-1)()
  assert.deepEqual(sends.at(-1), { tab: ID(1), sequence: 10, baseRevision: 4, changes: { [ID(20)]: 3 } })
  assert.equal(restored.snapshot().state, 'saving')
})

test('a page that asks twice (a remount, or effects run twice) keeps its stored identity: one claim per page', async () => {
  const stored = JSON.stringify({ tab: ID(9), sequence: 3 })
  const channel = bus()
  const options = (session, key, first) => {
    let next = first
    return { key: `${KEY}:${key}`, storage: session, channel, newId: () => ID(next++), schedule: (run, ms) => setTimeout(run, Math.min(ms, 30)) }
  }
  // Regression: two concurrent claims from the same page look like a duplicated tab, and both take a new identity.
  const twice = storage({ [`exam-tab:${KEY}:raced`]: stored })
  const raced = await Promise.all([claimExamTab(options(twice, 'raced', 100)), claimExamTab(options(twice, 'raced', 150))])
  assert.ok(raced.every(claim => claim.tab !== ID(9)), 'the uncached claim loses the stored identity')
  const once = storage({ [`exam-tab:${KEY}:once`]: stored })
  const [a, b] = await Promise.all([claimExamTabOnce(options(once, 'once', 200)), claimExamTabOnce(options(once, 'once', 250))])
  assert.equal(a, b, 'the same claim is returned')
  assert.equal(a.tab, ID(9), 'and it keeps the stored identity')
  assert.equal(a.sequence, 3)
})

for (const surface of ['practice-attempt', 'discovery-exam']) {
  test(`${surface}: save, remount from the cached claim, change and save preserves the new choice`, async () => {
    const session = storage(), channel = bus(), question = ID(40)
    const options = { key: `${KEY}:saved-remount:${surface}`, storage: session, channel,
      newId: () => ID(100), schedule: run => setTimeout(run, 0) }
    let server = { revision: 0, answers: {} }, applied = 0
    const mount = async () => {
      const identity = await claimExamTabOnce(options)
      return new ExamAutosave({ tab: identity.tab, startSequence: identity.sequence,
        onSequence: next => identity.remember(next), server, remaining: () => 60_000,
        // The database accepts this identity's increasing sequences and acknowledges a duplicate unchanged.
        send: async delta => {
          if (delta.sequence > applied) {
            applied = delta.sequence
            server = { revision: server.revision + 1, answers: { ...server.answers, ...delta.changes } }
          }
          return { kind: 'saved', ...server }
        }, schedule: () => 0, cancel() {}, onChange() {} })
    }
    const first = await mount()
    first.change({ [question]: 0 })
    await first.flush()
    first.stop()
    const remounted = await mount()
    remounted.change({ [question]: 2 })
    await remounted.flush()
    assert.equal(server.answers[question], 2, 'the changed choice must be stored after a cached remount')
    assert.equal(applied, 2, 'the remount continues above the previously accepted sequence')
    assert.equal(remounted.snapshot().state, 'saved')
    remounted.stop()
  })
}
