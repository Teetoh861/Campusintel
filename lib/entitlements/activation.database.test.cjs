// lib/entitlements/activation.database.test.cjs — Real concurrent sessions against a LOCAL database: one account
// activating its Discovery Pass from many sessions at once, one deleted-and-recreated address, the lock-free
// eligibility read and AI admission at the trial cap. The free month's races (Early Access is claimed by the student
// since 20261116120000) are in early-access-claim.database.test.cjs; the pre-launch list and its races are retired.
// Opt in: ENTITLEMENT_DB_TEST=1 [ENTITLEMENT_DB_CONTAINER=supabase_db_<project>]
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.ENTITLEMENT_DB_TEST === '1'
const container = process.env.ENTITLEMENT_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8

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

const asService = call => `set role service_role; select ${call};`
const hash = value => `encode(sha256(convert_to('${value}', 'UTF8')), 'hex')`
const until = async (predicate, label) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
// Sessions blocked on a lock right now, excluding the test's own gate holders.
const waiting = () => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
  and (query like '%public.%' or query like '%private.%' or query like '%auth.users%') and query not like '%pg_stat_activity%'
  and query not like '%entitlement-test-gate%'`))

/** A session holding a private advisory lock until release(). Nothing here depends on how fast docker exec is. */
async function openGate() {
  const key = `entitlement-test-gate-${randomUUID()}`
  const session = background(`select pg_advisory_lock(hashtextextended('${key}', 0)); select pg_sleep(300);`)
    .catch(() => undefined)
  const sleeping = `select count(*) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${key}%'`
  await until(() => sql(sleeping) !== '0', 'the gate')
  return {
    // A statement that blocks until the gate is released.
    wait: `select pg_advisory_lock(hashtextextended('${key}', 0));`,
    release: async () => {
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${key}%'`)
      await session
    },
  }
}

/** Hold one advisory lock the functions take until release(), so every racer provably queues behind it first. */
async function holdLock(key) {
  const gate = await openGate()
  const holder = background(`begin; select pg_advisory_xact_lock(hashtextextended('${key}', 0)); ${gate.wait} commit;`)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%${key}%'`) !== '0', 'the lock holder')
  return { release: async () => { await gate.release(); await holder } }
}

/** Run one statement in a transaction that keeps its locks until release(). */
async function holdStatement(statement) {
  const gate = await openGate()
  const marker = `entitlement-test-gate-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin; ${statement}; ${gate.wait} commit;`)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%${marker}%'`) !== '0', 'the statement holder')
  return { release: async () => { await gate.release(); await holder } }
}

/** Every adversarial session must succeed: a deadlock (40P01) or timeout is a failure, reported with its message. */
async function allSucceed(promises, label) {
  const settled = await Promise.allSettled(promises)
  const failures = settled.filter(result => result.status === 'rejected').map(result => String(result.reason).slice(0, 300))
  assert.deepEqual(failures, [], `${label}: every concurrent session must complete`)
  return settled.map(result => result.value)
}

/** A confirmed student with a live session (and, for the activation races, several sessions of one account), with
 *  Business Administration 200L First Semester set: a pass is offered only to a student whose courses are set. */
function student({ email, sessions = 1, user = randomUUID() } = {}) {
  const ids = Array.from({ length: sessions }, () => randomUUID())
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated',
        '${email ?? `ent-db-${user}@example.test`}', 'x', now(), '{}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at)
      values ${ids.map(id => `('${id}', '${user}', now(), now())`).join(', ')};
    update public.profiles set first_name = 'Ada', department_id = '10000000-0000-4000-8000-000000000002',
      academic_level_id = '20000000-0000-4000-8000-000000000002', academic_period_id = '30000000-0000-4000-8000-000000000001'
      where id = '${user}';`)
  return { user, session: ids[0], sessions: ids }
}

const cleanup = (...people) => sql(`delete from auth.users where id in (${people.map(p => `'${p.user}'`).join(',')})`)
// The keyed claim hashes and key checks the application would send for an address (lib/entitlements/claim-hash.ts);
// plain digests stand in for the HMACs. This suite signs under its own key version so it never collides with the
// application's keys on a shared local database, and presents every other registered version with its registered
// check (as a correctly configured application does), so the ledger's fail-closed integrity rules are satisfied.
const KEY_VERSION = 900
const claimHash = email => hash(`claim-v${KEY_VERSION}:${email.trim().toLowerCase()}`)
const claim = email => {
  const address = email.trim().toLowerCase()
  // Read as postgres here; the activation call itself runs as the service role, which cannot see the registry.
  const others = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('version', key_version, 'check', key_check)), '[]')
    from private.discovery_claim_keys where key_version <> ${KEY_VERSION}`))
  const entries = [`jsonb_build_object('version', ${KEY_VERSION}, 'hash', ${claimHash(email)}, 'check', ${hash(`claim-key-check-v${KEY_VERSION}`)})`,
    ...others.map(k => `jsonb_build_object('version', ${k.version}, 'hash', ${hash(`claim-v${k.version}:${address}`)}, 'check', '${k.check}')`)]
  return `jsonb_build_array(${entries.join(', ')})`
}
const releaseClaim = email => sql(`delete from private.discovery_pass_claims where claim_hash = ${claimHash(email)}`)
const tally = results => results.reduce((counts, state) => ({ ...counts, [state]: (counts[state] ?? 0) + 1 }), {})
const activate = (session, email) => background(asService(
  `public.activate_discovery_pass('${session}', ${claim(email)}) ->> 'state'`))

test('one account tapping activate from eight sessions at once: exactly one pass, seven replays', { skip: !enabled }, async () => {
  const email = `race-${randomUUID()}@example.test`
  const who = student({ email, sessions: CONCURRENCY })
  try {
    const lock = await holdLock(`entitlement-account:${who.user}`)
    const racers = who.sessions.map(session => activate(session, email))
    await until(() => waiting() >= CONCURRENCY, 'every activation to queue on the account')
    await lock.release()
    assert.deepEqual(tally(await Promise.all(racers)), { 'activated': 1, 'already-activated': CONCURRENCY - 1 })
    assert.equal(sql(`select count(*) from public.entitlement_grants where user_id = '${who.user}'`), '1')
    assert.equal(sql(`select count(*) from private.discovery_pass_claims where user_id = '${who.user}'`), '1')
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${who.user}'
      and event = 'discovery.activated'`), '1', 'one activation is audited, never a replay')
  } finally {
    cleanup(who)
    releaseClaim(email)
  }
})

/**
 * Regression (Codex F7): one noisy account behind a campus address never locks the other students behind it out of
 * activation. The account limit holds; the shared address is monitored, not refused.
 */
test('a noisy account and seventy legitimate accounts behind one campus address: only the noisy one is limited', { skip: !enabled }, async () => {
  const origin = hash(`origin-${randomUUID()}`)
  const noisy = hash(`account-${randomUUID()}`)
  const limit = account => asService(`public.consume_discovery_activation_limit(${account}, ${origin}, 5, 900, 60, 900)::text`)
  const noisyAnswers = await allSucceed(Array.from({ length: 100 }, () => background(limit(noisy))), 'the noisy account')
  const admitted = noisyAnswers.map(answer => JSON.parse(answer)).filter(answer => answer.allowed).length
  assert.equal(admitted, 5, 'five of a hundred requests from one account are admitted, whatever their order')
  const students = Array.from({ length: 70 }, () => hash(`account-${randomUUID()}`))
  const hall = await allSucceed(students.map(account => background(limit(account))), 'the lecture hall')
  assert.equal(hall.map(answer => JSON.parse(answer)).filter(answer => answer.allowed).length, 70,
    'seventy other accounts behind the same address are all admitted, beyond the old ceiling of sixty')
  assert.equal(sql(`select count(*) from public.auth_rate_limit_events where action = 'DISCOVERY_ACTIVATION'
    and kind = 'origin' and bucket = ${origin}`), '75', 'the address was charged only for admitted requests')
  assert.equal(sql(`select count(*) from private.entitlement_events where event = 'discovery.origin-notice'
    and detail ->> 'origin' = left(${origin}, 12)`), '1', 'crossing the notice threshold is audited once')
  sql(`delete from public.auth_rate_limit_events where action = 'DISCOVERY_ACTIVATION'
    and bucket in (${[origin, noisy, ...students].join(', ')})`)
})

test('deleting the account and registering the same address again, eight times at once, never yields a second pass', { skip: !enabled }, async () => {
  const email = `again-${randomUUID()}@example.test`
  const first = student({ email })
  let again = null
  try {
    assert.equal(sql(asService(`public.activate_discovery_pass('${first.session}', ${claim(email)}) ->> 'state'`)), 'activated')
    cleanup(first)
    assert.equal(sql(`select (user_id is null)::text from private.discovery_pass_claims
      where claim_hash = ${claimHash(email)}`), 'true', 'the claim outlives the account')
    again = student({ email: email.toUpperCase(), sessions: CONCURRENCY })
    const lock = await holdLock(`entitlement-account:${again.user}`)
    const racers = again.sessions.map(session => activate(session, email.toUpperCase()))
    await until(() => waiting() >= CONCURRENCY, 'every activation to queue on the new account')
    await lock.release()
    assert.deepEqual(tally(await Promise.all(racers)), { 'already-claimed': CONCURRENCY })
    assert.equal(sql(`select count(*) from public.entitlement_grants where user_id = '${again.user}'`), '0')
  } finally {
    if (again) cleanup(again)
    releaseClaim(email)
  }
})

// The eligibility read behind every offer (20261023120000) takes no lock: a page never waits on an activation holding
// the account, nor on Auth holding the account row, and it sees a pass only once the activation commits.
test('the eligibility read never waits on activation or Auth, and turns false once a pass commits', { skip: !enabled }, async () => {
  const email = `ent-eligible-${randomUUID()}@example.test`
  const who = student({ email })
  // A read that had to wait for a lock fails here instead of passing late.
  const eligible = () => sql(`set statement_timeout = '5s'; set lock_timeout = '500ms'; ${asService(
    `public.discovery_pass_eligibility('${who.session}', ${claim(email)}) ->> 'eligible'`)}`)
  try {
    assert.equal(eligible(), 'true', 'a new student is eligible')
    const row = await holdStatement(`select 1 from auth.users where id = '${who.user}' for update`)
    try { assert.equal(eligible(), 'true', 'Auth holding the account row does not block the read') }
    finally { await row.release() }
    const lock = await holdLock(`entitlement-account:${who.user}`)
    const activated = activate(who.session, email)
    try {
      await until(() => waiting() >= 1, 'the activation to queue on the account')
      assert.equal(eligible(), 'true', 'an activation waiting on the account does not block the read, and has not committed')
    } finally { await lock.release() }
    assert.equal(await activated, 'activated')
    assert.equal(eligible(), 'false', 'once the pass commits the student is no longer offered one')
    assert.equal(sql(`select count(*) from private.entitlement_events where user_id = '${who.user}'
      and event <> 'discovery.activated'`), '0', 'the reads wrote no audit row')
  } finally {
    cleanup(who)
    releaseClaim(email)
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// M2: simultaneous trusted imports. M3: one lock order for policy, account, identity group and member rows.
// ---------------------------------------------------------------------------------------------------------------------

test('at one remaining trial unit, concurrent AI admissions start one generation and a duplicate finish charges once', { skip: !enabled }, async () => {
  const email = `ai-${randomUUID()}@example.test`
  const who = student({ email })
  // One of the student's own department courses (Business Administration, 200 Level, First Semester): Campus Bot
  // opens only for a student's own courses, so the race is decided by the pass's last unit and nothing else.
  const course = sql(`select c.id from public.institutional_courses c join public.course_applicability a
    on a.institutional_course_id = c.id where a.department_id = '10000000-0000-4000-8000-000000000002'
    and a.academic_level_id = '20000000-0000-4000-8000-000000000002' and a.academic_period_id = '30000000-0000-4000-8000-000000000001'
    and not c.is_free order by c.id limit 1`)
  assert.match(course, /^[0-9a-f-]{36}$/, 'the student has a department course')
  const documentId = randomUUID()
  try {
    assert.equal(sql(asService(`public.activate_discovery_pass('${who.session}', ${claim(email)}) ->> 'state'`)), 'activated')
    // The document is the upload this Discovery Pass accepted (20261021100000_discovery_pass.sql): only that one can
    // use the pass's AI.
    sql(`update public.entitlement_grants set ai_units = 1 where user_id = '${who.user}';
      insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name, media_type,
        declared_bytes, expires_at, status, source_text, source_sha256, word_count, discovery_grant_id)
        select '${documentId}', '${who.user}', '${course}', '${who.user}/${documentId}', 'notes.txt', 'text/plain', 10,
          now() + interval '1 day', 'ready', 'ready text', ${hash('ready text')}, 2, id
        from public.entitlement_grants where user_id = '${who.user}' and source = 'trial';
      insert into private.discovery_ai_uploads (document_id, grant_id)
        select '${documentId}', id from public.entitlement_grants where user_id = '${who.user}' and source = 'trial';`)
    const lock = await holdLock(`ai-practice-generation:${who.user}`)
    const racers = Array.from({ length: CONCURRENCY }, () => background(asService(
      `public.begin_ai_practice_generation('${who.session}', '${randomUUID()}', '${documentId}',
        array['trial', 'early_access']) ->> 'state'`)))
    await until(() => waiting() >= CONCURRENCY, 'every admission to queue')
    await lock.release()
    assert.deepEqual(tally(await Promise.all(racers)), { started: 1, busy: CONCURRENCY - 1 })
    const generation = sql(`select id from public.ai_practice_generations where user_id = '${who.user}'`)
    const finish = `public.finish_ai_practice_generation('${who.user}', '${generation}', 'failed', 'timeout', null, null) ->> 'state'`
    const finishes = await Promise.all([background(asService(finish)), background(asService(finish))])
    assert.deepEqual(finishes.sort(), ['already-finished', 'finished'])
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id = '${who.user}' and state = 'consumed'`), '0',
      'a failed generation is never charged')
    assert.equal(sql(asService(`public.begin_ai_practice_generation('${who.session}', '${randomUUID()}', '${documentId}',
      array['trial', 'early_access']) ->> 'state'`)), 'started', 'the released unit is still available')
  } finally {
    cleanup(who)
    releaseClaim(email)
  }
})
