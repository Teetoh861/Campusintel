// scripts/entitlements/ops.test.cjs — The operator tool: mandatory actor/reason, narrow service RPCs only, the public
// launch, which opens free access until the end of 30 December (Lagos), and the retired Early Access commands and flags.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { run } = require('./ops.cjs')

const ENV = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: 'local-secret' }
const LAUNCH = ['activate-launch', '--confirm-public-launch', '--actor', 'founder', '--reason', 'public launch']
// The migration that ends free access, and closes the claim, at the end of 30 December (Lagos).
const MIGRATION = 'supabase/migrations/20261126100000_free_until_30_december.sql'

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
      'Students claim free access on the site; see docs/entitlements-operations\\.md$'))
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
  const h = harness(() => ({ state: 'launched', actual_launch_at: '2026-12-01T08:00:00+00:00',
    claim_closes_at: '2026-12-30T23:00:00+00:00', short_window: false }))
  await assert.rejects(h.run(['activate-launch', '--actor', 'founder', '--reason', 'go live']), /--confirm-public-launch/)
  await assert.rejects(h.run(['activate-launch', '--confirm-public-launch', '--actor', 'founder']), /--reason/)
  assert.equal(h.requests.length, 0)
  await h.run(LAUNCH)
  // One call, no sweep: the launch enrols nobody. It never asks the database to open a claim that has already closed.
  assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [['admin_activate_public_launch',
    { p_actor: 'founder', p_reason: 'public launch', p_allow_short_window: false }]])
})

test('the launch prints when it was recorded and when the claim closes, in Lagos time', async () => {
  // Free access is claimed from the launch until the end of 30 December, Lagos: the close is that exclusive midnight.
  const reply = { state: 'launched', actual_launch_at: '2026-12-01T08:00:00+00:00',
    claim_closes_at: '2026-12-30T23:00:00+00:00', short_window: false }
  const h = harness(() => reply)
  await h.run(LAUNCH)
  assert.deepEqual(JSON.parse(h.output.at(-1)), { state: 'launched', launch_recorded: 'Tue, 1 Dec 2026, 09:00 (Lagos)',
    claim_closes: 'Thu, 31 Dec 2026, 00:00 (Lagos)', ...reply })
  // Run again by mistake: the database changes nothing and the tool still says when the claim closes.
  const again = harness(() => ({ state: 'already-launched', actual_launch_at: reply.actual_launch_at,
    claim_closes_at: reply.claim_closes_at }))
  await again.run(LAUNCH)
  assert.equal(JSON.parse(again.output.at(-1)).claim_closes, 'Thu, 31 Dec 2026, 00:00 (Lagos)')
  assert.equal(JSON.parse(again.output.at(-1)).state, 'already-launched')
})

test('the retired flags are refused by name and nothing is sent: --allow-short-claim-window and --enrollment-days', async () => {
  const h = harness(() => ({ state: 'launched', actual_launch_at: '2026-12-01T08:00:00+00:00',
    claim_closes_at: '2026-12-30T23:00:00+00:00', short_window: false }))
  const shortWindow = '--allow-short-claim-window is retired: free access is claimed from the launch until the end of ' +
    '30 December (Lagos), and a launch after that is refused'
  // Refused before the confirmation, the actor and the reason are read.
  for (const command of [[...LAUNCH, '--allow-short-claim-window'], ['activate-launch', '--allow-short-claim-window']]) {
    await assert.rejects(h.run(command), { name: 'Error', message: shortWindow })
  }
  const days = '--enrollment-days is retired: free access can be claimed from the launch until the end of 30 December (Lagos)'
  for (const command of [['configure-early-access', '--enrollment-days', '12', '--actor', 'owner', '--reason', 'longer claim'],
    ['configure-early-access', '--planned-launch', '2026-12-01T08:00:00Z', '--enrollment-days', '10']]) {
    await assert.rejects(h.run(command), { name: 'Error', message: days })
  }
  assert.equal(h.requests.length, 0, 'a retired flag never reaches the database')
  assert.equal(h.output.length, 0)
})

test('the launch is refused, with nothing recorded, on an unmigrated database and once the claim has closed', async () => {
  // A database without the migration still answers with its claim days: the operator is told to apply it first.
  const old = harness(() => ({ state: 'short-claim-window', claim_would_close_at: '2026-11-30T23:00:00+00:00', claim_days: 10,
    full_window_needs_launch_by: '2026-11-20T23:00:00+00:00' }))
  await assert.rejects(old.run(LAUNCH), { name: 'Error', message: 'launch NOT recorded: this database still closes the claim ' +
    `10 days after launch or at the end of 30 November. Apply ${MIGRATION} first` })
  assert.ok(fs.existsSync(path.join(__dirname, '../..', MIGRATION)), 'the migration named is in the repository')
  // With it, a launch is refused only once the end of 30 December (Lagos) has passed, and the message says when that was.
  const late = harness(() => ({ state: 'short-claim-window', claim_would_close_at: '2026-12-30T23:00:00+00:00' }))
  await assert.rejects(late.run(LAUNCH), { name: 'Error',
    message: 'launch NOT recorded: free access could be claimed only until Thu, 31 Dec 2026, 00:00 (Lagos), which has passed' })
  for (const h of [old, late]) {
    assert.equal(h.output.length, 0, 'nothing is printed as if the launch happened')
    assert.deepEqual(h.requests.map(r => [r.fn, r.body.p_allow_short_window]), [['admin_activate_public_launch', false]])
  }
})

test('configure sends the planned launch only: no claim days, and the post-Early-Access trial is retired', async () => {
  const h = harness(() => ({ state: 'changed' }))
  for (const value of ['true', 'false', 'maybe']) {
    await assert.rejects(h.run(['configure-early-access', '--trial-after-early-access', value, '--actor', 'o', '--reason', 'r']),
      /retired/)
  }
  assert.equal(h.requests.length, 0, 'a retired flag never reaches the database')
  await h.run(['configure-early-access', '--planned-launch', '2026-12-01T08:00:00Z', '--actor', 'owner',
    '--reason', 'launch date'])
  await h.run(['configure-early-access', '--actor', 'owner', '--reason', 'no change'])
  // Null leaves the retired days as the migrations pinned them, so the database has no claim days to refuse after launch.
  assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [
    ['admin_configure_early_access', { p_planned_launch_at: '2026-12-01T08:00:00.000Z', p_enrollment_days: null,
      p_trial_after_early_access: null, p_actor: 'owner', p_reason: 'launch date' }],
    ['admin_configure_early_access', { p_planned_launch_at: null, p_enrollment_days: null,
      p_trial_after_early_access: null, p_actor: 'owner', p_reason: 'no change' }]])
  assert.deepEqual(h.output.map(text => JSON.parse(text)), [{ state: 'changed' }, { state: 'changed' }])
})

test('the report is one read and prints what the database answered', async () => {
  // The report since the migration: no claim days; if_launched_now says when the claim would close and whether it would open.
  const report = { now: '2026-11-26T08:00:00+00:00', planned_launch_at: '2026-12-01T08:00:00+00:00', actual_launch_at: null,
    claim_cutoff: '2026-12-30T23:00:00+00:00', claim_closes_at: null, claim_open: false,
    if_launched_now: { claim_would_close_at: '2026-12-30T23:00:00+00:00', claim_would_open: true },
    months: { claimed: 0, running: 0, ended: 0, revoked: 0 }, address_records: 0, retired_list_rows: 0 }
  const h = harness(() => report)
  await h.run(['early-access-report'])
  assert.deepEqual(h.requests.map(r => [r.fn, r.body]), [['admin_early_access_report', {}]])
  assert.deepEqual(JSON.parse(h.output[0]), report)
})
