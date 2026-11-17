// app/courses/ai-practice/[courseId]/page.test.cjs — Where the Campus Bot link on a course row lands, and what the page
// hands Campus Bot: the free month only when the database says this student can claim it now.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../../../lib/test/element-walker.cjs')
const { entitlementSummarySchema } = require('../../../../lib/entitlements/contract.ts')

const COURSE = '41111111-1111-4111-8111-111111111111'
const reference = (id, label) => ({ id, label, isActive: true })
const mine = { department: reference('11111111-1111-4111-8111-111111111111', 'Business Administration'),
  academicLevel: reference('21111111-1111-4111-8111-111111111111', '100 Level'),
  academicPeriod: reference('31111111-1111-4111-8111-111111111111', 'Second Semester') }
const elsewhere = { ...mine, academicLevel: reference('22222222-2222-4222-8222-222222222222', '300 Level') }
// GST102 as the read model hands it over: free, offered to the student's own semester, nothing built.
const course = (overrides = {}) => ({ institutionalCourseId: COURSE, code: 'GST102', title: 'Philosophy and Logic',
  isFree: true, applicability: [mine], repository: { state: 'unlinked' }, content: { state: 'not-built', reason: 'unlinked' },
  ...overrides })
// get_my_course_access answers a free course before it looks at the student's list: on_list is never set.
const decision = (reason, extra = {}) => ({ institutional_course_id: COURSE, reason,
  allowed: ['free', 'operator', 'own-list', 'team-added'].includes(reason), on_list: false, team_added: false,
  ends_at: null, ...extra })
const savedSet = { generationId: '71111111-1111-4111-8111-111111111111', createdAt: '2026-11-10T09:00:00.000Z',
  fileName: 'logic-notes.pdf', questions: [] }
// The plan as the server read it for a student with no plan, a day after launch; `free_month` is the database's answer
// to "can this student claim now", with the day the month would end.
const plan = (freeMonth, overrides = {}) => ({ status: 'ok', entitlement: { ...entitlementSummarySchema.parse({
  now: '2026-11-16T12:00:00+00:00', planned_launch_at: '2026-11-14T23:00:00+00:00', actual_launch_at: '2026-11-15T08:00:00+00:00',
  trial_hours: 72, trial_days: 3, expiry_notice_hours: 12, tier: 'free', access: null,
  trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null },
  discovery: { cbt_questions: 50, ai_sets: 1, previews: [] }, otp: null,
  early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: '2026-11-25T08:00:00+00:00' },
  ...overrides }), free_month: freeMonth } })

async function fixture(run) {
  return withTsx(async () => {
    const original = Module._load, client = {}, user = { id: 'student' }, reads = [], planReads = []
    const state = { course: course(), decision: decision('free'), sets: [], enabled: true,
      // What the entitlement read and the profile revision read answer.
      plan: { status: 'unavailable' }, revision: 1,
      allowance: { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null },
      profile: { status: 'complete', revision: 1, firstName: 'Ada', options: {}, selection: mine } }
    function StudentAccessGate() { return null }
    function AiPracticeClient() { return React.createElement('div', { 'data-campus-bot': '' }) }
    const selection = original.call(Module, path.join(__dirname, '../../../..', 'lib/profile/course-selection.ts'), module, false)
    const local = relative => path.join(__dirname, '../../../..', relative)
    try {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/navigation') return { notFound: () => { throw new Error('notFound') },
          redirect: destination => { throw new Error('redirect:' + destination) } }
        if (name === '@/lib/supabase/server') return { createClient: async () => client }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
          assert.equal(supplied, client); return { user, sessionId: 'live-session' }
        } }
        if (name === '@/lib/courses/read-model') return {
          // The real predicates; only the verified read is the fixture's.
          ...original.call(this, local('lib/courses/read-model.ts'), ...args),
          getStudentCourseByIdForVerifiedStudent: async (supplied, id) => {
            assert.equal(supplied, client); assert.equal(id, COURSE); return { status: 'ok', course: state.course }
          },
        }
        if (name === '@/lib/courses/access') return { getCourseAccessForVerifiedStudent: async (supplied, ids) => {
          assert.equal(supplied, client); assert.deepEqual(ids, [COURSE])
          return state.decision === null ? { status: 'unavailable' }
            : { status: 'ok', decisions: new Map([[COURSE, state.decision]]) }
        } }
        if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfileForVerifiedStudent: async (supplied, owner) => {
          assert.equal(supplied, client); assert.equal(owner, user); reads.push('profile'); return state.profile
        } }
        if (name === '@/lib/ai-practice/supabase-env') return {
          listPersonalSetsForCourse: async (supplied, owner, id) => {
            assert.equal(supplied, client); assert.equal(owner, user.id); assert.equal(id, COURSE); return state.sets
          },
          readAllowance: async supplied => { assert.equal(supplied, client); return state.allowance },
        }
        if (name === '@/lib/ai-practice/config') return { isAiPracticeAvailable: () => state.enabled }
        if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async (supplied, options) => {
          assert.equal(supplied, client); planReads.push(options)
          if (state.plan === 'fails') throw new Error('read failed')
          return state.plan
        } }
        if (name === '@/lib/profile/course-selection') return { ...selection, readProfileRevision: async (supplied, owner) => {
          assert.equal(supplied, client); assert.equal(owner, user.id); return state.revision
        } }
        if (name === './AiPracticeClient') return { AiPracticeClient }
        return original.call(this, name, ...args)
      }
      const page = require('./page.tsx').default
      const open = async () => {
        const gated = await page({ params: Promise.resolve({ courseId: COURSE }) })
        assert.equal(gated.type, StudentAccessGate)
        assert.equal(gated.props.returnPath, `/courses/ai-practice/${COURSE}`)
        const child = gated.props.children('page-token')
        return child.type(child.props)
      }
      const workspace = async () => {
        const screens = elementNodes(await open()).filter(node => node.type === AiPracticeClient)
        assert.equal(screens.length, 1, 'the page shows Campus Bot')
        return { ...screens[0].props, key: screens[0].key }
      }
      await run({ state, reads, planReads, open, workspace })
    } finally { Module._load = original }
  })
}

test('the Campus Bot link on a free course without materials opens Campus Bot, never My Courses again', async () => fixture(async f => {
  const props = await f.workspace()
  assert.equal(props.courseId, COURSE)
  assert.equal(props.continuityToken, 'page-token')
  assert.equal(props.canGenerate, true, 'the student’s own course: the notice or the upload, by what their account holds')
  assert.equal(props.uploadsUnavailableReason, undefined)
  assert.deepEqual(props.initialAllowance, f.state.allowance)
  assert.deepEqual(f.reads, ['profile'], 'the list is read from the student’s own saved selection')
  const html = renderToStaticMarkup(await f.open())
  assert.match(html, /<b>GST102<\/b> · Philosophy and Logic/)
  assert.doesNotMatch(html, /Turn your own notes into practice questions/, 'the title says it; no line repeats it')
  assert.equal(props.freeMonth, null, 'no plan read, no offer')
}))

test('a student who can claim the free month is offered it here, bound to the revision and end day the server read', async () => fixture(async f => {
  f.state.plan = plan({ endsAt: '2026-12-16T13:30:00+00:00' }, { plans_on_sale: true, plans: [] })
  f.state.revision = 7
  const props = await f.workspace()
  assert.deepEqual(props.freeMonth, { continuityToken: 'page-token', profileRevision: 7, endsOn: '16 December' })
  assert.deepEqual(f.planReads.at(-1), { freeMonth: true }, 'the page asks whether this student can claim now')
  assert.equal(props.plansOnSale, true, 'what else the page could say is still handed over; the month comes first')
}))

test('no free month here when the database offers none, or the plan or the revision cannot be read', async () => fixture(async f => {
  f.state.plan = plan(null)
  assert.equal((await f.workspace()).freeMonth, null, 'the database offers none')
  f.state.plan = plan({ endsAt: '2026-12-16T13:30:00+00:00' })
  f.state.revision = null
  assert.equal((await f.workspace()).freeMonth, null, 'a month must be bound to the courses the student saw (D7)')
  f.state.revision = 7
  for (const failed of [{ status: 'unavailable' }, { status: 'signed-out' }, 'fails']) {
    f.state.plan = failed
    const props = await f.workspace()
    assert.equal(props.freeMonth, null, JSON.stringify(failed))
    assert.deepEqual(props.trial, { policy: null, passAvailable: false }, 'and the wording stays neutral')
  }
}))

test('Campus Bot is drawn afresh when what the account holds changes, so a month claimed here opens the upload', async () => fixture(async f => {
  const before = (await f.workspace()).key
  f.state.allowance = { state: 'active', source: 'early_access', total: null, used: 0, endsAt: '2026-12-16T13:30:00.000Z' }
  const after = (await f.workspace()).key
  assert.deepEqual([before, after], ['not-entitled:', 'active:early_access'])
}))

test('a free course of another level stays outside Campus Bot, as every course off the student’s list does', async () => fixture(async f => {
  f.state.course = course({ applicability: [elsewhere] })
  await assert.rejects(f.open(), /^Error: redirect:\/my-courses$/)
  f.state.course = course()
  f.state.profile = { status: 'unavailable' }
  await assert.rejects(f.open(), /^Error: redirect:\/my-courses$/, 'an unread selection opens nothing')
  f.state.profile = { status: 'complete', revision: 1, firstName: 'Ada', options: {}, selection: mine }
  f.state.decision = null
  await assert.rejects(f.open(), /^Error: redirect:\/my-courses$/, 'an unread decision opens nothing')
}))

test('saved sets stay with their owner when a free course has left the list, without the upload', async () => fixture(async f => {
  f.state.course = course({ applicability: [elsewhere] })
  f.state.sets = [savedSet]
  const props = await f.workspace()
  assert.equal(props.canGenerate, false)
  assert.equal(props.uploadsUnavailableReason, 'outside-list')
  assert.deepEqual(props.recentSets, [savedSet])
}))

test('a paid course keeps the database’s answer about the list', async () => fixture(async f => {
  f.state.course = course({ code: 'PSY101', title: 'Introduction to Psychology', isFree: false })
  f.state.decision = decision('needs-plan', { on_list: true })
  assert.equal((await f.workspace()).canGenerate, true, 'on the list without a plan: the page names what is missing')
  f.state.decision = decision('own-list', { on_list: true })
  assert.equal((await f.workspace()).canGenerate, true)
  f.state.decision = decision('team-added', { team_added: true })
  f.state.course = course({ isFree: false, applicability: [elsewhere] })
  assert.equal((await f.workspace()).canGenerate, true)
  // The saved selection matches, but the database looked at the list and said no.
  f.state.course = course({ isFree: false })
  for (const reason of ['outside-list', 'needs-selection', 'missing-calendar']) {
    f.state.decision = decision(reason)
    await assert.rejects(f.open(), /^Error: redirect:\/my-courses$/, reason)
  }
}))

test('with Campus Bot switched off the student’s own free course says so, and still does not bounce', async () => fixture(async f => {
  f.state.enabled = false
  const html = renderToStaticMarkup(await f.open())
  assert.match(html, /<h2 class="student-notice-title">Campus Bot is unavailable\.<\/h2><div class="student-notice-action">/,
    'one line, then the way back')
  assert.match(html, /href="\/my-courses"/)
  assert.doesNotMatch(html, /data-campus-bot/)
}))
