// lib/ai-practice/topic-set.database.test.cjs — "Quiz me on this topic" under real concurrent sessions against a LOCAL
// database: identical taps and different taps on one topic, a topic set racing an upload set, a double settlement, the
// platform's last set of the day, and a free pass's one set. Every racer queues behind a held lock first, so the race
// is real; no racer may deadlock or wait out a lock timeout. The provider is never called.
// Needs 20261117110000_campus_bot_topic_sets.sql. Opt in, one file at a time, on an isolated stack:
//   CAMPUS_BOT_DB_TEST=1 CAMPUS_BOT_DB_CONTAINER=supabase_db_<isolated project> \
//     node -r ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/ai-practice/topic-set.database.test.cjs
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const { until } = require('../payments/campus-bot-race-tools.cjs')

const enabled = process.env.CAMPUS_BOT_DB_TEST === '1'
const container = process.env.CAMPUS_BOT_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_') && container !== 'supabase_db_Campusintel',
  'set CAMPUS_BOT_DB_CONTAINER to the isolated test stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
const SOURCES = "array['trial','early_access','paid']"
const USAGE = `'{"provider":"anthropic","model":"claude-haiku-5-5","inputTokens":6000,"outputTokens":3000,"cacheReadInputTokens":0,"cacheCreationInputTokens":0,"estimatedCostUsd":0.002,"durationMs":9000}'`
const users = []
let saved

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
const json = text => JSON.parse(text)

/** Hold an advisory lock until every racer is queued behind a lock, then let them all go. */
async function raceBehind(lockKey, racers) {
  const marker = `quiz-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin;
    select pg_advisory_xact_lock(hashtextextended('${lockKey}', 0)); select pg_sleep(300); commit;`).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the lock holder')
  const tags = racers.map(() => `quiz-racer-${randomUUID()}`)
  const running = racers.map((statement, i) => background(`/* ${tags[i]} */ ${statement}`))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and (${tags.map(tag => `query like '%${tag}%'`).join(' or ')}) and query not like '%pg_stat_activity%'`))
    >= racers.length, 'every racer to queue')
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
    'authenticated','quiz-race-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';`)
  return { user, session }
}
const service = call => `set role service_role; select ${call};`
const revision = p => sql(`select revision from public.profiles where id='${p.user}'`)
function paid(p) {
  const id = json(sql(service(`public.create_payment_order('${p.session}','standard_semester',${revision(p)},
    '${randomUUID()}','/access','fake')`))).order.id
  sql(service(`public.fulfil_payment('${id}','fake','ch_${id.replaceAll('-', '')}','succeeded',400000,'NGN','card',
    clock_timestamp(),'webhook','race')`))
  return id
}
const course = code => sql(`select repository_course_id from public.institutional_courses where course_code='${code}'`)
const topic = code => sql(`select i.id from public.managed_content_items i where i.course_id='${course(code)}'
  and i.kind='note' and i.published_revision is not null order by i.position nulls last, i.created_at, i.id limit 1`)
const quizCall = (p, code, request = randomUUID()) => `public.begin_campus_bot_topic_set('${p.session}','${request}',
  '${course(code)}','${topic(code)}',${SOURCES})::text`
// A delivered set in the stored format, for whatever the generation was admitted for. Built as postgres before the call:
// the service role cannot read the generations table itself.
const setFor = generation => sql(`select jsonb_build_object('formatVersion',1,'origin','ai-generated','visibility','personal',
  'verification','unverified','source',jsonb_build_object('kind','notes-topic','itemId',g.source_item_id,
  'revision',g.source_revision,'title','A topic'),'questions',(select jsonb_agg(jsonb_build_object('id','ai_'||lpad(to_hex(n),24,'0'),
  'prompt','Question '||n||'?','options',jsonb_build_array('Right','Wrong one','Wrong two','Wrong three'),'correctOption',0,
  'explanation','Because.','section','Topic','grounding',jsonb_build_object('documentId',g.source_item_id,
  'sourceSha256',repeat('a',64),'passageId','N1','passageStart',0,'passageEnd',10,'quote','a quote here')) order by n)
  from generate_series(1,5) n))::text from public.ai_practice_generations g where g.id='${generation}'`)
const finishCall = (p, generation) => `public.finish_campus_bot_topic_set('${p.user}','${generation}','generated',null,
  '${setFor(generation).replaceAll("'", "''")}'::jsonb,${USAGE},null)::text`
const today = () => Number(sql(`select count(*) from public.ai_usage_events
  where reserved_at >= date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc'`))

before(() => {
  if (!enabled) return
  saved = sql(`select global_daily_generations||','||paid_daily_reserve||','||s.topic_sets_enabled
    from private.ai_practice_policy cross join private.campus_bot_settings s`)
  sql(`update private.payment_policy set sales_open = true where singleton;
    update private.campus_bot_settings set topic_sets_enabled = true where singleton;`)
})
after(() => {
  if (!enabled) return
  const [daily, reserve, on] = saved.split(',')
  sql(`update private.ai_practice_policy set global_daily_generations = ${daily}, paid_daily_reserve = ${reserve} where singleton;
    update private.campus_bot_settings set topic_sets_enabled = ${on === 't'} where singleton;
    update private.payment_policy set sales_open = false where singleton;`)
  // Orders outlive their student, so this file's payment rows are removed explicitly; logs are append-only, so replica
  // mode (cleanup only) skips those triggers.
  const ids = users.map(id => `'${id}'`).join(',')
  // A pass claim outlives its student (user_id is cleared) and its key version would then be required of every later
  // activation on this stack, so the claims this file made go first.
  if (users.length) assert.equal(sql(`create temporary table race_orders as select id from private.payment_orders where user_id in (${ids});
    delete from private.discovery_pass_claims where user_id in (${ids});
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

test('eight identical taps on one topic: one set written, every other tap is that same set, one reservation',
  { skip: !enabled }, async () => {
    const p = student()
    paid(p)
    const request = randomUUID()
    const results = (await raceBehind(`entitlement-account:${p.user}`,
      Array.from({ length: 8 }, () => service(quizCall(p, 'BUA201', request))))).map(json)
    assert.deepEqual(results.map(result => result.state).sort(), [...Array(7).fill('existing'), 'started'])
    const generation = results.find(result => result.state === 'started').generation_id
    assert.ok(results.every(result => result.generation_id === generation), 'the same set')
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id='${p.user}'`), '1')
    assert.equal(sql(`select count(*) from private.campus_bot_windows where user_id='${p.user}'`), '2', 'one pair of windows')
  })

test('eight different taps: one set in flight, the rest wait for it, one reservation', { skip: !enabled }, async () => {
  const p = student()
  paid(p)
  const results = (await raceBehind(`entitlement-account:${p.user}`,
    Array.from({ length: 8 }, () => service(quizCall(p, 'BUA201'))))).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), [...Array(7).fill('busy'), 'started'])
  assert.equal(sql(`select count(*) from public.ai_usage_events where user_id='${p.user}' and state='reserved'`), '1')
})

test('a quiz racing an upload set for the same student: one in flight, never two reservations', { skip: !enabled },
  async () => {
    const p = student()
    paid(p)
    const reserved = json(sql(`select public.create_ai_practice_document('${p.session}',
      (select id from public.institutional_courses where course_code='BUA201'),'notes.txt','text/plain',10,${SOURCES})`))
    assert.equal(reserved.status, 'created', JSON.stringify(reserved))
    sql(`insert into storage.objects(bucket_id,name) values('ai-practice-uploads','${reserved.storage_path}')`)
    const claim = json(sql(`select public.claim_ai_practice_extraction('${p.session}','${reserved.document_id}')`)).claim_id
    sql(`select public.settle_ai_practice_document('${p.session}','${reserved.document_id}','${claim}',null,'ready notes',
      encode(sha256(convert_to('ready notes','UTF8')),'hex'),2)`)
    // Each racer is its own request: the same request id twice would be one request, answered "existing".
    const upload = () => `public.begin_ai_practice_generation('${p.session}','${randomUUID()}','${reserved.document_id}',${SOURCES})::text`
    const results = (await raceBehind(`entitlement-account:${p.user}`,
      [service(quizCall(p, 'BUA201')), service(upload()), service(quizCall(p, 'BUA201')), service(upload())])).map(json)
    assert.deepEqual(results.map(result => result.state).sort(), ['busy', 'busy', 'busy', 'started'])
    assert.equal(sql(`select count(*) from public.ai_usage_events where user_id='${p.user}' and state='reserved'`), '1')
    sql(`set session_replication_role = replica; delete from storage.objects where name='${reserved.storage_path}';`)
  })

test('two settlements of one set: charged once', { skip: !enabled }, async () => {
  const p = student()
  paid(p)
  const generation = json(sql(service(quizCall(p, 'BUA201')))).generation_id
  const results = (await raceBehind(`entitlement-account:${p.user}`,
    [service(finishCall(p, generation)), service(finishCall(p, generation))])).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), ['already-finished', 'finished'])
  assert.equal(sql(`select e.charged_tokens from public.ai_usage_events e join public.ai_practice_generations g
    on g.usage_event_id = e.id where g.id='${generation}'`), String(6000 + 5 * 3000))
})

test('two students for the platform’s last set of the day: exactly one starts', { skip: !enabled }, async () => {
  const a = student(), b = student()
  paid(a)
  paid(b)
  sql(`update private.ai_practice_policy set global_daily_generations = ${today() + 1}, paid_daily_reserve = 0 where singleton`)
  try {
    const results = (await raceBehind('ai-practice-global-day',
      [service(quizCall(a, 'BUA201')), service(quizCall(b, 'BUA201'))])).map(json)
    assert.deepEqual(results.map(result => result.state).sort(), ['capacity', 'started'])
  } finally {
    // The day is full now: the tests after this one need the platform's real limit back.
    const [daily, reserve] = saved.split(',')
    sql(`update private.ai_practice_policy set global_daily_generations = ${daily}, paid_daily_reserve = ${reserve} where singleton`)
  }
})

test('a free pass’s one set: concurrent taps on a free course start one, and after it nothing more', { skip: !enabled },
  async () => {
    const p = student()
    // One claim hash for every key version the stack already knows (activation verifies them all), and 999 for this run.
    const known = JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('version',key_version,'check',key_check)),
      '[]') from private.discovery_claim_keys where key_version <> 999`))
    const entry = (version, check) => `jsonb_build_object('version',${version},'hash',
      encode(sha256(convert_to('${p.user}-v${version}','UTF8')),'hex'),'check',${check})`
    const hash = `jsonb_build_array(${[entry(999, "repeat('f',64)"),
      ...known.map(key => entry(key.version, `'${key.check}'`))].join(',')})`
    assert.equal(json(sql(service(`public.activate_discovery_pass('${p.session}',${hash},null)::text`))).state, 'activated')
    const results = (await raceBehind(`entitlement-account:${p.user}`,
      [service(quizCall(p, 'GST111')), service(quizCall(p, 'GST111')), service(quizCall(p, 'GST111'))])).map(json)
    assert.deepEqual(results.map(result => result.state).sort(), ['busy', 'busy', 'started'])
    const generation = results.find(result => result.state === 'started').generation_id
    assert.equal(json(sql(service(finishCall(p, generation)))).status, 'generated')
    assert.equal(json(sql(service(quizCall(p, 'GST111')))).state, 'pass-used')
  })
