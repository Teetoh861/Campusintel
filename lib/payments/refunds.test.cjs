// lib/payments/refunds.test.cjs — The refund identity: keyed hashes of the canonical email, so tags, Gmail dots and
// googlemail never make a second person for the one-standard-refund rule.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { orphanOrderIdentity, refundIdentityHashes } = require('./refunds.ts')

const ENV = { ENTITLEMENT_CLAIM_HASH_KEYS: `2:${'b'.repeat(40)},1:${'a'.repeat(40)}` }

test('aliases of one address give the same identity under every key; another address does not', () => {
  const base = refundIdentityHashes('ada.obi@gmail.com', ENV)
  assert.equal(base.length, 2)
  for (const alias of ['AdaObi@gmail.com', ' ada.o.bi+refund@googlemail.com ', 'adaobi+x@GMAIL.COM']) {
    assert.deepEqual(refundIdentityHashes(alias, ENV), base, alias)
  }
  assert.deepEqual(refundIdentityHashes('ada+shop@example.test', ENV), refundIdentityHashes('ada@example.test', ENV))
  assert.notDeepEqual(refundIdentityHashes('a.da@example.test', ENV), refundIdentityHashes('ada@example.test', ENV),
    'dots matter outside Gmail')
  assert.notDeepEqual(refundIdentityHashes('bola@gmail.com', ENV), base)
  assert.equal(refundIdentityHashes('ada@gmail.com', {}), null, 'no keys, no identity')
})

test('a deleted account\'s order is its own identity, matching nothing else', () => {
  const one = orphanOrderIdentity('9e4a1d85-6f70-4182-9d9e-0f1a2b3c4d5e')
  assert.equal(one.length, 1)
  assert.match(one[0], /^[0-9a-f]{64}$/)
  assert.notDeepEqual(orphanOrderIdentity('9e4a1d85-6f70-4182-9d9e-0f1a2b3c4d5f'), one)
})
