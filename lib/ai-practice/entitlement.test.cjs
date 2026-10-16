// lib/ai-practice/entitlement.test.cjs — Grant sources the server honours, and fail-closed defaults.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { NOT_ENTITLED, acceptedGrantSources, effectiveAllowance, isVerifiedLocalEnvironment } = require('./entitlement.ts')

const active = source => ({ state: 'active', source, total: 10, used: 1, endsAt: '2026-10-23T00:00:00.000Z' })
const PRODUCTION = ['trial', 'early_access']
const LOCAL = { NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  AI_PRACTICE_ACCEPT_TEST_GRANTS: 'true' }

test('production accepts only trial and Early Access grants', () => {
  assert.deepEqual(acceptedGrantSources({}), PRODUCTION)
  assert.deepEqual(acceptedGrantSources({ ...LOCAL, VERCEL_ENV: 'production' }), PRODUCTION,
    'a test-grant flag can never open Vercel production')
  assert.deepEqual(acceptedGrantSources({ ...LOCAL, AI_PRACTICE_ACCEPT_TEST_GRANTS: '1' }), PRODUCTION,
    'only the literal true opts in')
})

test('test grants are refused on every production build, on any host, with VERCEL_ENV absent', () => {
  // A non-Vercel host sets no VERCEL_ENV at all. The previous check read that absence as "not production".
  for (const env of [
    { AI_PRACTICE_ACCEPT_TEST_GRANTS: 'true' },
    { ...LOCAL, NODE_ENV: 'production' },
    { ...LOCAL, NODE_ENV: undefined },
    { ...LOCAL, NODE_ENV: 'staging' },
    { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'https://abcd.supabase.co' },
    { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: undefined },
    { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'not a url' },
    { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1.attacker.example:54321' },
    { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'http://user@127.0.0.1:54321' },
    { ...LOCAL, VERCEL_ENV: 'preview' },
  ]) {
    assert.deepEqual(acceptedGrantSources(env), PRODUCTION, JSON.stringify(env))
    assert.equal(isVerifiedLocalEnvironment(env), false, JSON.stringify(env))
  }
})

test('test grants count only with an explicit opt-in in a verified local environment', () => {
  assert.deepEqual(acceptedGrantSources(LOCAL), [...PRODUCTION, 'test'])
  assert.deepEqual(acceptedGrantSources({ ...LOCAL, NODE_ENV: 'test', NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:55321' }),
    [...PRODUCTION, 'test'])
  assert.deepEqual(acceptedGrantSources({ ...LOCAL, VERCEL_ENV: 'development' }), [...PRODUCTION, 'test'],
    '`vercel dev` against a local stack is local')
  assert.deepEqual(acceptedGrantSources({ ...LOCAL, AI_PRACTICE_ACCEPT_TEST_GRANTS: undefined }), PRODUCTION,
    'a local environment still needs the explicit flag')
})

test('a grant from an unaccepted source reads exactly like no grant', () => {
  const production = acceptedGrantSources({})
  assert.deepEqual(effectiveAllowance(active('test'), production), NOT_ENTITLED)
  assert.deepEqual(effectiveAllowance(active('trial'), production), active('trial'))
  assert.deepEqual(effectiveAllowance(active('early_access'), production), active('early_access'))
  assert.deepEqual(effectiveAllowance({ ...NOT_ENTITLED }, production), NOT_ENTITLED)
  assert.deepEqual(effectiveAllowance({ ...active('trial'), source: null }, production), NOT_ENTITLED)
})
