// lib/auth/requester-address.test.ts — Trusted Vercel IPs and explicit loopback production testing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRequesterAddress } from './request'

test('requester address preserves deployed boundaries and allows configured loopback production', () => {
  const previous = { NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL }
  const request = (headers: Record<string, string> = {}) => new Request('http://localhost/api/auth/register', { headers })
  try {
    Object.assign(process.env, { NODE_ENV: 'production', VERCEL: '1', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })
    assert.equal(getRequesterAddress(request({ 'x-vercel-forwarded-for': '203.0.113.10' })), '203.0.113.10')
    assert.equal(getRequesterAddress(request({ 'x-vercel-forwarded-for': '2001:db8::1' })), '2001:db8::1')
    assert.throws(() => getRequesterAddress(request()), { status: 503 })
    for (const ip of ['invalid', '203.0.113.10, 203.0.113.11']) {
      assert.throws(() => getRequesterAddress(request({ 'x-vercel-forwarded-for': ip })), { status: 503 })
    }

    delete process.env.VERCEL
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000', 'https://localhost']) {
      process.env.NEXT_PUBLIC_SITE_URL = origin
      assert.equal(getRequesterAddress(request({ 'x-forwarded-for': '203.0.113.99' })), 'local')
    }
    for (const origin of ['https://campusintell.com', 'https://localhost.attacker.test', 'http://localhost:3000/not-an-origin', 'invalid', '']) {
      process.env.NEXT_PUBLIC_SITE_URL = origin
      assert.throws(() => getRequesterAddress(request({ host: 'localhost:3000', 'x-forwarded-host': 'localhost', 'x-forwarded-for': '127.0.0.1' })), { status: 503 })
    }
    delete process.env.NEXT_PUBLIC_SITE_URL
    assert.throws(() => getRequesterAddress(request({ host: 'localhost' })), { status: 503 })
    for (const mode of ['development', 'test']) {
      Object.assign(process.env, { NODE_ENV: mode })
      assert.equal(getRequesterAddress(request()), 'local')
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
