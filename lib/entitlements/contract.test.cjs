// lib/entitlements/contract.test.cjs — The client-boundary contract: strict commands, well-formed results only, and a
// summary that never carries a code, phone number or hint.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { entitlementCommandSchema, entitlementResultSchema, entitlementSummarySchema } = require('./contract.ts')

test('commands are strict: no phone, email, user id or extra field can reach the server', () => {
  assert.equal(entitlementCommandSchema.safeParse({ action: 'activate-discovery-pass' }).success, true)
  for (const command of [
    { action: 'activate-discovery-pass', phone: '08031234567' },
    { action: 'activate-discovery-pass', email: 'someone@example.test' },
    { action: 'send-trial-code', phone: '08031234567' },
    { action: 'verify-trial-code', challengeId: '11111111-1111-4111-8111-111111111111', code: '123456' },
    { action: 'claim-early-access' },
    { action: 'grant-access' },
  ]) assert.equal(entitlementCommandSchema.safeParse(command).success, false, JSON.stringify(command))
})

test('the client accepts only well-formed results', () => {
  assert.equal(entitlementResultSchema.safeParse({ status: 'pass-activated', endsAt: '2026-10-29T09:00:00.000Z' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'already-claimed', retentionMonths: 24 }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'already-claimed' }).success, false, 'the retention is always stated')
  assert.equal(entitlementResultSchema.safeParse({ status: 'rate-limited' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'pass-activated' }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'granted-everything' }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'code-sent', challengeId: 'x', phoneHint: '567',
    expiresAt: 'a', resendAt: 'b' }).success, false, 'the retired phone-code results are not accepted')
  assert.equal(entitlementResultSchema.safeParse({ status: 'phone-already-used' }).success, false)
})

test('the summary drops the compatibility otp key and never exposes a code or phone hint', () => {
  const wire = { now: '2026-10-30T12:00:00.000+00:00', planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null,
    trial_hours: 72, trial_days: 3, expiry_notice_hours: 12, tier: 'free', access: null,
    trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null },
    discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
    early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null } }
  for (const otp of [null, undefined, { challenge_id: '11111111-1111-4111-8111-111111111111', phone_hint: '567' }]) {
    const parsed = entitlementSummarySchema.parse(otp === undefined ? wire : { ...wire, otp })
    assert.equal('otp' in parsed, false)
    assert.doesNotMatch(JSON.stringify(parsed), /567|challenge/)
  }
})
