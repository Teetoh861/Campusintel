// scripts/entitlements/ops.test.cjs — The operator tool: trusted-list import validation, hashing before sending,
// mandatory actor/reason, and narrow service RPCs only.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { run, parseCsv } = require('./ops.cjs')
const { phoneHash } = require('../../lib/entitlements/phone.cjs')

const KEY = 'k'.repeat(40)
const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-secret',
  ENTITLEMENT_PHONE_HASH_KEY: KEY }

function harness(reply = () => ({ state: 'added' })) {
  const requests = []
  const transport = async (url, init) => {
    const body = JSON.parse(init.body)
    requests.push({ fn: new URL(url).pathname.replace('/rest/v1/rpc/', ''), body, headers: init.headers })
    return new Response(JSON.stringify(reply(body)), { status: 200 })
  }
  const output = []
  return { requests, output, run: (args, env = ENV) => run(args, env, transport, text => output.push(text)) }
}

function csv(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'early-access-'))
  const file = path.join(dir, 'list.csv')
  fs.writeFileSync(file, text)
  return { file, done: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

test('the CSV reader handles quotes, doubled quotes, CRLF and a byte-order mark', () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\n'), [['a', 'b, c', 'say "hi"'], ['1', '2', '3']])
  assert.throws(() => parseCsv('a,"b'), /unterminated/)
})

test('import validates the whole file first, normalizes email, and sends only a keyed phone hash', async () => {
  const list = csv('﻿email,full_name,phone,joined_at\n Ada@Example.TEST ,"Ada Obi",0803 123 4567,2026-09-01T10:00:00Z\n' +
    'tunde@example.test,Tunde Bello,,2026-09-02T10:00:00Z\n')
  try {
    const h = harness()
    await h.run(['import-early-access', '--file', list.file, '--batch', 'google-form-2026-10', '--actor', 'ops'])
    assert.deepEqual(h.requests.map(r => r.fn), ['admin_add_early_access_member', 'admin_add_early_access_member'])
    assert.deepEqual(h.requests[0].body, { p_email: 'ada@example.test', p_full_name: 'Ada Obi',
      p_phone_hash: phoneHash(KEY, '+2348031234567'), p_joined_at: '2026-09-01T10:00:00.000Z', p_source: 'import',
      p_batch: 'google-form-2026-10', p_actor: 'ops' })
    assert.equal(h.requests[1].body.p_phone_hash, null)
    assert.doesNotMatch(JSON.stringify(h.requests), /8031234567/)
    assert.deepEqual(JSON.parse(h.output[0]), { added: 2 })
  } finally { list.done() }
})

test('a bad row, duplicate email, wrong header or a phone without the key rejects the file before any write', async () => {
  const cases = [
    ['email,full_name,phone,joined_at\nnot-an-email,A,,2026-09-01T00:00:00Z\n', /line 2: invalid email/],
    ['email,full_name,phone,joined_at\na@x.test,A,,2026-09-01T00:00:00Z\nA@x.test,B,,2026-09-01T00:00:00Z\n', /repeated/],
    ['email,name\na@x.test,A\n', /header/],
    ['email,full_name,phone,joined_at\na@x.test,A,12345,2026-09-01T00:00:00Z\n', /Nigerian mobile/],
    ['email,full_name,phone,joined_at\na@x.test,A,,yesterday\n', /joined_at/],
    ['email,full_name,phone,joined_at\na@x.test,,,2026-09-01T00:00:00Z\n', /full_name/],
  ]
  for (const [text, error] of cases) {
    const list = csv(text)
    try {
      const h = harness()
      await assert.rejects(h.run(['import-early-access', '--file', list.file, '--batch', 'batch-1', '--actor', 'ops']), error)
      assert.equal(h.requests.length, 0)
    } finally { list.done() }
  }
  const phoneWithoutKey = csv('email,full_name,phone,joined_at\na@x.test,A,08031234567,2026-09-01T00:00:00Z\n')
  try {
    const h = harness()
    await assert.rejects(h.run(['import-early-access', '--file', phoneWithoutKey.file, '--batch', 'b-1', '--actor', 'ops'],
      { ...ENV, ENTITLEMENT_PHONE_HASH_KEY: undefined }), /ENTITLEMENT_PHONE_HASH_KEY/)
    assert.equal(h.requests.length, 0)
  } finally { phoneWithoutKey.done() }
})

test('a dry run validates and counts without connecting', async () => {
  const list = csv('email,full_name,phone,joined_at\na@x.test,A,08031234567,2026-09-01T00:00:00Z\n')
  try {
    const h = harness()
    await h.run(['import-early-access', '--file', list.file, '--batch', 'b-1', '--actor', 'ops', '--dry-run'],
      { ENTITLEMENT_PHONE_HASH_KEY: KEY })
    assert.deepEqual(JSON.parse(h.output[0]), { valid: 1, withPhone: 1 })
    assert.equal(h.requests.length, 0)
  } finally { list.done() }
})

test('every recovery change requires an actor and a reason and calls one narrow function', async () => {
  const h = harness(() => ({ state: 'changed' }))
  const grant = '11111111-1111-4111-8111-111111111111'
  await assert.rejects(h.run(['change-grant', '--grant', grant, '--action', 'revoke', '--actor', 'ops']), /--reason/)
  await assert.rejects(h.run(['grant', '--user', 'not-a-uuid', '--days', '7', '--actor', 'ops', '--reason', 'support']), /--user/)
  await assert.rejects(h.run(['change-grant', '--grant', grant, '--action', 'delete', '--actor', 'a', '--reason', 'r']), /--action/)
  assert.equal(h.requests.length, 0)
  await h.run(['change-grant', '--grant', grant, '--action', 'extend', '--until', '2026-11-10T00:00:00Z',
    '--actor', 'ops', '--reason', 'SMS outage during trial'])
  assert.deepEqual(h.requests.at(-1), { fn: 'admin_change_grant', headers: h.requests.at(-1).headers, body: {
    p_grant_id: grant, p_action: 'extend', p_ends_at: '2026-11-10T00:00:00.000Z', p_ai_units: null,
    p_actor: 'ops', p_reason: 'SMS outage during trial' } })
  await h.run(['release-phone', '--phone', '+234 803 123 4567', '--actor', 'ops', '--reason', 'number reassigned'])
  assert.deepEqual(h.requests.at(-1).body, { p_phone_hash: phoneHash(KEY, '+2348031234567'), p_actor: 'ops',
    p_reason: 'number reassigned' })
})

test('hosted configuration requires HTTPS and an sb_secret_ key; nothing is sent otherwise', async () => {
  const h = harness()
  for (const env of [{}, { ...ENV, NEXT_PUBLIC_SUPABASE_URL: 'http://db.example.test' },
    { ...ENV, NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test' },
    { ...ENV, NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.test/rest' }]) {
    await assert.rejects(h.run(['early-access-report'], env))
  }
  assert.equal(h.requests.length, 0)
})

test('the actual public launch needs an explicit confirmation flag, an actor and a reason', async () => {
  const h = harness(() => ({ state: 'launched', granted: 3, remaining: 0 }))
  await assert.rejects(h.run(['activate-launch', '--actor', 'founder', '--reason', 'go live']), /--confirm-public-launch/)
  await assert.rejects(h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder']), /--reason/)
  assert.equal(h.requests.length, 0)
  await h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch'])
  assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [['admin_activate_public_launch',
    { p_actor: 'founder', p_reason: 'public launch', p_limit: 200 }]])
})

test('policy changes keep the enrollment window and the post-Early-Access trial configurable', async () => {
  const h = harness(() => ({ state: 'changed' }))
  await assert.rejects(h.run(['configure-early-access', '--trial-after-early-access', 'maybe', '--actor', 'o', '--reason', 'r']),
    /true or false/)
  await h.run(['configure-early-access', '--enrollment-days', '42', '--trial-after-early-access', 'false',
    '--actor', 'owner', '--reason', 'final policy'])
  assert.deepEqual(h.requests.at(-1).body, { p_planned_launch_at: null, p_enrollment_days: 42,
    p_trial_after_early_access: false, p_actor: 'owner', p_reason: 'final policy' })
  await h.run(['reconcile-early-access', '--actor', 'ops', '--reason', 'recovery sweep'])
  assert.equal(h.requests.at(-1).fn, 'admin_reconcile_early_access')
})

test('launch and recovery sweep in bounded batches until nothing enrollable remains', async () => {
  const replies = [{ state: 'launched', granted: 200, remaining: 350, deferred: 0 },
    { state: 'reconciled', granted: 200, remaining: 150, deferred: 0 }, { state: 'reconciled', granted: 150, remaining: 0, deferred: 0 }]
  const h = harness(() => replies.shift())
  await h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch'])
  assert.deepEqual(h.requests.map(r => [r.fn, r.body.p_limit]), [['admin_activate_public_launch', 200],
    ['admin_reconcile_early_access', 200], ['admin_reconcile_early_access', 200]])
  assert.deepEqual(JSON.parse(h.output.at(-1)), { state: 'launched', granted: 550, remaining: 0, deferred: 0, batches: 3 })
  const sweep = harness(() => ({ state: 'reconciled', granted: 0, remaining: 0, deferred: 0 }))
  await sweep.run(['reconcile-early-access', '--actor', 'ops', '--reason', 'recovery'])
  assert.deepEqual(JSON.parse(sweep.output.at(-1)), { granted: 0, remaining: 0, batches: 1 })
})

test('M3-B: a batch that grants nobody only because accounts were in flight is retried, not taken as the end', async () => {
  const replies = [{ state: 'reconciled', granted: 0, remaining: 3, deferred: 2 },
    { state: 'reconciled', granted: 3, remaining: 0, deferred: 0 }]
  const h = harness(() => replies.shift())
  await h.run(['reconcile-early-access', '--actor', 'ops', '--reason', 'recovery'])
  assert.deepEqual(JSON.parse(h.output.at(-1)), { granted: 3, remaining: 0, batches: 2 })
})

test('M3-B: the sweep never reports success while enrollable accounts remain', async () => {
  // No progress and nothing in flight: the database says work is left that no batch can do. That is an error.
  const stuck = harness(() => ({ state: 'reconciled', granted: 0, remaining: 10, deferred: 0 }))
  await assert.rejects(stuck.run(['reconcile-early-access', '--actor', 'ops', '--reason', 'recovery']),
    /stopped with 10 enrollable account\(s\) left after 1 batch/)
  assert.equal(stuck.output.length, 0, 'no partial result is printed as if complete')
  const launch = [{ state: 'launched', granted: 200, remaining: 10, deferred: 0 },
    { state: 'reconciled', granted: 0, remaining: 10, deferred: 0 }]
  const h = harness(() => launch.shift())
  await assert.rejects(h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'go']),
    /10 enrollable account\(s\) left after 2 batch\(es\) \(200 granted\)/)
})

test('M3-A: an enrollment deferred by an import is completed by a follow-up sweep in fresh transactions', async () => {
  const list = csv('email,full_name,phone,joined_at\nada@example.test,Ada Obi,,2026-09-01T10:00:00Z\n' +
    'tunde@example.test,Tunde Bello,,2026-09-02T10:00:00Z\n')
  try {
    const h = harness(body => body.p_email === 'ada@example.test' ? { state: 'added', enrollment: 'deferred' }
      : body.p_email ? { state: 'added', enrollment: null } : { state: 'reconciled', granted: 1, remaining: 0, deferred: 0 })
    await h.run(['import-early-access', '--file', list.file, '--batch', 'google-form', '--actor', 'ops'])
    assert.deepEqual(h.requests.map(r => r.fn), ['admin_add_early_access_member', 'admin_add_early_access_member',
      'admin_reconcile_early_access'])
    assert.deepEqual(h.requests.at(-1).body, { p_actor: 'ops', p_reason: 'import google-form: deferred enrollment',
      p_limit: 200 })
    assert.deepEqual(JSON.parse(h.output.at(-1)), { added: 2, deferred: 1, sweep: { granted: 1, remaining: 0, batches: 1 } })
    const plain = harness(() => ({ state: 'added', enrollment: 'granted' }))
    await plain.run(['import-early-access', '--file', list.file, '--batch', 'google-form', '--actor', 'ops'])
    assert.equal(plain.requests.filter(r => r.fn === 'admin_reconcile_early_access').length, 0,
      'no sweep when nothing was deferred')
  } finally {
    list.done()
  }
})

test('M3-A: an enrollment deferred by a member change is completed by a follow-up sweep', async () => {
  const h = harness(body => body.p_email ? { state: 'changed', enrollment: 'deferred', duplicate_grants_revoked: 0 }
    : { state: 'reconciled', granted: 1, remaining: 0, deferred: 0 })
  await h.run(['member', '--email', 'ada@example.test', '--action', 'include', '--actor', 'ops', '--reason', 'list fixed'])
  assert.deepEqual(h.requests.map(r => r.fn), ['admin_change_early_access_member', 'admin_reconcile_early_access'])
  assert.deepEqual(h.requests.at(-1).body, { p_actor: 'ops', p_reason: 'list fixed', p_limit: 200 })
  assert.deepEqual(JSON.parse(h.output.at(-1)), { state: 'changed', enrollment: 'deferred', duplicate_grants_revoked: 0,
    sweep: { granted: 1, remaining: 0, batches: 1 } })
  const plain = harness(() => ({ state: 'changed', enrollment: 'granted', duplicate_grants_revoked: 0 }))
  await plain.run(['member', '--email', 'ada@example.test', '--action', 'include', '--actor', 'ops', '--reason', 'list fixed'])
  assert.deepEqual(plain.requests.map(r => r.fn), ['admin_change_early_access_member'], 'no sweep when nothing was deferred')
})
