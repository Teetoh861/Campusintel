// lib/entitlements/service.test.cjs — The two student commands (start a free pass, claim a free month): the request
// limit comes first, nothing but the verified session and the revision on the page reaches the database, and every
// database answer maps to one student-facing result.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeEntitlementCommand } = require('./service.ts')
const { entitlementCommandSchema } = require('./contract.ts')

const ENDS = '2026-10-29T09:00:00.000Z'
const STARTS = '2026-11-22T13:00:00.000Z'
const MONTH_ENDS = '2026-12-22T13:00:00.000Z'
const ACTIVATE = { action: 'activate-discovery-pass' }

const CLAIM = { action: 'claim-free-month', profileRevision: 7 }

function harness(overrides = {}) {
  const calls = { limit: 0, activate: 0 }
  // The revision each activation was bound to, kept apart from the call counts the other tests compare exactly.
  const revisions = []
  // Every argument each claim was called with: the revision, and nothing else.
  const claims = []
  const answers = { limit: 'allowed', activate: { state: 'activated', ends_at: ENDS },
    claim: { state: 'claimed', starts_at: STARTS, ends_at: MONTH_ENDS }, ...overrides }
  const env = {
    async limit() { calls.limit += 1; return answers.limit },
    async activate(profileRevision) { calls.activate += 1; revisions.push(profileRevision); return answers.activate },
    async claimFreeMonth(...args) { claims.push(args); return answers.claim },
  }
  return { calls, revisions, claims, run: command => executeEntitlementCommand(env, command) }
}

test('activation takes no input from the student: the command is the action alone', () => {
  assert.equal(entitlementCommandSchema.safeParse(ACTIVATE).success, true)
  for (const command of [
    { action: 'activate-discovery-pass', phone: '08031234567' },
    { action: 'activate-discovery-pass', userId: '22222222-2222-4222-8222-222222222222' },
    { action: 'activate-discovery-pass', hours: 720 },
    { action: 'send-trial-code', phone: '08031234567' },
    { action: 'verify-trial-code', challengeId: '11111111-1111-4111-8111-111111111111', code: '123456' },
    { action: 'claim-early-access' },
    { action: 'grant-access' },
    {},
  ]) assert.equal(entitlementCommandSchema.safeParse(command).success, false, JSON.stringify(command))
})

test('a limited request never reaches the database', async () => {
  const h = harness({ limit: 'limited' })
  assert.deepEqual(await h.run(ACTIVATE), { status: 'rate-limited' })
  assert.deepEqual(h.calls, { limit: 1, activate: 0 })
})

test('every database answer maps to one result, and the limit is charged exactly once per request', async () => {
  const cases = [
    [{ state: 'activated', ends_at: ENDS }, { status: 'pass-activated', endsAt: ENDS }],
    [{ state: 'already-activated', ends_at: ENDS }, { status: 'already-activated', endsAt: ENDS }],
    [{ state: 'early-access-active', available_from: ENDS }, { status: 'early-access-active', availableFrom: ENDS }],
    // The retention a database still reports is never passed on: the student is told no period.
    [{ state: 'already-claimed', retention_months: 60 }, { status: 'already-claimed' }],
    [{ state: 'already-claimed' }, { status: 'already-claimed' }],
    [{ state: 'trial-not-offered' }, { status: 'trial-not-offered' }],
    [{ state: 'capacity' }, { status: 'capacity' }],
    [{ state: 'signed-out' }, { status: 'signed-out' }],
    // A missing answer fails closed: no pass is reported that the database did not confirm.
    [null, { status: 'unavailable' }],
  ]
  for (const [answer, expected] of cases) {
    const h = harness({ activate: answer })
    assert.deepEqual(await h.run(ACTIVATE), expected, JSON.stringify(answer))
    assert.deepEqual(h.calls, { limit: 1, activate: 1 })
  }
})

test('a malformed database answer is rejected before it can be mapped', () => {
  const { activationRow } = require('./service.ts')
  for (const [answer, valid] of [[{ state: 'activated' }, false], [{ state: 'granted-everything' }, false],
    [{ state: 'already-claimed' }, true], [{ state: 'already-claimed', retention_months: 60, extra: 1 }, true],
    [{ state: 'already-claimed', retention_months: 0 }, false], ['activated', false]]) {
    assert.equal(activationRow.safeParse(answer).success, valid, JSON.stringify(answer))
  }
})

test('the eligibility answer is a boolean and nothing else counts as eligible', () => {
  const { eligibilityRow } = require('./service.ts')
  assert.deepEqual(eligibilityRow.parse({ eligible: true }), { eligible: true })
  assert.deepEqual(eligibilityRow.parse({ eligible: false, reason: 'claimed' }), { eligible: false }, 'no reason is kept')
  for (const answer of [{}, { eligible: 'true' }, { eligible: 1 }, null, true]) {
    assert.equal(eligibilityRow.safeParse(answer).success, false, JSON.stringify(answer))
  }
})

test('a limiter outage fails closed instead of skipping the limit', async () => {
  const calls = { activate: 0 }
  const env = { async limit() { throw new Error('Auth rate limit unavailable') }, async activate() { calls.activate += 1 } }
  await assert.rejects(executeEntitlementCommand(env, ACTIVATE), /unavailable/)
  assert.equal(calls.activate, 0)
})

test('the free month is its own command: the retired names are refused, and it never starts a pass', async () => {
  assert.equal(entitlementCommandSchema.safeParse({ action: 'claim-early-access' }).success, false)
  const h = harness()
  assert.deepEqual(await h.run(CLAIM), { status: 'month-started', endsAt: MONTH_ENDS })
  assert.deepEqual(h.calls, { limit: 1, activate: 0 }, 'the limit is charged once and no pass is touched')
  assert.deepEqual(h.claims, [[7]], 'the database is given the revision the page showed and nothing else')
})

test('a limited claim never reaches the database', async () => {
  const h = harness({ limit: 'limited' })
  assert.deepEqual(await h.run(CLAIM), { status: 'rate-limited' })
  assert.deepEqual(h.claims, [])
})

test('every answer to a claim maps to one result, and never carries a reason', async () => {
  const cases = [
    [{ state: 'claimed', starts_at: STARTS, ends_at: MONTH_ENDS }, { status: 'month-started', endsAt: MONTH_ENDS }],
    // A double tap, a second tab, a lost response: the month the account already has, with the database's own end.
    [{ state: 'already-claimed', ends_at: MONTH_ENDS, active: true }, { status: 'month-started', endsAt: MONTH_ENDS }],
    // A month that has ended or been withdrawn is not available again.
    [{ state: 'already-claimed', ends_at: MONTH_ENDS, active: false }, { status: 'offer-unavailable' }],
    [{ state: 'closed' }, { status: 'offer-ended' }],
    [{ state: 'not-available' }, { status: 'offer-unavailable' }],
    [{ state: 'needs-selection' }, { status: 'selection-changed' }],
    [{ state: 'selection-changed' }, { status: 'selection-changed' }],
    [{ state: 'signed-out' }, { status: 'signed-out' }],
    // A key fault is an operations matter: the student is told it could not be started, and can try again.
    [{ state: 'claim-key-missing' }, { status: 'unavailable' }],
    [{ state: 'claim-key-replaced' }, { status: 'unavailable' }],
    // A missing answer fails closed: no month is reported that the database did not confirm.
    [null, { status: 'unavailable' }],
  ]
  const error = console.error
  console.error = () => {}
  try {
    for (const [answer, expected] of cases) {
      assert.deepEqual(await harness({ claim: answer }).run(CLAIM), expected, JSON.stringify(answer))
    }
  } finally { console.error = error }
})

test('a malformed claim answer is rejected before it can be mapped', () => {
  const { claimRow, freeMonthEligibilityRow } = require('./service.ts')
  for (const [answer, valid] of [[{ state: 'claimed', starts_at: STARTS, ends_at: MONTH_ENDS }, true],
    [{ state: 'claimed' }, false], [{ state: 'already-claimed', ends_at: MONTH_ENDS }, false],
    [{ state: 'already-claimed', ends_at: MONTH_ENDS, active: 'yes' }, false], [{ state: 'closed', reason: 'late' }, true],
    [{ state: 'granted-everything' }, false], ['claimed', false]]) {
    assert.equal(claimRow.safeParse(answer).success, valid, JSON.stringify(answer))
  }
  assert.deepEqual(freeMonthEligibilityRow.parse({ eligible: true, ends_at: MONTH_ENDS }), { eligible: true, ends_at: MONTH_ENDS })
  assert.deepEqual(freeMonthEligibilityRow.parse({ eligible: false, reason: 'paid' }), { eligible: false }, 'no reason is kept')
  for (const answer of [{}, { eligible: 'true' }, { eligible: true, ends_at: 16 }, null]) {
    assert.equal(freeMonthEligibilityRow.safeParse(answer).success, false, JSON.stringify(answer))
  }
})

test('D7: the revision the page showed reaches the database, and a changed selection starts nothing', async () => {
  assert.equal(entitlementCommandSchema.safeParse({ ...ACTIVATE, profileRevision: 3 }).success, true)
  for (const profileRevision of [-1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(entitlementCommandSchema.safeParse({ ...ACTIVATE, profileRevision }).success, false, String(profileRevision))
  }
  const bound = harness()
  await bound.run({ ...ACTIVATE, profileRevision: 3 })
  assert.deepEqual(bound.revisions, [3])
  const unbound = harness()
  await unbound.run(ACTIVATE)
  assert.deepEqual(unbound.revisions, [undefined], 'a tab from before the change activates unbound')
  assert.deepEqual(await harness({ activate: { state: 'selection-changed' } }).run({ ...ACTIVATE, profileRevision: 3 }),
    { status: 'selection-changed' })
})
