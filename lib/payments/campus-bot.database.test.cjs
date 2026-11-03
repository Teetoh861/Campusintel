// lib/payments/campus-bot.database.test.cjs — Real concurrent sessions against a LOCAL database for payments part 2b:
// five concurrent starts for one student; a start racing the payment that funds it; a delivery racing a refund; two
// students for the platform's last set of the day; a start racing a refill. Every racer queues behind a held lock
// first, so the race is real; no racer may deadlock or wait out a lock timeout.
// Needs 20261103100000_campus_bot_limits.sql. Opt in, one file at a time:
//   CAMPUS_BOT_DB_TEST=1 CAMPUS_BOT_DB_CONTAINER=supabase_db_<isolated project> node --test lib/payments/campus-bot.database.test.cjs
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.CAMPUS_BOT_DB_TEST === '1'
const container = process.env.CAMPUS_BOT_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_') && container !== 'supabase_db_Campusintel',
  'set CAMPUS_BOT_DB_CONTAINER to the isolated test stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
const SOURCES = "array['trial','early_access','paid']"
const SET = `'{"formatVersion":1,"origin":"ai-generated","visibility":"personal","verification":"unverified","questions":[{"id":"q1"}]}'`
const USAGE = `'{"provider":"anthropic","model":"claude-haiku-5-5","inputTokens":15000,"outputTokens":4000,"cacheReadInputTokens":1000,"cacheCreationInputTokens":500}'`
const users = []
let policy

function sql(statement) {
  const result = spawnSync('docker', psql, { input: statement, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
function background(statement) {
  const child = spawn('docker', [...psql, '-c', `set statement_timeout = '30s'; set lock_timeout = '30s'; ${statement}`],
    { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let error = ''
  child.stdout.on('data', value => { out += value })
  child.stderr.on('data', value => { error += value })
  return new Promise((resolve, reject) => child.on('error', reject).on('close', code => {
    if (code !== 0) reject(new Error(error)); else resolve(out.trim().split('\n').pop())
  }))
}
const until = async (predicate, label, timeoutMs = 10_000) => {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}
const json = text => JSON.parse(text)

/** Hold an advisory lock (a student's entitlement account, or the platform day) until every racer is queued behind a
 *  lock, then let them all go. Racers that never wait (refills take no account lock) are listed in `free`. */
async function raceBehind(lockKey, racers, { free = 0 } = {}) {
  const marker = `bot-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin;
    select pg_advisory_xact_lock(hashtextextended('${lockKey}', 0)); select pg_sleep(300); commit;`).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the lock holder')
  const tags = racers.map(() => `bot-racer-${randomUUID()}`)
  const running = racers.map((statement, i) => background(`/* ${tags[i]} */ ${statement}`))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and (${tags.map(tag => `query like '%${tag}%'`).join(' or ')}) and query not like '%pg_stat_activity%'`))
    >= racers.length - free, 'every racer to queue')
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where query like '%${marker}%'
    and query not like '%pg_stat_activity%'`)
  await holder
  return Promise.all(running)
}

function student() {
  const user = randomUUID()
  const session = randomUUID()
  users.push(user)
  sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','${user}','authenticated',
    'authenticated','bot-race-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';`)
  return { user, session }
}
const service = call => `set role service_role; select ${call};`
const revision = p => sql(`select revision from public.profiles where id='${p.user}'`)
const order = p => json(sql(service(`public.create_payment_order('${p.session}','standard_semester',${revision(p)},
  '${randomUUID()}','/access','fake')`))).order.id
const fulfilCall = orderId => `public.fulfil_payment('${orderId}','fake','ch_${orderId.replaceAll('-', '')}','succeeded',
  400000,'NGN','card',clock_timestamp(),'webhook','race')`
const paid = p => { const id = order(p); sql(service(fulfilCall(id))); return id }
/** A settled notes document through the A2 path. */
function documentFor(p) {
  const reserved = json(sql(`select public.create_ai_practice_document('${p.session}',
    (select id from public.institutional_courses where course_code='BUA201'),'notes.txt','text/plain',10,${SOURCES})`))
  assert.equal(reserved.status, 'created', JSON.stringify(reserved))
  sql(`insert into storage.objects(bucket_id,name) values('ai-practice-uploads','${reserved.storage_path}')`)
  const claim = json(sql(`select public.claim_ai_practice_extraction('${p.session}','${reserved.document_id}')`)).claim_id
  sql(`select public.settle_ai_practice_document('${p.session}','${reserved.document_id}','${claim}',null,'ready notes',
    encode(sha256(convert_to('ready notes','UTF8')),'hex'),2)`)
  return reserved.document_id
}
const beginCall = (p, documentId) => `public.begin_ai_practice_generation('${p.session}','${randomUUID()}','${documentId}',${SOURCES})::text`
const finishCall = (p, generationId) => `public.finish_ai_practice_generation('${p.user}','${generationId}','generated',null,
  ${SET},${USAGE})::text`
const today = () => Number(sql(`select count(*) from public.ai_usage_events
  where reserved_at >= date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc'`))

before(() => {
  if (!enabled) return
  policy = sql(`select global_daily_generations||','||paid_daily_reserve from private.ai_practice_policy`)
  sql(`update private.payment_policy set sales_open = true where singleton`)
})
after(() => {
  if (!enabled) return
  const [daily, reserve] = policy.split(',')
  sql(`update private.ai_practice_policy set global_daily_generations = ${daily}, paid_daily_reserve = ${reserve} where singleton`)
  sql(`update private.payment_policy set sales_open = false where singleton`)
  // Orders outlive their student, so remove this file's payment rows explicitly; logs are append-only and Storage rows
  // are protected, so replica mode (cleanup only) skips those triggers.
  const ids = users.map(id => `'${id}'`).join(',')
  if (users.length) assert.equal(sql(`create temporary table race_orders as select id from private.payment_orders where user_id in (${ids});
    set session_replication_role = replica;
    delete from storage.objects where bucket_id = 'ai-practice-uploads' and split_part(name, '/', 1) in (${users.map(id => `'${id}'`).join(',')});
    set session_replication_role = origin;
    delete from auth.users where id in (${ids});
    set session_replication_role = replica;
    delete from private.payment_events where order_id in (select id from race_orders);
    delete from private.plan_use_events where order_id in (select id from race_orders);
    delete from private.payment_refunds where order_id in (select id from race_orders);
    delete from private.payment_fulfilments where order_id in (select id from race_orders);
    delete from private.payment_orders where id in (select id from race_orders);
    set session_replication_role = origin;
    select count(*) from private.payment_orders where id in (select id from race_orders);`), '0',
  'the race file leaves no payment orders behind')
})

test('five concurrent starts for one student: one set in flight, the rest busy, one reservation', { skip: !enabled }, async () => {
  const p = student()
  paid(p)
  const documentId = documentFor(p)
  const results = (await raceBehind(`entitlement-account:${p.user}`,
    Array.from({ length: 5 }, () => service(beginCall(p, documentId))))).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), ['busy', 'busy', 'busy', 'busy', 'started'])
  assert.equal(sql(`select count(*) from public.ai_usage_events where user_id='${p.user}' and state='reserved'`), '1')
  assert.equal(sql(`select count(*) from private.campus_bot_windows where user_id='${p.user}'`), '2', 'one pair of windows')
})

test('a start racing the payment that funds it: no deadlock, and a start only on a recorded paid grant', { skip: !enabled }, async () => {
  const p = student()
  const id = order(p)
  // Only the first upload slot needs funding: a trial pass reserves the document, then ends.
  sql(`insert into public.entitlement_grants(user_id,source,trial_policy,starts_at,ends_at,ai_terms,ai_units,created_by)
    values('${p.user}','trial','discovery',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day','capped',1,'race')`)
  const documentId = documentFor(p)
  sql(`update public.entitlement_grants set ends_at = clock_timestamp() where user_id='${p.user}' and source='trial'`)
  const [begun, fulfilled] = await raceBehind(`entitlement-account:${p.user}`,
    [service(beginCall(p, documentId)), service(`${fulfilCall(id)}::text`)])
  assert.equal(json(fulfilled).outcome, 'fulfilled')
  const state = json(begun).state
  assert.ok(['started', 'not-entitled', 'allowance-expired'].includes(state), state)
  if (state === 'started') {
    assert.equal(sql(`select funding_source from public.ai_usage_events where user_id='${p.user}'`), 'paid')
  }
})

test('a delivery racing a refund: both complete; the set is kept and charged, the plan revoked', { skip: !enabled }, async () => {
  const p = student()
  const id = paid(p)
  const documentId = documentFor(p)
  const generationId = json(sql(service(beginCall(p, documentId)))).generation_id
  const [finished, refunded] = await raceBehind(`entitlement-account:${p.user}`, [service(finishCall(p, generationId)),
    service(`public.refund_order('${id}','our-fault','${randomUUID()}',array['${randomUUID().replaceAll('-', '').repeat(2)}'],
      'Ops','race test',clock_timestamp())::text`)])
  assert.equal(json(finished).status, 'generated')
  assert.equal(json(refunded).state, 'refund-pending')
  assert.equal(sql(`select status from public.ai_practice_generations where id='${generationId}'`), 'generated')
  assert.equal(sql(`select e.charged_tokens from public.ai_usage_events e join public.ai_practice_generations g
    on g.usage_event_id = e.id where g.id='${generationId}'`), '36500')
  assert.equal(sql(`select count(*) from public.entitlement_grants where order_id='${id}' and revoked_at is null`), '0')
})

test('two students for the platform\'s last set of the day: exactly one starts', { skip: !enabled }, async () => {
  const [a, b] = [student(), student()]
  paid(a)
  paid(b)
  const [documentA, documentB] = [documentFor(a), documentFor(b)]
  sql(`update private.ai_practice_policy set global_daily_generations = ${today() + 1}, paid_daily_reserve = 0 where singleton`)
  const results = (await raceBehind('ai-practice-global-day',
    [service(beginCall(a, documentA)), service(beginCall(b, documentB))])).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), ['capacity', 'started'])
  const [daily, reserve] = policy.split(',')
  sql(`update private.ai_practice_policy set global_daily_generations = ${daily}, paid_daily_reserve = ${reserve} where singleton`)
})

test('a start racing a refill: neither waits for the other, and the start lands in one consistent pair of windows', { skip: !enabled }, async () => {
  const p = student()
  paid(p)
  const documentId = documentFor(p)
  const first = json(sql(service(beginCall(p, documentId))))
  sql(service(finishCall(p, first.generation_id)))
  const [begun, refilled] = await raceBehind(`entitlement-account:${p.user}`, [service(beginCall(p, documentId)),
    service(`public.admin_campus_bot_refill('${p.user}','Ops','race refill')::text`)], { free: 1 })
  assert.equal(json(refilled).state, 'refilled')
  assert.equal(json(begun).state, 'started')
  assert.equal(sql(`select count(distinct (e.session_window_id, e.week_window_id)) = count(*)
    from public.ai_usage_events e where e.user_id='${p.user}' and e.state='reserved'`), 't')
})
