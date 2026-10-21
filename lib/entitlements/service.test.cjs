// lib/entitlements/service.test.cjs — Activation orchestration: the request limit comes first, nothing but the verified
// session reaches the database, and every database answer maps to one student-facing result.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeEntitlementCommand } = require('./service.ts')
const { entitlementCommandSchema } = require('./contract.ts')

const ENDS = '2026-10-29T09:00:00.000Z'
const ACTIVATE = { action: 'activate-discovery-pass' }

function harness(overrides = {}) {
  const calls = { limit: 0, activate: 0 }
  const answers = { limit: 'allowed', activate: { state: 'activated', ends_at: ENDS }, ...overrides }
  const env = {
    async limit() { calls.limit += 1; return answers.limit },
    async activate() { calls.activate += 1; return answers.activate },
  }
  return { calls, run: command => executeEntitlementCommand(env, command) }
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
  for (const answer of [{ state: 'activated' }, { state: 'granted-everything' }, { state: 'already-claimed', extra: 1 }, 'activated']) {
    const parsed = activationRow.safeParse(answer)
    assert.equal(parsed.success, answer !== 'activated' && typeof answer === 'object' && answer.state === 'already-claimed',
      JSON.stringify(answer))
  }
})

test('a limiter outage fails closed instead of skipping the limit', async () => {
  const calls = { activate: 0 }
  const env = { async limit() { throw new Error('Auth rate limit unavailable') }, async activate() { calls.activate += 1 } }
  await assert.rejects(executeEntitlementCommand(env, ACTIVATE), /unavailable/)
  assert.equal(calls.activate, 0)
})

test('there is no student command for Early Access: it is granted by the database', () => {
  assert.equal(entitlementCommandSchema.safeParse({ action: 'claim-early-access' }).success, false)
})
