const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, createHmac } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const Module = require('node:module')
const { createClient: supabaseClient } = require('@supabase/supabase-js')

// Opt in only against an already-running local Supabase stack. No hosted URLs,
// email, password login, or external provider is used by this acceptance test.
const enabled = process.env.QUIZ_START_REPLAY_DB_TEST === '1'
function db(sql) {
  const result = spawnSync('docker', ['exec', '-i', 'supabase_db_Campusintel', 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', timeout: 15000 })
  assert.equal(result.status, 0, 'Local SQL fixture operation failed')
  return result.stdout.trim()
}
function localConfig() {
  const result = spawnSync('supabase', ['status', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(result.status, 0, 'Local Supabase unavailable')
  const config = JSON.parse(result.stdout)
  assert.equal(new URL(config.API_URL).hostname, '127.0.0.1', 'never contact hosted Supabase')
  return config
}
function userToken(config, user, session) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', role: 'authenticated',
    sub: user, session_id: session, iss: `${config.API_URL}/auth/v1`,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${body}.${createHmac('sha256', config.JWT_SECRET).update(body).digest('base64url')}`
}
async function fixture(run) {
  const config = localConfig(), user = randomUUID(), session = randomUUID(), operator = randomUUID(), operatorSession = randomUUID()
  const other = randomUUID(), otherSession = randomUUID(), attemptId = randomUUID()
  const load = Module._load, cache = new Map(Object.entries(require.cache))
  const course = require('../data/courses.ts').getCourseByContentKey('financial-accounting-1')
  const policy = require('../data/quizzes.ts').getQuizConfigurationByCourseSlug(course.slug)
  const courseId = db(`select id from public.courses where content_key='${course.contentKey}';`)
  assert.match(courseId, /^[0-9a-f-]{36}$/)
  const claims = JSON.stringify({ sub: operator, session_id: operatorSession, role: 'authenticated' })
  let itemId, questionId
  const state = { publishedUnavailable: false, publishedCalls: 0, clients: [] }
  try {
    db(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',id::text || '@example.test',
        'x',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()
      from (values ('${user}'::uuid),('${operator}'::uuid),('${other}'::uuid)) u(id);
      -- GoTrue scans these optional token fields as strings, unlike SQL-only fixtures.
      update auth.users set confirmation_token='',recovery_token='',email_change_token_new='',
        email_change_token_current='',email_change='',reauthentication_token=''
        where id in ('${user}','${operator}','${other}');
      update public.profiles set role='operator' where id='${operator}';
      insert into auth.sessions(id,user_id,created_at,updated_at) values
        ('${session}','${user}',now(),now()),('${operatorSession}','${operator}',now(),now()),('${otherSession}','${other}',now(),now());
      begin; set local request.jwt.claims='${claims}';
      do $f$ declare item uuid; begin
        item := public.create_managed_content_once('${courseId}','cbt_question',
          '{"prompt":"Replay fixture","options":["Original","Replacement"],"correctOption":0,"section":"Replay fixture"}',gen_random_uuid());
        perform public.review_managed_content(item,1,1,'approved');
        perform public.publish_managed_content(item,2,1);
      end; $f$; commit;`)
    const identity = JSON.parse(db(`select jsonb_build_object('item',id,'question',question_id)::text
      from public.managed_content_items where created_by='${operator}';`))
    itemId = identity.item; questionId = identity.question
    const selected = JSON.parse(db(`select jsonb_agg(jsonb_build_object('questionId',question_id,
      'ordinal',ordinal,'publishedRevision',published_revision) order by ordinal)::text from (
      select question_id,published_revision,row_number() over (order by (id='${itemId}') desc,id)-1 ordinal
      from public.managed_content_items where course_id='${courseId}' and kind='cbt_question' and published_revision is not null
      order by (id='${itemId}') desc,id limit ${policy.maxQuizQuestions}) q;`))
    assert.equal(selected.length, policy.maxQuizQuestions)
    assert.equal(selected[0].questionId, questionId)
    const makeClient = (account, authSession) => {
      const token = userToken(config, account, authSession)
      const client = supabaseClient(config.API_URL, config.ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
      })
      const getUser = client.auth.getUser.bind(client.auth), getClaims = client.auth.getClaims.bind(client.auth)
      client.auth.getUser = () => getUser(token)
      client.auth.getClaims = () => getClaims(token)
      state.clients.push(client)
      return client
    }
    let client = makeClient(user, session)
    const authUser = await client.auth.getUser(), authClaims = await client.auth.getClaims()
    assert.equal(authUser.error?.name ?? null, null, 'local live-user fixture validates')
    assert.equal(authUser.data.user?.id, user)
    assert.equal(authClaims.error?.name ?? null, null, 'local claims fixture validates')
    assert.equal(authClaims.data?.claims.session_id, session)
    const bridge = await client.from('courses').select('id,content_key').eq('content_key', course.contentKey).maybeSingle()
    assert.equal(bridge.error?.code ?? null, null, 'local owner bridge read works')
    const absent = await client.from('quiz_attempts')
      .select('id,user_id,course_id,question_count,status,revision,finished_at,quiz_attempt_questions(question_id,ordinal,content_revision)')
      .eq('id', attemptId).eq('user_id', user).maybeSingle()
    assert.equal(absent.error?.code ?? null, null, 'local embedded owner snapshot read works')
    const configMock = { isStudentAuthEnabled: () => true, getAuthSecretKey: () => config.SERVICE_ROLE_KEY,
      getSupabaseConfig: () => ({ url: config.API_URL, key: config.ANON_KEY }),
      isTrustedAuthOrigin: origin => origin === 'http://localhost:3000' }
    let published
    Module._load = function (name, ...args) {
      if (name === '@/lib/auth/config' || (name === './config' && args[0]?.filename.includes('/lib/auth/'))) return configMock
      if (name === '@/lib/supabase/server') return { createClient: async () => client }
      if (name === '@/lib/managed-content/published') return { getPublishedManagedCourse: async (...args) => {
        state.publishedCalls++
        return state.publishedUnavailable ? { status: 'unavailable' } : published.getPublishedManagedCourse(...args)
      } }
      return load.call(this, name, ...args)
    }
    for (const file of ['./current-student-attempt.ts', './rpc.ts', './recover-start.ts',
      '../auth/student-state.ts', '../auth/account-continuity.ts', '../managed-content/published.ts', '../../app/api/quiz-attempts/route.ts']) {
      delete require.cache[require.resolve(file)]
    }
    published = require('../managed-content/published.ts')
    const { POST } = require('../../app/api/quiz-attempts/route.ts')
    const { issueAccountContinuityToken } = require('../auth/account-continuity.ts')
    let pageToken = issueAccountContinuityToken(user, session)
    const post = body => POST(new Request('http://localhost:3000/api/quiz-attempts', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json',
        'x-campus-account-continuity': pageToken }, body: JSON.stringify(body),
    }))
    const start = { operation: 'start', attemptId, courseContentKey: course.contentKey, questions: selected }
    const snapshot = id => db(`select jsonb_agg(to_jsonb(q) order by ordinal)::text from public.quiz_attempt_questions q where attempt_id='${id}';`)
    const changePublication = withdraw => db(`begin; set local request.jwt.claims='${claims}';
      ${withdraw ? `select public.unpublish_managed_content('${itemId}',3);`
        : `select public.revise_managed_content('${itemId}',3,'{"prompt":"Republished fixture","options":["Original","Replacement"],"correctOption":1,"section":"Changed section"}');
           select public.review_managed_content('${itemId}',4,2,'approved'); select public.publish_managed_content('${itemId}',5,2);`}
      commit;`)
    const switchOwner = () => { client = makeClient(other, otherSession); pageToken = issueAccountContinuityToken(other, otherSession) }
    await run({ user, session, courseId, itemId, questionId, attemptId, start, post, snapshot, state, changePublication, switchOwner })
  } finally {
    Module._load = load
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
    db(`begin; delete from auth.users where id in ('${user}','${other}');
      delete from private.managed_content_create_intents where actor_id='${operator}';
      delete from public.managed_content_publications where item_id in (select id from public.managed_content_items where created_by='${operator}');
      delete from public.managed_content_reviews where item_id in (select id from public.managed_content_items where created_by='${operator}');
      delete from public.managed_content_revisions where item_id in (select id from public.managed_content_items where created_by='${operator}');
      delete from public.managed_content_items where created_by='${operator}'; delete from auth.users where id='${operator}'; commit;`)
  }
}

test('real HTTP START recovers its pinned snapshot after republish, withdrawal or unavailable current publication; RECORD still scores P',
  { skip: !enabled }, async () => {
    for (const change of ['republish','withdraw','unavailable']) await fixture(async f => {
      const lost = await f.post(f.start)
      assert.equal(lost.status, 200) // Deliberately discard the successful HTTP body.
      const before = f.snapshot(f.attemptId)
      assert.equal(JSON.parse(before).length, f.start.questions.length)
      if (change === 'unavailable') f.state.publishedUnavailable = true
      else f.changePublication(change === 'withdraw')
      const publication = db(`select coalesce(published_revision::text,'withdrawn') from public.managed_content_items where id='${f.itemId}';`)
      assert.equal(publication, change === 'republish' ? '2' : change === 'withdraw' ? 'withdrawn' : '1')
      f.state.publishedCalls = 0
      const retry = await f.post(f.start)
      assert.equal(retry.status, 200)
      assert.deepEqual(await retry.json(), { status: 'saved', attempt: { id: f.attemptId,
        revision: 0, status: 'in_progress', questionCount: f.start.questions.length } })
      assert.equal(f.state.publishedCalls, 0)
      assert.equal(db(`select count(*) from public.quiz_attempts where id='${f.attemptId}';`), '1')
      assert.equal(f.snapshot(f.attemptId), before)
      const freshId = randomUUID()
      const fresh = await f.post({ ...f.start, attemptId: freshId })
      assert.equal(fresh.status, change === 'unavailable' ? 503 : 409)
      assert.equal(db(`select count(*) from public.quiz_attempts where id='${freshId}';`), '0')
      const record = await f.post({ operation: 'record', attemptId: f.attemptId, courseContentKey: f.start.courseContentKey,
        expectedRevision: 0, answers: [{ questionId: f.questionId, ordinal: 0, optionIndex: 0 }] })
      assert.equal(record.status, 200)
      assert.deepEqual(JSON.parse(db(`select jsonb_build_object('correct',is_correct,'section',section_label)::text
        from public.quiz_attempt_answers where attempt_id='${f.attemptId}' and question_id='${f.questionId}';`)),
      { correct: true, section: 'Replay fixture' })
      assert.equal(f.snapshot(f.attemptId), before)
      f.switchOwner()
      const hidden = await f.state.clients.at(-1).from('quiz_attempts').select('id').eq('id', f.attemptId).maybeSingle()
      assert.equal(hidden.error, null); assert.equal(hidden.data, null, 'live owner RLS hides another student attempt')
      const hiddenQuestions = await f.state.clients.at(-1).from('quiz_attempt_questions').select('question_id').eq('attempt_id', f.attemptId)
      assert.equal(hiddenQuestions.error, null); assert.deepEqual(hiddenQuestions.data, [], 'snapshot RLS also hides it')
      const other = await f.post(f.start)
      assert.notEqual(other.status, 200, 'another live student cannot recover the original attempt')
    })
  })

test('two identical first HTTP STARTs create one attempt and immutable snapshot through the existing write boundary',
  { skip: !enabled }, async () => fixture(async f => {
    const [a,b] = await Promise.all([f.post(f.start),f.post(f.start)])
    assert.equal(a.status, 200); assert.equal(b.status, 200)
    assert.deepEqual(await a.json(), await b.json())
    assert.equal(db(`select count(*) from public.quiz_attempts where id='${f.attemptId}';`), '1')
    assert.equal(JSON.parse(f.snapshot(f.attemptId)).length, f.start.questions.length)
  }))

test('final real RLS confirmation rejects deterministic post-read expiry/deletion and advanced state without fresh fallthrough',
  { skip: !enabled }, async () => {
    for (const mode of ['valid', 'expire', 'delete', 'advance']) await fixture(async f => {
      db(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id='${f.session}';`)
      assert.equal((await f.post(f.start)).status, 200)
      const beforeSnapshot = f.snapshot(f.attemptId)
      const beforeAttempt = db(`select to_jsonb(a)::text from public.quiz_attempts a where id='${f.attemptId}';`)
      const client = f.state.clients[0], from = client.from.bind(client)
      const fetch = global.fetch, writes = []
      let recoveryReads = 0, firstMatched = false, finalVisible = null
      client.from = table => {
        const relation = from(table)
        if (table !== 'quiz_attempts') return relation
        const select = relation.select.bind(relation)
        relation.select = columns => {
          const query = select(columns), read = query.maybeSingle.bind(query)
          query.maybeSingle = async () => {
            const result = await read()
            recoveryReads++
            if (recoveryReads === 1) {
              assert.equal(result.error, null)
              assert.equal(result.data.id, f.attemptId)
              assert.equal(result.data.revision, 0)
              assert.equal(result.data.quiz_attempt_questions.length, f.start.questions.length)
              firstMatched = true
              // First real owner/live-session SELECT is complete. Invalidate only
              // now, without a timer or a production hook, before returning it.
              if (mode === 'expire') db(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${f.session}';`)
              if (mode === 'delete') db(`delete from auth.sessions where id='${f.session}';`)
              if (mode === 'expire') {
                const user = await client.auth.getUser(), claims = await client.auth.getClaims()
                assert.equal(user.error, null); assert.equal(user.data.user.id, f.user)
                assert.equal(claims.error, null); assert.equal(claims.data.claims.session_id, f.session,
                  'same cookie/JWT identity does not reveal durable not_after expiry')
              }
              if (mode === 'advance') assert.equal((await f.post({ operation: 'record', attemptId: f.attemptId,
                courseContentKey: f.start.courseContentKey, expectedRevision: 0,
                answers: [{ questionId: f.questionId, ordinal: 0, optionIndex: 0 }] })).status, 200)
            } else {
              assert.equal(result.error, null)
              finalVisible = result.data !== null
            }
            return result
          }
          return query
        }
        return relation
      }
      global.fetch = (url, options) => {
        if (String(url).endsWith('/rest/v1/rpc/write_quiz_attempt')) writes.push(JSON.parse(options.body).p_operation)
        return fetch(url, options)
      }
      try {
        f.state.publishedCalls = 0; f.state.publishedUnavailable = true
        const response = await f.post(f.start), body = await response.json()
        assert.equal(firstMatched, true)
        assert.equal(f.state.publishedCalls, 0)
        assert.deepEqual(writes, mode === 'advance' ? ['record'] : [], 'recovery never invokes START/create or an extra write')
        if (mode === 'valid') {
          assert.equal(response.status, 200)
          assert.deepEqual(body, { status: 'saved', attempt: { id: f.attemptId,
            revision: 0, status: 'in_progress', questionCount: f.start.questions.length } })
          assert.equal(recoveryReads, 2); assert.equal(finalVisible, true)
        } else {
          assert.equal(response.status, mode === 'advance' ? 409 : 401)
          assert.deepEqual(body, { status: mode === 'advance' ? 'conflict' : 'signed-out' })
          if (mode === 'expire') { assert.equal(recoveryReads, 2); assert.equal(finalVisible, false) }
          if (mode === 'delete') assert.equal(recoveryReads, 1, 'live Auth rejects the deleted session before final SELECT')
          if (mode === 'advance') assert.equal(recoveryReads, 2)
        }
        assert.equal(f.snapshot(f.attemptId), beforeSnapshot)
        assert.equal(db(`select count(*) from public.quiz_attempts where user_id='${f.user}';`), '1')
        const afterAttempt = db(`select to_jsonb(a)::text from public.quiz_attempts a where id='${f.attemptId}';`)
        if (mode !== 'advance') assert.equal(afterAttempt, beforeAttempt, 'acknowledgement mutates no attempt state')
        else assert.equal(JSON.parse(afterAttempt).revision, 1, 'only the legitimate control RECORD advanced the attempt')
      } finally { global.fetch = fetch; client.from = from }
    })
  })
