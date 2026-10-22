// lib/entitlements/exam-clock.test.cjs — Whether a tap may still change an answer is decided from a fresh server
// exchange and the monotonic clock only: the round trip is charged in full, the device's wall clock is never the
// authority, there is no reading (and no answering) until an exchange lands, and a device that may have slept reads
// the server again before any tap. Time and the network are simulated, so each rule is exact.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EXAM_CLOCK, ExamClock, syncRetryMs } = require('./exam-clock.ts')

const SERVER_NOW = Date.parse('2026-10-22T10:00:00.000Z')

/**
 * A device: a monotonic clock, a wall clock set as far from the server's as the test says, and a server whose clock
 * runs at the same rate as the monotonic one. Each sync resolves after the chosen round trip, with the server's clock
 * read at the chosen point of it.
 */
function device({ wallOffset = 0, deadlineIn = 60_000, roundTrip = 200, readAt = 'end' } = {}) {
  let now = 0
  const timers = new Map()
  let nextTimer = 1
  const states = []
  const pending = []
  const server = { readAt, roundTrip, fail: false, deadline: SERVER_NOW + deadlineIn }
  const serverClock = () => SERVER_NOW + now
  const clock = new ExamClock({
    monotonic: () => now,
    wall: () => SERVER_NOW + wallOffset + now,
    sync: () => new Promise(resolve => {
      const sentAt = now
      pending.push({ sentAt, resolve, answer: () => {
        if (server.fail) return null
        const readAtMs = server.readAt === 'start' ? sentAt : server.readAt === 'middle' ? sentAt + server.roundTrip / 2
          : sentAt + server.roundTrip
        return { serverNow: SERVER_NOW + readAtMs, deadline: server.deadline }
      } })
    }),
    schedule: (run, ms) => { const id = nextTimer++; timers.set(id, { at: now + ms, run }); return id },
    cancel: id => { timers.delete(id) },
    onChange: state => states.push(state),
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
  /** Let the oldest exchange in flight answer, after its round trip has elapsed on the clocks. */
  async function answer() {
    const request = pending.shift()
    if (!request) throw new Error('no exchange in flight')
    await advance(Math.max(0, request.sentAt + server.roundTrip - now))
    request.resolve(request.answer())
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
  }
  return { clock, server, states, advance, answer, inFlight: () => pending.length, serverClock,
    serverRemaining: () => server.deadline - serverClock(), pendingTimers: () => [...timers.values()].map(t => t.at - now) }
}

test('no reading, no answering: until the first exchange lands the clock reports nothing', async () => {
  const d = device()
  assert.deepEqual([d.clock.state(), d.clock.remaining()], ['unsynced', null])
  d.clock.start()
  assert.equal(d.inFlight(), 1, 'the exchange is sent on start')
  await d.advance(100)
  assert.equal(d.clock.remaining(), null, 'still nothing while it is in flight')
  await d.answer()
  assert.deepEqual([d.clock.state(), d.states], ['synced', ['synced']])
  assert.ok(d.clock.remaining() !== null && d.clock.remaining() > 0)
})

test('the reading charges the whole round trip, so it is never later than the server\'s deadline wherever the server read its clock', async () => {
  for (const readAt of ['start', 'middle', 'end']) {
    const d = device({ deadlineIn: 60_000, roundTrip: 3_000, readAt })
    d.clock.start()
    await d.answer()
    const remaining = d.clock.remaining()
    assert.ok(remaining <= d.serverRemaining(), `${readAt}: ${remaining} is not later than the server's ${d.serverRemaining()}`)
    assert.ok(d.serverRemaining() - remaining <= 3_000, `${readAt}: at most the round trip is lost`)
    if (readAt === 'start') assert.equal(remaining, d.serverRemaining(), 'exact when the server read its clock as the request left')
  }
})

test('regression F3: the device wall clock is never the authority: ahead or behind the server, the cutoff is the same', async () => {
  const readings = []
  for (const wallOffset of [0, 5 * 60_000, -5 * 60_000, 24 * 3_600_000]) {
    const d = device({ wallOffset, deadlineIn: 30_000, roundTrip: 400 })
    d.clock.start()
    await d.answer()
    readings.push(d.clock.remaining())
    await d.advance(10_000)
    assert.ok(d.clock.remaining() <= d.serverRemaining(), `offset ${wallOffset}: still conservative after ten seconds`)
  }
  assert.equal(new Set(readings).size, 1, `every device reads the same time left: ${readings.join(',')}`)
})

test('regression F3: a page that mounts long after the server rendered it reads the server afresh; the old fixed allowance is gone', async () => {
  // The exam was rendered with 30 s left; the device only mounted the exam 40 s later (far beyond any fixed 15 s
  // allowance). The exchange reads the server now: time is up, and no tap can be accepted.
  const d = device({ deadlineIn: 30_000, roundTrip: 200 })
  await d.advance(40_000)
  d.clock.start()
  await d.answer()
  assert.ok(d.clock.remaining() <= 0, `the reading says the exam is over: ${d.clock.remaining()}`)
  // With 50 s of mounting delay and 60 s on the deadline there are about ten seconds, not sixty, and not 45.
  const e = device({ deadlineIn: 60_000, roundTrip: 200 })
  await e.advance(50_000)
  e.clock.start()
  await e.answer()
  assert.ok(e.clock.remaining() <= 10_000 && e.clock.remaining() > 9_000, `about ten seconds: ${e.clock.remaining()}`)
})

test('regression F3: a tap just after the real deadline is refused by the live reading, not the countdown', async () => {
  const d = device({ deadlineIn: 10_000, roundTrip: 250 })
  d.clock.start()
  await d.answer()
  await d.advance(9_000)
  assert.ok(d.clock.remaining() > 0 && d.clock.remaining() <= 1_000, 'a second left on the conservative reading')
  await d.advance(760)
  assert.ok(d.clock.remaining() <= 0, 'past the cutoff: the reading charged the round trip, the server may have 10 ms left')
  assert.ok(d.serverRemaining() <= 250 && d.serverRemaining() >= -10)
  await d.advance(300)
  assert.ok(d.serverRemaining() < 0 && d.clock.remaining() < 0, 'and after the real deadline, certainly refused')
})

test('a round trip too long to say anything useful is discarded and retried with backoff', async () => {
  const d = device({ roundTrip: EXAM_CLOCK.maxRoundTripMs + 1 })
  d.clock.start()
  await d.answer()
  assert.deepEqual([d.clock.state(), d.clock.remaining(), d.states], ['unsynced', null, ['unsynced']])
  assert.deepEqual(d.pendingTimers(), [syncRetryMs(1)], 'a retry is planned')
  d.server.roundTrip = 100
  await d.advance(syncRetryMs(1))
  assert.equal(d.inFlight(), 1)
  await d.answer()
  assert.equal(d.clock.state(), 'synced')
})

test('a failed exchange keeps answering disabled and retries with bounded backoff until one lands', async () => {
  const d = device({ roundTrip: 100 })
  d.server.fail = true
  d.clock.start()
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await d.answer()
    assert.deepEqual([d.clock.state(), d.clock.remaining()], ['unsynced', null], `attempt ${attempt}`)
    assert.deepEqual(d.pendingTimers(), [syncRetryMs(attempt)], `attempt ${attempt}: backoff`)
    await d.advance(syncRetryMs(attempt))
  }
  assert.ok(syncRetryMs(5) <= EXAM_CLOCK.retryMaxMs, 'the backoff is capped')
  d.server.fail = false
  await d.answer()
  assert.equal(d.clock.state(), 'synced')
  assert.equal(d.states.filter(state => state === 'synced').length, 1)
})

test('the device may have slept: the page coming back into view, or the clocks drifting apart, invalidates the reading until a fresh exchange lands', async () => {
  const d = device({ deadlineIn: 60_000, roundTrip: 100 })
  d.clock.start()
  await d.answer()
  assert.equal(d.clock.state(), 'synced')
  // Back into view: no tap is accepted until the server has been read again.
  d.clock.invalidate()
  assert.deepEqual([d.clock.state(), d.clock.remaining(), d.inFlight()], ['unsynced', null, 1])
  await d.answer()
  assert.equal(d.clock.state(), 'synced')
  // The wall clock jumps ahead of the monotonic one by more than the tolerance (the monotonic clock paused while
  // the device slept): the very next reading refuses and asks the server again.
  const slept = device({ deadlineIn: 60_000, roundTrip: 100 })
  slept.clock.start()
  await slept.answer()
  const before = slept.clock.remaining()
  // Simulate sleep: the server (and the wall clock) moved on while the monotonic clock stood still.
  slept.server.deadline -= 30_000
  const wallJump = EXAM_CLOCK.maxDriftMs + 1
  const original = slept.clock
  original['drift'] -= wallJump
  assert.equal(slept.clock.remaining(), null, 'the reading is refused at the moment of the tap')
  assert.deepEqual([slept.clock.state(), slept.inFlight()], ['unsynced', 1], 'and a fresh exchange is on its way')
  await slept.answer()
  assert.ok(slept.clock.remaining() < before - 29_000, 'the fresh reading has the thirty seconds the device slept taken off')
})

test('regression (review of 1620315, finding 3): a reply from an exchange started before an invalidation is discarded; answering stays disabled until the fresh exchange succeeds', async () => {
  // Variant A: the page came back into view while an exchange was in flight.
  const d = device({ deadlineIn: 60_000, roundTrip: 100 })
  d.clock.start()
  await d.advance(50)
  d.clock.invalidate()
  assert.equal(d.inFlight(), 1, 'no second request while one is in flight; the fresh one is queued')
  await d.answer()
  assert.deepEqual([d.clock.state(), d.clock.remaining(), d.inFlight()], ['unsynced', null, 1],
    'the stale reply published nothing: still unsynced, nothing to answer with, and the fresh exchange is on its way')
  assert.ok(!d.states.includes('synced'), `no synced state came from the stale reply: ${d.states}`)
  await d.advance(60)
  assert.deepEqual([d.clock.state(), d.clock.remaining()], ['unsynced', null], 'during the whole interval before the fresh reply')
  await d.answer()
  assert.deepEqual([d.clock.state(), d.states.filter(state => state === 'synced').length], ['synced', 1],
    'the exchange started after the invalidation is the one that enables answering')
  // Variant B: the device slept 30 s with the monotonic clock paused, so the pre-sleep round trip looks short and
  // its reading would overstate the time left by the whole sleep. The pre-sleep reply is discarded.
  const slept = device({ deadlineIn: 60_000, roundTrip: 100 })
  slept.clock.start()
  slept.server.deadline -= 30_000
  slept.clock.invalidate()
  await slept.answer()
  assert.deepEqual([slept.clock.state(), slept.clock.remaining()], ['unsynced', null], 'the pre-sleep reading is not trusted')
  await slept.answer()
  assert.ok(slept.clock.remaining() !== null && slept.clock.remaining() <= 30_000,
    `the fresh reading carries the sleep: ${slept.clock.remaining()} ms left, not 60 s`)
  // Several invalidations in a row: only an exchange from the latest generation counts.
  const twice = device({ deadlineIn: 60_000, roundTrip: 100 })
  twice.clock.start()
  twice.clock.invalidate(); twice.clock.invalidate()
  await twice.answer()
  assert.equal(twice.clock.state(), 'unsynced')
  await twice.answer()
  assert.equal(twice.clock.state(), 'synced')
  assert.equal(twice.inFlight(), 0, 'and nothing further is in flight')
})

test('an invalidation during an exchange in flight asks the server again once that exchange settles', async () => {
  const d = device({ roundTrip: 100 })
  d.clock.start()
  d.clock.invalidate()
  assert.equal(d.inFlight(), 1, 'no second request while one is in flight')
  await d.answer()
  assert.equal(d.inFlight(), 1, 'then the fresh one goes')
  assert.equal(d.clock.state(), 'unsynced', 'and the first reply, from before the invalidation, enabled nothing')
  await d.answer()
  assert.equal(d.clock.state(), 'synced')
  d.clock.stop()
  d.clock.invalidate()
  assert.equal(d.inFlight(), 0, 'nothing after stop')
})
