const { test } = require('node:test')
const assert = require('node:assert/strict')

test('page continuity tokens compare only with the server-derived account and hide its ID', () => {
  const previous = process.env.SUPABASE_SECRET_KEY
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_' + 'x'.repeat(48)
  try {
    const { issueAccountContinuityToken, matchesAccountContinuityToken } = require('./account-continuity.ts')
    const first = issueAccountContinuityToken('student-a', 'session-one')
    const second = issueAccountContinuityToken('student-a', 'session-one')
    assert.notEqual(first, second)
    assert.doesNotMatch(first, /student-a/)
    assert.doesNotMatch(first, /session-one/)
    assert.equal(matchesAccountContinuityToken(first, 'student-a', 'session-one'), true)
    assert.equal(matchesAccountContinuityToken(first, 'student-a', 'session-two'), false)
    assert.equal(matchesAccountContinuityToken(first, 'student-b', 'session-one'), false)
    assert.equal(matchesAccountContinuityToken(first + 'tampered', 'student-a', 'session-one'), false)
    assert.equal(matchesAccountContinuityToken('malformed', 'student-a', 'session-one'), false)
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const [nonce, digest] = first.split('.')
    const alteredDigest = digest.slice(0, -1) + alphabet[alphabet.indexOf(digest.at(-1)) ^ 1]
    assert.notEqual(alteredDigest, digest)
    assert.deepEqual(Buffer.from(alteredDigest, 'base64url'), Buffer.from(digest, 'base64url'))
    assert.equal(matchesAccountContinuityToken(`${nonce}.${alteredDigest}`, 'student-a', 'session-one'), false)
  } finally {
    if (previous === undefined) delete process.env.SUPABASE_SECRET_KEY
    else process.env.SUPABASE_SECRET_KEY = previous
  }
})
