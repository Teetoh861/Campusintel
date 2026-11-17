// scripts/entitlements/ops.test.cjs — The operator tool: mandatory actor/reason, narrow service RPCs only, the public
// launch with its claim window, and the retired Early Access list commands.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { run } = require('./ops.cjs')

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-secret' }

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

test('the retired list commands are refused by name and nothing is sent', async () => {
  const h = harness()
  for (const command of [['import-early-access', '--file', 'list.csv', '--batch', 'b-1', '--actor', 'ops'],
    ['import-early-access', '--file', 'list.csv', '--batch', 'b-1', '--actor', 'ops', '--dry-run'],
    ['member', '--email', 'ada@example.test', '--action', 'include', '--actor', 'ops', '--reason', 'list fixed'],
    ['reconcile-early-access', '--actor', 'ops', '--reason', 'recovery sweep']]) {
    await assert.rejects(h.run(command), new RegExp(`^Error: ${command[0]} is retired: there is no Early Access list\\. ` +
      'Students claim their free month on the site'))
    // Not even a configuration error: the command is refused before the connection is read.
    await assert.rejects(h.run(command, {}), /is retired/)
  }
  assert.equal(h.requests.length, 0)
  assert.equal(h.output.length, 0)
})

test('every recovery change requires an actor and a reason and calls one narrow function', async () => {
  const h = harness(() => ({ state: 'changed' }))
  const grant = '11111111-1111-4111-8111-111111111111'
  await assert.rejects(h.run(['change-grant', '--grant', grant, '--action', 'revoke', '--actor', 'ops']), /--reason/)
  await assert.rejects(h.run(['grant', '--user', 'not-a-uuid', '--days', '7', '--actor', 'ops', '--reason', 'support']), /--user/)
  await assert.rejects(h.run(['change-grant', '--grant', grant, '--action', 'delete', '--actor', 'a', '--reason', 'r']), /--action/)
  assert.equal(h.requests.length, 0)
  await h.run(['change-grant', '--grant', grant, '--action', 'extend', '--until', '2026-11-10T00:00:00Z',
    '--actor', 'ops', '--reason', 'activation outage compensation'])
  assert.deepEqual(h.requests.at(-1), { fn: 'admin_change_grant', headers: h.requests.at(-1).headers, body: {
    p_grant_id: grant, p_action: 'extend', p_ends_at: '2026-11-10T00:00:00.000Z', p_ai_units: null,
    p_actor: 'ops', p_reason: 'activation outage compensation' } })
  // The phone-code commands of the retired activation no longer exist; a pass is started only by the student.
  for (const command of [['release-phone', '--phone', '+234 803 123 4567', '--actor', 'ops', '--reason', 'r'], ['purge-otp']]) {
    await assert.rejects(h.run(command), /usage/)
  }
  assert.equal(h.requests.filter(r => r.fn !== 'admin_change_grant').length, 0)
  // Claim housekeeping calls one narrow function each and sends nothing else.
  await h.run(['purge-claims'])
  assert.deepEqual([h.requests.at(-1).fn, h.requests.at(-1).body], ['purge_discovery_pass_claims', {}])
  await h.run(['claim-keys'])
  assert.deepEqual([h.requests.at(-1).fn, h.requests.at(-1).body], ['admin_discovery_claim_keys', {}])
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
  const h = harness(() => ({ state: 'launched', actual_launch_at: '2026-11-20T08:00:00+00:00',
    claim_closes_at: '2026-11-30T08:00:00+00:00', claim_days: 10, short_window: false }))
  await assert.rejects(h.run(['activate-launch', '--actor', 'founder', '--reason', 'go live']), /--confirm-public-launch/)
  await assert.rejects(h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder']), /--reason/)
  assert.equal(h.requests.length, 0)
  await h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch'])
  // One call, no sweep: the launch enrols nobody. The short window is refused unless the flag is given.
  assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [['admin_activate_public_launch',
    { p_actor: 'founder', p_reason: 'public launch', p_allow_short_window: false }]])
})

test('the launch prints when it was recorded and when the claim closes, in Lagos time', async () => {
  const reply = { state: 'launched', actual_launch_at: '2026-11-20T08:00:00+00:00',
    claim_closes_at: '2026-11-30T08:00:00+00:00', claim_days: 10, short_window: false }
  const h = harness(() => reply)
  await h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch'])
  assert.deepEqual(JSON.parse(h.output.at(-1)), { state: 'launched', launch_recorded: 'Fri, 20 Nov 2026, 09:00 (Lagos)',
    claim_closes: 'Mon, 30 Nov 2026, 09:00 (Lagos)', ...reply })
  // Run again by mistake: the database changes nothing and the tool still says when the claim closes.
  const again = harness(() => ({ state: 'already-launched', actual_launch_at: reply.actual_launch_at,
    claim_closes_at: reply.claim_closes_at }))
  await again.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch'])
  assert.equal(JSON.parse(again.output.at(-1)).claim_closes, 'Mon, 30 Nov 2026, 09:00 (Lagos)')
  assert.equal(JSON.parse(again.output.at(-1)).state, 'already-launched')
})

test('a launch that would leave fewer than the full claim days is refused, with the dates, unless the flag is given', async () => {
  const short = { state: 'short-claim-window', claim_would_close_at: '2026-11-30T23:00:00+00:00', claim_days: 10,
    full_window_needs_launch_by: '2026-11-20T23:00:00+00:00' }
  const h = harness(() => short)
  await assert.rejects(h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch']),
    /launch NOT recorded: the free month claim would close on Tue, 1 Dec 2026, 00:00 \(Lagos\), less than 10 days after launch \(a full window needs launch by Sat, 21 Nov 2026, 00:00 \(Lagos\)\)\. To launch anyway, add --allow-short-claim-window/)
  assert.equal(h.output.length, 0, 'nothing is printed as if the launch happened')
  assert.equal(h.requests[0].body.p_allow_short_window, false)
  const allowed = harness(() => ({ state: 'launched', actual_launch_at: '2026-11-25T08:00:00+00:00',
    claim_closes_at: '2026-11-30T23:00:00+00:00', claim_days: 10, short_window: true }))
  await allowed.run(['activate-launch', '--confirm-public-launch', '--allow-short-claim-window', '--actor', 'founder',
    '--reason', 'public launch'])
  assert.equal(allowed.requests[0].body.p_allow_short_window, true)
  const printed = JSON.parse(allowed.output.at(-1))
  assert.deepEqual([printed.claim_closes, printed.short_window], ['Tue, 1 Dec 2026, 00:00 (Lagos)', true])
})

test('policy changes keep the claim days configurable; the post-Early-Access trial is retired', async () => {
  const h = harness(() => ({ state: 'changed' }))
  for (const value of ['true', 'false', 'maybe']) {
    await assert.rejects(h.run(['configure-early-access', '--trial-after-early-access', value, '--actor', 'o', '--reason', 'r']),
      /retired/)
  }
  assert.equal(h.requests.length, 0, 'a retired flag never reaches the database')
  // 0 days closes the claim at once: the operator's brake.
  await h.run(['configure-early-access', '--enrollment-days', '0', '--actor', 'owner', '--reason', 'close the claim'])
  assert.deepEqual(h.requests.at(-1).body, { p_planned_launch_at: null, p_enrollment_days: 0,
    p_trial_after_early_access: null, p_actor: 'owner', p_reason: 'close the claim' })
})

test('the report is one read and prints what the database answered', async () => {
  const report = { actual_launch_at: null, claim_days: 10, claim_open: false,
    if_launched_now: { claim_would_close_at: '2026-11-26T08:00:00+00:00', full_window: true }, months: { claimed: 0 } }
  const h = harness(() => report)
  await h.run(['early-access-report'])
  assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [['admin_early_access_report', {}]])
  assert.deepEqual(JSON.parse(h.output[0]), report)
})
