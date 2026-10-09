// lib/auth/email-initiation.test.cjs — Delivery failures stay neutral and diagnostics contain no recipient data.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { initiateAuthEmail } = require('./email-initiation.ts')
const { checkSignupAcknowledgment, checkResendAcknowledgment, checkRecoveryAcknowledgment } = require('./signup-result.ts')

async function capture(run) {
  const original = console.error, diagnostics = []
  console.error = (...args) => diagnostics.push(args)
  try { return { result: await run(), diagnostics } } finally { console.error = original }
}

test('returned delivery and account-state errors stay neutral for every email initiation', async () => {
  for (const action of ['register', 'resend', 'recovery']) {
    for (const code of ['unexpected_failure', 'email_provider_disabled', 'user_not_found', 'email_exists', 'unknown']) {
      const r = await capture(() => initiateAuthEmail(action, async () => ({ data: null,
        error: { code, status: 500, message: 'private-recipient@example.test fixture-password fixture-token', recipient: 'private-recipient@example.test' },
      }), () => assert.fail('an error cannot validate an acknowledgment')))
      assert.equal(r.result, null)
      assert.deepEqual(r.diagnostics, [['CampusIntell auth email initiation', { action, outcome: 'failed' }]])
      assert.doesNotMatch(JSON.stringify(r.diagnostics), /@|password|token|status|message|recipient|unexpected_failure/)
    }
  }
})

test('transport exceptions stay neutral with a distinct safe server diagnostic', async () => {
  const r = await capture(() => initiateAuthEmail('recovery', async () => {
    throw new Error('private-recipient@example.test fixture-token SMTP password')
  }, () => assert.fail('no provider acknowledgment')))
  assert.equal(r.result, null)
  assert.deepEqual(r.diagnostics, [['CampusIntell auth email initiation', { action: 'recovery', outcome: 'exception' }]])
})

test('accepted no-op and recipient cooldown authorize the same neutral response without claiming delivery', async () => {
  const accepted = await capture(() => initiateAuthEmail('recovery', async () => ({ data: {}, error: null }), checkRecoveryAcknowledgment))
  const cooldown = await capture(() => initiateAuthEmail('recovery', async () => ({ data: null,
    error: { code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 30 seconds.' },
  }), checkRecoveryAcknowledgment))
  assert.equal(accepted.result, null)
  assert.equal(cooldown.result, null)
  assert.deepEqual(accepted.diagnostics, [])
  assert.deepEqual(cooldown.diagnostics, [['CampusIntell auth email initiation', { action: 'recovery', outcome: 'cooldown' }]])
})

test('recipient-independent provider quotas and signup password policy still reject requests', async () => {
  for (const error of [
    { code: 'over_request_rate_limit' },
    { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' },
    { status: 429, code: 'unknown' },
  ]) {
    const r = await capture(() => initiateAuthEmail('recovery', async () => ({ data: null, error }), checkRecoveryAcknowledgment))
    assert.deepEqual(r.result, { status: 429, error: 'Too many attempts. Please try again later.' })
    assert.deepEqual(r.diagnostics, [['CampusIntell auth email initiation', { action: 'recovery', outcome: 'limited' }]])
  }
  const weak = await capture(() => initiateAuthEmail('register', async () => ({ data: null, error: { code: 'weak_password' } }), checkSignupAcknowledgment))
  assert.deepEqual(weak.result, { status: 400, error: 'Choose a stronger password and try again.' })
  assert.deepEqual(weak.diagnostics, [['CampusIntell auth email initiation', { action: 'register', outcome: 'policy' }]])
})

test('invalid success envelopes and unexpected signup sessions still fail closed', async () => {
  for (const [action, validate, data] of [
    ['register', checkSignupAcknowledgment, { user: { id: 'fixture-user' }, session: { access_token: 'fixture-token' } }],
    ['resend', checkResendAcknowledgment, {}],
    ['recovery', checkRecoveryAcknowledgment, { unexpected: 'private-recipient@example.test' }],
  ]) {
    const r = await capture(async () => {
      await assert.rejects(initiateAuthEmail(action, async () => ({ data, error: null }), validate), /Auth email acknowledgment invalid/)
    })
    assert.deepEqual(r.diagnostics, [['CampusIntell auth email initiation', { action, outcome: 'invalid-acknowledgment' }]])
  }
})
