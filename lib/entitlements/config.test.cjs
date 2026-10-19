// lib/entitlements/config.test.cjs — Fail-closed SMS and key configuration, the request contract and the code generator.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { readSmsConfig, trialCodeMessage } = require('./sms.ts')
const { generateCode, readPhoneHashKey } = require('./otp-crypto.ts')
const { entitlementCommandSchema, entitlementResultSchema } = require('./contract.ts')

const LOCAL = { NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }

test('no provider, an unapproved provider or a production-like environment never enables sending', () => {
  assert.deepEqual(readSmsConfig({}), { status: 'disabled', reason: 'not-configured' })
  assert.deepEqual(readSmsConfig({ ENTITLEMENT_SMS_PROVIDER: ' ' }), { status: 'disabled', reason: 'not-configured' })
  // Termii is approved but needs its key, account base URL and sender ID (lib/entitlements/termii.test.cjs).
  assert.deepEqual(readSmsConfig({ ...LOCAL, ENTITLEMENT_SMS_PROVIDER: 'termii' }), { status: 'disabled', reason: 'missing-setting' })
  for (const provider of ['Termii', 'twilio', 'africastalking', 'console']) {
    assert.deepEqual(readSmsConfig({ ...LOCAL, ENTITLEMENT_SMS_PROVIDER: provider }),
      { status: 'disabled', reason: 'unsupported-provider' }, provider)
  }
  const outbox = { ENTITLEMENT_SMS_PROVIDER: 'local-outbox', ENTITLEMENT_SMS_LOCAL_OUTBOX: '/tmp/outbox.jsonl' }
  for (const env of [{ ...outbox }, { ...LOCAL, ...outbox, NODE_ENV: 'production' }, { ...LOCAL, ...outbox, VERCEL_ENV: 'preview' },
    { ...LOCAL, ...outbox, NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' }]) {
    assert.equal(readSmsConfig(env).status, 'disabled', JSON.stringify(env))
  }
  assert.deepEqual(readSmsConfig({ ...LOCAL, ENTITLEMENT_SMS_PROVIDER: 'local-outbox' }),
    { status: 'disabled', reason: 'missing-setting' })
  assert.deepEqual(readSmsConfig({ ...LOCAL, ...outbox, ENTITLEMENT_SMS_LOCAL_OUTBOX: 'relative.jsonl' }),
    { status: 'disabled', reason: 'missing-setting' })
})

test('the local outbox works only locally and writes a private file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'entitlement-outbox-'))
  const file = path.join(dir, 'outbox.jsonl')
  try {
    const config = readSmsConfig({ ...LOCAL, ENTITLEMENT_SMS_PROVIDER: 'local-outbox', ENTITLEMENT_SMS_LOCAL_OUTBOX: file })
    assert.equal(config.status, 'enabled')
    assert.equal(await config.provider.send('+2348031234567', trialCodeMessage('123456', 10), AbortSignal.timeout(1000)), 'sent')
    const [line] = fs.readFileSync(file, 'utf8').trim().split('\n').map(text => JSON.parse(text))
    assert.equal(line.to, '+2348031234567')
    assert.match(line.body, /123456/)
    assert.equal(fs.statSync(file).mode & 0o077, 0, 'the outbox is readable only by its owner')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('the hash key must be present and long; codes are six CSPRNG digits', () => {
  assert.equal(readPhoneHashKey({}), null)
  assert.equal(readPhoneHashKey({ ENTITLEMENT_PHONE_HASH_KEY: 'short' }), null)
  assert.equal(readPhoneHashKey({ ENTITLEMENT_PHONE_HASH_KEY: ' '.repeat(40) }), null)
  assert.equal(readPhoneHashKey({ ENTITLEMENT_PHONE_HASH_KEY: 'a'.repeat(32) }), 'a'.repeat(32))
  const codes = new Set(Array.from({ length: 200 }, generateCode))
  for (const code of codes) assert.match(code, /^\d{6}$/)
  assert.ok(codes.size > 190, 'codes do not repeat in practice')
})

test('commands are strict: no email, user id or extra field can reach the server', () => {
  assert.equal(entitlementCommandSchema.safeParse({ action: 'send-trial-code', phone: '08031234567' }).success, true)
  for (const command of [
    { action: 'claim-early-access' },
    { action: 'claim-early-access', email: 'someone@example.test' },
    { action: 'send-trial-code', phone: '08031234567', userId: 'x' },
    { action: 'verify-trial-code', challengeId: '11111111-1111-4111-8111-111111111111', code: '12345' },
    { action: 'verify-trial-code', challengeId: '11111111-1111-4111-8111-111111111111', code: '12345a' },
    { action: 'verify-trial-code', challengeId: 'not-a-uuid', code: '123456' },
    { action: 'send-trial-code', phone: '0'.repeat(25) },
    { action: 'grant-access' },
  ]) assert.equal(entitlementCommandSchema.safeParse(command).success, false, JSON.stringify(command))
})

test('the client accepts only well-formed results', () => {
  assert.equal(entitlementResultSchema.safeParse({ status: 'incorrect', attemptsLeft: 2 }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'phone-already-used' }).success, true)
  assert.equal(entitlementResultSchema.safeParse({ status: 'incorrect' }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'granted-everything' }).success, false)
  assert.equal(entitlementResultSchema.safeParse({ status: 'code-sent', challengeId: 'x', phoneHint: '567',
    expiresAt: 'a', resendAt: 'b' }).success, false)
})
