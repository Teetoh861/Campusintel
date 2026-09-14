// lib/auth/secret-key.test.ts — Legacy privileged keys require a configured loopback Supabase URL.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getAuthSecretKey } from './config'

// Synthetic JWT-shaped fixture, not a real credential or valid signature.
const LOCAL_JWT = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ role: 'service_role', iss: 'test-fixture' })).toString('base64url'),
  Buffer.alloc(32).toString('base64url'),
].join('.')

test('production secret-key validation uses only the configured Supabase URL', () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY }
  try {
    Object.assign(process.env, { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_test_fixture' })
    assert.equal(getAuthSecretKey(), 'sb_secret_test_fixture')
    process.env.SUPABASE_SECRET_KEY = LOCAL_JWT
    assert.throws(() => getAuthSecretKey(), /Auth configuration unavailable/)
    const spoofed = new Request('http://localhost', { headers: { host: 'localhost', 'x-forwarded-host': '127.0.0.1' } })
    assert.equal(spoofed.headers.get('host'), 'localhost')
    assert.throws(() => getAuthSecretKey(), /Auth configuration unavailable/)
    for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url
      process.env.SUPABASE_SECRET_KEY = LOCAL_JWT
      assert.equal(getAuthSecretKey(), LOCAL_JWT)
      for (const key of ['', ' ', 'arbitrary-string', 'a.b.c', 'a'.repeat(80), 'sb_secret_', LOCAL_JWT + ' ']) {
        process.env.SUPABASE_SECRET_KEY = key
        assert.throws(() => getAuthSecretKey(), /Auth configuration unavailable/)
      }
    }
    process.env.SUPABASE_SECRET_KEY = LOCAL_JWT
    for (const url of ['https://localhost.attacker.test', 'http://localhost@attacker.test', 'ftp://localhost', 'invalid', '']) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = url
      assert.throws(() => getAuthSecretKey(), /Auth configuration unavailable/)
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
