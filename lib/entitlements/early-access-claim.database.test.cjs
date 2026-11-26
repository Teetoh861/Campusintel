// lib/entitlements/early-access-claim.database.test.cjs — Real concurrent sessions against a LOCAL database for the free
// access claim (20261116120000_early_access_claim.sql; since 20261126100000_free_until_30_december.sql the claim is open
// from the launch until the cutoff, and every claim ends at the close stored from it, whenever it was made): one account
// tapping Start from several tabs at once, several accounts presenting one address, fifty accounts claiming together,
// claims long after the launch, and the claim racing the launch switch, a move of the end, the closing instant, a
// payment, a free pass and an account deletion. Each race must end with at most one claim per account and per address,
// each ending at the close stored when it was decided, and with no deadlock or lock timeout.
// It moves the claim window on the one policy row while it runs (and puts it back), so run it on its own.
// Opt in: ENTITLEMENT_DB_TEST=1 [ENTITLEMENT_DB_CONTAINER=supabase_db_<project>]
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.ENTITLEMENT_DB_TEST === '1'
const container = process.env.ENTITLEMENT_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
// Fifty students, and how long all fifty claims may take from the first request to the last answer. Each request is
// its own `docker exec`, which is most of the time on a busy machine; the database's own share is reported beside it.
const CROWD = 50
const CROWD_LIMIT_MS = 60_000

function sql(statement) {
  const result = spawnSync('docker', [...psql, '-c', statement], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function background(statement) {
  const child = spawn('docker', [...psql, '-c', statement], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let error = ''
  child.stdout.on('data', value => { out += value })
  child.stderr.on('data', value => { error += value })
  return new Promise((resolve, reject) => child.on('error', reject).on('close', code => {
    if (code !== 0) reject(new Error(error)); else resolve(out.trim())
  }))
}

const until = async (predicate, label) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 20_000) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
// Sessions running the named function that are blocked on a lock right now.
const waitingIn = name => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
  and query like '%${name}%' and query not like '%pg_stat_activity%'`))
// Strict limits for every racing session: a deadlock, hang or long lock wait fails the test instead of stalling it.
const strict = statement => `set statement_timeout = '30s'; set lock_timeout = '30s'; ${statement}`
const lastJson = out => JSON.parse(out.split('\n').at(-1))

/** A session holding a private advisory lock until release(). Nothing here depends on how fast docker exec is. */
async function openGate() {
  const key = `month-test-gate-${randomUUID()}`
  const session = background(`select pg_advisory_lock(hashtextextended('${key}', 0)); select pg_sleep(300);`)
    .catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${key}%'`) !== '0',
    'the gate')
  return {
    wait: `reset role; select pg_advisory_lock(hashtextextended('${key}', 0));`,
    release: async () => {
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${key}%'`)
      await session
    },
  }
}

/** Hold one advisory lock the claim takes until release(), so every racer provably queues behind it first. */
async function holdLock(key) {
  const gate = await openGate()
  const holder = background(`begin; select pg_advisory_xact_lock(hashtextextended('${key}', 0)); ${gate.wait} commit;`)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%${key}%' and query not like '%pg_stat_activity%'`) !== '0', 'the lock holder')
  return { release: async () => { await gate.release(); await holder } }
}

/** Run statements in a transaction that keeps its locks until release(), which resolves to their output. */
async function holdStatement(statement) {
  const gate = await openGate()
  const marker = `month-test-gate-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin; ${statement}; ${gate.wait} commit;`)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%${marker}%' and query not like '%pg_stat_activity%'`) !== '0', 'the statement holder')
  return { release: async () => { await gate.release(); return holder } }
}

/** Every racing session must succeed: a deadlock (40P01) or timeout is a failure, reported with its message. */
async function allSucceed(promises, label) {
  const settled = await Promise.allSettled(promises)
  const failures = settled.filter(result => result.status === 'rejected').map(result => String(result.reason).slice(0, 300))
  assert.deepEqual(failures, [], `${label}: every concurrent session must complete`)
  return settled.map(result => result.value)
}
const tally = states => states.reduce((counts, state) => ({ ...counts, [state]: (counts[state] ?? 0) + 1 }), {})

/** Confirmed students, each with live sessions and Business Administration 200L First Semester set. */
function students(count, { sessions = 1, email = user => `month-db-${user}@example.test` } = {}) {
  const people = Array.from({ length: count }, (_, index) => {
    const user = randomUUID()
    return { user, email: email(user, index), sessions: Array.from({ length: sessions }, () => randomUUID()) }
  })
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
      ${people.map(p => `('00000000-0000-0000-0000-000000000000', '${p.user}', 'authenticated', 'authenticated',
        '${p.email}', 'x', now(), '{}', '{}', now(), now())`).join(', ')};
    insert into auth.sessions (id, user_id, created_at, updated_at) values
      ${people.flatMap(p => p.sessions.map(id => `('${id}', '${p.user}', now(), now())`)).join(', ')};
    update public.profiles set first_name = 'Ada', department_id = '${BUA}', academic_level_id = '${L200}',
      academic_period_id = '${FIRST}' where id in (${people.map(p => `'${p.user}'`).join(', ')});`)
  const revisions = JSON.parse(sql(`select jsonb_object_agg(id, revision) from public.profiles
    where id in (${people.map(p => `'${p.user}'`).join(', ')})`))
  return people.map(p => ({ ...p, session: p.sessions[0], revision: revisions[p.user] }))
}
const student = options => students(1, options)[0]
const ids = people => people.map(p => `'${p.user}'`).join(', ')

// The keyed hashes and key checks the application would send for an address (lib/entitlements/claim-hash.ts); plain
// digests stand in for the HMACs. This suite signs under its own key version so it never collides with the
// application's keys on a shared local database, and presents every other registered version with its registered
// check (as a correctly configured application does), so the ledger's fail-closed integrity rules are satisfied.
const KEY_VERSION = 902
const digest = value => `encode(sha256(convert_to('${value}', 'UTF8')), 'hex')`
const claimHash = email => digest(`claim-v${KEY_VERSION}:${email.trim().toLowerCase()}`)
/** A function from an address to the SQL of its hashes; the registry is read once, as postgres. */
function hasher() {
  const others = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('version', key_version, 'check', key_check)), '[]')
    from private.discovery_claim_keys where key_version <> ${KEY_VERSION}`))
  return email => {
    const address = email.trim().toLowerCase()
    return `jsonb_build_array(${[`jsonb_build_object('version', ${KEY_VERSION}, 'hash', ${claimHash(email)},
      'check', ${digest(`claim-key-check-v${KEY_VERSION}`)})`,
    ...others.map(k => `jsonb_build_object('version', ${k.version}, 'hash', ${digest(`claim-v${k.version}:${address}`)},
      'check', '${k.check}')`)].join(', ')})`
  }
}

// The calls as the server makes them, with the service role: the session, the hashes of its address, the revision.
const claimSql = (hashes, who, { session = who.session, email = who.email, seen = who.revision } = {}) =>
  `set role service_role; select public.claim_early_access('${session}', ${hashes(email)}, ${seen})::text`
const claimMonth = (hashes, who, options) => background(strict(claimSql(hashes, who, options))).then(lastJson)
const canClaimSql = (hashes, who) => `set role service_role;
  select public.early_access_claim_eligibility('${who.session}', ${hashes(who.email)})::text`
const passSql = (hashes, who) => `set role service_role;
  select public.activate_discovery_pass('${who.session}', ${hashes(who.email)}, ${who.revision})::text`
const asStudent = (who, statement) => `set role authenticated; set request.jwt.claims = '${JSON.stringify(
  { sub: who.user, role: 'authenticated', session_id: who.session })}'; ${statement}`
const months = people => Number(sql(`select count(*) from public.entitlement_grants where source = 'early_access'
  and user_id in (${ids(people)})`))
/** How many of these accounts' free access grants end exactly at the close stored on the policy row. */
const endingAtClose = people => Number(sql(`select count(*) from public.entitlement_grants g
  join private.entitlement_policy p on g.ends_at = p.early_access_claim_closes_at
  where g.source = 'early_access' and g.user_id in (${ids(people)})`))
/** Whether an instant a database answer named (a JSON timestamp) is the close stored on the policy row. */
const isStoredClose = instant => typeof instant === 'string' && sql(`select '${instant}'::timestamptz
  = early_access_claim_closes_at from private.entitlement_policy`) === 't'

/** The claim open: launched a minute ago, until the cutoff far off (the trigger stores it as the close, and every claim
 *  ends there), unless a test says otherwise. The days are retired and decide nothing; they stay at 10 so that the
 *  mixed load's configure call, which still sends 10, is a change and not a refusal. */
const openWindow = ({ launched = "now() - interval '1 minute'", days = 10, cutoff = "now() + interval '60 days'" } = {}) =>
  sql(`update private.entitlement_policy set actual_launch_at = ${launched}, early_access_enrollment_days = ${days},
    early_access_claim_cutoff = ${cutoff}`)

/** Both ledgers first (a record left behind would keep this suite's key version needed for ever), then the accounts
 *  and, in replica mode as the payment suites do, the payment records this suite made for them. */
function cleanup(...people) {
  if (people.length === 0) return
  sql(`delete from private.early_access_claims where user_id in (${ids(people)}) or key_version = ${KEY_VERSION};
    delete from private.discovery_pass_claims where user_id in (${ids(people)});
    create temporary table month_orders as select id from private.payment_orders where user_id in (${ids(people)});
    delete from auth.users where id in (${ids(people)});
    set session_replication_role = replica;
    delete from private.payment_events where order_id in (select id from month_orders);
    delete from private.payment_fulfilments where order_id in (select id from month_orders);
    delete from private.payment_orders where id in (select id from month_orders);
    set session_replication_role = origin;`)
}

let restorePolicy = null
before(() => {
  if (!enabled) return
  restorePolicy = sql(`select format('update private.entitlement_policy set actual_launch_at = %L::timestamptz,
    early_access_enrollment_days = %s, early_access_claim_cutoff = %L::timestamptz; update private.payment_policy
    set sales_open = %L', p.actual_launch_at, p.early_access_enrollment_days, p.early_access_claim_cutoff,
    (select sales_open from private.payment_policy)) from private.entitlement_policy p`)
  openWindow()
  sql('update private.payment_policy set sales_open = true')
})
after(() => {
  if (!enabled || restorePolicy === null) return
  sql(`${restorePolicy}; delete from private.early_access_claims where key_version = ${KEY_VERSION}`)
})

test('one account tapping Start from four tabs, twice each, at once: exactly one grant and seven replays of it', { skip: !enabled }, async () => {
  const who = student({ sessions: 4 })
  const hashes = hasher()
  let lock
  try {
    lock = await holdLock(`entitlement-account:${who.user}`)
    const racers = who.sessions.flatMap(session => [claimMonth(hashes, who, { session }), claimMonth(hashes, who, { session })])
    await until(() => waitingIn('claim_early_access') >= 8, 'every claim to queue behind the account lock')
    await lock.release(); lock = null
    const results = await allSucceed(racers, 'eight claims of one account')
    assert.deepEqual(tally(results.map(result => result.state)), { 'claimed': 1, 'already-claimed': 7 })
    assert.equal(new Set(results.map(result => result.ends_at)).size, 1, 'every answer names the same end: it is one grant')
    assert.ok(isStoredClose(results[0].ends_at), 'the claim and its seven replays name the stored close')
    assert.equal(endingAtClose([who]), 1, 'and the one grant ends there')
    assert.equal(months([who]), 1)
    assert.equal(sql(`select count(*) from private.early_access_claims where user_id = '${who.user}'`), '1')
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${who.user}'
      and event = 'early-access.claimed'`), '1', 'audited once, never per tap')
  } finally {
    if (lock) await lock.release()
    cleanup(who)
  }
})

test('eight accounts presenting one address at once (spellings of one inbox): exactly one claim between them', { skip: !enabled }, async () => {
  const tag = randomUUID()
  // The application sends the same canonical hashes for every spelling; the accounts' own emails differ.
  const address = `month-alias-${tag}@example.test`
  const people = students(8, { email: (user, index) => `month-alias-${tag}+${index}@example.test` })
  const hashes = hasher()
  let lock
  try {
    lock = await holdLock(`discovery-claim:${sql(`select ${claimHash(address)}`)}`)
    const racers = people.map(who => claimMonth(hashes, who, { email: address }))
    await until(() => waitingIn('claim_early_access') >= 8, 'every claim to queue')
    await lock.release(); lock = null
    const results = await allSucceed(racers, 'eight accounts on one address')
    assert.deepEqual(tally(results.map(result => result.state)), { 'claimed': 1, 'not-available': 7 })
    assert.equal(months(people), 1)
    assert.equal(sql(`select count(*) from private.early_access_claims where claim_hash = ${claimHash(address)}`), '1')
  } finally {
    if (lock) await lock.release()
    cleanup(...people)
  }
})

test(`${CROWD} students claiming at once: every one gets free access to the one end, with no deadlock, well inside the limit`, { skip: !enabled }, async t => {
  const people = students(CROWD)
  const hashes = hasher()
  try {
    const started = Date.now()
    const results = await allSucceed(people.map(who => claimMonth(hashes, who)), `${CROWD} claims at once`)
    const elapsed = Date.now() - started
    assert.deepEqual(tally(results.map(result => result.state)), { claimed: CROWD })
    assert.equal(months(people), CROWD)
    assert.equal(sql(`select count(distinct user_id) from private.early_access_claims where user_id in (${ids(people)})`),
      String(CROWD))
    // Each claim starts when it is decided, one after another, but they all end at one instant: the stored close.
    assert.equal(sql(`select count(distinct ends_at) from public.entitlement_grants where source = 'early_access'
      and user_id in (${ids(people)})`), '1', 'one end for every claim, whichever was decided first')
    assert.equal(endingAtClose(people), CROWD, 'and that end is the stored close')
    // The claims pass one at a time through the claim-keys lock: how long the database took from first to last.
    const inDatabase = Number(sql(`select round(extract(epoch from max(starts_at) - min(starts_at)) * 1000)
      from public.entitlement_grants where source = 'early_access' and user_id in (${ids(people)})`))
    t.diagnostic(`${CROWD} concurrent claims: ${elapsed} ms from first request to last answer, ${inDatabase} ms between the first and last claim starting`)
    assert.ok(elapsed < CROWD_LIMIT_MS, `${CROWD} claims took ${elapsed} ms`)
  } finally {
    cleanup(...people)
  }
})

test('a claim sent while the launch is being recorded waits for it, then ends at the cutoff the launch stored', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let launch
  try {
    sql('update private.entitlement_policy set actual_launch_at = null')
    assert.equal((await claimMonth(hashes, who)).state, 'closed', 'before any launch nothing can be claimed')
    launch = await holdStatement(`set role service_role; select public.admin_activate_public_launch('founder', 'race test')::text`)
    const racer = claimMonth(hashes, who)
    await until(() => waitingIn('claim_early_access') >= 1, 'the claim to queue behind the launch')
    const launched = lastJson(await launch.release()); launch = null
    assert.equal(launched.state, 'launched')
    const claimed = await racer
    assert.equal(claimed.state, 'claimed', 'the claim read the launch the switch committed')
    assert.equal(sql(`select early_access_claim_closes_at = early_access_claim_cutoff
      and '${launched.claim_closes_at}'::timestamptz = early_access_claim_cutoff from private.entitlement_policy`), 't',
      'the launch stored the cutoff as the close')
    assert.ok(isStoredClose(claimed.ends_at), 'and the claim that waited for it ends there')
    assert.equal(months([who]), 1)
  } finally {
    if (launch) await launch.release()
    cleanup(who)
    openWindow()
  }
})

test('a claim that queues while the claim is open and is decided after it closes starts nothing', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let lock
  try {
    lock = await holdLock(`entitlement-account:${who.user}`)
    // The end (the cutoff, which the trigger stores as the close) falls a few seconds from now, on the database clock.
    openWindow({ cutoff: "clock_timestamp() + interval '8 seconds'" })
    const racer = claimMonth(hashes, who)
    await until(() => waitingIn('claim_early_access') >= 1, 'the claim to queue behind the account lock')
    assert.equal(sql('select private.early_access_claim_open(clock_timestamp())'), 't',
      'the claim was sent, and queued, while the claim was still open')
    await until(() => sql('select private.early_access_claim_open(clock_timestamp())') === 'f', 'the window to close')
    await lock.release(); lock = null
    assert.equal((await racer).state, 'closed', 'the window is judged on the database clock after the wait, not when the request began')
    assert.equal(months([who]), 0)
  } finally {
    if (lock) await lock.release()
    cleanup(who)
    openWindow()
  }
})

test('a claim sent while the end is being moved waits for the move, then ends at the new end', { skip: !enabled }, async () => {
  // A stand-in for 20261126100000 on a launched database: one UPDATE of the cutoff, which the trigger copies to the
  // stored close, holds the policy row until it commits while students keep claiming.
  const [earlier, who] = students(2)
  const hashes = hasher()
  let moving
  try {
    assert.equal((await claimMonth(hashes, earlier)).state, 'claimed', 'a claim decided before the move')
    const oldEnd = sql('select early_access_claim_closes_at::text from private.entitlement_policy')
    moving = await holdStatement(`update private.entitlement_policy
      set early_access_claim_cutoff = early_access_claim_cutoff + interval '30 days' where singleton = true`)
    const racer = claimMonth(hashes, who)
    await until(() => waitingIn('claim_early_access') >= 1, 'the claim to queue behind the moving end')
    await moving.release(); moving = null
    const claimed = await racer
    assert.equal(claimed.state, 'claimed', 'the claim read the end the update committed')
    assert.equal(sql(`select early_access_claim_cutoff = '${oldEnd}'::timestamptz + interval '30 days'
      and early_access_claim_closes_at = early_access_claim_cutoff from private.entitlement_policy`), 't',
      'the stored close moved with the cutoff')
    assert.ok(isStoredClose(claimed.ends_at), 'the claim that waited ends at the new end')
    assert.equal(sql(`select ends_at = '${oldEnd}'::timestamptz from public.entitlement_grants
      where user_id = '${earlier.user}' and source = 'early_access'`), 't',
      'a claim decided before the move keeps its end: moving the end rewrites no grant')
  } finally {
    if (moving) await moving.release()
    cleanup(earlier, who)
    openWindow()
  }
})

test('free access can still be claimed fifteen days after the launch: the ten-day window is gone', { skip: !enabled }, async () => {
  const people = students(4)
  const hashes = hasher()
  try {
    openWindow({ launched: "now() - interval '15 days'" })
    assert.equal(sql(`select private.early_access_claim_open(clock_timestamp())
      and actual_launch_at + make_interval(days => early_access_enrollment_days) < clock_timestamp()
      and early_access_claim_closes_at = early_access_claim_cutoff from private.entitlement_policy`), 't',
      'the retired ten days have passed, and the claim stays open until the cutoff')
    // The pages ask about free access only while the plan read's enrollment_closes_at lies ahead, so it names the stored
    // close, not ten days after the launch (the get_my_entitlement step of 20261126100000).
    const plan = lastJson(sql(asStudent(people[0], 'select public.get_my_entitlement()::text')))
    assert.ok(isStoredClose(plan.early_access.enrollment_closes_at), 'the plan read still tells the pages to offer it')
    const results = await allSucceed(people.map(who => claimMonth(hashes, who)), 'claims fifteen days after the launch')
    assert.deepEqual(tally(results.map(result => result.state)), { claimed: people.length })
    assert.equal(endingAtClose(people), people.length, 'each ending at the stored close')
  } finally {
    cleanup(...people)
    openWindow()
  }
})

const orderFor = who => lastJson(sql(`set role service_role; select public.create_payment_order('${who.session}',
  'standard_semester', ${who.revision}, '${randomUUID()}', '/access', 'fake')::text`)).order.id
const fulfilSql = order => `set role service_role; select public.fulfil_payment('${order}', 'fake',
  'ch_month_${order.replaceAll('-', '')}', 'succeeded', 400000, 'NGN', 'card', clock_timestamp(), 'webhook', 'test')::text`
const grantsBySource = who => JSON.parse(sql(`select coalesce(jsonb_object_agg(source, n), '{}') from (
  select source, count(*) as n from public.entitlement_grants where user_id = '${who.user}' group by source) g`))

test('a claim behind a payment being confirmed sees the plan and starts nothing', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let paying
  try {
    paying = await holdStatement(fulfilSql(orderFor(who)))
    const racer = claimMonth(hashes, who)
    await until(() => waitingIn('claim_early_access') >= 1, 'the claim to queue behind the payment')
    assert.equal(lastJson(await paying.release()).outcome, 'fulfilled'); paying = null
    assert.equal((await racer).state, 'not-available', 'a student with a paid plan is not given free access')
    assert.deepEqual(grantsBySource(who), { paid: 1 })
  } finally {
    if (paying) await paying.release()
    cleanup(who)
  }
})

test('a payment confirmed behind a claim in flight lands beside free access, without a deadlock', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let claiming
  try {
    const order = orderFor(who)
    claiming = await holdStatement(claimSql(hashes, who))
    const paying = background(strict(fulfilSql(order))).then(lastJson)
    await until(() => waitingIn('fulfil_payment') >= 1, 'the payment to queue behind the claim')
    assert.equal(lastJson(await claiming.release()).state, 'claimed'); claiming = null
    assert.equal((await paying).outcome, 'fulfilled', 'paying stays possible: the plan is added beside free access')
    assert.deepEqual(grantsBySource(who), { early_access: 1, paid: 1 })
  } finally {
    if (claiming) await claiming.release()
    cleanup(who)
  }
})

test('a free pass sent beside a claim on one account never starts, whichever is decided first', { skip: !enabled }, async () => {
  const people = students(2)
  const hashes = hasher()
  const locks = []
  try {
    for (const who of people) locks.push(await holdLock(`entitlement-account:${who.user}`))
    const racers = people.flatMap(who => [claimMonth(hashes, who), background(strict(passSql(hashes, who))).then(lastJson)])
    await until(() => waitingIn('claim_early_access') + waitingIn('activate_discovery_pass') >= 4, 'both requests of both accounts to queue')
    for (const lock of locks.splice(0)) await lock.release()
    const results = await allSucceed(racers, 'a claim and a pass per account')
    for (const [month, pass] of [results.slice(0, 2), results.slice(2, 4)]) {
      assert.equal(month.state, 'claimed')
      // Decided first, the pass is not offered while the claim is open; decided second, free access is already running.
      assert.match(pass.state, /^(trial-not-offered|early-access-active)$/)
    }
    assert.equal(sql(`select count(*) from public.entitlement_grants where source = 'trial' and user_id in (${ids(people)})`), '0')
    assert.equal(months(people), 2)
  } finally {
    for (const lock of locks) await lock.release()
    cleanup(...people)
  }
})

const scheduleSql = (who, proof) => `set role service_role; select public.schedule_student_deletion('${who.session}', '${proof}')::text`
const proofSession = who => {
  const session = randomUUID()
  sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${who.user}', now(), now())`)
  return session
}

test('a claim behind an account deletion being scheduled starts nothing, without a deadlock', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let deleting
  try {
    deleting = await holdStatement(scheduleSql(who, proofSession(who)))
    const racer = claimMonth(hashes, who)
    await until(() => waitingIn('claim_early_access') >= 1, 'the claim to queue behind the deletion')
    assert.equal(lastJson(await deleting.release()).status, 'scheduled'); deleting = null
    assert.equal((await racer).state, 'signed-out', 'an account scheduled for deletion cannot claim')
    assert.equal(months([who]), 0)
  } finally {
    if (deleting) await deleting.release()
    cleanup(who)
  }
})

test('an account deletion scheduled behind a claim in flight completes, without a deadlock', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let claiming
  try {
    const proof = proofSession(who)
    claiming = await holdStatement(claimSql(hashes, who))
    const deleting = background(strict(scheduleSql(who, proof))).then(lastJson)
    await until(() => waitingIn('schedule_student_deletion') >= 1, 'the deletion to queue behind the claim')
    assert.equal(lastJson(await claiming.release()).state, 'claimed'); claiming = null
    assert.equal((await deleting).status, 'scheduled')
    assert.equal(months([who]), 1, 'the grant stays until the account is purged; its address record outlives it')
  } finally {
    if (claiming) await claiming.release()
    cleanup(who)
  }
})

test('the read for the pages never waits on a claim, the account lock or Auth', { skip: !enabled }, async () => {
  const who = student()
  const hashes = hasher()
  let lock
  let row
  try {
    lock = await holdLock(`entitlement-account:${who.user}`)
    row = await holdStatement(`select id from auth.users where id = '${who.user}' for update`)
    const answer = lastJson(await background(`set statement_timeout = '5s'; set lock_timeout = '1s'; ${canClaimSql(hashes, who)}`))
    assert.equal(answer.eligible, true, 'answered at once, with both locks held elsewhere')
    assert.equal(answer.ends_at, answer.closes_at, 'free access offered until the instant the claim closes')
    assert.ok(isStoredClose(answer.ends_at), 'which is the stored close')
  } finally {
    if (row) await row.release()
    if (lock) await lock.release()
    cleanup(who)
  }
})

test('a mixed load: claims from two tabs each, plan reads, offer reads, pass attempts and operator commands complete with no deadlock', { skip: !enabled }, async () => {
  const people = students(12, { sessions: 2 })
  const hashes = hasher()
  try {
    const sessions = people.flatMap(who => [
      claimMonth(hashes, who, { session: who.sessions[0] }),
      claimMonth(hashes, who, { session: who.sessions[1] }),
      background(strict(asStudent(who, 'select public.get_my_entitlement()::text'))),
      background(strict(canClaimSql(hashes, who))),
      background(strict(passSql(hashes, who))),
    ])
    sessions.push(
      background(strict(`set role service_role; select public.admin_configure_early_access(null, 10, null, 'Ops', 'mixed load')::text`)),
      background(strict('set role service_role; select public.admin_early_access_report()::text')),
      background(strict('set role service_role; select public.admin_discovery_claim_keys()::text')),
      background(strict('set role service_role; select public.purge_discovery_pass_claims()')))
    const answers = await allSucceed(sessions, 'the mixed load')
    // The operator tool no longer sends days, but the database command still takes them (unchanged by 20261126100000).
    assert.equal(lastJson(answers[people.length * 5]).state, 'changed', 'configure with the retired days still lands')
    assert.equal(sql(`select count(*) from (select user_id from public.entitlement_grants where source = 'early_access'
      and user_id in (${ids(people)}) group by user_id having count(*) = 1) one`), '12', 'every account ends with exactly one grant')
    assert.equal(endingAtClose(people), 12, 'each ending at the stored close, which the configure call in the mix left in place')
    assert.equal(sql(`select count(*) from public.entitlement_grants where source = 'trial' and user_id in (${ids(people)})`), '0',
      'and no free pass')
  } finally {
    cleanup(...people)
  }
})
