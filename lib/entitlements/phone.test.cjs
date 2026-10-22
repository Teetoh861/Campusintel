// lib/entitlements/phone.test.cjs — The phone rules the Early Access list import still relies on: every accepted
// spelling of one Nigerian mobile number normalizes and hashes identically, and anything else is rejected. Nothing
// here is part of Discovery Pass activation, which collects no phone number.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeNigerianMobile, phoneHash } = require('./phone.cjs')

const KEY = 'k'.repeat(48)

test('every accepted spelling of one number normalizes to one form, one hint and one keyed hash', () => {
  const forms = new Set()
  const hashes = new Set()
  for (const spelling of ['08031234567', '+2348031234567', '2348031234567', '0803 123 4567', '(0803)-123-4567',
    '+234 (0) 803 123 4567', '8031234567', ' 0803.123.4567 ']) {
    const normalized = normalizeNigerianMobile(spelling)
    assert.deepEqual(normalized, { e164: '+2348031234567', hint: '567' }, spelling)
    forms.add(normalized.e164)
    hashes.add(phoneHash(KEY, normalized.e164))
  }
  assert.equal(forms.size, 1)
  assert.equal(hashes.size, 1)
  assert.match([...hashes][0], /^[0-9a-f]{64}$/)
  assert.notEqual(phoneHash(KEY, '+2348031234567'), phoneHash('x'.repeat(48), '+2348031234567'), 'the hash is keyed')
  assert.notEqual(phoneHash(KEY, '+2348031234567'), phoneHash(KEY, '+2348031234568'))
})

test('numbers that are not Nigerian mobiles are rejected before anything is hashed', () => {
  for (const phone of ['12345', '+15551234567', '08001234567', '07001234567', '09001234567', '0803123456', '080312345678',
    'phone', '0803-123-456a', '', '+234', '01234567890']) {
    assert.equal(normalizeNigerianMobile(phone), null, phone)
  }
})
