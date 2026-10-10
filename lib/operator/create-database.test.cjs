const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const Module = require('node:module')

// Local-only acceptance/concurrency gate; no HTTP provider or hosted database.
const enabled = process.env.OPERATOR_CREATE_DB_TEST === '1'
const args = ['exec', '-i', 'supabase_db_Campusintel', 'psql', '-U', 'postgres', '-d', 'postgres',
  '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
function db(sql) {
  const result = spawnSync('docker', args, { input: sql, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return result.stdout.trim()
}
function fixture() {
  const actor = randomUUID(), session = randomUUID(), other = randomUUID(), otherSession = randomUUID()
  const course = randomUUID(), intent = randomUUID()
  const authenticate = (user = actor, authSession = session) => `set local role authenticated;
    set local request.jwt.claims = '${JSON.stringify({ sub: user, session_id: authSession })}';`
  const create = (key = intent) => `public.create_managed_content_once('${course}', 'cbt_question',
    '{"prompt":"Choose","options":["A","B"],"correctOption":0}', '${key}')`
  db(`insert into public.courses(id,content_key) values ('${course}','create-${course}');
    insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
      id::text || '@example.test','x',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
    from (values ('${actor}'::uuid),('${other}'::uuid)) u(id);
    update public.profiles set role='operator' where id in ('${actor}','${other}');
    insert into auth.sessions(id,user_id,created_at,updated_at) values
      ('${session}','${actor}',now(),now()),('${otherSession}','${other}',now(),now());`)
  return { actor, session, other, otherSession, course, intent, authenticate, create,
    cleanup: () => db(`begin; delete from private.managed_content_create_intents where actor_id in ('${actor}','${other}');
      delete from public.managed_content_revisions where item_id in (select id from public.managed_content_items where course_id='${course}');
      delete from public.managed_content_items where course_id='${course}';
      delete from public.courses where id='${course}'; delete from auth.users where id in ('${actor}','${other}'); commit;`) }
}
function connection() {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const state = { child, output: '', error: '' }
  child.stdout.on('data', chunk => { state.output += chunk })
  child.stderr.on('data', chunk => { state.error += chunk })
  state.closed = new Promise(resolve => child.on('close', resolve))
  return state
}
async function waitFor(state, pattern) {
  for (let n = 0; n < 500; n++) {
    const match = state.output.match(pattern)
    if (match) return match
    if (state.child.exitCode !== null) throw new Error(state.error || state.output)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out: ${state.error || state.output}`)
}

test('create commits, HTTP response is lost, exact POST replay returns the same durable CBT item', { skip: !enabled }, async () => {
  const f = fixture(), load = Module._load, cache = new Map(Object.entries(require.cache)), env = { ...process.env }
  const calls = []
  const client = { rpc: async (name, input) => {
    assert.equal(name, 'create_managed_content_once'); calls.push(input)
    const result = spawnSync('docker', [...args, '-v', 'VERBOSITY=sqlstate'], { input: `begin; ${f.authenticate()}
      select public.create_managed_content_once('${input.p_course_id}', '${input.p_kind}',
        '${JSON.stringify(input.p_payload)}'::jsonb, '${input.p_create_intent_id}'); commit;`, encoding: 'utf8', timeout: 15000 })
    if (result.status !== 0) return { data: null, error: { code: result.stderr.match(/ERROR:\s+([0-9A-Z]{5})/)?.[1] } }
    return { data: result.stdout.trim(), error: null }
  } }
  try {
    process.env.STUDENT_AUTH_ENABLED = 'true'; process.env.NEXT_PUBLIC_SITE_URL = 'https://campus.test'
    Module._load = function (name, ...rest) {
      if (name === '@/lib/auth/mutation-context') return { getAuthenticatedMutationContext: async () => ({ status: 'ready', context: { client } }) }
      if (name === '@/lib/operator/access') return { authorizeOperatorContext: async () => ({ status: 'operator', client }) }
      return load.call(this, name, ...rest)
    }
    const file = require.resolve('../../app/api/admin/editor/route.ts')
    delete require.cache[file]
    const { POST } = require(file)
    const request = (prompt = 'Choose') => new Request('https://campus.test/api/admin/editor', { method: 'POST',
      headers: { origin: 'https://campus.test', 'content-type': 'application/json', 'x-campus-account-continuity': 'test-rendered-context' },
      body: JSON.stringify({ action: 'create', createIntentId: f.intent, courseId: f.course, kind: 'cbt_question',
        payload: { prompt, options: ['A','B'], correctOption: 0 } }) })
    const lost = await POST(request())
    assert.equal(lost.status, 200) // Response is deliberately not consumed by the simulated browser.
    const committed = JSON.parse(db(`select jsonb_build_object('id',id,'question',question_id)::text
      from public.managed_content_items where course_id='${f.course}';`))
    const recovered = await POST(request())
    assert.equal(recovered.status, 200)
    assert.deepEqual(await recovered.json(), { status: 'ok', data: { itemId: committed.id } })
    assert.deepEqual(calls[1], calls[0])
    const mismatch = await POST(request('Changed'))
    assert.equal(mismatch.status, 409)
    assert.deepEqual(await mismatch.json(), { status: 'conflict',
      message: 'This create intent was already used with different content. Reload the workspace before continuing.' })
    const after = JSON.parse(db(`select jsonb_build_object('items',count(*),'question',min(question_id::text),
      'revisions',(select count(*) from public.managed_content_revisions where item_id='${committed.id}'))::text
      from public.managed_content_items where course_id='${f.course}';`))
    assert.deepEqual(after, { items: 1, question: committed.question, revisions: 1 })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key]
    Object.assign(process.env, env); f.cleanup()
  }
})

test('simultaneous identical creates wait on one intent and recover one item; unrelated intents proceed', { skip: !enabled }, async () => {
  const f = fixture()
  let first, retry, released = false
  try {
    first = connection()
    first.child.stdin.write(`begin; ${f.authenticate()} select ${f.create()};\n\\echo CREATED\n`)
    await waitFor(first, /CREATED/)
    const itemId = first.output.match(/[0-9a-f-]{36}/)[0]
    retry = connection()
    retry.child.stdin.end(`begin; ${f.authenticate()} select pg_backend_pid(); select ${f.create()}; commit;`)
    const pid = Number((await waitFor(retry, /(?:^|\n)(\d+)\r?\n/))[1])
    let blocked = false
    for (let n = 0; n < 30; n++) {
      blocked = db(`select wait_event_type='Lock' from pg_stat_activity where pid=${pid};`) === 't'
      if (blocked) break
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.equal(blocked, true, 'replay waits for the first transaction to commit')
    assert.match(db(`begin; ${f.authenticate()} select ${f.create(randomUUID())}; commit;`), /^[0-9a-f-]{36}$/,
      'different intent for same operator completes while first intent is locked')
    assert.match(db(`begin; ${f.authenticate(f.other, f.otherSession)} select ${f.create()}; commit;`), /^[0-9a-f-]{36}$/,
      'same key for another operator completes independently')
    first.child.stdin.end('commit;\n\\q\n'); released = true
    assert.equal(await first.closed, 0, first.error)
    assert.equal(await retry.closed, 0, retry.error)
    assert.ok(retry.output.split(/\r?\n/).includes(itemId), 'both requests return the same item')
    assert.equal(db(`select count(*) from private.managed_content_create_intents where actor_id='${f.actor}' and intent_id='${f.intent}';`), '1')
    assert.equal(db(`select count(*) from public.managed_content_items where id='${itemId}';`), '1')
    assert.equal(db(`select count(*) from public.managed_content_revisions where item_id='${itemId}';`), '1')
    assert.equal(db(`select count(distinct question_id) from public.managed_content_items where id='${itemId}';`), '1')
  } finally {
    if (first && !released && first.child.exitCode === null) first.child.stdin.end('rollback;\n\\q\n')
    if (retry && retry.child.exitCode === null) retry.child.kill()
    if (first) await first.closed
    if (retry) await retry.closed
    f.cleanup()
  }
})
