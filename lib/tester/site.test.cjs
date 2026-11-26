// lib/tester/site.test.cjs — Owner tester access: only the test project's database, or a local stack, counts as the test
// site, and no other variable can make it so.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { TEST_PROJECT_REF, isTesterSite, isTesterOperatorTarget, fundedByTesterOffSite } = require('./site.cjs')

const TEST_URL = `https://${TEST_PROJECT_REF}.supabase.co`

test('the test project over HTTPS and a loopback local stack are the test site', () => {
  for (const url of [TEST_URL, `${TEST_URL}/`, 'http://127.0.0.1:54321', 'http://localhost:54321', 'https://localhost']) {
    assert.equal(isTesterSite({ NEXT_PUBLIC_SUPABASE_URL: url }), true, url)
  }
})

test('every other Supabase URL, or none, fails closed', () => {
  for (const url of [undefined, '', ' ', 'garbage', 'https://abcdefghijklmnopqrst.supabase.co',
    `http://${TEST_PROJECT_REF}.supabase.co`, `${TEST_URL}:8443`, `${TEST_URL}/rest/v1`, `${TEST_URL}?x=1`,
    `${TEST_URL}#x`, ` ${TEST_URL}`, `https://user:pass@${TEST_PROJECT_REF}.supabase.co`,
    `https://${TEST_PROJECT_REF}.supabase.co.evil.example`, `https://evil.example/${TEST_PROJECT_REF}.supabase.co`,
    `https://x${TEST_PROJECT_REF}.supabase.co`, 'http://[::1]:54321', 'http://10.0.0.2:54321', 'ftp://127.0.0.1']) {
    assert.equal(isTesterSite({ NEXT_PUBLIC_SUPABASE_URL: url }), false, String(url))
  }
})

test('no deployment variable can switch it on or off; only the Supabase URL is read', () => {
  const production = 'https://abcdefghijklmnopqrst.supabase.co'
  for (const extra of [{ VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'development' }, { NODE_ENV: 'development' },
    { NEXT_PUBLIC_SITE_URL: 'https://test.campusintell.com' }, { TESTER_ACCESS: 'true' }, { VERCEL_GIT_COMMIT_REF: 'develop' }]) {
    assert.equal(isTesterSite({ NEXT_PUBLIC_SUPABASE_URL: production, ...extra }), false, JSON.stringify(extra))
    assert.equal(isTesterSite({ NEXT_PUBLIC_SUPABASE_URL: TEST_URL, ...extra, VERCEL_ENV: 'production' }), true)
  }
})

test('a tester-funded Campus Bot admission is refused only off the test site', () => {
  const production = { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' }
  const site = { NEXT_PUBLIC_SUPABASE_URL: TEST_URL }
  assert.equal(fundedByTesterOffSite({ state: 'started', funding: 'tester' }, production), true)
  assert.equal(fundedByTesterOffSite({ state: 'started', funding: 'tester' }, site), false)
  for (const data of [null, undefined, 'tester', { state: 'started' }, { state: 'started', funding: 'paid' }]) {
    assert.equal(fundedByTesterOffSite(data, production), false, JSON.stringify(data))
  }
})

test('the operator target: the test project, or a loopback stack from a local development or test run only', () => {
  assert.equal(isTesterOperatorTarget({ NEXT_PUBLIC_SUPABASE_URL: TEST_URL }), true)
  assert.equal(isTesterOperatorTarget({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NODE_ENV: 'test' }), true)
  assert.equal(isTesterOperatorTarget({ NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NODE_ENV: 'development' }), true)
  for (const env of [{ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NODE_ENV: 'production' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NODE_ENV: 'test', VERCEL_ENV: 'development' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', NODE_ENV: 'test' }]) {
    assert.equal(isTesterOperatorTarget(env), false, JSON.stringify(env))
  }
})
