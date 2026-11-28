// lib/entitlements/free-month-clock.test.cjs — Every free access time rule comes from the database clock: whether the
// claim is open, when it closes, when free access starts and ends, and when its ending notice shows. A device with the
// wrong clock (and a server process with one) cannot claim after the claim closes, cannot keep an offer on screen, and
// cannot move the last day of free access, because nothing between the tap and the database reads a clock or carries a
// time. The database's own half of this (the window and the end judged on clock_timestamp(), no time parameter) is in
// supabase/tests/early_access_claim.test.sql. Run with lib/auth/test-loader.cjs.
const { test, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { entitlementCommandSchema, entitlementSummarySchema, freeMonthCouldBeClaimed } = require('./contract.ts')
const { accessNotice, COURSES_FIXED_LINE, formatFreeMonthDay, FREE_MONTH_COPY } = require('./presentation.ts')

const ROOT = path.resolve(__dirname, '../..')
const KEYS = '1:first-secret-of-at-least-thirty-two-chars'
const USER = '11111111-1111-4111-8111-111111111111'
const SESSION = '22222222-2222-4222-8222-222222222222'
// What the database said: free access started at its own 22 November 13:00 UTC and ends where every claim ends, and the
// claim closes: the end of 30 December in Lagos (20261126100000).
const STARTS = '2026-11-22T13:00:00+00:00'
const ENDS = '2026-12-30T23:00:00+00:00'
// Device and server clocks that are wrong in both directions, and one that happens to be right.
const WRONG_CLOCKS = { 'a year slow': '2025-11-22T13:00:00Z', 'right': '2026-11-22T13:00:00Z', 'a year fast': '2027-11-22T13:00:00Z',
  'inside the window when the database says it has closed': '2026-12-30T22:30:00Z' }
const ZONES = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles']

/** Run once in each of these process time zones, then put the zone back. */
async function inEachZone(run) {
  const zone = process.env.TZ
  try {
    for (const tz of ZONES) {
      process.env.TZ = tz
      await run(tz)
    }
  } finally {
    if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone
  }
}

/** Run with every `Date` in this process reading the given instant. */
async function atClock(iso, run) {
  mock.timers.enable({ apis: ['Date'], now: Date.parse(iso) })
  try { return await run() } finally { mock.timers.reset() }
}

/** The command entry point over a recording database: what was sent, and what the student is told. */
async function claimThrough({ answer, input = { action: 'claim-free-month', profileRevision: 3 } }) {
  const calls = []
  const service = { async rpc(name, args) {
    calls.push([name, args])
    if (name === 'consume_discovery_activation_limit') return { data: { allowed: true, origin_requests: 1 }, error: null }
    return { data: answer, error: null }
  } }
  const mocks = {
    '@supabase/supabase-js': { createClient: () => service },
    '@vercel/analytics/server': { track: async () => {} },
    '@/lib/auth/config': { getSupabaseConfig: () => ({ url: 'http://127.0.0.1:1' }), getAuthSecretKey: () => 'service-key',
      isStudentAuthEnabled: () => true },
    '@/lib/supabase/server': { createClient: async () => ({}) },
    '@/lib/auth/student-state': { getStudentSessionContext: async () => ({ user: { id: USER, email: 'Student@Example.test' },
      sessionId: SESSION }) },
    '@/lib/auth/account-continuity': { matchesAccountContinuityToken: () => true },
    '@/lib/auth/rate-limit': { getBucket: () => 'a'.repeat(64) },
  }
  const original = Module._load
  const before = process.env.ENTITLEMENT_CLAIM_HASH_KEYS
  Module._load = function (name, ...args) {
    return Object.hasOwn(mocks, name) ? mocks[name] : original.call(this, name, ...args)
  }
  process.env.ENTITLEMENT_CLAIM_HASH_KEYS = KEYS
  try {
    delete require.cache[require.resolve('./server.ts')]
    const { runEntitlementRequest } = require('./server.ts')
    const result = await runEntitlementRequest(input, { headers: new Headers() }, 'page-token', '203.0.113.7')
    return { result, calls, claims: calls.filter(([name]) => name === 'claim_early_access') }
  } finally {
    Module._load = original
    delete require.cache[require.resolve('./server.ts')]
    if (before === undefined) delete process.env.ENTITLEMENT_CLAIM_HASH_KEYS
    else process.env.ENTITLEMENT_CLAIM_HASH_KEYS = before
  }
}

test('a claim carries the session, the hashes of the address and the revision on the page: no date, time or length', async () => {
  const { result, claims } = await claimThrough({ answer: { state: 'claimed', starts_at: STARTS, ends_at: ENDS } })
  assert.deepEqual(result, { status: 'month-started', endsAt: ENDS })
  assert.equal(claims.length, 1)
  assert.deepEqual(Object.keys(claims[0][1]).sort(), ['p_claim_hashes', 'p_expected_profile_revision', 'p_session_id'])
  assert.equal(claims[0][1].p_session_id, SESSION)
  assert.equal(claims[0][1].p_expected_profile_revision, 3)
  for (const hash of claims[0][1].p_claim_hashes) assert.deepEqual(Object.keys(hash).sort(), ['check', 'hash', 'version'])
})

test('with the device and server clocks wrong in either direction the same claim is sent, and the end date is the database answer', async () => {
  const seen = []
  for (const [label, clock] of Object.entries(WRONG_CLOCKS)) {
    const { result, calls } = await atClock(clock, () => claimThrough({ answer: { state: 'claimed', starts_at: STARTS, ends_at: ENDS } }))
    assert.deepEqual(result, { status: 'month-started', endsAt: ENDS }, label)
    seen.push(JSON.stringify(calls))
  }
  assert.equal(new Set(seen).size, 1, 'every call to the database is identical whatever the clock here reads')
  assert.doesNotMatch(seen[0], /202[5-9]-\d\d-\d\d/, 'and none of them contains a date')
})

test('a claim the database closed starts nothing, even from a device whose clock says the claim is still open', async () => {
  for (const [label, clock] of Object.entries(WRONG_CLOCKS)) {
    const { result } = await atClock(clock, () => claimThrough({ answer: { state: 'closed' } }))
    assert.deepEqual(result, { status: 'offer-ended' }, label)
  }
})

test('a client cannot send the end date, a start, the current time or a length: such a request is refused before the database', async () => {
  for (const extra of [{ endsAt: '2027-06-30T00:00:00.000Z' }, { startsAt: '2026-11-01T00:00:00.000Z' },
    { now: '2026-11-25T09:00:00.000Z' }, { claimedAt: '2026-11-25T09:00:00.000Z' }, { days: 365 }, { months: 12 }]) {
    const input = { action: 'claim-free-month', profileRevision: 3, ...extra }
    assert.equal(entitlementCommandSchema.safeParse(input).success, false, JSON.stringify(extra))
    const { result, claims, calls } = await claimThrough({ answer: { state: 'claimed', starts_at: STARTS, ends_at: ENDS }, input })
    assert.deepEqual(result, { status: 'invalid-request' }, JSON.stringify(extra))
    assert.deepEqual(claims, [], 'the claim never reaches the database')
    assert.deepEqual(calls, [], 'nor is anything else asked of it')
  }
})

// The claim closes where every claim ends: the close the launch stored, now the end of 30 December.
const planRead = { now: '2026-11-22T12:00:00.000+00:00', planned_launch_at: '2026-10-24T23:00:00+00:00',
  actual_launch_at: '2026-11-20T08:00:00+00:00', trial_hours: 72, expiry_notice_hours: 12, tier: 'free', access: null,
  trial: { status: 'not-offered', policy: null, starts_at: null, ends_at: null, available_from: null },
  discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
  early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: ENDS } }

test('whether the claim could be open is judged from the instants the database reported, never from the clock here', async () => {
  for (const [label, clock] of Object.entries(WRONG_CLOCKS)) {
    await atClock(clock, () => {
      assert.equal(freeMonthCouldBeClaimed(entitlementSummarySchema.parse(planRead)), true, label)
      assert.equal(freeMonthCouldBeClaimed(entitlementSummarySchema.parse({ ...planRead, now: '2026-12-30T22:59:59.999+00:00' })),
        true, `${label}: open until the last moment of 30 December by the database's now`)
      assert.equal(freeMonthCouldBeClaimed(entitlementSummarySchema.parse({ ...planRead, now: ENDS })),
        false, `${label}: closed by the database's now`)
      assert.equal(freeMonthCouldBeClaimed(entitlementSummarySchema.parse({ ...planRead, now: '2026-11-20T07:59:59+00:00' })),
        false, `${label}: not yet launched by the database's now`)
    })
  }
})

test('the ending notice shows by the database clock: the same summary gives the same notice on any device clock or time zone', async () => {
  const running = { ...planRead, tier: 'full', access: { source: 'early_access', ends_at: ENDS },
    early_access: { status: 'active', starts_at: STARTS, ends_at: ENDS, enrollment_closes_at: planRead.early_access.enrollment_closes_at } }
  const notices = []
  await inEachZone(async tz => {
    for (const clock of Object.values(WRONG_CLOCKS)) {
      await atClock(clock, () => {
        // Eleven hours before the end by the database's now (13:00 on 30 December in Lagos): inside the twelve-hour notice.
        notices.push(accessNotice(entitlementSummarySchema.parse({ ...running, now: '2026-12-30T12:00:00+00:00' })))
        // A day before the end: not yet.
        assert.equal(accessNotice(entitlementSummarySchema.parse({ ...running, now: '2026-12-29T23:00:00+00:00' })), null,
          `${tz} at ${clock}`)
      })
    }
  })
  assert.equal(notices.length, ZONES.length * Object.keys(WRONG_CLOCKS).length)
  assert.equal(new Set(notices.map(notice => JSON.stringify(notice))).size, 1)
  assert.deepEqual(notices[0], { id: 'access-ending', tone: 'info', title: 'Your free access ends at midnight tonight.',
    body: 'After that, only GST courses stay free.', action: 'View your plan' })
})

test('the last day of free access is written from the database instant in Lagos time, whatever the clock or time zone here', async () => {
  await inEachZone(async tz => {
    for (const clock of Object.values(WRONG_CLOCKS)) {
      await atClock(clock, () => {
        const day = formatFreeMonthDay(ENDS)
        assert.equal(day, '30 December', `${tz} at ${clock}: the end of 30 December names 30 December, never 31`)
        // A Lagos midnight ends the day before it; 23:30 UTC is already the next day in Lagos.
        assert.equal(formatFreeMonthDay('2026-12-16T23:00:00+00:00'), '16 December')
        assert.equal(formatFreeMonthDay('2026-12-16T23:30:00+00:00'), '17 December')
        assert.deepEqual([FREE_MONTH_COPY.title(day), FREE_MONTH_COPY.active(day)], ['Free until 30 December', 'Free until 30 December'])
        assert.deepEqual(FREE_MONTH_COPY.terms(day), ['Starts now', COURSES_FIXED_LINE])
      })
    }
  })
})

test('the browser code for the offer reads no clock and formats no date: its dates are text the server wrote', () => {
  for (const file of ['app/access/FreeMonthOffer.tsx', 'app/access/OfferConfirm.tsx']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert.match(source, /^'use client'/, `${file} runs in the browser`)
    assert.doesNotMatch(source, /\bDate\b|performance\.now|Intl\.|setInterval|toLocale/, `${file} reads no clock`)
    // A timer is allowed only for the delays the page was given: the time left until the claim closes, worked out on
    // the server from the database's clock, and a fixed pause after "This offer has ended.". Neither reads a clock.
    assert.deepEqual([...source.matchAll(/setTimeout\(.*?,\s*([A-Za-z_]+)\)/g)].map(match => match[1]),
      file.endsWith('FreeMonthOffer.tsx') ? ['closesInMs', 'ENDED_REFRESH_MS'] : [], `${file}: timers use the server's delay only`)
  }
  const offer = fs.readFileSync(path.join(ROOT, 'app/access/FreeMonthOffer.tsx'), 'utf8')
  assert.match(offer, /postEntitlementCommand\(\{ action: 'claim-free-month', profileRevision \}, token\)/,
    'the request is the action and the revision the page showed')
  // Each line that names the day is given the server's text as it arrived, never a day worked out here.
  const named = [...offer.matchAll(/FREE_MONTH_COPY\.(\w+)\(([^()]*)\)/g)].map(([, key, day]) => `${key}(${day})`)
  assert.ok(named.length >= 4, named.join(', '))
  for (const call of named) assert.match(call, /^\w+\((claim\.)?endsOn\)$/, call)
  const claim = fs.readFileSync(path.join(ROOT, 'lib/entitlements/presentation.ts'), 'utf8')
  assert.match(claim, /endsOn: string/, 'the end date arrives as text')
  assert.match(claim, /Date\.parse\(offer\.closesAt\) - Date\.parse\(summary\.now\)/,
    'the time left is the database\'s closing instant less the database\'s own now, on the server')
})

test('the database functions take no time from a caller and judge the window on their own clock after their locks', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261116120000_early_access_claim.sql'), 'utf8')
  assert.match(sql, /create function public\.claim_early_access\(p_session_id uuid, p_claim_hashes jsonb, p_expected_profile_revision bigint\)\s+returns jsonb/)
  assert.match(sql, /create function public\.early_access_claim_eligibility\(p_session_id uuid, p_claim_hashes jsonb\) returns jsonb/)
  const body = sql.slice(sql.indexOf('create function public.claim_early_access('), sql.indexOf('-- No automatic enrolment.'))
  const locks = body.lastIndexOf('pg_advisory_xact_lock')
  const clock = body.indexOf('v_now := clock_timestamp();')
  assert.ok(locks > 0 && clock > locks, 'the clock is read once, after the last lock is held')
  assert.ok(body.indexOf('private.early_access_claim_open(v_now)') > clock, 'the window is judged at that instant')
  assert.match(body, /values \(v_user, 'early_access', v_now, private\.early_access_month_end\(v_now\), 'uncapped'/,
    'free access starts at that same instant, and its end comes from private.early_access_month_end')
  // That end is the close the launch stored (the end of 30 December), whenever the claim was made: the newest
  // definition reads the stored close, not the retired one-month length.
  const dir = path.join(ROOT, 'supabase/migrations')
  const defines = /create (?:or replace )?function private\.early_access_month_end\(/
  const defining = fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort()
    .filter(file => defines.test(fs.readFileSync(path.join(dir, file), 'utf8')))
  const newest = defining.at(-1)
  assert.ok(newest >= '20261126100000', `the newest definition is in ${newest}`)
  const source = fs.readFileSync(path.join(dir, newest), 'utf8')
  const start = [...source.matchAll(new RegExp(defines.source, 'g'))].at(-1).index
  const definition = source.slice(source.indexOf('as $$', start), source.indexOf('$$;', start) + 3)
  assert.match(definition, /\bearly_access_claim_closes_at\b/, `${newest}: every claim ends at the stored close`)
  assert.doesNotMatch(definition, /early_access_duration|p_start/, `${newest}: whatever the claim's start`)
  assert.doesNotMatch(body.replace(/--.*$/gm, ''), /\bnow\(\)/, 'the transaction start time is never used: a request that waited is judged when it is decided')
})
