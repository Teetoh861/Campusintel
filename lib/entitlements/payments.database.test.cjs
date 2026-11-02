// lib/entitlements/payments.database.test.cjs — Real concurrent sessions against a LOCAL database for payments part 1:
// five concurrent fulfils of one order; webhook, return page, catch-up and operator racing on one order; two orders for
// one semester both paid; a double tap on create; a refund racing fulfilment; a Session plan's second half racing
// term-set. Every racer queues behind a held account lock first, so the race is real. The installed write functions
// take every lock before their one clock read and nothing after it.
// Needs 20261102100000_payments.sql. Opt in, one file at a time:
//   PAYMENTS_DB_TEST=1 PAYMENTS_DB_CONTAINER=supabase_db_<isolated project> node --test lib/entitlements/payments.database.test.cjs
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

const enabled = process.env.PAYMENTS_DB_TEST === '1'
const container = process.env.PAYMENTS_DB_CONTAINER
if (enabled) assert.ok(container?.startsWith('supabase_db_') && container !== 'supabase_db_Campusintel',
  'set PAYMENTS_DB_CONTAINER to the isolated test stack')
const psql = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const BUA = '10000000-0000-4000-8000-000000000002'
const L200 = '20000000-0000-4000-8000-000000000002'
const FIRST = '30000000-0000-4000-8000-000000000001'
const users = []

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

/** Hold a student's entitlement-account lock (and, for calendar races, the calendar shared) until every racer is
 * queued behind a lock, then let them all go. */
async function raceBehind(userId, racers, { calendar = false } = {}) {
  const marker = `payments-holder-${randomUUID()}`
  const holder = background(`/* ${marker} */ begin;
    select pg_advisory_xact_lock(hashtextextended('entitlement-account:${userId}', 0));
    ${calendar ? "select pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));" : ''}
    select pg_sleep(300); commit;`)
    .catch(() => undefined)
  await until(() => sql(`select count(*) from pg_stat_activity where wait_event = 'PgSleep'
    and query like '%${marker}%'`) !== '0', 'the account lock holder')
  const tags = racers.map(() => `payments-racer-${randomUUID()}`)
  const running = racers.map((statement, i) => background(`/* ${tags[i]} */ ${statement}`))
  await until(() => Number(sql(`select count(*) from pg_stat_activity where wait_event_type = 'Lock'
    and (${tags.map(tag => `query like '%${tag}%'`).join(' or ')}) and query not like '%pg_stat_activity%'`)) === racers.length,
  'every racer to queue')
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
    'authenticated','pay-race-${user}@example.test','fixture-only',now(),'{}','{}',now(),now());
    insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${user}',now(),now());
    update public.profiles set first_name='Ada',department_id='${BUA}',academic_level_id='${L200}',
      academic_period_id='${FIRST}' where id='${user}';`)
  return { user, session }
}
const service = call => `set role service_role; select ${call};`
const createCall = (p, plan, request, path = '/access') => `public.create_payment_order('${p.session}','${plan}',
  (select revision from public.profiles where id='${p.user}'),'${request}','${path}','fake')`
const order = (p, plan = 'standard_semester', path = '/access') =>
  json(sql(service(createCall(p, plan, randomUUID(), path)))).order.id
const fulfilCall = (orderId, payment, amount = 400000, source = 'webhook') =>
  `public.fulfil_payment('${orderId}','fake','${payment}','succeeded',${amount},'NGN','card',clock_timestamp(),'${source}','race')`
const identity = () => randomUUID().replaceAll('-', '').repeat(2)
const refundCall = (orderId, request) => `public.refund_order('${orderId}','standard','${request}',
  array['${identity()}'],'Ops','race test',clock_timestamp())`
const grants = orderId => Number(sql(`select count(*) from public.entitlement_grants where order_id='${orderId}'`))
const secondTermSql = `select t.id from private.academic_terms t join public.academic_periods p on p.id = t.academic_period_id
  where t.session_label = (select session_label from private.academic_terms order by resumes_on limit 1)
    and p.key = 'second-semester'`

before(() => {
  if (!enabled) return
  sql(`update private.payment_policy set sales_open = true`)
})
after(() => {
  if (!enabled) return
  sql(`update private.payment_policy set sales_open = false`)
  if (users.length) sql(`delete from auth.users where id in (${users.map(id => `'${id}'`).join(',')})`)
  sql(`delete from private.academic_term_extensions where term_id in (${secondTermSql})`)
  sql(`delete from private.academic_terms where id in (${secondTermSql})
    and not exists (select 1 from public.entitlement_grants g where g.course_term_id = academic_terms.id)`)
})

test('five concurrent fulfils of one order write one grant set and answer the same', { skip: !enabled }, async () => {
  const p = student()
  const id = order(p)
  const payment = `ch_${randomUUID().replaceAll('-', '')}`
  const results = await raceBehind(p.user, Array.from({ length: 5 }, () => service(`${fulfilCall(id, payment)}::text`)))
  assert.equal(new Set(results).size, 1, 'every racer gets the first answer')
  assert.equal(json(results[0]).outcome, 'fulfilled')
  assert.equal(grants(id), 1, 'one grant')
  assert.equal(sql(`select count(*) from private.payment_fulfilments where order_id='${id}'`), '1', 'one fulfilment')
})

test('webhook, return page, catch-up and operator on one order: one grant set, one answer', { skip: !enabled }, async () => {
  const p = student()
  const id = order(p, 'standard_session')
  const payment = `ch_${randomUUID().replaceAll('-', '')}`
  const results = await raceBehind(p.user, ['webhook', 'return', 'reconcile', 'operator']
    .map(source => service(`${fulfilCall(id, payment, 700000, source)}::text`)))
  assert.equal(new Set(results).size, 1, 'the same answer for every source')
  assert.equal(grants(id), 2, 'one Session grant set')
  assert.equal(sql(`select status from private.payment_orders where id='${id}'`), 'paid')
})

test('two orders for one semester, both paid at once: one grants, the other is a duplicate', { skip: !enabled }, async () => {
  const p = student()
  const first = order(p, 'standard_semester', '/access')
  const second = order(p, 'standard_semester', '/courses')
  assert.notEqual(first, second)
  const results = (await raceBehind(p.user, [service(`${fulfilCall(first, `ch_${randomUUID().replaceAll('-', '')}`)}::text`),
    service(`${fulfilCall(second, `ch_${randomUUID().replaceAll('-', '')}`)}::text`)])).map(json)
  assert.deepEqual(results.map(r => r.outcome).sort(), ['fulfilled', 'paid-duplicate'])
  assert.equal(sql(`select count(*) from public.entitlement_grants where user_id='${p.user}' and order_id is not null`), '1',
    'one paid grant for the semester')
})

test('a double tap on create makes one order', { skip: !enabled }, async () => {
  const p = student()
  const request = randomUUID()
  const results = (await raceBehind(p.user, Array.from({ length: 5 },
    () => service(`${createCall(p, 'standard_semester', request)}::text`)))).map(json)
  assert.equal(new Set(results.map(r => r.order.id)).size, 1, 'the same order for every tap')
  assert.deepEqual(results.map(r => r.state).sort(), ['created', 'existing', 'existing', 'existing', 'existing'])
  assert.equal(sql(`select count(*) from private.payment_orders where user_id='${p.user}'`), '1')
})

test('a refund racing fulfilment never leaves two live plans or a refunded live grant', { skip: !enabled }, async () => {
  for (const refundFirst of [true, false]) {
    const p = student()
    // Both orders exist before the first is paid (the second tab), so the second can race the refund.
    const paid = order(p, 'standard_semester', '/access')
    const other = order(p, 'standard_semester', '/courses')
    const paidWith = `ch_${randomUUID().replaceAll('-', '')}`
    assert.equal(json(sql(service(`${fulfilCall(paid, paidWith)}::text`))).outcome, 'fulfilled')
    sql(`update private.payment_orders set paid_at = paid_at - interval '1 hour' where id='${paid}';
      update private.payment_fulfilments set created_at = created_at - interval '1 hour' where order_id='${paid}'`)
    const racers = [service(`${refundCall(paid, randomUUID())}::text`),
      service(`${fulfilCall(other, `ch_${randomUUID().replaceAll('-', '')}`)}::text`),
      service(`${fulfilCall(paid, paidWith)}::text`)]
    const launch = refundFirst ? [0, 1, 2] : [1, 2, 0]
    const answers = await raceBehind(p.user, launch.map(i => racers[i]))
    const [refund, second, replay] = [0, 1, 2].map(i => json(answers[launch.indexOf(i)]))
    const label = refundFirst ? 'refund launched first' : 'fulfil launched first'
    assert.equal(refund.state, 'refund-pending', `${label}: refund recorded`)
    assert.equal(replay.outcome, 'fulfilled', `${label}: the replay answers as before`)
    assert.ok(['fulfilled', 'paid-duplicate'].includes(second.outcome), `${label}: the other order is decided once`)
    assert.equal(sql(`select count(*) from public.entitlement_grants where order_id='${paid}' and revoked_at is null`), '0',
      `${label}: the refunded order has no live grant`)
    assert.ok(Number(sql(`select count(*) from public.entitlement_grants where user_id='${p.user}' and order_id is not null
      and revoked_at is null`)) <= 1, `${label}: never two live plans for the semester`)
  }
})

test('a Session plan\'s second half racing term-set binds to the Second Semester only', { skip: !enabled }, async () => {
  assert.equal(sql(`select count(*) from (${secondTermSql}) s`), '0', 'starts with no Second Semester')
  const p = student()
  const id = order(p, 'standard_session')
  const session = sql(`select session_label from private.academic_terms order by resumes_on limit 1`)
  const resumes = sql(`select last_day + 14 from private.academic_terms order by resumes_on limit 1`)
  const racers = [service(`${fulfilCall(id, `ch_${randomUUID().replaceAll('-', '')}`, 700000)}::text`),
    service(`public.admin_set_academic_term('${session}','second-semester','${resumes}','Ops','race')::text`)]
  const [fulfil, termSet] = (await raceBehind(p.user, racers, { calendar: true })).map(json)
  assert.equal(fulfil.outcome, 'fulfilled')
  assert.equal(termSet.state, 'created')
  // Whichever went first, the next ordered read binds the second half to the Second Semester, never the first.
  sql(`select private.lock_course_access_scope('${p.user}'), private.bind_pending_course_grants('${p.user}')`)
  assert.equal(sql(`select course_term_id from public.entitlement_grants where order_id='${id}' and plan_part=2`),
    sql(secondTermSql))
  assert.equal(sql(`select course_term_id = (select id from private.academic_terms order by resumes_on limit 1)
    from public.entitlement_grants where order_id='${id}' and plan_part=1`), 't')
  // And a bind racing a later calendar write: the read path and term-set serialize on the calendar lock.
  const q = student()
  const idq = order(q, 'standard_session')
  sql(service(`${fulfilCall(idq, `ch_${randomUUID().replaceAll('-', '')}`, 700000)}::text`))
  const results = await raceBehind(q.user, [
    `select private.lock_course_access_scope('${q.user}'), private.bind_pending_course_grants('${q.user}');`,
    service(`public.admin_set_department_end('${session}','second-semester','business-administration',
      ('${resumes}'::date + interval '4 months' + interval '7 days')::date,'Ops','race')::text`)], { calendar: true })
  assert.equal(json(results[1]).state, 'changed')
  assert.equal(sql(`select course_term_id from public.entitlement_grants where order_id='${idq}' and plan_part=2`),
    sql(secondTermSql), 'bound at insert to the Second Semester, unchanged by the extension')
})

// What can wait in plpgsql: a row lock, an advisory lock, a table lock, or a call to a function that takes locks.
const WAITS = [/\bfor\s+(?:no\s+key\s+update|key\s+share|update|share)\b/i, /\bpg_advisory\w*/i, /\block\s+table\b/i,
  /\b(?:lock_course_access_scope|bind_pending_course_grants|close_overdue_practice|open_course_access_read)\b/i,
  /\bprivate\.\w*lock\w*/i]
const installed = name => sql(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname || '.' || p.proname = '${name}'`)
const statements = definition => definition.split('$function$')[1].replace(/--[^\n]*/g, '').split(';')
  .map(text => text.replace(/\s+/g, ' ').trim().replace(/^(?:.*\b(?:then|else|begin|loop)\s+)/i, '')).filter(Boolean)

test('every payment write takes its locks, scope first, before one clock read, and nothing waits after it',
  { skip: !enabled }, () => {
    for (const name of ['public.create_payment_order', 'public.attach_payment_checkout', 'public.fulfil_payment',
      'public.record_payment_outcome', 'public.refund_order', 'public.record_refund_result']) {
      const body = statements(installed(name))
      const clocks = body.filter(text => /v_now\s*:=/i.test(text))
      assert.deepEqual(clocks, ['v_now := clock_timestamp()'], `${name}: one clock read`)
      const clock = body.indexOf(clocks[0])
      assert.deepEqual(body.slice(clock).filter(text => WAITS.some(pattern => pattern.test(text))), [],
        `${name}: nothing waits after the final checks`)
      const locks = body.slice(0, clock).filter(text => WAITS.some(pattern => pattern.test(text)))
      assert.match(locks[0], /lock_course_access_scope/, `${name}: A1's write prefix comes first`)
    }
  })
