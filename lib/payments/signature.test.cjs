// lib/payments/signature.test.cjs — X-Bachs-Signature-V2 verification: valid, invalid, stale, future, rotated, malformed.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { signatureHeader, signPayload, verifySignature } = require('./signature.ts')

const CURRENT = 'whsec_current_secret_for_tests_0001'
const PREVIOUS = 'whsec_previous_secret_for_tests_0002'
const NOW = 1_793_000_000
const BODY = '{"id":"evt_1","type":"collection.succeeded","data":{"reference":"x"}}'

test('the digest is HMAC-SHA256 of "{t}.{raw body}" as Bachs documents', () => {
  const expected = createHmac('sha256', CURRENT).update(`${NOW}.${BODY}`).digest('hex')
  assert.equal(signPayload(CURRENT, NOW, BODY), expected)
  assert.deepEqual(verifySignature(`t=${NOW},v1=${expected}`, BODY, [CURRENT], NOW), { ok: true })
})

test('a wrong secret, a changed body or a changed timestamp is refused as a bad signature', () => {
  const header = signatureHeader(['some_other_secret_value_000000'], NOW, BODY)
  assert.deepEqual(verifySignature(header, BODY, [CURRENT], NOW), { ok: false, reason: 'signature' })
  const good = signatureHeader([CURRENT], NOW, BODY)
  assert.deepEqual(verifySignature(good, `${BODY} `, [CURRENT], NOW), { ok: false, reason: 'signature' })
  const moved = good.replace(`t=${NOW}`, `t=${NOW + 1}`)
  assert.deepEqual(verifySignature(moved, BODY, [CURRENT], NOW), { ok: false, reason: 'signature' })
})

test('a stale or future timestamp beyond 300 seconds is refused even with a valid digest', () => {
  for (const timestamp of [NOW - 301, NOW + 301]) {
    assert.deepEqual(verifySignature(signatureHeader([CURRENT], timestamp, BODY), BODY, [CURRENT], NOW),
      { ok: false, reason: 'timestamp' })
  }
  for (const timestamp of [NOW - 300, NOW + 300]) {
    assert.deepEqual(verifySignature(signatureHeader([CURRENT], timestamp, BODY), BODY, [CURRENT], NOW), { ok: true })
  }
})

test('rotation: any v1 under any configured secret is accepted', () => {
  // Bachs signs with both secrets during its 24-hour overlap; the old one is listed first here.
  const both = signatureHeader([PREVIOUS, CURRENT], NOW, BODY)
  assert.deepEqual(verifySignature(both, BODY, [CURRENT], NOW), { ok: true })
  // We still hold the previous secret while the new one is deployed.
  assert.deepEqual(verifySignature(signatureHeader([PREVIOUS], NOW, BODY), BODY, [CURRENT, PREVIOUS], NOW), { ok: true })
  assert.deepEqual(verifySignature(signatureHeader([PREVIOUS], NOW, BODY), BODY, [CURRENT], NOW),
    { ok: false, reason: 'signature' })
})

test('malformed headers are refused without comparing anything', () => {
  const digest = signPayload(CURRENT, NOW, BODY)
  for (const header of [null, '', `v1=${digest}`, `t=${NOW}`, `t=abc,v1=${digest}`, `t=${NOW},t=${NOW},v1=${digest}`,
    `t=${NOW},v1=XYZ`, `t=${NOW},v1=${digest.slice(0, 63)}`, `t=${NOW},${'x'.repeat(1100)}`]) {
    assert.deepEqual(verifySignature(header, BODY, [CURRENT], NOW), { ok: false, reason: 'malformed' }, String(header))
  }
  assert.deepEqual(verifySignature(`t=${NOW},v1=${digest}`, BODY, [], NOW), { ok: false, reason: 'malformed' })
  // Unknown schemes are ignored, not trusted: a v0 alongside a valid v1 still verifies on the v1.
  assert.deepEqual(verifySignature(`t=${NOW},v0=${'0'.repeat(64)},v1=${digest}`, BODY, [CURRENT], NOW), { ok: true })
})
