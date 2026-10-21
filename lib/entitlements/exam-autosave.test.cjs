// lib/entitlements/exam-autosave.test.cjs — The exam sheet is saved in revision order with one request in flight,
// saved at once near the deadline, still sent when the clock runs out, retried within bounds after a failure,
// re-based when another copy got ahead, and reported as saved, saving, unsaved or failed at every step. Time and the
// network are simulated, so each rule is exact.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AUTOSAVE, ExamAutosave, retryDelayMs } = require('./exam-autosave.ts')

const Q1 = '11111111-1111-4111-8111-111111111111'
const Q2 = '22222222-2222-4222-8222-222222222222'

/** A fake clock, scheduler and network: every send is a pending promise the test settles in any order. */
function harness({ deadlineIn = 30 * 60_000, revision = 0, savedRevision = 0, answers = {} } = {}) {
  let now = 0
  const timers = new Map()
  let nextTimer = 1
  const sends = []
  const states = []
  const rebased = []
  const controller = new ExamAutosave({
    answers, revision, savedRevision,
    remaining: () => deadlineIn - now,
    send: (sheet, rev) => new Promise((resolve, reject) => sends.push({ answers: sheet, revision: rev, resolve, reject })),
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
  return { controller, sends, states, rebased, advance, settle, pendingTimers, state: () => controller.snapshot().state,
    last: () => sends[sends.length - 1] }
}

test('changes are numbered in order, one save is in flight at a time, and a newer change waits for the acknowledgement', async () => {
  const h = harness()
  assert.equal(h.state(), 'saved', 'nothing to save when the exam opens')
  assert.equal(h.controller.change({ [Q1]: 0 }), 1)
  assert.equal(h.state(), 'unsaved')
  assert.deepEqual(h.pendingTimers(), [AUTOSAVE.delayMs], 'one debounced save is planned')
  assert.equal(h.controller.change({ [Q1]: 1 }), 2, 'a quick second change coalesces into the same save')
  await h.advance(AUTOSAVE.delayMs)
  assert.equal(h.sends.length, 1)
  assert.deepEqual([h.sends[0].revision, h.sends[0].answers], [2, { [Q1]: 1 }], 'the latest sheet goes, at its revision')
  assert.equal(h.state(), 'saving')
  assert.equal(h.controller.change({ [Q1]: 1, [Q2]: 2 }), 3, 'a change while a save is in flight')
  await h.advance(AUTOSAVE.delayMs * 2)
  assert.equal(h.sends.length, 1, 'is not sent until the in-flight save returns: saves never overlap')
  await h.settle(h.sends[0], { kind: 'saved', revision: 2 })
  assert.equal(h.sends.length, 2, 'then the newer sheet is sent at once')
  assert.deepEqual([h.sends[1].revision, h.sends[1].answers], [3, { [Q1]: 1, [Q2]: 2 }])
  assert.equal(h.state(), 'saving')
  await h.settle(h.sends[1], { kind: 'saved', revision: 3 })
  assert.equal(h.state(), 'saved')
  assert.deepEqual(h.controller.snapshot(), { state: 'saved', revision: 3, savedRevision: 3, attempts: 0, refusal: null })
})

test('regression: answer 0 then answer 1 with the older request completing last leaves 1 saved', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  await h.advance(AUTOSAVE.delayMs)
  const older = h.sends[0]
  assert.deepEqual([older.revision, older.answers], [1, { [Q1]: 0 }])
  // The first request stalls on the network. The student changes the answer meanwhile; nothing else is sent until
  // the stalled request settles, so the two can never race each other out of this device.
  h.controller.change({ [Q1]: 1 })
  await h.advance(AUTOSAVE.delayMs * 3)
  assert.equal(h.sends.length, 1, 'revision 2 waits behind revision 1')
  assert.equal(h.state(), 'saving')
  await h.settle(older, { kind: 'saved', revision: 1 })
  assert.equal(h.sends.length, 2, 'then revision 2 goes')
  assert.deepEqual([h.sends[1].revision, h.sends[1].answers], [2, { [Q1]: 1 }])
  await h.settle(h.sends[1], { kind: 'saved', revision: 2 })
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision], ['saved', 2])
  // The database side of the same case (the stalled request arriving after a retry that already landed at a higher
  // revision) answers "stale": the newer sheet stands, and this device re-bases rather than treating it as saved.
  const late = harness({ revision: 0, savedRevision: 0 })
  late.controller.change({ [Q1]: 0 })
  await late.advance(AUTOSAVE.delayMs)
  await late.settle(late.sends[0], { kind: 'failed' })
  late.controller.change({ [Q1]: 1 })
  await late.advance(AUTOSAVE.delayMs)
  assert.equal(late.sends[1].revision, 2)
  await late.settle(late.sends[1], { kind: 'saved', revision: 2 })
  assert.deepEqual([late.state(), late.controller.snapshot().savedRevision], ['saved', 2])
})

test('a stale acknowledgement never counts as saved: the device re-bases above the server, keeps its own choices and resends', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 2 })
  await h.advance(AUTOSAVE.delayMs)
  assert.equal(h.sends[0].revision, 1)
  // Another tab had already saved revision 5 with a different sheet.
  await h.settle(h.sends[0], { kind: 'stale', revision: 5, answers: { [Q1]: 0, [Q2]: 3 } })
  assert.notEqual(h.state(), 'saved', 'the acknowledgement of a stale sheet is not a confirmation of this one')
  assert.equal(h.sends.length, 2, 'the sheet is sent again at once')
  assert.deepEqual([h.sends[1].revision, h.sends[1].answers], [6, { [Q1]: 2, [Q2]: 3 }],
    'above the server revision, with this device’s choice kept and the other tab’s untouched answer merged in')
  assert.deepEqual(h.rebased, [{ [Q1]: 2, [Q2]: 3 }], 'the screen is told about the merged sheet')
  await h.settle(h.sends[1], { kind: 'saved', revision: 6 })
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision], ['saved', 6])
  assert.equal(h.controller.change({ [Q1]: 1 }), 7, 'the next change is numbered above the database’s revision')
  // Two copies cannot chase each other without end: re-basing is bounded like a failure.
  const loop = harness()
  loop.controller.change({ [Q1]: 0 })
  await loop.advance(AUTOSAVE.delayMs)
  for (let attempt = 1; attempt <= AUTOSAVE.maxRetries; attempt += 1) {
    await loop.settle(loop.last(), { kind: 'stale', revision: loop.last().revision + 1, answers: {} })
    assert.equal(loop.sends.length, attempt + 1, `re-base ${attempt} resends`)
  }
  await loop.settle(loop.last(), { kind: 'stale', revision: loop.last().revision + 1, answers: {} })
  assert.equal(loop.sends.length, AUTOSAVE.maxRetries + 1, 'then it stops and reports')
  assert.equal(loop.state(), 'failed')
})

test('duplicate retries carry the same revision, and an acknowledgement naming another revision is not a confirmation', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  await h.advance(AUTOSAVE.delayMs)
  await h.settle(h.sends[0], { kind: 'failed' })
  await h.advance(retryDelayMs(1))
  assert.equal(h.sends[1].revision, 1, 'the retry repeats revision 1, so the database applies it at most once')
  await h.settle(h.sends[1], { kind: 'saved', revision: 7 })
  assert.deepEqual([h.state(), h.controller.snapshot().savedRevision, h.controller.snapshot().attempts], ['unsaved', 0, 2],
    'a confirmation that does not name the sheet sent is treated as a failure, never as saved')
  await h.advance(retryDelayMs(2))
  await h.settle(h.last(), { kind: 'saved', revision: 1 })
  assert.equal(h.state(), 'saved')
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
    assert.equal(h.sends[attempt].revision, 1, 'with the same revision')
  }
  await h.settle(h.last(), { kind: 'failed' })
  assert.equal(h.state(), 'failed', 'after the bounded retries the student is told the sheet is not saved')
  assert.deepEqual(h.pendingTimers(), [], 'and no further retry is planned on its own')
  assert.ok(retryDelayMs(AUTOSAVE.maxRetries) <= AUTOSAVE.retryMaxMs, 'the backoff is capped')
  h.controller.retry()
  assert.equal(h.sends.length, AUTOSAVE.maxRetries + 2, 'a manual retry sends at once')
  await h.settle(h.last(), { kind: 'saved', revision: 1 })
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
  await recover.settle(recover.sends[1], { kind: 'saved', revision: 1 })
  assert.equal(recover.state(), 'saved', 'saved is shown only once the server confirmed the latest revision')
})

test('a change 500 milliseconds before the deadline is sent at once', async () => {
  const h = harness({ deadlineIn: 500 })
  assert.equal(h.controller.change({ [Q1]: 3 }), 1)
  assert.deepEqual(h.pendingTimers(), [0], 'no debounce near the deadline')
  await h.advance(0)
  assert.equal(h.sends.length, 1, 'the sheet is on its way with half a second to spare')
  assert.equal(h.state(), 'saving')
  await h.settle(h.sends[0], { kind: 'saved', revision: 1 })
  assert.equal(h.state(), 'saved')
  await h.advance(600)
  assert.equal(h.controller.change({ [Q1]: 0 }), null, 'after the deadline a change is refused on this device')
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
  await accepted.settle(accepted.sends[0], { kind: 'saved', revision: 1 })
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
  assert.equal(failed.sends.length, 2, 'the flush at the deadline sends the unsaved sheet immediately')
  await failed.settle(failed.sends[1], { kind: 'refused', status: 'closed' })
  await flushed
  assert.equal(failed.controller.snapshot().refusal, 'closed')
})

test('a change made while a save is in flight is still sent when its predecessor returns after the deadline', async () => {
  const h = harness({ deadlineIn: 1_000 })
  h.controller.change({ [Q1]: 0 })
  await h.advance(0)
  assert.equal(h.sends.length, 1)
  await h.advance(700)
  assert.equal(h.controller.change({ [Q1]: 1 }), 2, 'a second change 300 milliseconds before the deadline')
  await h.advance(500)
  await h.settle(h.sends[0], { kind: 'saved', revision: 1 })
  assert.equal(h.sends.length, 2, 'the pending sheet is sent, not discarded because the clock ran out')
  assert.deepEqual([h.sends[1].revision, h.sends[1].answers], [2, { [Q1]: 1 }])
})

test('flush resolves when the in-flight save settles, so a submission can let the sheet land first', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  let done = false
  const flushed = h.controller.flush().then(() => { done = true })
  assert.equal(h.sends.length, 1, 'flush sends at once')
  await Promise.resolve()
  assert.equal(done, false)
  await h.settle(h.sends[0], { kind: 'saved', revision: 1 })
  await flushed
  assert.equal(done, true)
  assert.equal(h.state(), 'saved')
  await h.controller.flush()
  assert.equal(h.sends.length, 1, 'nothing to flush when everything is saved')
})

test('a sheet restored on this device that is newer than the database’s is saved immediately', async () => {
  const h = harness({ revision: 4, savedRevision: 2, answers: { [Q1]: 1 } })
  assert.equal(h.state(), 'unsaved')
  await h.advance(AUTOSAVE.delayMs)
  assert.deepEqual([h.sends[0].revision, h.sends[0].answers], [4, { [Q1]: 1 }])
  await h.settle(h.sends[0], { kind: 'saved', revision: 4 })
  assert.equal(h.state(), 'saved')
  const same = harness({ revision: 2, savedRevision: 2 })
  assert.equal(same.state(), 'saved', 'a sheet the database already holds is not re-sent')
  await same.advance(AUTOSAVE.delayMs)
  assert.equal(same.sends.length, 0)
})

test('stopping for submission cancels the planned save and ignores a late acknowledgement', async () => {
  const h = harness()
  h.controller.change({ [Q1]: 0 })
  h.controller.stop()
  await h.advance(AUTOSAVE.delayMs)
  assert.equal(h.sends.length, 0)
  assert.equal(h.controller.change({ [Q1]: 1 }), null)
})
