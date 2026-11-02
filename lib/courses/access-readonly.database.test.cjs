// PostgREST GET executes this stable, invoker probe in a real read-only transaction, using the student's JWT and RLS.
// Opt in on the isolated A2 stack with ACCESS_SCOPE_DB_TEST/CONTAINER and ACCESS_SCOPE_API_CONFIG (local status JSON).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createHmac } = require('node:crypto')
const f = require('./access-scope-fixture.cjs')

test('read-only API SELECT projects pending bindings and never enrolls newly eligible Early Access', { skip: !f.enabled }, async () => {
  const cfg = JSON.parse(readFileSync(process.env.ACCESS_SCOPE_API_CONFIG, 'utf8'))
  assert.equal(new URL(cfg.API_URL).hostname, '127.0.0.1', 'only the selected local API')
  const p = f.student({ source: null }), attempt = f.randomUUID(), request = f.randomUUID()
  const probe = `a2_readonly_${request.replaceAll('-', '')}`
  const email = `scope-race-${p.user}@example.test`
  const policy = JSON.parse(f.sql('select to_jsonb(p) from private.entitlement_policy p'))
  const token = () => {
    const encoded = value => Buffer.from(JSON.stringify(value)).toString('base64url')
    const body = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role: 'authenticated', aud: 'authenticated',
      sub: p.user, session_id: p.session, exp: Math.floor(Date.now() / 1000) + 600 })}`
    return `${body}.${createHmac('sha256', cfg.JWT_SECRET).update(body).digest('base64url')}`
  }
  const get = async () => {
    const response = await fetch(`${cfg.API_URL}/rest/v1/rpc/${probe}`, { headers: { apikey: cfg.ANON_KEY,
      Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10_000) })
    const body = await response.json()
    assert.equal(response.status, 200, JSON.stringify(body))
    assert.equal(body.read_only, 'on')
    return body
  }
  try {
    f.sql(`insert into public.entitlement_grants(user_id,source,starts_at,ends_at,ai_terms,created_by)
      values('${p.user}','early_access',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day','uncapped','a2-readonly')`)
    assert.equal(JSON.parse(f.sql(f.service(f.start(p, attempt)))).state, 'ready')
    const answer = f.sql(`select jsonb_object_agg(q.question_id::text, r.payload->'correctOption')
      from public.quiz_attempt_questions q join public.managed_content_revisions r
      on r.item_id=q.item_id and r.revision=q.content_revision where q.attempt_id='${attempt}'`)
    assert.equal(JSON.parse(f.sql(f.service(`select public.practice_submit('${p.session}','${attempt}',
      '${f.randomUUID()}',1,0,'${answer}')`))).state, 'graded')
    const course = f.sql(`select id from public.institutional_courses where repository_course_id='${f.COURSE}'`)
    const doc = JSON.parse(f.sql(f.service(`select public.create_ai_practice_document('${p.session}','${course}',
      'notes.txt','text/plain',10,array['early_access'])`))).document_id
    f.sql(`update public.ai_practice_documents set status='ready',source_text='ready notes',word_count=2,
      source_sha256=encode(sha256(convert_to('ready notes','UTF8')),'hex') where id='${doc}'`)
    const begun = JSON.parse(f.sql(f.service(`select public.begin_ai_practice_generation('${p.session}','${request}',
      '${doc}',array['early_access'])`)))
    assert.equal(begun.state, 'started')
    const set = JSON.stringify({ formatVersion: 1, origin: 'ai-generated', visibility: 'personal', verification: 'unverified',
      questions: [{ id: 'retained-question' }] })
    assert.equal(JSON.parse(f.sql(f.service(`select public.finish_ai_practice_generation('${p.user}',
      '${begun.generation_id}','generated',null,'${set}',null)`))).status, 'generated')
    f.sql(`update public.entitlement_grants set course_term_id=null,course_department_id=null where user_id='${p.user}';
      create function public.${probe}() returns jsonb language sql stable security invoker set search_path='' as $probe$
        select jsonb_build_object('read_only',current_setting('transaction_read_only'),
          'answers',(select count(*) from public.quiz_attempt_answers),
          'answer_values',(select jsonb_agg(is_correct) from public.quiz_attempt_answers),
          'documents',(select count(*) from public.ai_practice_documents),
          'sets',(select count(*) from public.ai_practice_generations),
          'saved_sets',(select jsonb_agg(question_set) from public.ai_practice_generations))
      $probe$;
      revoke all on function public.${probe}() from public,anon,service_role;
      grant execute on function public.${probe}() to authenticated;
      notify pgrst,'reload schema';`)
    // Wait for PostgREST's schema cache only; no student-access call may repair the fixture first.
    for (let i = 0; i < 100; i++) {
      const response = await fetch(`${cfg.API_URL}/rest/v1/`, { headers: { apikey: cfg.ANON_KEY,
        Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10_000) })
      if ((await response.text()).includes(probe)) break
      await f.delay(50)
    }
    const audit = f.sql(`select count(*) from private.entitlement_events where user_id='${p.user}'`)
    assert.deepEqual(await get(), { read_only: 'on', answers: 1, answer_values: [true], documents: 1, sets: 1,
      saved_sets: [JSON.parse(set)] })
    assert.equal(f.sql(`select course_term_id is null and course_department_id is null from public.entitlement_grants
      where user_id='${p.user}'`), 't', 'the API did not persist a binding')
    assert.equal(f.sql(`select count(*) from private.entitlement_events where user_id='${p.user}'`), audit)
    f.sql(`delete from public.entitlement_grants where user_id='${p.user}';
      insert into private.early_access_members(email,full_name,joined_at,source,batch,added_by)
        values('${email}','Ada',clock_timestamp()-interval '2 days','manual','a2-readonly','a2-test');
      update private.entitlement_policy set actual_launch_at=clock_timestamp()-interval '1 hour' where singleton;`)
    assert.equal(f.sql(`select private.early_access_status('${p.user}')->>'status'`), 'eligible')
    assert.deepEqual(await get(), { read_only: 'on', answers: 0, answer_values: null, documents: 0, sets: 1,
      saved_sets: [JSON.parse(set)] })
    assert.equal(f.sql(`select count(*) from public.entitlement_grants where user_id='${p.user}'`), '0', 'no enrollment')
    assert.equal(f.sql(`select claimed_at is null from private.early_access_members where email='${email}'`), 't')
  } finally {
    f.sql(`drop function if exists public.${probe}(); notify pgrst,'reload schema';
      delete from private.early_access_members where email='${email}';
      update private.entitlement_policy set actual_launch_at=${policy.actual_launch_at === null ? 'null' : `'${policy.actual_launch_at}'::timestamptz`} where singleton;`)
    f.cleanup(p)
  }
})
