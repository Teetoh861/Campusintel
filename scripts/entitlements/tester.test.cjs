// scripts/entitlements/tester.test.cjs — The tester commands: test project (or a local stack) only, refused before the key
// is read or anything is sent; an actor and a reason on every change; the narrow service functions and their bounds.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { run } = require('./ops.cjs')

const USER = '11111111-1111-4111-8111-111111111111'
const TEST = { NEXT_PUBLIC_SUPABASE_URL: 'https://znwluaiylogqapansuht.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }
const LOCAL = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-secret', NODE_ENV: 'test' }

function harness(reply = () => ({ state: 'granted', expires_at: '2026-12-02T10:00:00Z' })) {
  const requests = []
  const transport = async (url, init) => {
    requests.push({ url: String(url), fn: new URL(url).pathname.replace('/rest/v1/rpc/', ''), body: JSON.parse(init.body) })
    return new Response(JSON.stringify(reply()), { status: 200 })
  }
  const output = []
  return { requests, output, run: (args, env) => run([...args, '--project', 'test'], env, transport, text => output.push(text)) }
}

const GRANT = ['tester-grant', '--user', USER, '--actor', 'est', '--reason', 'owner testing']

test('every project but the test one is refused before anything is sent, whatever the key', async () => {
  const h = harness()
  for (const url of ['https://abcdefghijklmnopqrst.supabase.co', 'http://znwluaiylogqapansuht.supabase.co',
    'https://znwluaiylogqapansuht.supabase.co.evil.example', 'http://[::1]:54321', '', undefined]) {
    for (const args of [GRANT, ['tester-revoke', '--user', USER, '--actor', 'est', '--reason', 'done'], ['tester-status']]) {
      await assert.rejects(h.run(args, { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_prod' }),
        /nothing was sent/)
    }
  }
  assert.equal(h.requests.length, 0)
  assert.equal(h.output.length, 0)
})

test('the named test project is accepted, and only the named function is called', async () => {
  for (const env of [TEST]) {
    const h = harness()
    await h.run(GRANT, env)
    assert.equal(new URL(h.requests[0].url).origin, new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin)
    assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [['admin_set_tester_access', { p_user_id: USER,
      p_action: 'grant', p_days: null, p_daily_cap: null, p_actor: 'est', p_reason: 'owner testing' }]])
    assert.match(h.output[0], /"ends": "[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} 2026, \d{2}:\d{2} \(Lagos\)"/)
  }
})

test('grant takes days 1-30 and a cap 100000-50000000; revoke and status call their own functions', async () => {
  const h = harness()
  await h.run([...GRANT, '--days', '30', '--daily-cap', '3000000'], TEST)
  assert.deepEqual([h.requests.at(-1).body.p_days, h.requests.at(-1).body.p_daily_cap], [30, 3000000])
  for (const [flag, value] of [['--days', '0'], ['--days', '31'], ['--days', '1.5'], ['--daily-cap', '99999'],
    ['--daily-cap', '50000001']]) {
    await assert.rejects(h.run([...GRANT, flag, value], TEST), new RegExp(flag))
  }
  await h.run(['tester-revoke', '--user', USER, '--actor', 'est', '--reason', 'finished'], TEST)
  assert.deepEqual(h.requests.at(-1), { url: h.requests.at(-1).url, fn: 'admin_set_tester_access', body: {
    p_user_id: USER, p_action: 'revoke', p_days: null, p_daily_cap: null, p_actor: 'est', p_reason: 'finished' } })
  await h.run(['tester-status'], TEST)
  assert.deepEqual([h.requests.at(-1).fn, h.requests.at(-1).body], ['admin_tester_status', { p_user_id: null }])
  await h.run(['tester-status', '--user', USER], TEST)
  assert.deepEqual(h.requests.at(-1).body, { p_user_id: USER })
  assert.equal(h.requests.length, 4)
})

test('every change needs an account, an actor and a reason', async () => {
  const h = harness()
  await assert.rejects(h.run(['tester-grant', '--user', USER, '--actor', 'est'], TEST), /--reason/)
  await assert.rejects(h.run(['tester-grant', '--user', USER, '--reason', 'testing'], TEST), /--actor/)
  await assert.rejects(h.run(['tester-revoke', '--user', 'not-a-uuid', '--actor', 'est', '--reason', 'r'], TEST), /--user/)
  await assert.rejects(h.run(['tester-grant', '--actor', 'est', '--reason', 'testing'], TEST), /--user/)
  await assert.rejects(h.run(['tester-status', '--user', 'nope'], TEST), /--user/)
  assert.equal(h.requests.length, 0)
})

test('all local stacks are refused; a hosted test target needs no deployment flag', async () => {
  const h = harness()
  for (const env of [{ ...LOCAL, NODE_ENV: undefined }, { ...LOCAL, NODE_ENV: 'production' },
    { ...LOCAL, VERCEL_ENV: 'development' }, { ...LOCAL, VERCEL_ENV: 'preview' },
    { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NODE_ENV: 'staging' }]) {
    await assert.rejects(h.run(GRANT, env), /nothing was sent/, JSON.stringify(env))
  }
  assert.equal(h.requests.length, 0)
  await assert.rejects(h.run(GRANT, { ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321', NODE_ENV: 'development' }), /nothing was sent/)
  assert.equal(h.requests.length, 0)
  // The test project needs nothing else: a hosted shell has no NODE_ENV.
  await h.run(GRANT, { ...TEST, NODE_ENV: 'production', VERCEL_ENV: 'production' })
  assert.equal(h.requests.length, 1)
})
