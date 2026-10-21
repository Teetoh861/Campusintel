// lib/entitlements/claim-hash.test.cjs — Keyed claim hashes: fail-closed configuration, versioned rotation, purpose
// separation, and one hash per address however it is spelled.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHmac } = require('node:crypto')
const { claimHashes, normalizeClaimEmail, readClaimHashKeys } = require('./claim-hash.ts')

const K1 = 'one-'.repeat(10)
const K2 = 'two-'.repeat(10)

test('configuration fails closed unless every key is versioned, long and distinct', () => {
  assert.equal(readClaimHashKeys({}), null)
  assert.equal(readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: ' ' }), null)
  for (const raw of [K1, `0:${K1}`, `1:short`, `1:${K1},1:${K2}`, `1001:${K1}`, `a:${K1}`, `1:${K1},`,
    Array.from({ length: 9 }, (_, i) => `${i + 1}:${K1}`).join(',')]) {
    assert.equal(readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: raw }), null, raw)
  }
  const keys = readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: `2:${K2}, 1:${K1}` })
  assert.deepEqual(keys, { current: { version: 2, key: K2 }, all: [{ version: 2, key: K2 }, { version: 1, key: K1 }] })
})

test('every spelling of one address hashes identically, and the hash is bound to the key and the purpose', () => {
  const keys = readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: `1:${K1}` })
  const hashes = new Set(['ada@example.test', ' Ada@Example.TEST ', 'ADA@EXAMPLE.TEST'].map(email =>
    claimHashes(keys, email)[0].hash))
  assert.equal(hashes.size, 1)
  assert.equal(normalizeClaimEmail(' Ada@Example.TEST '), 'ada@example.test')
  const [hash] = claimHashes(keys, 'ada@example.test')
  assert.match(hash.hash, /^[0-9a-f]{64}$/)
  assert.equal(hash.version, 1)
  assert.notEqual(hash.hash, claimHashes(readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: `1:${K2}` }), 'ada@example.test')[0].hash,
    'another key, another hash')
  assert.notEqual(hash.hash, createHmac('sha256', K1).update('ada@example.test').digest('hex'),
    'a plain HMAC of the address is not a claim hash: the purpose string separates it')
  assert.notEqual(hash.hash, claimHashes(keys, 'ada@example.org')[0].hash)
})

test('after a rotation new claims use the current key while old claims stay matchable', () => {
  const before = readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: `1:${K1}` })
  const after = readClaimHashKeys({ ENTITLEMENT_CLAIM_HASH_KEYS: `2:${K2},1:${K1}` })
  const old = claimHashes(before, 'ada@example.test')
  const rotated = claimHashes(after, 'ada@example.test')
  assert.deepEqual(rotated.map(h => h.version), [2, 1], 'current first, then the retained key')
  assert.deepEqual(rotated[1], old[0], 'the old claim is still found under its version')
  assert.notEqual(rotated[0].hash, old[0].hash)
})
