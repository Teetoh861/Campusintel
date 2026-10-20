// lib/ai-practice/admission.database.test.cjs — Real concurrent sessions against a LOCAL database: extraction claims,
// generation admission and the Account lifecycle lock. Needs the Account migrations (20261016100000-130000).
// Opt in: AI_PRACTICE_DB_TEST=1 [AI_PRACTICE_DB_CONTAINER=supabase_db_<project>]
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.AI_PRACTICE_DB_TEST === '1'
const container = process.env.AI_PRACTICE_DB_CONTAINER || 'supabase_db_Campusintel'
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const CONCURRENCY = 8
// Long enough that every competing session is provably queued behind the held lock.
const HOLD_SECONDS = 1.5

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
const until = async (predicate, label) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > 10_000) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
/** Sessions blocked on a lock right now, so a test can prove its competitors really queued. */
const waiting = () => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
  and query like '%ai_practice%'`))

/** One confirmed student with a live session, an accepted grant and one uploaded-but-unread document. */
function student() {
  const user = randomUUID()
  const session = randomUUID()
  const awaiting = randomUUID()
  const ready = randomUUID()
  // Looked up as postgres: the service role has no read access to the catalogue.
  const course = sql('select id from public.institutional_courses order by id limit 1')
  sql(`
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated', 'authenticated',
        'ai-db-${user}@example.test', 'x', now(), '{}', '{}', now(), now());
    insert into auth.sessions (id, user_id, created_at, updated_at) values ('${session}', '${user}', now(), now());
    insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, created_by)
      values ('${user}', 'trial', now(), now() + interval '7 days', 'capped', 10, 'test');
    insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name, media_type,
      declared_bytes, expires_at, status, source_text, source_sha256, word_count)
      select doc.id, '${user}', '${course}', '${user}/' || doc.id, 'notes.txt', 'text/plain', 10, now() + interval '1 day', doc.status,
        doc.text, case when doc.text is null then null else encode(sha256(convert_to(doc.text, 'UTF8')), 'hex') end,
        case when doc.text is null then null else 2 end
      from (values ('${awaiting}'::uuid, 'awaiting_upload', null::text), ('${ready}'::uuid, 'ready', 'ready text')) doc (id, status, text);`)
  return { user, session, awaiting, ready, course }
}

const cleanup = who => sql(`delete from auth.users where id = '${who.user}'`)

test('eight concurrent extraction requests produce one claim; the other seven are told busy', { skip: !enabled }, async () => {
  const who = student()
  try {
    // Hold the document row so all eight calls queue on it and then race for the claim together.
    const holder = background(`begin; select 1 from public.ai_practice_documents where id = '${who.awaiting}' for update;
      select pg_sleep(${HOLD_SECONDS}); commit;`)
    await until(() => sql(`select count(*) from pg_locks l join pg_class c on c.oid = l.relation
      where c.relname = 'ai_practice_documents' and l.mode = 'RowShareLock' and l.granted`) !== '0', 'the row holder')
    const racers = Array.from({ length: CONCURRENCY }, () =>
      background(asService(`public.claim_ai_practice_extraction('${who.session}', '${who.awaiting}') ->> 'state'`)))
    await until(() => waiting() >= CONCURRENCY, 'all eight claimants to queue')
    await holder
    const states = (await Promise.all(racers)).map(line => line.split('\n').at(-1)).sort()
    assert.deepEqual(states, ['busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'claimed'])
    assert.equal(sql(`select count(*) from public.ai_practice_documents where id = '${who.awaiting}'
      and extraction_claim is not null`), '1')
  } finally { cleanup(who) }
})

test('eight concurrent generation requests reserve exactly one allowance unit', { skip: !enabled }, async () => {
  const who = student()
  try {
    const racers = Array.from({ length: CONCURRENCY }, () => background(asService(`public.begin_ai_practice_generation(
      '${who.session}', '${randomUUID()}', '${who.ready}', array['trial']) ->> 'state'`)))
    const states = (await Promise.all(racers)).map(line => line.split('\n').at(-1)).sort()
    assert.deepEqual(states, ['busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'started'])
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id = '${who.user}'`), '1')
  } finally { cleanup(who) }
})

test('admission committed first: deletion scheduling waits for it, then nothing more is admitted', { skip: !enabled }, async () => {
  const who = student()
  const verified = randomUUID()
  try {
    sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${verified}', '${who.user}', now(), now())`)
    const admission = background(`begin; set local role service_role;
      select public.begin_ai_practice_generation('${who.session}', '${randomUUID()}', '${who.ready}', array['trial']) ->> 'state';
      select pg_sleep(${HOLD_SECONDS}); commit;`)
    await until(() => sql(`select count(*) from pg_stat_activity where state = 'active'
      and query like '%begin_ai_practice_generation%' and query like '%pg_sleep%'`) !== '0', 'the admission to hold its lock')
    await new Promise(resolve => setTimeout(resolve, 200))
    const started = Date.now()
    const scheduling = background(asService(`public.schedule_student_deletion('${who.session}', '${verified}') ->> 'status'`))
    assert.equal((await admission).split('\n').at(-1), 'started')
    assert.equal((await scheduling).split('\n').at(-1), 'scheduled')
    assert.ok(Date.now() - started >= HOLD_SECONDS * 1000 * 0.5, 'scheduling queued behind the admission lock')
    assert.equal(sql(asService(`public.begin_ai_practice_generation('${who.session}', '${randomUUID()}', '${who.ready}',
      array['trial']) ->> 'state'`)).split('\n').at(-1), 'signed-out', 'nothing is admitted after scheduling')
  } finally { cleanup(who) }
})

test('scheduling committed first: an admission queued behind it re-checks and is refused', { skip: !enabled }, async () => {
  const who = student()
  const verified = randomUUID()
  try {
    sql(`insert into auth.sessions (id, user_id, created_at, updated_at) values ('${verified}', '${who.user}', now(), now())`)
    // The scheduler holds the account row FOR UPDATE until it commits, as the real RPC's transaction does.
    const scheduling = background(`begin; set local role service_role;
      select public.schedule_student_deletion('${who.session}', '${verified}') ->> 'status';
      select pg_sleep(${HOLD_SECONDS}); commit;`)
    await until(() => sql(`select count(*) from pg_stat_activity where state = 'active'
      and query like '%schedule_student_deletion%' and query like '%pg_sleep%'`) !== '0', 'the scheduler')
    await new Promise(resolve => setTimeout(resolve, 200))
    // The session row is already deleted inside the scheduler's uncommitted transaction; the admission sees it
    // in its snapshot, waits for the account lock, and must re-check rather than trust what it read first.
    const admission = background(asService(`public.begin_ai_practice_generation('${who.session}', '${randomUUID()}',
      '${who.ready}', array['trial']) ->> 'state'`))
    const upload = background(asService(`public.create_ai_practice_document('${who.session}', '${who.course}',
      'late.txt', 'text/plain', 10, array['trial']) ->> 'status'`))
    await until(() => waiting() >= 2, 'both admissions to queue on the account lock')
    assert.equal((await scheduling).split('\n').at(-1), 'scheduled')
    assert.equal((await admission).split('\n').at(-1), 'signed-out')
    assert.equal((await upload).split('\n').at(-1), 'signed-out')
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id = '${who.user}'`), '0')
  } finally { cleanup(who) }
})
