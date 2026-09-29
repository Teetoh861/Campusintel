const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { randomUUID } = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')

async function fixture(run) {
  const originalLoad = Module._load
  const originalFetch = global.fetch
  const savedCache = new Map(Object.entries(require.cache))
  const state = { key: 'sb_secret_' + 'test-only-'.repeat(8), httpStatus: 200, body: null }
  const command = { p_session_id: randomUUID(), p_attempt_id: randomUUID(), p_course_id: randomUUID(),
    p_question_count: 50, p_operation: 'start', p_expected_revision: null, p_status: 'in_progress', p_answers: [] }
  const calls = []
  state.body = { status: 'saved', attempt: { id: command.p_attempt_id, revision: 0, status: 'in_progress', questionCount: 50 } }
  try {
    Module._load = function (name, ...args) {
      return name === '@/lib/auth/config' ? {
        getAuthSecretKey: () => state.key,
        getSupabaseConfig: () => ({ url: 'http://127.0.0.1:54321', key: 'unused-publishable-key' }),
      } : originalLoad.call(this, name, ...args)
    }
    global.fetch = async (url, options) => {
      calls.push({ url, options })
      return new Response(JSON.stringify(state.body), { status: state.httpStatus, headers: { 'content-type': 'application/json' } })
    }
    delete require.cache[require.resolve('./rpc.ts')]
    await run({ rpc: require('./rpc.ts').writeAttemptCommand, command, calls, state })
  } finally {
    Module._load = originalLoad
    global.fetch = originalFetch
    for (const key of Object.keys(require.cache)) if (!savedCache.has(key)) delete require.cache[key]
    for (const [key, value] of savedCache) require.cache[key] = value
  }
}

test('transport exposes one fixed RPC, has no table interface, and keeps server credentials internal', async () => fixture(async f => {
  const result = await f.rpc(f.command)
  assert.deepEqual(result, f.state.body)
  assert.equal(f.calls.length, 1)
  const { url, options } = f.calls[0]
  assert.equal(url, 'http://127.0.0.1:54321/rest/v1/rpc/write_quiz_attempt')
  assert.equal(options.method, 'POST')
  assert.equal(options.cache, 'no-store')
  assert.equal(options.redirect, 'error')
  assert.equal(options.headers.apikey, f.state.key)
  assert.equal(Object.hasOwn(options.headers, 'Authorization'), false)
  assert.ok(options.signal instanceof AbortSignal)
  assert.deepEqual(JSON.parse(options.body), f.command)
  assert.equal(JSON.stringify(result).includes(f.state.key), false)
}))

test('legacy local gateway keys also receive Bearer authorization', async () => fixture(async f => {
  f.state.key = 'test-only-local-jwt'
  await f.rpc(f.command)
  assert.equal(f.calls[0].options.headers.Authorization, `Bearer ${f.state.key}`)
}))

test('database validation errors return a minimal invalid-request result', async () => fixture(async f => {
  f.state.httpStatus = 400
  f.state.body = { code: '22023', message: 'private database detail' }
  assert.deepEqual(await f.rpc(f.command), { status: 'invalid-request' })
  f.state.body = { code: '28000', message: 'private session detail' }
  assert.deepEqual(await f.rpc(f.command), { status: 'signed-out' })
}))

test('provider failures and malformed or overbroad RPC responses fail closed', async () => fixture(async f => {
  f.state.httpStatus = 500
  await assert.rejects(f.rpc(f.command), /Attempt store unavailable/)
  f.state.httpStatus = 200
  for (const body of [null, { status: 'saved' }, { status: 'saved', attempt: { ...f.state.body.attempt, user_id: randomUUID() } },
    { status: 'saved', attempt: { ...f.state.body.attempt, revision: -1 } }, { status: 'unknown' }]) {
    const previous = f.state.body
    f.state.body = body
    await assert.rejects(f.rpc(f.command))
    f.state.body = previous
  }
}))

// Opt in after a local Supabase reset: QUIZ_ATTEMPT_DB_TEST=1 node --require
// ./lib/auth/test-loader.cjs --test lib/quiz-attempts/rpc.test.cjs
test('a writer waiting on the attempt lock stamps new and changed answers after the wait',
  { skip: process.env.QUIZ_ATTEMPT_DB_TEST !== '1' }, async () => {
    const args = ['exec', '-i', 'supabase_db_Campusintel', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    const db = script => {
      const result = spawnSync('docker', args, { input: script, encoding: 'utf8', timeout: 15000 })
      assert.equal(result.status, 0, result.stderr || result.error?.message)
      return result.stdout.trim()
    }
    const session = () => {
      const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
      const state = { child, output: '', error: '' }
      child.stdout.on('data', chunk => { state.output += chunk })
      child.stderr.on('data', chunk => { state.error += chunk })
      state.closed = new Promise(resolve => child.on('close', resolve))
      return state
    }
    const waitFor = async (state, pattern) => {
      for (let i = 0; i < 500; i++) {
        const match = state.output.match(pattern)
        if (match) return match
        if (state.child.exitCode !== null) throw new Error(state.error || state.output)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      throw new Error(`Timed out waiting for database session: ${state.error || state.output}`)
    }
    const user = randomUUID()
    const authSession = randomUUID()
    const attempt = randomUUID()
    const firstQuestion = randomUUID()
    const secondQuestion = randomUUID()
    const course = '40000000-0000-4000-8000-000000000007'
    const first = { question_id: firstQuestion, ordinal: 0, option_index: 0,
      is_correct: true, section_label: 'Accounting' }
    const changed = { ...first, option_index: 1, is_correct: false }
    const fresh = { question_id: secondQuestion, ordinal: 1, option_index: 0,
      is_correct: true, section_label: 'Accounting' }
    const command = (revision, answers) => `public.write_quiz_attempt('${authSession}', '${attempt}',
      '${course}', 2, 'record', ${revision}, 'in_progress', '${JSON.stringify(answers)}'::jsonb)`
    let locker
    let writer
    let released = false
    try {
      db(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        values ('00000000-0000-0000-0000-000000000000', '${user}', 'authenticated',
        'authenticated', '${user}@example.test', 'x', now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now());
        insert into auth.sessions (id, user_id, created_at, updated_at)
        values ('${authSession}', '${user}', now(), now());
        set role service_role;
        select public.write_quiz_attempt('${authSession}', '${attempt}', '${course}',
          2, 'start', null, 'in_progress', '[]'::jsonb);
        select ${command(0, [first])};`)
      const original = db(`select answered_at from public.quiz_attempt_answers
        where attempt_id = '${attempt}' and question_id = '${firstQuestion}';`)

      locker = session()
      locker.child.stdin.write(`begin;
        select id from public.quiz_attempts where id = '${attempt}' for update;
        \\echo LOCKED
      `)
      await waitFor(locker, /LOCKED/)

      writer = session()
      writer.child.stdin.end(`begin;
        set local role service_role;
        select pg_backend_pid();
        select ${command(1, [changed, fresh])};
        commit;
      `)
      const pid = Number((await waitFor(writer, /(?:^|\n)(\d+)\r?\n/))[1])
      let blocked = false
      for (let i = 0; i < 20; i++) {
        blocked = db(`select wait_event_type = 'Lock' from pg_stat_activity where pid = ${pid};`) === 't'
        if (blocked) break
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.equal(blocked, true, `writer did not wait on attempt lock: ${writer.error || writer.output}`)
      const whileBlocked = db('select clock_timestamp();')
      locker.child.stdin.end('commit;\n\\q\n')
      released = true
      assert.equal(await locker.closed, 0, locker.error)
      assert.equal(await writer.closed, 0, writer.error)
      assert.match(writer.output, /"revision": 2/)

      const times = JSON.parse(db(`select jsonb_build_object(
        'changed', (select answered_at from public.quiz_attempt_answers
          where attempt_id = '${attempt}' and question_id = '${firstQuestion}'),
        'fresh', (select answered_at from public.quiz_attempt_answers
          where attempt_id = '${attempt}' and question_id = '${secondQuestion}'),
        'after_wait', (select bool_and(answered_at >= '${whileBlocked}'::timestamptz)
          from public.quiz_attempt_answers where attempt_id = '${attempt}')
      )::text;`))
      assert.equal(times.after_wait, true)
      assert.equal(times.changed, times.fresh)
      assert.ok(Date.parse(times.changed) > Date.parse(original))

      const retry = JSON.parse(db(`set role service_role; select ${command(1, [changed, fresh])};`))
      assert.equal(retry.attempt.revision, 2)
      const persisted = db(`select count(*) from public.quiz_attempt_answers
        where attempt_id = '${attempt}' and answered_at = '${times.changed}'::timestamptz;`)
      assert.equal(persisted, '2')
    } finally {
      if (locker && !released && locker.child.exitCode === null) locker.child.stdin.end('rollback;\n\\q\n')
      if (writer && writer.child.exitCode === null) writer.child.kill()
      if (locker) await locker.closed
      if (writer) await writer.closed
      db(`delete from auth.users where id = '${user}';`)
    }
  })
