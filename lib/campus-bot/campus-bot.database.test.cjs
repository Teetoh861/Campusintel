// lib/campus-bot/campus-bot.database.test.cjs — Real concurrent sessions against a LOCAL database for Campus Bot Explain
// and Ask Campus Bot (20261117100000_campus_bot_explain_ask.sql): double taps never reserve or charge twice, two
// students asking for one shared explanation get one writer, a double settlement charges once, and Explain, Ask and a
// practice set racing for a nearly used-up window never reserve past it. Every racer queues behind a held lock first,
// so the race is real; no racer may deadlock or wait out a lock timeout. Opt in, one file at a time:
//   CAMPUS_BOT_DB_TEST=1 CAMPUS_BOT_DB_CONTAINER=supabase_db_<isolated project> \
//     node -r ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/campus-bot/campus-bot.database.test.cjs
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
const GST111 = '40000000-0000-4000-8000-000000000008'
const TOPIC = 'Listening Skills and Note-taking'
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
const SOURCES = "array['trial','early_access','paid']"
const USAGE = `'{"provider":"anthropic","model":"claude-haiku-5-5","inputTokens":3300,"outputTokens":400,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}'`
const CHAT_USAGE = `'{"provider":"anthropic","model":"claude-haiku-5-5","inputTokens":6000,"outputTokens":350,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}'`
const users = []
let saved
let startedAt
let standardSessionTokens

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
const service = call => `set role service_role; select ${call}::text;`

/** Hold an advisory lock until every racer is queued behind a lock, then let them all go. */
async function raceBehind(lockKey, racers) {
  const marker = `explain-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin;
    select pg_advisory_xact_lock(hashtextextended('${lockKey}', 0)); select pg_sleep(300); commit;`).catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the lock holder')
  const tags = racers.map(() => `explain-racer-${randomUUID()}`)
  const running = racers.map((statement, i) => background(`/* ${tags[i]} */ ${statement}`))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and (${tags.map(tag => `query like '%${tag}%'`).join(' or ')}) and query not like '%pg_stat_activity%'`))
    >= racers.length, 'every racer to queue')
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where query like '%${marker}%'
    and query not like '%pg_stat_activity%'`)
  await holder
  return Promise.all(running)
}

/** A confirmed student with one session and the free month (Standard Campus Bot limits), on BUA 200 Level. */
function student() {
  const user = randomUUID()
  const session = randomUUID()
  users.push(user)
  sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,
    raw_user_meta_data,created_at,updated_at) values('00000000-0000-0000-0000-000000000000','${user}','authenticated',
    'authenticated','bot-explain-race-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';
    insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,ai_units,created_by)
      values('${user}','early_access',clock_timestamp()-interval '1 day',clock_timestamp()+interval '20 days','uncapped',null,'race');`)
  return { user, session }
}
/** Topic practice on GST 111's first topic, every question of it, so two students share the same questions. */
function practice(p) {
  const attempt = randomUUID()
  const started = json(sql(service(`public.practice_start('${p.session}','${attempt}','${GST111}','new',null,100,10800,
    '[]',null,null,null,'instant','${TOPIC}')`)))
  assert.equal(started.state, 'ready', JSON.stringify(started).slice(0, 200))
  return attempt
}
/** The n-th question of the topic (by id, so the same question in every attempt), and a wrong option for it. */
const question = (attempt, n) => sql(`select question_id from public.quiz_attempt_questions where attempt_id='${attempt}'
  order by question_id offset ${n} limit 1`)
const wrong = (attempt, id) => Number(sql(`select ((r.payload->>'correctOption')::int + 1) % jsonb_array_length(r.payload->'options')
  from public.quiz_attempt_questions q join public.managed_content_revisions r on r.item_id=q.item_id and r.revision=q.content_revision
  where q.attempt_id='${attempt}' and q.question_id='${id}'`))
function answer(p, attempt, n) {
  const id = question(attempt, n)
  const picked = json(sql(service(`public.practice_pick('${p.session}','${attempt}','${id}',${wrong(attempt, id)})`)))
  assert.equal(picked.state, 'picked')
  return id
}
// The notes topic GST 111's first practice topic links to: what Explain names, and what Ask is about.
const topicItem = () => sql(`select i.id from public.managed_content_items i join public.managed_content_revisions r
  on r.item_id=i.id and r.revision=i.published_revision where i.course_id='${GST111}' and i.kind='note'
  and r.payload->'practice' @> '[{"topic":"${TOPIC}"}]' limit 1`)
const explainCall = (p, attempt, id) => service(`public.begin_campus_bot_explanation('${p.session}','${attempt}','${id}',true)`)
const finishCall = (p, reply) => service(`public.finish_campus_bot_explanation('${p.user}','${reply}','explained',
  'B is right because the notes say so.','${topicItem()}',${USAGE},null)`)
const chatCall = (p, request) => service(`public.begin_campus_bot_chat('${p.session}','${request}','${GST111}','${topicItem()}',true)`)
const chatFinishCall = (p, reply) => service(`public.finish_campus_bot_chat('${p.user}','${reply}','answered',
  '{"text":"The answer is that a good listener prepares.","in_notes":true,"verdict":"not-quite","check":"What comes first?","memory_trick":null}',${CHAT_USAGE})`)
/** A settled notes document on BUA 201, for a practice set (the A2 path). */
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

before(() => {
  if (!enabled) return
  startedAt = sql('select clock_timestamp()')
  standardSessionTokens = Number(sql("select session_tokens from private.campus_bot_tiers where tier='standard'"))
  saved = sql(`select explain_enabled||','||ask_enabled from private.campus_bot_settings`)
  sql(`update private.campus_bot_settings set explain_enabled = true, ask_enabled = true where singleton`)
})
after(() => {
  if (!enabled) return
  const [explain, ask] = saved.split(',')
  sql(`update private.campus_bot_settings set explain_enabled = ${explain === 't'}, ask_enabled = ${ask === 't'} where singleton;
    update private.campus_bot_tiers set session_tokens = ${standardSessionTokens} where tier = 'standard';`)
  const ids = users.map(id => `'${id}'`).join(',')
  if (users.length) assert.equal(sql(`set session_replication_role = replica;
    delete from storage.objects where bucket_id = 'ai-practice-uploads' and split_part(name, '/', 1) in (${ids});
    set session_replication_role = origin;
    delete from private.campus_bot_explanations where started_at >= '${startedAt}';
    delete from auth.users where id in (${ids});
    select count(*) from private.campus_bot_replies where user_id in (${ids});`), '0',
  'the race file leaves no Campus Bot rows behind')
})

test('eight Explain taps on one answered question: one reservation, one writer, the rest busy', { skip: !enabled }, async () => {
  const p = student()
  const attempt = practice(p)
  const id = answer(p, attempt, 0)
  const results = (await raceBehind(`entitlement-account:${p.user}`,
    Array.from({ length: 8 }, () => explainCall(p, attempt, id)))).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), ['busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'started'])
  assert.equal(sql(`select count(*) from private.campus_bot_replies where user_id='${p.user}'`), '1', 'one reservation')
  assert.equal(sql(`select count(*) from private.campus_bot_explanations e join private.campus_bot_replies r on r.id = e.reply_id
    where r.user_id='${p.user}' and e.state='running'`), '1')
  assert.equal(sql(`select count(*) from private.campus_bot_windows where user_id='${p.user}'`), '2', 'one pair of windows')

  // Settled twice at once: charged once, saved once.
  const reply = results.find(result => result.state === 'started').reply_id
  const settled = (await raceBehind(`entitlement-account:${p.user}`, [finishCall(p, reply), finishCall(p, reply)])).map(json)
  assert.deepEqual(settled.map(result => result.state).sort(), ['already-finished', 'finished'])
  assert.equal(sql(`select state||':'||charged_tokens from private.campus_bot_replies where id='${reply}'`), 'consumed:5300')
  assert.equal(sql(`select count(*) from private.campus_bot_explanations where reply_id='${reply}' and state='done'`), '1')
  // And a tap after it: the saved explanation, nothing reserved.
  assert.equal(json(sql(explainCall(p, attempt, id))).state, 'saved')
  assert.equal(sql(`select count(*) from private.campus_bot_replies where user_id='${p.user}'`), '1')
})

test('two students ask for the same explanation at once: one writes it, the other waits, then gets it free', { skip: !enabled }, async () => {
  const [a, b] = [student(), student()]
  const [ta, tb] = [practice(a), practice(b)]
  const id = answer(a, ta, 1)
  assert.equal(answer(b, tb, 1), id, 'the same question')
  const key = sql(`select item_id||':'||content_revision from public.quiz_attempt_questions where attempt_id='${ta}' and question_id='${id}'`)
  const results = (await raceBehind(`campus-bot-explanation:${key}:${wrong(ta, id)}`,
    [explainCall(a, ta, id), explainCall(b, tb, id)])).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), ['busy', 'started'])
  const winner = results.findIndex(result => result.state === 'started')
  const [writer, waiter] = winner === 0 ? [[a, ta], [b, tb]] : [[b, tb], [a, ta]]
  assert.equal(json(sql(finishCall(writer[0], results[winner].reply_id))).outcome, 'explained')
  const second = json(sql(explainCall(waiter[0], waiter[1], id)))
  assert.deepEqual([second.state, second.outcome], ['saved', 'explained'])
  assert.equal(sql(`select count(*) from private.campus_bot_replies where user_id='${waiter[0].user}'`), '0',
    'the student who waited was charged nothing')
})

test('eight sends of one chat message: one reservation; two settlements charge once; a retry gets the kept reply', { skip: !enabled }, async () => {
  const p = student()
  const request = randomUUID()
  const results = (await raceBehind(`entitlement-account:${p.user}`,
    Array.from({ length: 8 }, () => chatCall(p, request)))).map(json)
  assert.deepEqual(results.map(result => result.state).sort(), ['busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'busy', 'started'])
  assert.equal(sql(`select count(*) from private.campus_bot_replies where user_id='${p.user}'`), '1')
  const reply = results.find(result => result.state === 'started').reply_id
  const settled = (await raceBehind(`entitlement-account:${p.user}`, [chatFinishCall(p, reply), chatFinishCall(p, reply)]))
    .map(json)
  assert.deepEqual(settled.map(result => result.state).sort(), ['already-finished', 'finished'])
  assert.equal(sql(`select state||':'||charged_tokens from private.campus_bot_replies where id='${reply}'`), 'consumed:7750')
  const retry = json(sql(chatCall(p, request)))
  assert.deepEqual([retry.state, retry.reply.in_notes, retry.reply.verdict, retry.reply.check, retry.reply.memory_trick],
    ['answered', true, 'not-quite', 'What comes first?', null])
  assert.equal(sql(`select count(*) from private.campus_bot_replies where user_id='${p.user}'`), '1', 'the retry is free')
})

test('two students whose expired requests cross never deadlock: each reclaims the other\'s without waiting', { skip: !enabled }, async () => {
  // Each student's dead request was writing an explanation the other now asks for. Reclaiming it touches the other
  // student's reply row, and then the caller's own expired one: taken in crossed order with waiting locks, that is a
  // deadlock. Reclamation skips rows another transaction holds, so neither waits on the other.
  const [a, b] = [student(), student()]
  const [ta, tb] = [practice(a), practice(b)]
  const [x, y] = [answer(a, ta, 2), answer(b, tb, 3)]
  assert.equal(answer(a, ta, 3), y)
  assert.equal(answer(b, tb, 2), x)
  const ra = json(sql(explainCall(a, ta, x)))
  const rb = json(sql(explainCall(b, tb, y)))
  assert.deepEqual([ra.state, rb.state], ['started', 'started'])
  // Both requests die: their reservations and running explanations expire.
  sql(`update private.campus_bot_replies set reserved_at = reserved_at - interval '1 hour'
      where id in ('${ra.reply_id}','${rb.reply_id}');
    update private.campus_bot_explanations set started_at = started_at - interval '1 hour'
      where reply_id in ('${ra.reply_id}','${rb.reply_id}');`)
  const gate = `campus-bot-crossed-${randomUUID()}`
  const behindGate = call => `select pg_advisory_xact_lock_shared(hashtextextended('${gate}', 0)); ${call}`
  const results = (await raceBehind(gate, [behindGate(explainCall(a, ta, y)), behindGate(explainCall(b, tb, x))]))
    .map(json)
  for (const result of results) assert.ok(['started', 'busy'].includes(result.state), JSON.stringify(result))
  assert.equal(sql(`select string_agg(state, ',' order by state) from private.campus_bot_replies
    where id in ('${ra.reply_id}','${rb.reply_id}')`), 'released,released', 'both dead requests are reclaimed, unpaid')
  assert.equal(sql(`select count(*) from private.campus_bot_replies where id in ('${ra.reply_id}','${rb.reply_id}')
    and charged_tokens <> 0`), '0')
})

test('Explain, Ask and a practice set racing for a nearly used-up window never reserve past it', { skip: !enabled }, async () => {
  const p = student()
  const attempt = practice(p)
  const id = answer(p, attempt, 2)
  const documentId = documentFor(p)
  // 70,000 left: a set (60,000) and Explain (12,000) or Ask (25,500) cannot both fit; Explain and Ask can.
  sql(`update private.campus_bot_tiers set session_tokens = 70000 where tier = 'standard'`)
  const results = (await raceBehind(`entitlement-account:${p.user}`, [explainCall(p, attempt, id), chatCall(p, randomUUID()),
    service(`public.begin_ai_practice_generation('${p.session}','${randomUUID()}','${documentId}',${SOURCES})`)])).map(json)
  sql(`update private.campus_bot_tiers set session_tokens = ${standardSessionTokens} where tier = 'standard'`)
  const states = results.map(result => result.state)
  assert.ok(states.includes('started'), states.join())
  assert.ok(states.every(state => state === 'started' || state === 'session-limit'), states.join())
  const reserved = Number(sql(`select coalesce(sum(reserved_tokens),0) from private.campus_bot_replies where user_id='${p.user}'
    and state='reserved'`)) + Number(sql(`select coalesce(sum(reserved_tokens),0) from public.ai_usage_events
    where user_id='${p.user}' and state='reserved'`))
  assert.ok(reserved <= 70000, `reserved ${reserved} of 70,000`)
  assert.equal(sql(`select count(distinct session_window_id) from (select session_window_id from private.campus_bot_replies
    where user_id='${p.user}' union all select session_window_id from public.ai_usage_events where user_id='${p.user}'
    and session_window_id is not null) w`), '1', 'one session window for all three')
})
