// lib/entitlements/activation.database.test.cjs — Real concurrent sessions against a LOCAL database: one phone activating
// from many accounts, replayed codes, racing Early Access enrollment (duplicates, launch versus confirmation, trial
// overlap) and AI admission at the trial cap.
// Needs 20261017100000_trial_entitlements.sql. Opt in: ENTITLEMENT_DB_TEST=1 [ENTITLEMENT_DB_CONTAINER=supabase_db_<project>]
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
// Strict limits for adversarial sessions: a deadlock, hang or long lock wait fails the test instead of stalling it.
const strict = statement => `set statement_timeout = '30s'; set lock_timeout = '30s'; ${statement}`

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

/** A confirmed student with a live session; optionally a pending code for a phone. */
function student({ phone, code, email } = {}) {
  const user = randomUUID()
  const session = randomUUID()
  const challenge = randomUUID()
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated',
        '${email ?? `ent-db-${user}@example.test`}', 'x', now(), '{}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${user}', now(), now());
    ${phone ? `insert into private.trial_otp_challenges (id, user_id, phone_hash, phone_hint, code_hash, delivery, expires_at)
      values ('${challenge}', '${user}', ${hash(phone)}, '123', ${hash(code)}, 'sent', now() + interval '10 minutes');` : ''}`)
  return { user, session, challenge }
}

const cleanup = (...people) => sql(`delete from auth.users where id in (${people.map(p => `'${p.user}'`).join(',')})`)
const tally = results => results.reduce((counts, state) => ({ ...counts, [state]: (counts[state] ?? 0) + 1 }), {})

test('eight accounts racing to activate with one phone: exactly one trial, seven refusals', { skip: !enabled }, async () => {
  const phone = `race-phone-${randomUUID()}`
  const people = Array.from({ length: CONCURRENCY }, () => student({ phone, code: 'same-code' }))
  try {
    const lock = await holdLock(`entitlement-phone:${sql(`select ${hash(phone)}`)}`)
    const racers = people.map(who => background(asService(
      `public.verify_trial_otp('${who.session}', '${who.challenge}', ${hash('same-code')}) ->> 'state'`)))
    await until(() => waiting() >= CONCURRENCY, 'every verification to queue on the phone')
    await lock.release()
    assert.deepEqual(tally(await Promise.all(racers)), { 'activated': 1, 'phone-already-used': CONCURRENCY - 1 })
    assert.equal(sql(`select count(*) from public.entitlement_grants where source = 'trial'
      and user_id in (${people.map(p => `'${p.user}'`).join(',')})`), '1')
    assert.equal(sql(`select count(*) from private.trial_phone_claims where phone_hash = ${hash(phone)}`), '1')
  } finally {
    cleanup(...people)
    sql(`delete from private.trial_phone_claims where phone_hash = ${hash(phone)}`)
  }
})

test('one code submitted eight times at once activates once; every replay is refused', { skip: !enabled }, async () => {
  const phone = `replay-phone-${randomUUID()}`
  const who = student({ phone, code: 'one-code' })
  try {
    const lock = await holdLock(`entitlement-account:${who.user}`)
    const racers = Array.from({ length: CONCURRENCY }, () => background(asService(
      `public.verify_trial_otp('${who.session}', '${who.challenge}', ${hash('one-code')}) ->> 'state'`)))
    await until(() => waiting() >= CONCURRENCY, 'every replay to queue on the account')
    await lock.release()
    assert.deepEqual(tally(await Promise.all(racers)), { 'activated': 1, 'already-used': CONCURRENCY - 1 })
    assert.equal(sql(`select count(*) from public.entitlement_grants where user_id = '${who.user}'`), '1')
  } finally {
    cleanup(who)
    sql(`delete from private.trial_phone_claims where phone_hash = ${hash(phone)}`)
  }
})

/** Run with the actual launch set (or unset), restoring the policy afterwards. */
async function withPolicy(launch, run) {
  const saved = sql(`select coalesce(actual_launch_at::text, '') from private.entitlement_policy`)
  try {
    sql(`update private.entitlement_policy set actual_launch_at = ${launch}`)
    await run()
  } finally {
    sql(`update private.entitlement_policy set actual_launch_at = ${saved === '' ? 'null' : `'${saved}'`}`)
  }
}

const listMember = (email, extra = '') => sql(`insert into private.early_access_members
  (email, full_name, joined_at, source, batch, added_by${extra ? ', duplicate_of' : ''})
  values ('${email}', 'Same Person', now() - interval '10 days', 'import', 'db-test', 'test'${extra ? `, '${extra}'` : ''})
  returning id`)
const earlyGrants = (...people) => sql(`select count(*) from public.entitlement_grants where source = 'early_access'
  and user_id in (${people.map(p => `'${p.user}'`).join(',')})`)

test('eight concurrent reconciliations across one duplicate group enroll exactly one identity, once', { skip: !enabled }, async () => {
  const tag = randomUUID()
  const first = student({ email: `ea-first-${tag}@example.test` })
  const second = student({ email: `ea-second-${tag}@example.test` })
  try {
    await withPolicy('now()', async () => {
      const root = listMember(`ea-first-${tag}@example.test`)
      listMember(`ea-second-${tag}@example.test`, root)
      const lock = await holdLock(`entitlement-early-access:${root}`)
      const racers = Array.from({ length: CONCURRENCY }, (_, index) => background(
        `select private.reconcile_early_access('${(index % 2 === 0 ? first : second).user}', 'db-test') ->> 'status'`))
      await until(() => waiting() >= CONCURRENCY, 'every reconciliation to queue on the group')
      await lock.release()
      const counts = tally(await Promise.all(racers))
      assert.equal(counts.granted, 1, JSON.stringify(counts))
      assert.equal(earlyGrants(first, second), '1')
      // Later reads, sweeps and replays never add or extend.
      const before = sql(`select string_agg(ends_at::text, ',') from public.entitlement_grants where source = 'early_access'
        and user_id in ('${first.user}', '${second.user}')`)
      await Promise.all(Array.from({ length: CONCURRENCY }, (_, index) => background(
        `select private.reconcile_early_access('${(index % 2 === 0 ? first : second).user}', 'db-test')`)))
      assert.equal(earlyGrants(first, second), '1')
      assert.equal(sql(`select string_agg(ends_at::text, ',') from public.entitlement_grants where source = 'early_access'
        and user_id in ('${first.user}', '${second.user}')`), before)
    })
  } finally {
    cleanup(first, second)
    sql(`delete from private.early_access_members where email like 'ea-%-${tag}@example.test'`)
  }
})

test('a confirmation in flight when the founder activates launch is enrolled, never missed or deadlocked', { skip: !enabled }, async () => {
  for (const order of ['confirmation-first', 'launch-first']) {
    const tag = randomUUID()
    const who = student({ email: `ea-race-${tag}@example.test` })
    sql(`update auth.users set email_confirmed_at = null where id = '${who.user}'`)
    try {
      await withPolicy('null', async () => {
        listMember(`ea-race-${tag}@example.test`)
        // The first transaction does its work, then holds its locks on a gate until the second is blocked on it.
        const gate = await openGate()
        const confirm = `update auth.users set email_confirmed_at = now() where id = '${who.user}';`
        const launch = `select public.admin_activate_public_launch('db-test', 'race probe');`
        const [firstWork, secondWork] = order === 'confirmation-first' ? [confirm, launch] : [launch, confirm]
        const first = background(`begin; ${firstWork} ${gate.wait} commit;`)
        await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
          and query like '%${firstWork.slice(0, 40).replace(/'/g, "''")}%'`) !== '0', 'the first transaction at the gate')
        const second = background(secondWork)
        await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
          and query = '${secondWork.replace(/'/g, "''")}'`) !== '0', 'the second transaction to block on the first')
        await gate.release()
        await Promise.all([first, second])
        assert.equal(earlyGrants(who), '1', `${order}: the account is enrolled exactly once`)
        assert.equal(sql(`select (g.starts_at >= p.actual_launch_at)::text from public.entitlement_grants g,
          private.entitlement_policy p where g.user_id = '${who.user}' and g.source = 'early_access'`), 'true',
          `${order}: the month never starts before the actual launch`)
      })
    } finally {
      cleanup(who)
      sql(`delete from private.early_access_members where email = 'ea-race-${tag}@example.test'`)
    }
  }
})

test('trial verification racing Early Access enrollment never leaves a trial started during active Early Access', { skip: !enabled }, async () => {
  const tag = randomUUID()
  const phone = `overlap-phone-${tag}`
  const who = student({ phone, code: 'overlap-code', email: `ea-overlap-${tag}@example.test` })
  try {
    await withPolicy('now()', async () => {
      listMember(`ea-overlap-${tag}@example.test`)
      const lock = await holdLock(`entitlement-account:${who.user}`)
      const enroll = background(`select private.reconcile_early_access('${who.user}', 'db-test') ->> 'status'`)
      const verify = background(asService(`public.verify_trial_otp('${who.session}', '${who.challenge}',
        ${hash('overlap-code')}) ->> 'state'`))
      await until(() => waiting() >= 2, 'both to queue on the account')
      await lock.release()
      const [enrolled, verified] = await Promise.all([enroll, verify])
      assert.equal(enrolled, 'granted')
      const trial = sql(`select count(*) from public.entitlement_grants where user_id = '${who.user}' and source = 'trial'`)
      if (verified === 'early-access-active') assert.equal(trial, '0', 'refused: nothing consumed')
      else {
        assert.equal(verified, 'activated')
        // Both grants are written while holding the account lock, so the audit sequence is the lock order.
        assert.equal(sql(`select (min(id) filter (where event = 'trial.activated')
          < min(id) filter (where event = 'early-access.granted'))::text
          from private.entitlement_events where user_id = '${who.user}'`),
          'true', 'a trial that won the race was activated before Early Access, never during it')
      }
    })
  } finally {
    cleanup(who)
    sql(`delete from private.early_access_members where email = 'ea-overlap-${tag}@example.test';
      delete from private.trial_phone_claims where phone_hash = ${hash(phone)}`)
  }
})

// ---------------------------------------------------------------------------------------------------------------------
// M2: simultaneous trusted imports. M3: one lock order for policy, account, identity group and member rows.
// ---------------------------------------------------------------------------------------------------------------------

const importMember = (email, phone, extra = '') => strict(asService(`public.admin_add_early_access_member('${email}',
  'Same Person', ${phone === null ? 'null' : hash(phone)}, now() - interval '10 days', 'import', 'db-race', 'db-test')${extra}`))
const groupRoots = emails => sql(`select count(distinct coalesce(duplicate_of, id)) from private.early_access_members
  where email in (${emails.map(email => `'${email}'`).join(',')})`)

test('M2: two simultaneous imports of one phone under different emails form one group and grant one month', { skip: !enabled }, async () => {
  const tag = randomUUID()
  const emails = [`ea-imp1-${tag}@example.test`, `ea-imp2-${tag}@example.test`]
  const people = emails.map(email => student({ email }))
  try {
    await withPolicy('now()', async () => {
      // Both imports start while the policy row is held, so neither can see the other's member row yet.
      const hold = await holdStatement('select 1 from private.entitlement_policy for update')
      const imports = emails.map(email => background(importMember(email, `import-phone-${tag}`, ` ->> 'state'`)))
      await until(() => waiting() >= 2, 'both imports to queue')
      await hold.release()
      const states = await allSucceed(imports, 'M2 imports')
      assert.deepEqual(states.sort(), ['added', 'added-duplicate'])
      assert.equal(groupRoots(emails), '1', 'one authoritative duplicate group')
      assert.equal(earlyGrants(...people), '1', 'one Early Access benefit for the person')
      // Later re-imports change nothing.
      for (const email of emails) assert.equal(sql(importMember(email, `import-phone-${tag}`, ` ->> 'state'`)), 'existing')
      assert.equal(earlyGrants(...people), '1')
      assert.equal(groupRoots(emails), '1')
    })
  } finally {
    cleanup(...people)
    sql(`delete from private.early_access_members where email like 'ea-imp%-${tag}@example.test'`)
  }
})

test('M2: two simultaneous imports of one email keep one row and report the second as existing', { skip: !enabled }, async () => {
  const email = `ea-same-${randomUUID()}@example.test`
  try {
    const hold = await holdStatement('select 1 from private.entitlement_policy for update')
    const imports = [1, 2].map(n => background(importMember(email, `same-email-phone-${n}`, ` ->> 'state'`)))
    await until(() => waiting() >= 2, 'both imports to queue')
    await hold.release()
    assert.deepEqual((await allSucceed(imports, 'M2 same email')).sort(), ['added', 'existing'])
    assert.equal(sql(`select count(*) from private.early_access_members where email = '${email}'`), '1')
  } finally {
    sql(`delete from private.early_access_members where email = '${email}'`)
  }
})

/** A listed account whose member row is a duplicate of an unclaimed root with no account of its own. */
function duplicateOfUnclaimedRoot(tag) {
  const root = sql(`insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
    values ('ea-root-${tag}@example.test', 'Root', now() - interval '20 days', 'import', 'db-test', 'test') returning id`)
  const email = `ea-member-${tag}@example.test`
  sql(`insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by, duplicate_of)
    values ('${email}', 'Member', now() - interval '10 days', 'import', 'db-test', 'test', '${root}')`)
  return { root, email, account: student({ email }) }
}

for (const action of ['clear-duplicate', 'include', 'mark-duplicate']) {
  test(`M3: automatic reconciliation racing ${action} cannot deadlock or double-grant`, { skip: !enabled }, async () => {
    const tag = randomUUID()
    const { root, email, account } = duplicateOfUnclaimedRoot(tag)
    const other = action === 'mark-duplicate' ? sql(`insert into private.early_access_members (email, full_name, joined_at,
      source, batch, added_by) values ('ea-other-${tag}@example.test', 'Other', now() - interval '30 days', 'import', 'db-test',
      'test') returning id`) : null
    try {
      await withPolicy('now()', async () => {
        // Reconciliation takes the account lock, then queues on the group lock held here.
        const group = await holdLock(`entitlement-early-access:${root}`)
        const reconcile = background(strict(`select private.reconcile_early_access('${account.user}', 'db-test') ->> 'status'`))
        await until(() => waiting() >= 1, 'reconciliation to hold the account and queue on the group')
        // The operator change queues too; before the fix it took the member row first and then asked for the account.
        const change = background(strict(asService(`public.admin_change_early_access_member('${email}', '${action}',
          ${other ? `'ea-other-${tag}@example.test'` : 'null'}, 'db-test', 'adversarial lock order') ->> 'state'`)))
        // clear-duplicate and include re-enroll (and so need the account); mark-duplicate may finish without waiting.
        let changeSettled = false
        change.then(() => { changeSettled = true }, () => { changeSettled = true })
        await until(() => changeSettled || waiting() >= 2, 'the operator change to queue or finish')
        await group.release()
        const [enrolled, changed] = await allSucceed([reconcile, change], `M3 ${action}`)
        assert.equal(enrolled, 'granted')
        assert.equal(changed, 'changed')
        assert.equal(earlyGrants(account), '1', 'exactly one grant')
      })
    } finally {
      cleanup(account)
      sql(`delete from private.early_access_members where email like 'ea-%-${tag}@example.test' and duplicate_of is not null;
        delete from private.early_access_members where email like 'ea-%-${tag}@example.test'`)
    }
  })
}

test('M3: a recovery sweep visiting A, C, B racing clear-duplicate(B) cannot deadlock or miss an account', { skip: !enabled }, async () => {
  const tag = randomUUID()
  // Join order fixes the sweep's visiting order: A, then C, then B. A and B share A's group.
  const [a, c, b] = ['a', 'c', 'b'].map(letter => ({ letter, email: `ea-sw-${letter}-${tag}@example.test` }))
  for (const person of [a, c, b]) person.account = student({ email: person.email })
  try {
    await withPolicy('now()', async () => {
      const root = sql(`insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
        values ('${a.email}', 'A', now() - interval '30 days', 'import', 'db-test', 'test') returning id`)
      sql(`insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
        values ('${c.email}', 'C', now() - interval '20 days', 'import', 'db-test', 'test');
        insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by, duplicate_of)
        values ('${b.email}', 'B', now() - interval '10 days', 'import', 'db-test', 'test', '${root}')`)
      // Stall the sweep at C (after it has granted A and taken A's group in the old design).
      const atC = await holdLock(`entitlement-account:${c.account.user}`)
      const sweep = background(strict(asService(`public.admin_reconcile_early_access('db-test', 'forced interleaving')
        ->> 'granted'`)))
      await until(() => waiting() >= 1, 'the sweep to stall')
      // The operator separates B: it takes B's account, then asks for the group.
      const clear = background(strict(asService(`public.admin_change_early_access_member('${b.email}', 'clear-duplicate',
        null, 'db-test', 'forced interleaving') ->> 'state'`)))
      let clearSettled = false
      clear.then(() => { clearSettled = true }, () => { clearSettled = true })
      await until(() => clearSettled || waiting() >= 2, 'clear-duplicate to queue or finish')
      await atC.release()
      await allSucceed([sweep, clear], 'sweep A, C, B versus clear-duplicate(B)')
      // B was separated into its own identity, so all three are enrolled exactly once and nothing is left to do.
      for (const person of [a, c, b]) assert.equal(earlyGrants(person.account), '1', `${person.letter} enrolled once`)
      assert.equal(sql(asService(`public.admin_reconcile_early_access('db-test', 'missed-account probe') ->> 'granted'`)), '0')
    })
  } finally {
    cleanup(a.account, c.account, b.account)
    sql(`delete from private.early_access_members where email like 'ea-sw-%-${tag}@example.test' and duplicate_of is not null;
      delete from private.early_access_members where email like 'ea-sw-%-${tag}@example.test'`)
  }
})

test('M3-A: an account that appears mid-import is deferred, never locked after the import\'s identity locks', { skip: !enabled }, async () => {
  const tag = randomUUID()
  const email = `ea-late-${tag}@example.test`
  const phone = `late-phone-${tag}`
  let account = null
  try {
    await withPolicy('now()', async () => {
      // The first import locks this email's accounts (none yet) and the email, then queues on its phone lock.
      const phoneLock = await holdLock(`entitlement-early-access-phone:${createHash('sha256').update(phone).digest('hex')}`)
      const first = background(importMember(email, phone, ` ->> 'enrollment'`))
      await until(() => waiting() >= 1, 'the first import to hold the email lock')
      // A confirmed account with that email appears; its own confirmation finds no list row yet.
      account = student({ email })
      // A second import of the email locks the new account, then queues on the email lock the first holds.
      const second = background(importMember(email, null, ` ->> 'state'`))
      await until(() => waiting() >= 2, 'the second import to lock the account and queue on the email')
      // Before the fix the first import now asked for that account lock: a cycle, and one import died in a deadlock.
      await phoneLock.release()
      const [enrollment, state] = await allSucceed([first, second], 'imports racing a new account')
      assert.equal(enrollment, 'deferred', 'the account the import did not lock first is left to a fresh transaction')
      assert.equal(state, 'existing')
      assert.equal(earlyGrants(account), '0')
      // The fresh transaction the operator tool runs next enrolls it exactly once.
      sql(asService(`public.admin_reconcile_early_access('db-test', 'deferred import enrollment')`))
      assert.equal(earlyGrants(account), '1')
    })
  } finally {
    if (account) cleanup(account)
    sql(`delete from private.early_access_members where email = '${email}'`)
  }
})

test('M3-A: an account that appears mid-member-change is deferred, never locked after the group locks', { skip: !enabled }, async () => {
  const tag = randomUUID()
  const email = `ea-mc-${tag}@example.test`
  let account = null
  try {
    await withPolicy('now()', async () => {
      // An excluded member with no account yet.
      sql(`insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by, excluded_at,
        excluded_reason) values ('${email}', 'B', now() - interval '10 days', 'import', 'db-test', 'test', now(), 'probe')`)
      // The first include locks the member's accounts (none), the regroup and group locks, then queues on the member row.
      const row = await holdStatement(`select 1 from private.early_access_members where email = '${email}' for update`)
      const first = background(strict(asService(`public.admin_change_early_access_member('${email}', 'include', null,
        'db-test', 'late account probe') ->> 'enrollment'`)))
      await until(() => waiting() >= 1, 'the first change to hold the group lock')
      // A confirmed account with the email appears (still excluded, so its own confirmation enrolls nothing).
      account = student({ email })
      // A second change locks that account, then queues on the group lock the first holds.
      const second = background(strict(asService(`public.admin_change_early_access_member('${email}', 'include', null,
        'db-test', 'late account probe') ->> 'enrollment'`)))
      await until(() => waiting() >= 2, 'the second change to lock the account and queue on the group')
      // Before the fix the first change now asked for that account lock: a cycle, and one change died in a deadlock.
      await row.release()
      const [deferred, enrolled] = await allSucceed([first, second], 'member changes racing a new account')
      assert.equal(deferred, 'deferred', 'the account the first change did not lock first is left to a fresh transaction')
      assert.equal(enrolled, 'granted', 'the second change, which locked the account first, enrolls it')
      assert.equal(earlyGrants(account), '1')
    })
  } finally {
    if (account) cleanup(account)
    sql(`delete from private.early_access_members where email = '${email}'`)
  }
})

test('M2: a merge queued behind the duplicate\'s own enrollment still ends with one active month', { skip: !enabled }, async () => {
  const tag = randomUUID()
  const first = { email: `ea-mk-${tag}@example.test` }
  const second = { email: `ea-ml-${tag}@example.test` }
  first.account = student({ email: first.email })
  second.account = student({ email: second.email })
  try {
    await withPolicy('now()', async () => {
      assert.equal(sql(importMember(first.email, null, ` ->> 'enrollment'`)), 'granted')
      const root = sql(`insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
        values ('${second.email}', 'Second', now() - interval '5 days', 'import', 'db-test', 'test') returning id`)
      // The duplicate's enrollment waits on its own group; the merge then queues behind it.
      const group = await holdLock(`entitlement-early-access:${root}`)
      const enroll = background(strict(`select private.reconcile_early_access('${second.account.user}', 'db-test') ->> 'status'`))
      await until(() => waiting() >= 1, 'the enrollment to queue')
      const merge = background(strict(asService(`public.admin_change_early_access_member('${second.email}', 'mark-duplicate',
        '${first.email}', 'db-test', 'same student') ->> 'duplicate_grants_revoked'`)))
      await until(() => waiting() >= 2, 'the merge to queue')
      await group.release()
      const [enrolled, revoked] = await allSucceed([enroll, merge], 'merge versus enrollment')
      assert.equal(enrolled, 'granted', 'the duplicate was enrolled first')
      assert.equal(revoked, '1', 'and the merge then ended that second month')
      assert.equal(sql(`select count(*) from public.entitlement_grants where source = 'early_access' and revoked_at is null
        and user_id in ('${first.account.user}', '${second.account.user}')`), '1')
    })
  } finally {
    cleanup(first.account, second.account)
    sql(`delete from private.early_access_members where email in ('${first.email}', '${second.email}') and duplicate_of is not null;
      delete from private.early_access_members where email in ('${first.email}', '${second.email}')`)
  }
})

/** Seeded pseudo-random choice so a failing interleaving can be replayed. */
function seeded(seed) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32 }
}

/**
 * Adversarial mix of every Early Access path at once. Afterwards: no session failed (no 40P01, no timeout), every grant
 * matches exactly one used list entry, no identity group holds more than one active Early Access grant (a merge keeps
 * the canonical grant and revokes the rest), and a recovery sweep finds nobody left to enroll. With `regroup`, operator
 * merges, separations and grant restores join the mix and the same invariant must still hold.
 */
async function stress({ seed, launchDuringRun, regroup }) {
  const random = seeded(seed)
  const tag = randomUUID().slice(0, 8)
  const pick = list => list[Math.floor(random() * list.length)]
  const accounts = Array.from({ length: 6 }, (_, n) => student({ email: `ea-st${n}-${tag}@example.test` }))
  const emails = accounts.map((_, n) => `ea-st${n}-${tag}@example.test`)
  // Two accounts start unconfirmed and are confirmed during the run.
  sql(`update auth.users set email_confirmed_at = null where id in ('${accounts[4].user}', '${accounts[5].user}')`)
  // Half the list exists before the run, in two shared-phone groups; the rest is imported during it.
  for (const n of [0, 1, 2]) sql(importMember(emails[n], `st-phone-${tag}-${n % 2}`))
  const operations = []
  for (let k = 0; k < 24; k += 1) {
    const n = Math.floor(random() * accounts.length)
    const kind = pick(['reconcile', 'import', 'include', 'exclude', 'sweep', 'confirm',
      ...(regroup ? ['clear-duplicate', 'mark-duplicate', 'restore'] : [])])
    if (kind === 'reconcile') operations.push(strict(`select private.reconcile_early_access('${accounts[n].user}', 'db-test')`))
    if (kind === 'import') operations.push(importMember(emails[n], `st-phone-${tag}-${n % 2}`))
    if (['clear-duplicate', 'include', 'exclude'].includes(kind)) operations.push(strict(asService(
      `public.admin_change_early_access_member('${emails[n]}', '${kind}', null, 'db-test', 'stress')`)))
    if (kind === 'mark-duplicate') operations.push(strict(asService(`public.admin_change_early_access_member('${emails[n]}',
      'mark-duplicate', '${pick(emails)}', 'db-test', 'stress')`)))
    if (kind === 'restore') operations.push(strict(`select public.admin_change_grant((select g.id from public.entitlement_grants g
      join auth.users u on u.id = g.user_id where u.email = '${emails[n]}' and g.source = 'early_access'), 'restore', null, null,
      'db-test', 'stress restore')`))
    if (kind === 'sweep') operations.push(strict(asService(`public.admin_reconcile_early_access('db-test', 'stress sweep')`)))
    if (kind === 'confirm') operations.push(strict(`update auth.users set email_confirmed_at = now()
      where id = '${accounts[4 + (n % 2)].user}' and email_confirmed_at is null`))
  }
  if (launchDuringRun) operations.splice(Math.floor(operations.length / 2), 0,
    strict(asService(`public.admin_activate_public_launch('db-test', 'stress launch')`)))
  try {
    const hold = await holdStatement('select 1 from private.entitlement_policy for update')
    const sessions = operations.map(background)
    // Every operation is either blocked behind the held policy row or already finished (not every path needs it).
    let settled = 0
    for (const session of sessions) session.then(() => { settled += 1 }, () => { settled += 1 })
    await until(() => settled + waiting() >= operations.length, 'every operation to block or finish')
    await hold.release()
    await allSucceed(sessions, `stress seed ${seed}`)
    // Each grant is attributed to its own list entry; the group is that entry's current group.
    const perGroup = sql(`select coalesce(max(grants), 0) from (select coalesce(m.duplicate_of, m.id) as root, count(g.id) as grants
      from public.entitlement_grants g join private.early_access_members m on m.id::text = g.reference->>'member_id'
      where g.source = 'early_access' and g.revoked_at is null and m.email like 'ea-st%-${tag}@example.test'
      group by 1) groups`)
    assert.ok(Number(perGroup) <= 1, `seed ${seed}: an identity group holds at most one active Early Access grant`)
    assert.equal(sql(`select count(*) from public.entitlement_grants g join auth.users u on u.id = g.user_id
      where g.source = 'early_access' and u.email like 'ea-st%-${tag}@example.test'`) ,
      sql(`select count(*) from private.early_access_members where email like 'ea-st%-${tag}@example.test'
        and claimed_by is not null`), `seed ${seed}: every grant matches exactly one used list entry`)
    assert.equal(sql(asService(`public.admin_reconcile_early_access('db-test', 'missed-account probe') ->> 'granted'`)), '0',
      `seed ${seed}: nobody eligible was missed`)
  } finally {
    cleanup(...accounts)
    sql(`delete from private.early_access_members where email like 'ea-st%-${tag}@example.test' and duplicate_of is not null;
      delete from private.early_access_members where email like 'ea-st%-${tag}@example.test'`)
  }
}

test('M2/M3: concurrent imports, enrollment, confirmations and sweeps keep one month per duplicate group', { skip: !enabled }, async () => {
  for (const seed of [11, 23, 47]) await withPolicy('now()', () => stress({ seed, launchDuringRun: false, regroup: false }))
})

test('M2/M3: with operator merges, separations and restores in the mix: one month per identity, no deadlock, nobody missed', { skip: !enabled }, async () => {
  for (const seed of [11, 23, 47]) await withPolicy('now()', () => stress({ seed, launchDuringRun: false, regroup: true }))
})

test('M3: the full mix racing the founder\'s launch activation never deadlocks or misses an account', { skip: !enabled }, async () => {
  for (const seed of [5, 31]) await withPolicy('null', () => stress({ seed, launchDuringRun: true, regroup: false }))
  for (const seed of [5, 31]) await withPolicy('null', () => stress({ seed, launchDuringRun: true, regroup: true }))
})

test('at one remaining trial unit, concurrent AI admissions start one generation and a duplicate finish charges once', { skip: !enabled }, async () => {
  const phone = `ai-phone-${randomUUID()}`
  const who = student({ phone, code: 'ai-code' })
  const course = sql('select id from public.institutional_courses order by id limit 1')
  const documentId = randomUUID()
  try {
    assert.equal(sql(asService(`public.verify_trial_otp('${who.session}', '${who.challenge}', ${hash('ai-code')}) ->> 'state'`)),
      'activated')
    sql(`update public.entitlement_grants set ai_units = 1 where user_id = '${who.user}';
      insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name, media_type,
        declared_bytes, expires_at, status, source_text, source_sha256, word_count)
        values ('${documentId}', '${who.user}', '${course}', '${who.user}/${documentId}', 'notes.txt', 'text/plain', 10,
          now() + interval '1 day', 'ready', 'ready text', ${hash('ready text')}, 2);`)
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
    sql(`delete from private.trial_phone_claims where phone_hash = ${hash(phone)}`)
  }
})
