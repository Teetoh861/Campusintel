// lib/entitlements/exam-autosave.test.cjs — The exam sheet is saved as this tab's changed questions over the revision
// it last received: numbered in sequence, normally one request at a time, sent at once near the deadline (overtaking a
// slow request), still sent when the clock runs out, retried within bounds after a failure, laid over the sheet the
// database returns without losing either tab's answers, and reported as saved only once the server confirmed this tab's
// latest change. Time and the network are simulated, so each rule is exact; the fake database applies the real rule
// (lib/entitlements/exam-autosave.ts, 20261021100000_discovery_pass.sql save_discovery_cbt).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AUTOSAVE, ExamAutosave, mergeSheets, retryDelayMs } = require('./exam-autosave.ts')

const Q1 = '11111111-1111-4111-8111-111111111111'
const Q2 = '22222222-2222-4222-8222-222222222222'
const Q3 = '33333333-3333-4333-8333-333333333333'
const TAB_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TAB_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** A fake clock, scheduler and network: every send is a pending promise the test settles in any order. */
function harness({ deadlineIn = 30 * 60_000, server = { revision: 0, answers: {} }, restored = null, tab = TAB_A,
  synced = true } = {}) {
  let now = 0
  const timers = new Map()
  let nextTimer = 1
  const sends = []
  const states = []
  const rebased = []
  const clock = { synced }
  const controller = new ExamAutosave({
    tab, server, restored,
    remaining: () => clock.synced ? deadlineIn - now : null,
    send: delta => new Promise((resolve, reject) => sends.push({ ...delta, resolve, reject })),
    schedule: (run, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, run }); return id },
    cancel: id => { timers.delete(id) },
    onChange: snapshot => states.push(snapshot),
    onRebase: merged => rebased.push(merged),
  })
  async function advance(ms) {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      now = due[1].at
      timers.delete(due[0])
      due[1].run()
      await Promise.resolve()
    }
    now = target
    await Promise.resolve()
  }
  const settle = async (send, outcome) => { send.resolve(outcome); await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
  const pendingTimers = () => [...timers.values()].map(t => t.at - now)
  return { controller, sends, states, rebased, clock, advance, settle, pendingTimers,
    state: () => controller.snapshot().state, last: () => sends[sends.length - 1], sheet: () => controller.unsent().answers }
}

/**
 * The database's rule (save_discovery_cbt): one tab's request is applied only above the sequence it last had
 * applied; its changed questions are laid over the sheet held; the revision advances by one; the whole sheet is
 * returned. A request at the applied sequence is a replay (acknowledged), below it stale (nothing applied).
 */
function database(initial = { revision: 0, answers: {} }) {
  const state = { revision: initial.revision, answers: { ...initial.answers }, applied: new Map(), saves: 0 }
  const reply = kind => ({ kind, revision: state.revision, answers: { ...state.answers } })
  return {
    state,
    save({ tab, sequence, baseRevision, changes }) {
      assert.ok(baseRevision <= state.revision, 'a tab never claims a revision the database has not issued')
      const applied = state.applied.get(tab) ?? 0
      if (Object.keys(changes).length === 0) return reply('saved')
      if (sequence < applied) return reply('stale')
      if (sequence === applied) return reply('saved')
      for (const [item, choice] of Object.entries(changes)) {
        if (choice === null) delete state.answers[item]; else state.answers[item] = choice
      }
      state.revision += 1
      state.saves += 1
      state.applied.set(tab, sequence)
      return reply('saved')
    },
  }
}

/** Settle every outstanding request of a tab against the database, in the order sent. */
async function exchange(h, db) {
  while (h.sends.some(send => !send.done)) {
    const send = h.sends.find(s => !s.done)
    send.done = true
    await h.settle(send, db.save(send))
  }
}

test('changes are numbered in sequence, only changed questions are sent, and a newer change waits for the acknowledgement', async () => {
  const h = harness({ server: { revision: 3, answers: { [Q3]: 1 } } })
  assert.equal(h.state(), 'saved', 'nothing to save when the exam opens')
  assert.equal(h.controller.change({ [Q3]: 1, [Q1]: 0 }), 1)
  assert.equal(h.state(), 'unsaved')
  assert.deepEqual(h.pendingTimers(), [AUTOSAVE.delayMs], 'one debounced save is planned')
  assert.equal(h.controller.change({ [Q3]: 1, [Q1]: 1 }), 2, 'a quick second change coalesces into the same save')
  await h.advance(AUTOSAVE.delayMs)
  assert.equal(h.sends.length, 1)
  assert.deepEqual([h.sends[0].tab, h.sends[0].sequence, h.sends[0].baseRevision, h.sends[0].changes],
    [TAB_A, 2, 3, { [Q1]: 1 }], 'only the question this tab changed goes, at its sequence, over the revision it holds')
  assert.equal(h.state(), 'saving')
  assert.equal(h.controller.change({ [Q3]: 1, [Q1]: 1, [Q2]: 2 }), 3, 'a change while a save is in flight')
  await h.advance(AUTOSAVE.delayMs * 2)
  assert.equal(h.sends.length, 1, 'is not sent until the in-flight save returns: saves never overlap')
  await h.settle(h.sends[0], { kind: 'saved', revision: 4, answers: { [Q3]: 1, [Q1]: 1 } })
  assert.equal(h.sends.length, 2, 'then the newer change is sent at once')
  assert.deepEqual([h.sends[1].sequence, h.sends[1].baseRevision, h.sends[1].changes], [3, 4, { [Q2]: 2 }],
    'Q1 was confirmed, so only Q2 is still pending, over the new revision')
  assert.equal(h.state(), 'saving')
  await h.settle(h.sends[1], { kind: 'saved', revision: 5, answers: { [Q3]: 1, [Q1]: 1, [Q2]: 2 } })
  assert.equal(h.state(), 'saved')
  assert.deepEqual(h.controller.snapshot(), { state: 'saved', revision: 3, savedRevision: 3, attempts: 0, refusal: null })
  assert.deepEqual(h.controller.delta(), { tab: TAB_A, sequence: 3, baseRevision: 5, changes: {} }, 'nothing pending')
})

test('regression F1: tab A changes Q1 and saves; tab B, holding the old sheet, changes Q2 twice before saving. Q1 never reverts', async () => {
  const db = database({ revision: 1, answers: { [Q1]: 0, [Q2]: 0, [Q3]: 2 } })
  const opened = { server: { revision: 1, answers: { ...db.state.answers } } }
  const a = harness({ ...opened, tab: TAB_A })
  const b = harness({ ...opened, tab: TAB_B })
  // Tab A changes Q1 and its save lands.
  a.controller.change({ ...opened.server.answers, [Q1]: 3 })
  await a.advance(AUTOSAVE.delayMs)
  await exchange(a, db)
  assert.deepEqual([a.state(), db.state.revision, db.state.answers[Q1]], ['saved', 2, 3])
  // Tab B still holds revision 1 with Q1 = 0. It changes Q2 twice (two local changes, one debounced save).
  b.controller.change({ ...opened.server.answers, [Q2]: 1 })
  b.controller.change({ ...opened.server.answers, [Q2]: 2 })
  await b.advance(AUTOSAVE.delayMs)
  assert.deepEqual([b.sends[0].sequence, b.sends[0].baseRevision, b.sends[0].changes], [2, 1, { [Q2]: 2 }],
    'tab B sends its own two changes to Q2 as one delta over the old revision, and nothing about Q1')
  await exchange(b, db)
  assert.deepEqual(db.state.answers, { [Q1]: 3, [Q2]: 2, [Q3]: 2 }, 'the database keeps tab A\'s Q1 and takes tab B\'s Q2')
  assert.deepEqual([b.state(), db.state.revision], ['saved', 3])
  assert.deepEqual(b.sheet(), { [Q1]: 3, [Q2]: 2, [Q3]: 2 }, 'tab B now shows Q1 as tab A saved it')
  assert.deepEqual(b.rebased, [{ [Q1]: 3, [Q2]: 2, [Q3]: 2 }], 'and its screen was told')
  assert.deepEqual(a.sheet(), { [Q1]: 3, [Q2]: 0, [Q3]: 2 }, 'tab A learns of Q2 at its next exchange')
  // Tab A's next save brings it up to date too.
  a.controller.change({ ...a.sheet(), [Q3]: 0 })
  await a.advance(AUTOSAVE.delayMs)
  await exchange(a, db)
  assert.deepEqual([db.state.answers, a.sheet()], [{ [Q1]: 3, [Q2]: 2, [Q3]: 0 }, { [Q1]: 3, [Q2]: 2, [Q3]: 0 }])
  assert.deepEqual([a.state(), b.state(), db.state.saves], ['saved', 'saved', 3])
})

test('policy: a question changed on two tabs takes the change that reaches the database last; both tabs then show it', async () => {
  for (const order of ['A then B', 'B then A']) {
    const db = database({ revision: 1, answers: { [Q1]: 0, [Q2]: 0 } })
    const opened = { server: { revision: 1, answers: { ...db.state.answers } } }
    const a = harness({ ...opened, tab: TAB_A })
    const b = harness({ ...opened, tab: TAB_B })
    a.controller.change({ [Q1]: 1, [Q2]: 0 })
    b.controller.change({ [Q1]: 2, [Q2]: 0 })
    await a.advance(AUTOSAVE.delayMs)
    await b.advance(AUTOSAVE.delayMs)
    const [first, second, expected] = order === 'A then B' ? [a, b, 2] : [b, a, 1]
    await exchange(first, db)
    await exchange(second, db)
    assert.equal(db.state.answers[Q1], expected, `${order}: the later arrival stands`)
    assert.deepEqual([first.state(), second.state()], ['saved', 'saved'], order)
    assert.equal(second.sheet()[Q1], expected, `${order}: the tab that saved last shows its own choice`)
    // The first tab learns the sheet that stands at its next exchange and shows it: no tab shows a choice the
    // database does not hold.
    first.controller.change({ ...first.sheet(), [Q2]: 3 })
    await first.advance(AUTOSAVE.delayMs)
    await exchange(first, db)
    assert.equal(first.sheet()[Q1], expected, `${order}: the first tab now shows the choice that stands`)
    assert.deepEqual(first.rebased, [{ [Q1]: expected, [Q2]: 3 }], order)
    assert.deepEqual(db.state.answers, { [Q1]: expected, [Q2]: 3 }, `${order}: Q2 was untouched on the other tab and is kept`)
  }
})

test('same-tab ordering: an older request landing after a newer one changes nothing, and a late stale answer loses nothing', async () => {
  // Far from the deadline the newer sheet overtakes a stalled request after the overtake window: both are in flight.
  const db = database()
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  await h.advance(AUTOSAVE.delayMs)
  h.controller.change({ [Q1]: 1 })
  await h.advance(AUTOSAVE.overtakeAfterMs)
  assert.deepEqual(h.sends.map(s => [s.sequence, s.changes]), [[1, { [Q1]: 0 }], [2, { [Q1]: 1 }]])
  // The newer request reaches the database first; the older one arrives late.
  const newer = db.save(h.sends[1])
  const older = db.save(h.sends[0])
  assert.deepEqual([newer.kind, older.kind, db.state.answers[Q1], db.state.revision], ['saved', 'stale', 1, 1],
    'the database applied sequence 2 and refused the late sequence 1: the answer is 1')
  await h.settle(h.sends[0], older)
  assert.deepEqual([h.state(), h.sheet()[Q1]], ['saving', 1], 'the stale answer does not disturb the pending confirmation')
  await h.settle(h.sends[1], newer)
  assert.deepEqual([h.state(), h.sheet()[Q1], h.sends.length], ['saved', 1, 2])
  // The opposite arrival order: the older is applied first, then the newer lays its later change over it.
  const db2 = database()
  const g = harness()
  g.controller.change({ [Q1]: 0 }); await g.advance(AUTOSAVE.delayMs); g.controller.change({ [Q1]: 1 })
  await g.advance(AUTOSAVE.overtakeAfterMs)
  await g.settle(g.sends[0], db2.save(g.sends[0]))
  await g.settle(g.sends[1], db2.save(g.sends[1]))
  assert.deepEqual([g.state(), db2.state.answers[Q1], db2.state.revision], ['saved', 1, 2])
})

test('a confirmation never goes backwards, and a retry carries the same sequence so the database applies it at most once', async () => {
  const db = database()
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  await h.advance(AUTOSAVE.delayMs)
  await h.settle(h.sends[0], { kind: 'failed' })
  await h.advance(retryDelayMs(1))
  assert.deepEqual([h.sends[1].sequence, h.sends[1].changes], [1, { [Q1]: 0 }], 'the retry repeats sequence 1')
  // Both the lost request and its retry reach the database: the second is a replay, acknowledged without a write.
  const first = db.save(h.sends[0])
  const replay = db.save(h.sends[1])
  assert.deepEqual([first.kind, replay.kind, db.state.saves, db.state.revision], ['saved', 'saved', 1, 1])
  await h.settle(h.sends[1], replay)
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision], ['saved', 1])
})

test('a failed save is retried with bounded backoff while the exam is open, without another answer change', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  await h.advance(AUTOSAVE.delayMs)
  for (let attempt = 1; attempt <= AUTOSAVE.maxRetries; attempt += 1) {
    await h.settle(h.last(), { kind: 'failed' })
    assert.equal(h.state(), 'unsaved', `attempt ${attempt}: still unsaved, not abandoned`)
    assert.deepEqual(h.pendingTimers(), [retryDelayMs(attempt)], `attempt ${attempt}: a retry is planned`)
    assert.equal(h.controller.snapshot().attempts, attempt)
    await h.advance(retryDelayMs(attempt))
    assert.equal(h.sends.length, attempt + 1, `attempt ${attempt}: the retry is sent`)
    assert.equal(h.sends[attempt].sequence, 1, 'with the same sequence')
  }
  await h.settle(h.last(), { kind: 'failed' })
  assert.equal(h.state(), 'failed', 'after the bounded retries the student is told the sheet is not saved')
  assert.deepEqual(h.pendingTimers(), [], 'and no further retry is planned on its own')
  assert.ok(retryDelayMs(AUTOSAVE.maxRetries) <= AUTOSAVE.retryMaxMs, 'the backoff is capped')
  h.controller.retry()
  assert.equal(h.sends.length, AUTOSAVE.maxRetries + 2, 'a manual retry sends at once')
  await h.settle(h.last(), { kind: 'saved', revision: 1, answers: { [Q1]: 0 } })
  assert.equal(h.state(), 'saved')
  // Recovery without a change: one failure, then the automatic retry succeeds.
  const recover = harness()
  recover.controller.change({ [Q1]: 1 })
  await recover.advance(AUTOSAVE.delayMs)
  await recover.settle(recover.sends[0], { kind: 'failed' })
  assert.equal(recover.state(), 'unsaved')
  await recover.advance(retryDelayMs(1))
  assert.equal(recover.sends.length, 2)
  assert.equal(recover.state(), 'saving')
  await recover.settle(recover.sends[1], { kind: 'saved', revision: 1, answers: { [Q1]: 1 } })
  assert.equal(recover.state(), 'saved', 'saved is shown only once the server confirmed the latest change')
})

test('a change is refused without a trustworthy clock reading, and after the cutoff; near the deadline it is sent at once', async () => {
  const unsynced = harness({ synced: false })
  assert.equal(unsynced.controller.change({ [Q1]: 0 }), null, 'no reading yet: the choice is not accepted')
  assert.equal(unsynced.state(), 'saved', 'and nothing is pending')
  unsynced.clock.synced = true
  assert.equal(unsynced.controller.change({ [Q1]: 0 }), 1, 'once a reading exists the choice is accepted')
  const h = harness({ deadlineIn: 500 })
  assert.equal(h.controller.change({ [Q1]: 3 }), 1)
  assert.deepEqual(h.pendingTimers(), [0], 'no debounce near the deadline')
  await h.advance(0)
  assert.equal(h.sends.length, 1, 'the change is on its way with half a second to spare')
  assert.equal(h.state(), 'saving')
  await h.settle(h.sends[0], { kind: 'saved', revision: 1, answers: { [Q1]: 3 } })
  assert.equal(h.state(), 'saved')
  await h.advance(600)
  assert.equal(h.controller.change({ [Q1]: 0 }), null, 'after the cutoff a change is refused on this device')
  assert.equal(h.sends.length, 1)
})

test('a change 300 milliseconds before the deadline, delayed past it, is reported by what the server decided', async () => {
  // The server accepted it in time: saved, even though the acknowledgement arrived after the clock ran out.
  const accepted = harness({ deadlineIn: 300 })
  accepted.controller.change({ [Q1]: 1 })
  await accepted.advance(0)
  assert.equal(accepted.sends.length, 1)
  await accepted.advance(1_000)
  assert.equal(accepted.state(), 'saving')
  await accepted.settle(accepted.sends[0], { kind: 'saved', revision: 1, answers: { [Q1]: 1 } })
  assert.deepEqual([accepted.state(), accepted.controller.snapshot().savedRevision], ['saved', 1])
  // The server closed the exam first: the change is reported as not saved, never promised.
  const closed = harness({ deadlineIn: 300 })
  closed.controller.change({ [Q1]: 1 })
  await closed.advance(0)
  await closed.advance(1_000)
  await closed.settle(closed.sends[0], { kind: 'refused', status: 'closed' })
  const snapshot = closed.controller.snapshot()
  assert.deepEqual([snapshot.state, snapshot.refusal, snapshot.savedRevision < snapshot.revision], ['failed', 'closed', true])
  // The request failed on the network: the deadline flush sends it again at once, and the server decides.
  const failed = harness({ deadlineIn: 300 })
  failed.controller.change({ [Q1]: 1 })
  await failed.advance(0)
  await failed.advance(1_000)
  await failed.settle(failed.sends[0], { kind: 'failed' })
  assert.deepEqual([failed.state(), failed.pendingTimers()], ['closed', []], 'no retry timer after the deadline')
  const flushed = failed.controller.flush()
  assert.equal(failed.sends.length, 2, 'the flush at the deadline sends the unsaved changes immediately')
  await failed.settle(failed.sends[1], { kind: 'refused', status: 'closed' })
  await flushed
  assert.equal(failed.controller.snapshot().refusal, 'closed')
})

test('regression F2: an older pending save, a new answer 300 ms before expiry, the older response arriving afterwards', async () => {
  const db = database()
  const h = harness({ deadlineIn: 5_000 })
  h.controller.change({ [Q1]: 0 })
  await h.advance(0)
  assert.deepEqual([h.sends.length, h.sends[0].sequence], [1, 1])
  await h.advance(4_700)
  assert.equal(h.controller.change({ [Q1]: 0, [Q2]: 1 }), 2)
  await h.advance(0)
  assert.equal(h.sends.length, 2, 'the urgent change is transmitted at once, in parallel with the stalled one')
  assert.deepEqual([h.sends[1].sequence, h.sends[1].changes], [2, { [Q1]: 0, [Q2]: 1 }], 'with every unconfirmed question')
  await h.advance(1_000)
  // The database took sequence 2 in time; the older request answers afterwards as stale.
  await h.settle(h.sends[1], db.save(h.sends[1]))
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision], ['saving', 2], 'saved at 2, older still pending')
  await h.settle(h.sends[0], db.save(h.sends[0]))
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision, h.sends.length, db.state.answers],
    ['saved', 2, 2, { [Q1]: 0, [Q2]: 1 }], 'the late older answer is ignored: nothing is resent, and the sheet stands')
  assert.deepEqual(h.rebased, [])
  // And when the server closed the exam before the urgent change arrived, it is never reported as saved.
  const late = harness({ deadlineIn: 5_000 })
  late.controller.change({ [Q1]: 0 }); await late.advance(4_700); late.controller.change({ [Q1]: 1 }); await late.advance(1_000)
  await late.settle(late.sends[1], { kind: 'refused', status: 'closed' })
  await late.settle(late.sends[0], { kind: 'saved', revision: 1, answers: { [Q1]: 0 } })
  const snapshot = late.controller.snapshot()
  assert.deepEqual([snapshot.state, snapshot.refusal, snapshot.savedRevision, snapshot.revision], ['failed', 'closed', 1, 2],
    'sequence 1 was saved in time, sequence 2 was not, and the screen is told so')
})

test('far from the deadline a newer change waits for a save in flight, but not longer than the overtake window', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  await h.advance(AUTOSAVE.delayMs)
  assert.equal(h.sends.length, 1)
  h.controller.change({ [Q1]: 1 })
  await h.advance(AUTOSAVE.overtakeAfterMs - 1)
  assert.equal(h.sends.length, 1, 'still waiting for the first request')
  await h.advance(1)
  assert.equal(h.sends.length, 2, 'after the overtake window the newer change goes in parallel')
  assert.deepEqual([h.sends[1].sequence, h.sends[1].changes], [2, { [Q1]: 1 }])
  await h.settle(h.sends[0], { kind: 'saved', revision: 1, answers: { [Q1]: 0 } })
  await h.settle(h.sends[1], { kind: 'saved', revision: 2, answers: { [Q1]: 1 } })
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision, h.sheet()], ['saved', 2, { [Q1]: 1 }])
  // A flush (the page being left, the deadline, a submission) overtakes at once.
  const f = harness()
  f.controller.change({ [Q1]: 0 }); await f.advance(AUTOSAVE.delayMs); f.controller.change({ [Q1]: 1 })
  void f.controller.flush()
  assert.deepEqual(f.sends.map(s => s.sequence), [1, 2])
})

test('a cleared choice is sent as null; an untouched question always follows the database', () => {
  assert.deepEqual(mergeSheets({ [Q1]: 1, [Q2]: 1 }, { [Q1]: 2 }, [Q1, Q2]), { [Q1]: 2 }, 'a dirty question cleared here is cleared')
  const h = harness({ server: { revision: 2, answers: { [Q1]: 1, [Q2]: 1 } } })
  h.controller.change({ [Q2]: 1 })
  assert.deepEqual(h.controller.delta(), { tab: TAB_A, sequence: 1, baseRevision: 2, changes: { [Q1]: null } })
})

test('a sheet kept before a reload lays only its unsent questions over the database\'s sheet, and saves them at once', async () => {
  // Q1 was changed here and never confirmed; Q2 was changed by another tab after this tab kept its copy.
  const h = harness({ server: { revision: 5, answers: { [Q1]: 0, [Q2]: 3 } },
    restored: { answers: { [Q1]: 1, [Q2]: 0 }, dirty: [Q1] } })
  assert.deepEqual(h.sheet(), { [Q1]: 1, [Q2]: 3 }, 'Q1 is this tab\'s unsent change; Q2 follows the database')
  assert.equal(h.state(), 'unsaved')
  await h.advance(AUTOSAVE.delayMs)
  assert.deepEqual([h.sends[0].sequence, h.sends[0].baseRevision, h.sends[0].changes], [1, 5, { [Q1]: 1 }])
  await h.settle(h.sends[0], { kind: 'saved', revision: 6, answers: { [Q1]: 1, [Q2]: 3 } })
  assert.deepEqual([h.state(), h.controller.unsent()], ['saved', { answers: { [Q1]: 1, [Q2]: 3 }, dirty: [] }])
  const same = harness({ server: { revision: 2, answers: { [Q1]: 0 } }, restored: { answers: { [Q1]: 0 }, dirty: [Q1] } })
  assert.equal(same.state(), 'saved', 'a kept change the database already holds is not re-sent')
  await same.advance(AUTOSAVE.delayMs)
  assert.equal(same.sends.length, 0)
})

test('a sheet learnt from a clock sync is adopted under this tab\'s unconfirmed changes', async () => {
  const h = harness({ server: { revision: 1, answers: { [Q1]: 0, [Q2]: 0 } } })
  h.controller.change({ [Q1]: 2, [Q2]: 0 })
  h.controller.adopt({ revision: 3, answers: { [Q1]: 1, [Q2]: 1 } })
  assert.deepEqual([h.sheet(), h.rebased], [{ [Q1]: 2, [Q2]: 1 }, [{ [Q1]: 2, [Q2]: 1 }]],
    'Q1 keeps the choice made here; Q2 takes the other tab\'s answer this tab never touched')
  h.controller.adopt({ revision: 2, answers: {} })
  assert.deepEqual(h.sheet(), { [Q1]: 2, [Q2]: 1 }, 'an older sheet is ignored')
  await h.advance(AUTOSAVE.delayMs)
  assert.deepEqual([h.sends[0].baseRevision, h.sends[0].changes], [3, { [Q1]: 2 }], 'the save goes over the newest revision')
})

test('flush resolves when the in-flight save settles, so a submission can let the changes land first', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  let done = false
  const flushed = h.controller.flush().then(() => { done = true })
  assert.equal(h.sends.length, 1, 'flush sends at once')
  await Promise.resolve()
  assert.equal(done, false)
  await h.settle(h.sends[0], { kind: 'saved', revision: 1, answers: { [Q1]: 0 } })
  await flushed
  assert.equal(done, true)
  assert.equal(h.state(), 'saved')
  await h.controller.flush()
  assert.equal(h.sends.length, 1, 'nothing to flush when everything is saved')
})

test('stopping for submission cancels the planned save and ignores a late acknowledgement', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  h.controller.stop()
  await h.advance(AUTOSAVE.delayMs)
  assert.equal(h.sends.length, 0)
  assert.equal(h.controller.change({ [Q1]: 1 }), null)
})

test('regression (review item 3): a too-many-tabs refusal drops the rejected choice for good: no sync brings it back, nothing resends it, and late replies change nothing', async () => {
  // Tab 65 opens with the standing sheet (Q1 = A at revision 64) and chooses Q1 = D; the database refuses the tab.
  const h = harness({ server: { revision: 64, answers: { [Q1]: 0 } } })
  assert.equal(h.controller.change({ [Q1]: 3 }), 1)
  await h.advance(AUTOSAVE.delayMs)
  // A second change overtakes while the first is still in flight, so two requests are pending when the refusal lands.
  assert.equal(h.controller.change({ [Q1]: 2 }), 2)
  await h.advance(AUTOSAVE.overtakeAfterMs)
  assert.deepEqual(h.sends.map(s => s.changes), [{ [Q1]: 3 }, { [Q1]: 2 }])
  await h.settle(h.sends[1], { kind: 'refused', status: 'too-many-tabs', sheet: { revision: 64, answers: { [Q1]: 0 } } })
  assert.deepEqual([h.state(), h.controller.snapshot().refusal], ['failed', 'too-many-tabs'])
  assert.deepEqual(h.sheet(), { [Q1]: 0 }, 'the sheet that stands is shown: nothing refused looks chosen')
  assert.deepEqual(h.rebased.at(-1), { [Q1]: 0 }, 'and the screen was told in the same step')
  assert.deepEqual(h.controller.unsent(), { answers: { [Q1]: 0 }, dirty: [] }, 'nothing is kept as unsent for a reload')
  assert.deepEqual(h.controller.delta().changes, {}, 'a submission carries nothing of the rejected choice')
  // The older request answers late with a reply that would restore the choice: it changes nothing.
  await h.settle(h.sends[0], { kind: 'saved', revision: 65, answers: { [Q1]: 3 } })
  assert.deepEqual([h.state(), h.sheet(), h.controller.delta().changes], ['failed', { [Q1]: 0 }, {}])
  // An existing tab saves Q2 = C; this tab comes back into view and its clock sync adopts the database's sheet.
  h.controller.adopt({ revision: 66, answers: { [Q1]: 0, [Q2]: 2 } })
  assert.deepEqual(h.sheet(), { [Q1]: 0, [Q2]: 2 }, 'the sync shows the sheet that stands, without Q1 = D')
  assert.deepEqual(h.controller.delta().changes, {}, 'and still nothing to resend')
  // No further change is accepted, and a flush (leaving the page, a submission) sends nothing.
  assert.equal(h.controller.change({ [Q1]: 0, [Q2]: 2, [Q3]: 1 }), null)
  await h.controller.flush()
  assert.equal(h.sends.length, 2, 'no request after the refusal')
  assert.deepEqual(h.sheet(), { [Q1]: 0, [Q2]: 2 })
})
