// lib/entitlements/service.test.cjs — Trial code orchestration: fail-closed configuration, the Early Access overlap, what the
// database and SMS provider may see, and how every database answer reaches the student.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { executeEntitlementCommand } = require('./service.ts')
const { codeHash, phoneHash } = require('./otp-crypto.ts')

const KEY = 'k'.repeat(48)
const CHALLENGE = '11111111-1111-4111-8111-111111111111'
const USER = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-10-26T09:00:00.000Z')
const READY = { state: 'ready', user_id: USER, expires_at: '2026-10-26T09:10:00.000Z', resend_at: '2026-10-26T09:01:00.000Z' }

function harness(overrides = {}) {
  const calls = { prepare: [], record: [], verify: [], sent: [], problems: [] }
  const answers = { prepare: READY, verify: { state: 'activated', ends_at: '2026-11-02T09:00:00.000Z' },
    delivery: 'sent', recordThrows: false, ...overrides.answers }
  const env = {
    phoneKey: KEY,
    sms: { status: 'enabled', provider: { id: 'fake', async send(to, body) {
      calls.sent.push({ to, body })
      if (answers.delivery instanceof Error) throw answers.delivery
      return answers.delivery
    } } },
    newChallengeId: () => CHALLENGE,
    newCode: () => '042917',
    now: () => NOW,
    async prepare(...args) { calls.prepare.push(args); return answers.prepare },
    async recordDelivery(...args) { calls.record.push(args); if (answers.recordThrows) throw new Error('down') },
    async verify(...args) { calls.verify.push(args); return answers.verify },
    reportProblem(problem) { calls.problems.push(problem) },
    ...overrides.env,
  }
  return { env, calls, run: command => executeEntitlementCommand(env, command) }
}

const send = phone => ({ action: 'send-trial-code', phone })
const verify = code => ({ action: 'verify-trial-code', challengeId: CHALLENGE, code })

test('trial activation fails closed without the hash key or an enabled SMS provider, before any database work', async () => {
  for (const env of [{ phoneKey: null }, { sms: { status: 'disabled', reason: 'not-configured' } },
    { sms: { status: 'disabled', reason: 'unsupported-provider' } }]) {
    const h = harness({ env })
    assert.deepEqual(await h.run(send('08031234567')), { status: 'unavailable' })
    assert.equal(h.calls.prepare.length + h.calls.sent.length, 0)
  }
  const noKey = harness({ env: { phoneKey: null } })
  assert.deepEqual(await noKey.run(verify('123456')), { status: 'unavailable' })
  assert.equal(noKey.calls.verify.length, 0)
})

test('the database sees only keyed hashes and a three-digit hint; the SMS provider alone sees the number and code', async () => {
  const h = harness()
  const result = await h.run(send('+234 803 123 4567'))
  assert.deepEqual(result, { status: 'code-sent', challengeId: CHALLENGE, phoneHint: '567',
    expiresAt: READY.expires_at, resendAt: READY.resend_at })
  const [args] = h.calls.prepare
  assert.deepEqual(args, [CHALLENGE, phoneHash(KEY, '+2348031234567'), '567', codeHash(KEY, CHALLENGE, '042917')])
  assert.doesNotMatch(JSON.stringify(args), /042917|8031234567/)
  assert.deepEqual(h.calls.sent.map(message => message.to), ['+2348031234567'])
  assert.match(h.calls.sent[0].body, /042917/)
  assert.match(h.calls.sent[0].body, /10 minutes/)
  assert.deepEqual(h.calls.record, [[USER, CHALLENGE, 'sent']])
})

test('every accepted spelling of one number produces the same uniqueness hash', async () => {
  const hashes = new Set()
  for (const spelling of ['08031234567', '+2348031234567', '2348031234567', '0803 123 4567', '(0803)-123-4567',
    '+234 (0) 803 123 4567', '8031234567']) {
    const h = harness()
    await h.run(send(spelling))
    hashes.add(h.calls.prepare[0][1])
  }
  assert.equal(hashes.size, 1)
})

test('invalid numbers are refused before the database or provider is touched', async () => {
  for (const phone of ['12345', '+15551234567', '08001234567', '0803123456', '080312345678', 'phone', '0803-123-456a']) {
    const h = harness()
    assert.deepEqual(await h.run(send(phone)), { status: 'invalid-phone' }, phone)
    assert.equal(h.calls.prepare.length, 0)
  }
})

test('a phone already used, a cooldown, rate limits and capacity are reported without sending anything', async () => {
  const cases = [
    [{ state: 'phone-already-used' }, { status: 'phone-already-used' }],
    [{ state: 'already-activated' }, { status: 'already-activated' }],
    [{ state: 'capacity' }, { status: 'capacity' }],
    [{ state: 'signed-out' }, { status: 'signed-out' }],
    [{ state: 'cooldown', retry_at: READY.resend_at }, { status: 'cooldown', retryAt: READY.resend_at }],
    [{ state: 'rate-limited', retry_at: READY.expires_at }, { status: 'rate-limited', retryAt: READY.expires_at }],
    [null, { status: 'unavailable' }],
  ]
  for (const [prepare, expected] of cases) {
    const h = harness({ answers: { prepare } })
    assert.deepEqual(await h.run(send('08031234567')), expected)
    assert.equal(h.calls.sent.length, 0)
    assert.equal(h.calls.record.length, 0)
  }
})

test('a provider rejection is recorded as a failed delivery and offers an immediate resend', async () => {
  const h = harness({ answers: { delivery: 'failed' } })
  const result = await h.run(send('08031234567'))
  assert.deepEqual(result, { status: 'delivery-failed', challengeId: CHALLENGE, phoneHint: '567',
    resendAt: new Date(NOW).toISOString() })
  assert.deepEqual(h.calls.record, [[USER, CHALLENGE, 'failed']])
  assert.deepEqual(h.calls.problems, ['sms-failed'])
})

test('a provider error is treated as possibly delivered, and a failed record never loses the sent code', async () => {
  const thrown = harness({ answers: { delivery: new Error('socket hang up') } })
  assert.equal((await thrown.run(send('08031234567'))).status, 'code-sent')
  assert.deepEqual(thrown.calls.record, [[USER, CHALLENGE, 'unknown']])
  assert.deepEqual(thrown.calls.problems, ['sms-error'])
  const unrecorded = harness({ answers: { recordThrows: true } })
  assert.equal((await unrecorded.run(send('08031234567'))).status, 'code-sent')
  assert.deepEqual(unrecorded.calls.problems, ['record-failed'])
})

test('verification sends the challenge-bound hash and maps every database answer', async () => {
  const cases = [
    [{ state: 'activated', ends_at: '2026-11-02T09:00:00.000Z' }, { status: 'trial-activated', endsAt: '2026-11-02T09:00:00.000Z' }],
    [{ state: 'incorrect', attempts_left: 3 }, { status: 'incorrect', attemptsLeft: 3 }],
    [{ state: 'already-used' }, { status: 'already-used' }],
    [{ state: 'superseded' }, { status: 'superseded' }],
    [{ state: 'too-many-attempts' }, { status: 'too-many-attempts' }],
    [{ state: 'expired' }, { status: 'expired' }],
    // An unknown or foreign challenge reads like an expired one and says nothing about its owner.
    [{ state: 'invalid' }, { status: 'expired' }],
    [{ state: 'phone-already-used' }, { status: 'phone-already-used' }],
    [{ state: 'already-activated' }, { status: 'already-activated' }],
    [{ state: 'signed-out' }, { status: 'signed-out' }],
    [null, { status: 'unavailable' }],
  ]
  for (const [answer, expected] of cases) {
    const h = harness({ answers: { verify: answer } })
    assert.deepEqual(await h.run(verify('042917')), expected)
    assert.deepEqual(h.calls.verify, [[CHALLENGE, codeHash(KEY, CHALLENGE, '042917')]])
  }
})

test('a code hash is bound to its challenge and the key; it never verifies another challenge', () => {
  const other = '33333333-3333-4333-8333-333333333333'
  assert.notEqual(codeHash(KEY, CHALLENGE, '042917'), codeHash(KEY, other, '042917'))
  assert.notEqual(codeHash(KEY, CHALLENGE, '042917'), codeHash('x'.repeat(48), CHALLENGE, '042917'))
  assert.match(codeHash(KEY, CHALLENGE, '042917'), /^[0-9a-f]{64}$/)
  assert.notEqual(phoneHash(KEY, '+2348031234567'), phoneHash('x'.repeat(48), '+2348031234567'))
})

test('active Early Access refuses both preparation and verification, before any SMS or code check', async () => {
  const until = '2026-11-25T09:00:00.000Z'
  const prepare = harness({ answers: { prepare: { state: 'early-access-active', available_from: until } } })
  assert.deepEqual(await prepare.run(send('08031234567')), { status: 'early-access-active', availableFrom: until })
  assert.equal(prepare.calls.sent.length + prepare.calls.record.length, 0, 'no SMS is spent')
  const verifyRefused = harness({ answers: { verify: { state: 'early-access-active', available_from: until } } })
  assert.deepEqual(await verifyRefused.run(verify('042917')), { status: 'early-access-active', availableFrom: until })
  const notOffered = harness({ answers: { prepare: { state: 'trial-not-offered' } } })
  assert.deepEqual(await notOffered.run(send('08031234567')), { status: 'trial-not-offered' })
})

test('there is no student command for Early Access: it is granted by the database', async () => {
  const { entitlementCommandSchema } = require('./contract.ts')
  assert.equal(entitlementCommandSchema.safeParse({ action: 'claim-early-access' }).success, false)
})
