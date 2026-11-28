// lib/payments/money.test.cjs — Exact kobo ↔ decimal-string conversion, with no floating point and no lenient parsing.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { decimalToKobo, koboToDecimal } = require('./money.ts')

test('kobo becomes the two-place decimal string Bachs expects', () => {
  assert.equal(koboToDecimal(400000), '4000.00')
  assert.equal(koboToDecimal(1100000), '11000.00')
  assert.equal(koboToDecimal(400050), '4000.50')
  assert.equal(koboToDecimal(5), '0.05')
  assert.equal(koboToDecimal(0), '0.00')
  for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => koboToDecimal(bad), RangeError)
})

test('decimal strings become exact kobo, and anything else is refused', () => {
  assert.equal(decimalToKobo('4000.00'), 400000)
  assert.equal(decimalToKobo('4000'), 400000)
  assert.equal(decimalToKobo('4000.5'), 400050)
  assert.equal(decimalToKobo('0.07'), 7)
  // The classic float trap: 0.1 + 0.2 style values stay exact.
  assert.equal(decimalToKobo('10999.99'), 1099999)
  for (const bad of ['4000.001', '-4000.00', '4,000.00', '4e3', ' 4000.00', '4000.00 ', '', '.50', '4000.', 'NaN', null,
    4000, undefined, '12345678901234.00']) {
    assert.equal(decimalToKobo(bad), null, String(bad))
  }
})

test('every kobo amount survives a round trip', () => {
  for (const kobo of [1, 99, 100, 101, 400000, 600000, 700000, 1100000, 123456789]) {
    assert.equal(decimalToKobo(koboToDecimal(kobo)), kobo)
  }
})
