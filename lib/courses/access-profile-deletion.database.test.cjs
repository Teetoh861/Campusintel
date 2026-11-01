const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./access-scope-fixture.cjs')
const INST = '50000000-0000-4000-8000-000000000072'
const pending = p => f.sql(`update public.entitlement_grants set course_term_id=null,course_department_id=null
  where user_id='${p.user}'; delete from private.entitlement_events
  where user_id='${p.user}' and event='course.grant-bound'`)
const bindings = p => Number(f.sql(`select count(*) from private.entitlement_events
  where user_id='${p.user}' and event='course.grant-bound'`))
const noLockError = result => {
  assert.equal(result.code, 0, result.err)
  assert.doesNotMatch(result.err, /40P01|55P03|deadlock|lock timeout|could not obtain lock/i)
  return JSON.parse(result.out.split('\n').at(-1))
}

// Catch only the two handled domain outcomes. A deadlock or raw lock refusal fails the SQL command.
function save(p, change = false) {
  return f.asStudent(p, `do $$ begin
    update public.profiles set first_name='Amara',department_id=department_id,
      academic_level_id=${change ? "'20000000-0000-4000-8000-000000000001'" : 'academic_level_id'},
      academic_period_id=academic_period_id where id='${p.user}';
    perform set_config('access_review.result','saved',false);
  exception when sqlstate 'CI409' then perform set_config('access_review.result','retry',false);
    when insufficient_privilege then perform set_config('access_review.result','signed-out',false);
  end $$; select jsonb_build_object('status',current_setting('access_review.result'))::text`)
}

function verifiedSession(p) {
  const session = f.randomUUID()
  f.sql(`insert into auth.sessions(id,user_id,created_at,updated_at) values('${session}','${p.user}',now(),now())`)
  return session
}
const schedule = (p, proof) => f.service(`select public.schedule_student_deletion('${p.session}','${proof}')::text`)
const dueJob = p => f.sql(`insert into private.account_deletion_jobs(user_id,requested_at,deadline,retry_at)
  values('${p.user}',now()-interval '720 hours 1 minute',now()-interval '1 minute',now()-interval '1 minute')`)

/** Pause a real UPDATE after it owns the profile but before any lifecycle/selection/binding trigger. */
async function pauseSave(p, change) {
  const gate = 'a1-profile-gate-' + f.randomUUID(), marker = 'a1-profile-save-' + f.randomUUID()
  f.sql(`create function private.access_round2_pause_profile() returns trigger language plpgsql security definer as $$
    begin if new.id='${p.user}'::uuid then perform pg_advisory_xact_lock(hashtextextended('${gate}',0));
    end if; return new; end $$;
    create trigger profiles_aaa_access_round2 before update of first_name on public.profiles
      for each row execute function private.access_round2_pause_profile()`)
  const held = await f.hold(`select pg_advisory_xact_lock(hashtextextended('${gate}',0))`)
  const saving = f.background(`/* ${marker} */ ${save(p, change)}`)
  await f.until(() => f.waiting(marker), 'save owns the profile before its guards')
  return { held, saving }
}
const removePause = () => f.sql(`drop trigger if exists profiles_aaa_access_round2 on public.profiles;
  drop function if exists private.access_round2_pause_profile()`, { cleanup: true })

for (const deletion of ['schedule', 'purge']) for (const variant of ['pending-name', 'selection-change']) {
  test(`${deletion} behind ${variant}: no Auth/profile cycle or raw lock error`, { skip: !f.enabled }, async () => {
    const p = f.student({ source: variant === 'pending-name' ? 'manual' : null })
    let held, saving, deleting
    try {
      if (variant === 'pending-name') pending(p)
      const proof = deletion === 'schedule' ? verifiedSession(p) : null
      ;({ held, saving } = await pauseSave(p, variant === 'selection-change'))
      // Purge's job appears only after the student's UPDATE passed its statement-snapshot RLS check.
      if (deletion === 'purge') dueJob(p)
      const marker = 'a1-deletion-waits-profile-' + f.randomUUID()
      deleting = f.background(`/* ${marker} */ ${deletion === 'schedule' ? schedule(p, proof)
        : f.service('select public.run_account_deletion_jobs()::text')}`)
      await f.until(() => f.waiting(marker), 'deletion owns Auth and waits for the profile')
      await held.release(); held = null
      const saved = noLockError(await saving), deleted = noLockError(await deleting)
      if (deletion === 'schedule') {
        assert.equal(saved.status, variant === 'pending-name' ? 'saved' : 'retry')
        assert.equal(deleted.status, 'scheduled')
        assert.equal(f.sql(`select count(*) from auth.sessions where user_id='${p.user}'`), '0')
        assert.equal(bindings(p), 0, 'a profile trigger cannot bind a pending grant through an Auth FK')
        assert.equal(f.sql(`select first_name from public.profiles where id='${p.user}'`),
          variant === 'pending-name' ? 'Amara' : 'Ada', 'a retry rolls the entire save back')
      } else {
        assert.equal(saved.status, 'signed-out', 'fresh lifecycle check refuses a save queued before the due job')
        assert.equal(deleted.completed, 1)
        assert.equal(deleted.failedThisRun, 0, 'purge must not swallow a deadlock into last_error_code')
        assert.equal(f.sql(`select count(*) from auth.users where id='${p.user}'`), '0')
      }
    } finally {
      if (held) await held.release()
      if (saving) await saving
      if (deleting) await deleting
      removePause(); f.cleanup(p)
    }
  })
}

for (const variant of ['pending-name', 'selection-change']) test(`Early Access import/profile/${variant}/queued deletion: all sessions finish`,
  { skip: !f.enabled }, async () => {
    const p = f.student({ source: variant === 'pending-name' ? 'manual' : null })
    const email = `scope-race-${p.user}@example.test`
    const policy = JSON.parse(f.sql('select row_to_json(p)::text from private.entitlement_policy p'))
    let held, saving, importing, deleting
    try {
      if (variant === 'pending-name') pending(p)
      const proof = verifiedSession(p)
      f.sql(`update private.entitlement_policy set actual_launch_at=now()-interval '1 day'`)
      ;({ held, saving } = await pauseSave(p, variant === 'selection-change'))
      const importMarker = 'a1-import-waits-profile-' + f.randomUUID()
      importing = f.background(`/* ${importMarker} */ ${f.service(`select public.admin_add_early_access_member(
        '${email}','Ada',null,now()-interval '2 days','manual','round2 race','Ops')::text`)}`)
      await f.until(() => f.waiting(importMarker), 'import owns Auth SHARE and waits for profile')
      const deletionMarker = 'a1-deletion-waits-import-' + f.randomUUID()
      deleting = f.background(`/* ${deletionMarker} */ ${schedule(p, proof)}`)
      await f.until(() => f.waiting(deletionMarker), 'deletion queues on Auth behind the import')
      await held.release(); held = null
      const saved = noLockError(await saving)
      assert.ok(['saved', 'retry'].includes(saved.status))
      noLockError(await importing)
      assert.equal(noLockError(await deleting).status, 'scheduled')
      assert.equal(f.sql(`select count(*) from public.entitlement_grants where user_id='${p.user}' and source='early_access'`), '1')
      assert.equal(f.sql(`select count(*) from auth.sessions where user_id='${p.user}'`), '0')
    } finally {
      if (held) await held.release()
      if (saving) await saving
      if (importing) await importing
      if (deleting) await deleting
      removePause(); f.cleanup(p)
      f.sql(`delete from private.early_access_members where email='${email}';
        update private.entitlement_policy set actual_launch_at=${policy.actual_launch_at === null ? 'null' : `'${policy.actual_launch_at}'::timestamptz`}`,
      { cleanup: true })
    }
  })

for (const binding of ['read', 'operator-add', 'operator-correction']) test(`a profile save defers pending binding to the next ordered ${binding}`, { skip: !f.enabled }, async () => {
  const p = f.student()
  try {
    pending(p)
    assert.equal(noLockError(await f.background(save(p))).status, 'saved')
    assert.equal(bindings(p), 0)
    assert.equal(f.sql(`select course_term_id is null from public.entitlement_grants where user_id='${p.user}'`), 't')
    const term = f.sql(`select private.current_course_scope('${p.user}',clock_timestamp())->>'term_id'`)
    const revision = f.sql(`select revision from public.profiles where id='${p.user}'`)
    const ordered = binding === 'read' ? f.asStudent(p,
      `select jsonb_build_object('reason',(select reason from public.get_my_course_access(array['${INST}'::uuid])))::text`)
      : binding === 'operator-correction' ? f.correction(p)
      : f.service(`select public.admin_add_student_course('${p.user}','50000000-0000-4000-8000-000000000077',
        '${term}',${revision},'${f.randomUUID()}','Ops','pending binding')::text`)
    const result = noLockError(await f.background(ordered))
    assert.equal(binding === 'read' ? result.reason : result.state, binding === 'read' ? 'own-list' : binding === 'operator-add' ? 'added' : 'changed')
    assert.equal(bindings(p), 1)
    assert.equal(f.sql(`select course_department_id from public.entitlement_grants where user_id='${p.user}'`),
      binding === 'operator-correction' ? f.ACC : f.BUA)
    assert.equal(f.sql(`select course_term_id is not null from public.entitlement_grants where user_id='${p.user}'`), 't')
  } finally { f.cleanup(p) }
})
