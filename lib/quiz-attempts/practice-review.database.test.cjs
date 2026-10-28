// Opt in: PRACTICE_DB_TEST=1 PRACTICE_DB_CONTAINER=supabase_db_<isolated-project>.
// Every request demonstrably waits on a real lock before its session/window changes.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./practice-review-fixture.cjs')

for (const operation of ['state', 'attempt', 'graded-result', 'save', 'submit', 'replayed-start', 'existing-open-start']) {
  test(`${operation}: a session removed while queued on the account lock is refused`, { skip: !f.enabled }, async () => {
    const p = f.student()
    try {
      const id = f.begin(p)
      if (operation === 'graded-result') f.service(`public.practice_submit('${p.session}','${id}','${f.TAB}',0,0,'{}')`)
      const calls = { state: `public.practice_state('${p.session}','${f.FREE}')`,
        attempt: `public.practice_attempt('${p.session}','${id}')`,
        'graded-result': `public.practice_attempt('${p.session}','${id}')`,
        save: f.delta(p, id, 'save'), submit: f.delta(p, id, 'submit'),
        'replayed-start': f.start(p, id), 'existing-open-start': f.start(p, f.randomUUID()) }
      const result = await f.queued(calls[operation],
        `select pg_advisory_xact_lock(hashtextextended('practice-account:${p.user}',0))`,
        () => f.sql(`delete from auth.sessions where id='${p.session}'`))
      assert.deepEqual(result, { state: 'signed-out' })
      if (operation === 'save' || operation === 'submit') {
        assert.equal(f.sql(`select saved_revision from public.quiz_attempts where id='${id}'`), '0', 'no answer was written')
        assert.equal(f.sql(`select status from public.quiz_attempts where id='${id}'`), 'in_progress', 'no submission was accepted')
      }
    } finally { f.cleanup(p) }
  })
}

for (const operation of ['save', 'submit', 'state']) {
  test(`${operation}: session removal during the final attempt-row wait is refused`, { skip: !f.enabled }, async () => {
    const p = f.student()
    try {
      const id = f.begin(p)
      if (operation === 'state') f.sql(`update public.quiz_attempts set created_at=created_at-interval '1 hour',
        deadline_at=clock_timestamp()-interval '1 second' where id='${id}'`)
      const call = operation === 'state' ? `public.practice_state('${p.session}','${f.FREE}')` : f.delta(p, id, operation)
      const result = await f.queued(call, `select 1 from public.quiz_attempts where id='${id}' for update`,
        () => f.sql(`delete from auth.sessions where id='${p.session}'`))
      assert.deepEqual(result, { state: 'signed-out' })
      if (operation !== 'state') assert.equal(f.sql(`select saved_revision from public.quiz_attempts where id='${id}'`), '0')
    } finally { f.cleanup(p) }
  })
}

for (const operation of ['record', 'finish']) {
  test(`legacy ${operation}: crossing 24 hours while waiting cannot accept an answer or change the score`, { skip: !f.enabled }, async () => {
    const p = f.student(), id = f.randomUUID()
    try {
      f.sql(`insert into public.quiz_attempts(id,user_id,course_id,question_count,created_at)
        values('${id}','${p.user}','${f.FREE}',1,clock_timestamp()-interval '24 hours'+interval '4 seconds');
        insert into public.quiz_attempt_questions(attempt_id,question_id,ordinal,item_id,content_revision)
        select '${id}',question_id,0,id,published_revision from public.managed_content_items
        where course_id='${f.FREE}' and kind='cbt_question' and published_revision is not null order by id limit 1;`)
      const choice = f.answer(id), [question, option] = Object.entries(choice)[0]
      const answers = JSON.stringify([{ question_id: question, ordinal: 0, option_index: option }])
      const call = `public.write_quiz_attempt('${p.session}','${id}','${f.FREE}',0,'${operation}',0,
        '${operation === 'record' ? 'in_progress' : 'submitted'}','${answers}')`
      const cutoff = `select created_at+interval '24 hours' <= clock_timestamp() from public.quiz_attempts where id='${id}'`
      const result = await f.queued(call, `select 1 from public.quiz_attempts where id='${id}' for update`, async () => {
        assert.equal(f.sql(cutoff), 'f', 'the request queued before the cutoff')
        await f.until(() => f.sql(cutoff) === 't', 'the strict legacy cutoff')
      })
      assert.deepEqual(result, { status: 'finalized' })
      assert.equal(f.sql(`select status||':'||revision||':'||coalesce(score::text,'null') from public.quiz_attempts where id='${id}'`),
        'in_progress:0:null', 'the late write leaves the attempt unchanged')
      assert.equal(f.sql(`select count(*) from public.quiz_attempt_answers where attempt_id='${id}'`), '0')
    } finally { f.cleanup(p) }
  })
}

test('a bank shrinking to the same attempt count asks again before silently changing whole-bank mode', { skip: !f.enabled }, () => {
  const p = f.student(), id = f.randomUUID()
  try {
    const call = f.start(p, id, f.FREE, false)
    const result = JSON.parse(f.sql(`begin;
      update public.managed_content_items set published_revision=null where id in
        (select id from public.managed_content_items where course_id='${f.FREE}' and kind='cbt_question'
          and published_revision is not null order by id limit 50);
      set role service_role; select ${call}::text; rollback;`))
    assert.deepEqual(result, { state: 'policy-changed', question_count: 50, duration_seconds: 1800, bank_size: 50 })
    assert.equal(f.sql(`select count(*) from public.quiz_attempts where id='${id}'`), '0')
  } finally { f.cleanup(p) }
})

test('D7: after course access ends, a live session still saves, submits and reads its own review', { skip: !f.enabled }, () => {
  const p = f.student(), id = f.randomUUID()
  try {
    assert.equal(f.service(f.start(p, id, f.PLAN)).state, 'ready')
    f.sql(`update public.entitlement_grants set ends_at=clock_timestamp()-interval '1 second' where user_id='${p.user}'`)
    assert.equal(f.service(f.delta(p, id, 'save')).state, 'saved')
    assert.equal(f.service(`public.practice_submit('${p.session}','${id}','${f.TAB}',1,1,'{}')`).state, 'graded')
    assert.equal(f.service(`public.practice_attempt('${p.session}','${id}')`).attempt.result.score, 1)
  } finally { f.cleanup(p) }
})
