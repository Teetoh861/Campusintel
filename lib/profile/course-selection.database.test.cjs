// lib/profile/course-selection.database.test.cjs — Real concurrent sessions against a LOCAL database for the course
// lock (20261026100000_course_selection_lock.sql): a selection change racing a bound pass activation in both orders,
// two tabs, a grant committing around a save, an operator change against a stale tab, a calendar extension committed
// while a save waits, a mixed load checked for deadlocks, and the migration's backfill locking existing holders.
// Opt in: COURSE_SELECTION_DB_TEST=1 [COURSE_SELECTION_DB_CONTAINER=supabase_db_<project>]
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.COURSE_SELECTION_DB_TEST === '1'
const container = process.env.COURSE_SELECTION_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1',
  '-v', 'VERBOSITY=verbose']
const MIGRATION = readFileSync('supabase/migrations/20261026100000_course_selection_lock.sql', 'utf8')
const BUA = '10000000-0000-4000-8000-000000000002'
const ACCOUNTING = '10000000-0000-4000-8000-000000000001'
const FINANCE = '10000000-0000-4000-8000-000000000008'
const L200 = '20000000-0000-4000-8000-000000000002'
const L300 = '20000000-0000-4000-8000-000000000003'
const FIRST = '30000000-0000-4000-8000-000000000001'

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
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
// Sessions blocked on a lock right now, excluding the test's own gate holders.
const waiting = () => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
  and query not like '%pg_stat_activity%' and query not like '%course-lock-test-gate%'`))
// Strict limits for adversarial sessions: a deadlock, hang or long lock wait fails the test instead of stalling it.
const strict = statement => `set statement_timeout = '30s'; set lock_timeout = '30s'; ${statement}`

/** A session holding a private advisory lock until release(). */
async function openGate() {
  const key = `course-lock-test-gate-${randomUUID()}`
  const session = background(`select pg_advisory_lock(hashtextextended('${key}', 0)); select pg_sleep(300);`)
    .catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${key}%'`) !== '0', 'the gate')
  return {
    wait: `reset role; select pg_advisory_lock(hashtextextended('${key}', 0));`,
    release: async () => {
      sql(`select pg_terminate_backend(pid) from pg_stat_activity where wait_event = 'PgSleep' and query like '%${key}%'`)
      await session
    },
  }
}

/** Run statements in a transaction that keeps its locks until release(); resolves to the statements' output. */
async function holdStatement(statement) {
  const gate = await openGate()
  const marker = `course-lock-test-gate-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin; ${statement}; ${gate.wait} commit;`)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and query like '%${marker}%'`) !== '0', 'the statement holder')
  return { release: async () => { await gate.release(); return holder } }
}

/** A confirmed student with a live session, Business Administration 200L First Semester unless told otherwise. */
function student({ department = BUA, level = L200, select = true } = {}) {
  const user = randomUUID()
  const session = randomUUID()
  const email = `lock-db-${user}@example.test`
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated', '${email}', 'x',
        now(), '{}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${user}', now(), now());
    ${select ? `update public.profiles set first_name = 'Ada', department_id = '${department}',
      academic_level_id = '${level}', academic_period_id = '${FIRST}' where id = '${user}';` : ''}`)
  return { user, session, email }
}
const cleanup = (...people) => sql(`delete from auth.users where id in (${people.map(p => `'${p.user}'`).join(',')})`)
const asStudent = (who, statement) => `set role authenticated; set request.jwt.claims = '${JSON.stringify(
  { sub: who.user, role: 'authenticated', session_id: who.session })}'; ${statement}`
const save = (who, department, revision) => asStudent(who, `update public.profiles set department_id = '${department}'
  where id = '${who.user}' and revision = ${revision} returning revision`)
const revision = who => Number(sql(`select revision from public.profiles where id = '${who.user}'`))
const state = who => sql(`select private.course_selection_state('${who.user}')->>'state'`)
const departmentOf = who => sql(`select department_id from public.profiles where id = '${who.user}'`)
const grants = who => Number(sql(`select count(*) from public.entitlement_grants where user_id = '${who.user}'`))

// The keyed claim the application would send for an address (lib/entitlements/claim-hash.ts); plain digests stand in
// for the HMACs, under this suite's own key version, presenting every other registered version with its check.
const KEY_VERSION = 901
const hash = value => `encode(sha256(convert_to('${value}', 'UTF8')), 'hex')`
const claim = email => {
  const others = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('version', key_version, 'check', key_check)),
    '[]') from private.discovery_claim_keys where key_version <> ${KEY_VERSION}`))
  const entries = [`jsonb_build_object('version', ${KEY_VERSION}, 'hash', ${hash(`claim-v${KEY_VERSION}:${email}`)},
    'check', ${hash(`claim-key-check-v${KEY_VERSION}`)})`,
  ...others.map(k => `jsonb_build_object('version', ${k.version}, 'hash', ${hash(`claim-v${k.version}:${email}`)},
    'check', '${k.check}')`)]
  return `jsonb_build_array(${entries.join(', ')})`
}
const activate = (who, seen) => `set role service_role;
  select public.activate_discovery_pass('${who.session}', ${claim(who.email)}, ${seen}) ->> 'state'`
const releaseClaims = (...people) => sql(`delete from private.discovery_pass_claims where user_id in (${
  people.map(p => `'${p.user}'`).join(',')})`)

/** One unclaimed pre-launch member on an open enrollment window, restored after this test. */
function earlyAccessMember(who) {
  const restore = sql(`select format('update private.entitlement_policy set actual_launch_at = %L::timestamptz,
    early_access_enrollment_days = %s', actual_launch_at, early_access_enrollment_days) from private.entitlement_policy`)
  sql(`update private.entitlement_policy set actual_launch_at = now() - interval '1 minute', early_access_enrollment_days = 28;
    insert into private.early_access_members (email, full_name, joined_at, source, batch, added_by)
      values ('${who.email}', 'Ada', now() - interval '1 day', 'manual', 'course-lock-race', 'test')`)
  assert.equal(sql(`select count(*) from private.early_access_sweep_candidates() where account_id = '${who.user}'`), '1')
  return { cleanup: () => sql(`delete from private.early_access_members where email = '${who.email}'; ${restore}`) }
}

test('an Early Access sweep defers a held profile, then binds the committed selection on retry', { skip: !enabled }, async () => {
  const who = student()
  const member = earlyAccessMember(who)
  let rowLock
  let saving
  try {
    const seen = revision(who)
    rowLock = await holdStatement(`select id from public.profiles where id = '${who.user}' for update`)
    saving = background(strict(save(who, ACCOUNTING, seen))).then(() => 'saved', error => String(error))
    await until(() => waiting() >= 1, 'the selection change to queue before the sweep')
    const sweep = JSON.parse(await background(strict(`set role service_role;
      select public.admin_reconcile_early_access('Ops', 'course lock race', 200)`)))
    assert.equal(sweep.granted, 0, 'enrollment never waits for a held profile after locking Auth')
    assert.equal(sweep.deferred, 1)
    assert.equal(grants(who), 0, 'a deferred enrollment issues nothing')
    await rowLock.release(); rowLock = null
    assert.equal(await saving, 'saved', 'the selection commits before any enrollment')
    assert.equal(departmentOf(who), ACCOUNTING)
    assert.equal(revision(who), seen + 1)
    assert.equal(await background(strict(`set role service_role;
      select public.admin_reconcile_early_access('Ops', 'retry after profile save', 200)->>'granted'`)), '1')
    assert.equal(sql(`select course_department_id from public.entitlement_grants where user_id='${who.user}'`), ACCOUNTING)
    assert.equal(state(who), 'locked')
  } finally {
    if (rowLock) await rowLock.release()
    if (saving) await saving
    member.cleanup()
    cleanup(who)
  }
})

test('a pass activated while the form saves: the activation holds the courses and the save is refused', { skip: !enabled }, async () => {
  const who = student()
  try {
    const seen = revision(who)
    const pass = await holdStatement(activate(who, seen))
    const saving = background(save(who, ACCOUNTING, seen)).then(() => 'saved', error => String(error))
    await until(() => waiting() >= 1, 'the save to queue behind the activation')
    assert.equal(await pass.release(), 'activated')
    assert.match(await saving, /CI423/, 'the save waits for the pass and is then refused by the lock')
    assert.equal(departmentOf(who), BUA, 'the pass locked exactly the courses on screen')
    assert.equal(state(who), 'locked')
    assert.equal(grants(who), 1)
  } finally { releaseClaims(who); cleanup(who) }
})

test('a save that lands first: the pass offered against the old courses is refused and starts nothing', { skip: !enabled }, async () => {
  const who = student()
  try {
    const seen = revision(who)
    const saving = await holdStatement(save(who, ACCOUNTING, seen))
    const pass = background(activate(who, seen))
    await until(() => waiting() >= 1, 'the activation to queue behind the save')
    assert.match(await saving.release(), new RegExp(`^${seen + 1}`))
    assert.equal(await pass, 'selection-changed', 'the pass never locks courses the student did not see')
    assert.equal(grants(who), 0)
    assert.equal(departmentOf(who), ACCOUNTING)
    assert.equal(state(who), 'open')
    // Offered again with the new courses, it starts and locks them.
    assert.equal(sql(activate(who, revision(who))), 'activated')
    assert.equal(state(who), 'locked')
  } finally { releaseClaims(who); cleanup(who) }
})

test('two tabs saving at once: one wins, the other is a conflict, and the row is the winner', { skip: !enabled }, async () => {
  const who = student()
  try {
    const seen = revision(who)
    const row = await holdStatement(`select 1 from public.profiles where id = '${who.user}' for update`)
    const tabs = [background(save(who, ACCOUNTING, seen)), background(save(who, FINANCE, seen))]
    await until(() => waiting() >= 2, 'both tabs to queue')
    await row.release()
    const results = await Promise.all(tabs)
    assert.deepEqual(results.map(result => result === '' ? 'conflict' : 'saved').sort(), ['conflict', 'saved'])
    const winner = results[0] === '' ? FINANCE : ACCOUNTING
    assert.equal(departmentOf(who), winner)
    assert.equal(revision(who), seen + 1)
    assert.equal(Number(sql(`select count(*) from private.course_selection_events where user_id = '${who.user}'
      and event = 'selection.changed' and actor = 'student'`)), 1, 'one change is recorded')
  } finally { cleanup(who) }
})

test('a grant committing around a save: commit order decides, and no change lands after a committed grant', { skip: !enabled }, async () => {
  const early = student()
  const late = student()
  let held, pending
  try {
    // Issuance protects the old profile before the uncommitted grant exists; the queued save is refused after commit.
    held = await holdStatement(`set role service_role;
      select public.admin_grant_access('${early.user}', 30, 'Ops', 'race test') ->> 'state'`)
    pending = background(strict(save(early, ACCOUNTING, revision(early)))).then(out => out, error => String(error))
    await until(() => waiting() >= 1, 'the save to wait for grant scope')
    assert.equal(await held.release(), 'granted'); held = null
    assert.match(await pending, /CI423/); pending = null
    assert.equal(departmentOf(early), BUA)
    assert.equal(state(early), 'locked')
    // Selection first: issuance waits, then binds the committed department and locks that selection.
    held = await holdStatement(save(late, ACCOUNTING, revision(late)))
    pending = background(strict(`set role service_role;
      select public.admin_grant_access('${late.user}', 30, 'Ops', 'race test')->>'state'`))
    await until(() => waiting() >= 1, 'issuance to wait for the profile save')
    await held.release(); held = null
    assert.equal(await pending, 'granted'); pending = null
    assert.equal(departmentOf(late), ACCOUNTING)
    assert.equal(sql(`select course_department_id from public.entitlement_grants where user_id='${late.user}'`), ACCOUNTING)
    assert.equal(state(late), 'locked')
  } finally { if (held) await held.release(); if (pending) await pending; cleanup(early, late) }
})

test('an operator change against a stale tab: the tab gets a conflict and the operator\'s courses stay', { skip: !enabled }, async () => {
  const who = student()
  try {
    sql(`set role service_role; select public.admin_grant_access('${who.user}', 30, 'Ops', 'plan')`)
    const seen = revision(who)
    const operator = await holdStatement(`set role service_role; select public.admin_change_course_selection('${who.user}',
      'finance', '200-level', 'first-semester', ${seen}, false, 'Ops', 'asked on WhatsApp') ->> 'state'`)
    const tab = background(save(who, ACCOUNTING, seen)).then(out => out, error => String(error))
    await until(() => waiting() >= 1, 'the tab to queue behind the operator')
    assert.equal(await operator.release(), 'changed')
    assert.equal(await tab, '', 'the stale tab updates nothing (conflict), it is not an error')
    assert.equal(departmentOf(who), FINANCE)
    assert.equal(state(who), 'locked', 'the operator change keeps the student locked')
  } finally { cleanup(who) }
})

test('an extension committed while a save waits: the save is decided on the extended calendar', { skip: !enabled }, async () => {
  const who = student()
  const term = randomUUID()
  try {
    // A semester that ended ten days ago, a selection confirmed in it and Early Access still running: released.
    sql(`insert into private.academic_terms (id, session_label, academic_period_id, resumes_on, created_by, updated_by)
        values ('${term}', '2001/2002', '${FIRST}', (now() at time zone 'Africa/Lagos')::date - 10 - interval '4 months',
          'test', 'test');
      alter table public.profiles disable trigger profiles_guard_course_selection;
      update public.profiles set selection_confirmed_at = now() - interval '200 days' where id = '${who.user}';
      alter table public.profiles enable trigger profiles_guard_course_selection;
      insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by, created_at)
        values ('${who.user}', 'early_access', now() - interval '199 days', now() + interval '20 days', 'uncapped', 'test', now() - interval '199 days');`)
    assert.equal(state(who), 'reselect')
    // An extension for the student's department, written under the calendar lock as at the last instant of the
    // semester (the operator function refuses it once the end has passed; this simulates the commit at the boundary).
    const extension = await holdStatement(`select pg_advisory_xact_lock(hashtextextended('academic-calendar', 0));
      insert into private.academic_term_extensions (term_id, department_id, last_day, set_by, reason)
        values ('${term}', '${BUA}', (now() at time zone 'Africa/Lagos')::date + 5, 'test', 'boundary')`)
    const saving = background(save(who, ACCOUNTING, revision(who))).then(() => 'saved', error => String(error))
    await until(() => waiting() >= 1, 'the save to wait for the calendar')
    await extension.release()
    assert.match(await saving, /CI423/, 'the save sees the committed extension and is refused')
    assert.equal(departmentOf(who), BUA)
  } finally {
    cleanup(who)
    sql(`delete from private.academic_term_extensions where term_id = '${term}';
      delete from private.academic_terms where id = '${term}'`)
  }
})

test('a mixed load on the same accounts completes with no deadlock', { skip: !enabled }, async () => {
  const people = Array.from({ length: 6 }, () => student())
  const term = randomUUID()
  let member
  try {
    sql(`insert into private.academic_terms (id, session_label, academic_period_id, resumes_on, created_by, updated_by)
      values ('${term}', '2090/2091', '${FIRST}', '2090-11-09', 'test', 'test')`)
    for (const who of people) sql(`set role service_role; select public.admin_grant_access('${who.user}', 30, 'Ops', 'load')`)
    member = earlyAccessMember(people[0])
    const swallowLock = statement => `do $$ begin ${statement}; exception when sqlstate 'CI423' then null; end $$`
    const sessions = people.flatMap(who => {
      const seen = revision(who)
      const manual = sql(`select id from public.entitlement_grants where user_id = '${who.user}'`)
      return [
        background(strict(activate(who, seen))),
        background(strict(asStudent(who, swallowLock(`update public.profiles set department_id = '${ACCOUNTING}'
          where id = '${who.user}'`)))),
        background(strict(asStudent(who, `update public.profiles set first_name = 'Load' where id = '${who.user}'`))),
        background(strict(`set role service_role; select public.admin_change_course_selection('${who.user}', 'finance',
          '200-level', 'first-semester', ${seen}, false, 'Ops', 'load')`)),
        background(strict(`set role service_role; select public.admin_change_grant('${manual}', 'revoke', null, null,
          'Ops', 'load')`)),
        background(strict(`set role service_role; select public.admin_grant_access('${who.user}', 5, 'Ops', 'load')`)),
        background(strict(asStudent(who, 'select public.get_my_course_selection()'))),
        background(strict(`set role service_role; select public.admin_course_selection_status('${who.user}')`)),
      ]
    })
    sessions.push(background(strict(`set role service_role; select public.admin_set_department_end('2090/2091',
      'first-semester', 'all', '2091-03-20', 'Ops', 'load')`)))
    const sweepIndex = sessions.length
    sessions.push(background(strict(`set role service_role; select public.admin_reconcile_early_access('Ops', 'load', 200)->>'granted'`)))
    const settled = await Promise.allSettled(sessions)
    const failures = settled.filter(result => result.status === 'rejected').map(result => String(result.reason).slice(0, 300))
    assert.deepEqual(failures, [], 'every concurrent session completes: no deadlock (40P01) and no lock timeout')
    const firstSweep = Number(settled[sweepIndex].value)
    assert.ok(firstSweep === 0 || firstSweep === 1, 'a contended profile may defer enrollment')
    const retry = Number(await background(strict(`set role service_role;
      select public.admin_reconcile_early_access('Ops', 'retry after mixed load', 200)->>'granted'`)))
    assert.equal(firstSweep + retry, 1, 'the mixed sweep eventually grants exactly one Early Access record')
    assert.equal(sql(`select count(*) from public.entitlement_grants where user_id='${people[0].user}'
      and source='early_access'`), '1')
    for (const who of people) {
      assert.equal(state(who), 'locked', 'every account ends locked: each kept an active grant')
      assert.notEqual(sql(`select selection_confirmed_at from public.profiles where id = '${who.user}'`), '')
    }
  } finally {
    releaseClaims(...people)
    member?.cleanup()
    cleanup(...people)
    sql(`delete from private.academic_term_extensions where term_id = '${term}';
      delete from private.academic_terms where id = '${term}'`)
  }
})

test('the migration backfill locks existing pass and Early Access holders and nobody else', { skip: !enabled }, () => {
  const start = MIGRATION.indexOf('-- course-lock:backfill:start')
  const end = MIGRATION.indexOf('-- course-lock:backfill:end')
  assert.ok(start > 0 && end > start, 'the migration marks its backfill')
  const backfill = MIGRATION.slice(start, end)
  const passActive = student()
  const passEnded = student()
  const earlyAccess = student()
  const revoked = student()
  const free = student()
  const unpicked = student({ select: false })
  const emptyCombination = student({ department: ACCOUNTING, level: L300 })
  const everyone = [passActive, passEnded, earlyAccess, revoked, free, unpicked, emptyCombination]
  const grant = (who, source, policy, starts, ends, revokedAt = 'null') => `insert into public.entitlement_grants
    (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units, created_by, revoked_at, revoked_by, revoke_reason)
    values ('${who.user}', '${source}', ${policy ? `'${policy}'` : 'null'}, ${starts}, ${ends},
      ${source === 'trial' ? `'capped', 1` : source === 'early_access' ? `'uncapped', null` : `'none', null`}, 'test',
      ${revokedAt}, ${revokedAt === 'null' ? 'null, null' : `'test', 'mistake'`});`
  try {
    // Rows as they stood before the migration: profiles made weeks ago, no confirmation time, grants of every kind, and
    // no guard trigger (the migration creates it after the backfill).
    const result = sql(`begin;
      alter table public.profiles drop constraint profiles_selection_confirmed_check;
      alter table public.profiles disable trigger profiles_guard_course_selection;
      update public.profiles set created_at = now() - interval '30 days', selection_confirmed_at = null
        where id in (${everyone.map(p => `'${p.user}'`).join(',')});
      ${grant(passActive, 'trial', 'discovery', "now() - interval '1 day'", "now() + interval '2 days'")}
      ${grant(passEnded, 'trial', 'discovery', "now() - interval '10 days'", "now() - interval '7 days'")}
      ${grant(earlyAccess, 'early_access', null, "now() - interval '3 days'", "now() + interval '27 days'")}
      ${grant(revoked, 'manual', null, "now() - interval '3 days'", "now() + interval '27 days'", 'now()')}
      ${grant(emptyCombination, 'trial', 'discovery', "now() - interval '1 day'", "now() + interval '2 days'")}
      create temporary table revisions on commit drop as select id, revision from public.profiles;
      ${backfill}
      alter table public.profiles enable trigger profiles_guard_course_selection;
      alter table public.profiles add constraint profiles_selection_confirmed_check
        check ((selection_confirmed_at is null) = (department_id is null));
      select jsonb_build_object('states', jsonb_object_agg(p.id, private.course_selection_state(p.id)->>'state'),
        'revisions_kept', bool_and(p.revision = r.revision))
        from public.profiles p join revisions r using (id) where p.id in (${everyone.map(p => `'${p.user}'`).join(',')});
      rollback;`)
    const { states, revisions_kept: revisionsKept } = JSON.parse(result.split('\n').filter(line => line.startsWith('{')).at(-1))
    assert.deepEqual(states, {
      [passActive.user]: 'locked', [passEnded.user]: 'locked', [earlyAccess.user]: 'locked',
      [revoked.user]: 'open', [free.user]: 'open', [unpicked.user]: 'incomplete', [emptyCombination.user]: 'locked',
    })
    assert.equal(revisionsKept, true, 'the backfill does not invalidate open forms')
  } finally { cleanup(...everyone) }
})
