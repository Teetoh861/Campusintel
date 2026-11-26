// app/dashboard/dashboard.test.cjs — Personalized course-file navigation, unchanged private Continue behavior, and free
// access: one card at the top while this student can claim it, then one line with its last day ("Free until {day}").
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

const NOW = '2026-10-27T09:00:00.000Z'
// The instant the claim closes and free access ends (20261126100000): the end of 30 December in Lagos, 23:00 UTC.
const END = '2026-12-30T23:00:00+00:00'
const root = path.join(__dirname, '../..')
const { entitlementSummarySchema } = require(path.join(root, 'lib/entitlements/contract.ts'))
// The plan as the server read it, at the database's clock NOW (or `now`), a day after launch, for a student with no plan.
// `free_month` is the database's answer to "can this student claim now", with the instant free access would end.
const planRead = ({ free_month = null, ...overrides } = {}) => ({ status: 'ok', entitlement: { ...entitlementSummarySchema.parse({
  now: NOW, planned_launch_at: '2026-10-25T23:00:00+00:00', actual_launch_at: '2026-10-26T08:00:00+00:00',
  trial_hours: 72, trial_days: 3, expiry_notice_hours: 12, tier: 'free', access: null,
  trial: { status: 'available', policy: null, starts_at: null, ends_at: null, available_from: null },
  discovery: { cbt_questions: 50, ai_sets: 1, previews: [] }, otp: null,
  early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: END },
  ...overrides }), free_month } })
const hoursFromNow = hours => new Date(Date.parse(NOW) + hours * 3_600_000).toISOString()

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = { ...require.cache }
  const state = { enabled: true, aiAvailable: false, context: { user: { id: 'student', email: 'not-a-name@example.test' }, sessionId: 'session' },
    failure: false, client: {}, profile: { status: 'complete', firstName: 'Ọlá', selection: {
      department: { id: 'dept', label: 'Business Administration', isActive: true },
      academicLevel: { id: 'level', label: '200 Level', isActive: true },
      academicPeriod: { id: 'period', label: 'First Semester', isActive: true },
    } }, profileReads: 0, courseReads: 0, current: { status: 'ok',
      selection: { departmentId: 'dept', academicLevelId: 'level', academicPeriodId: 'period' },
      courses: [], cbtBankSizes: new Map() },
    progressReads: [], progress: { status: 'ok', now: NOW, open: null, latest: null, courses: new Map() },
    // What the plan read and the profile revision read answer, and what the page asked the plan read for.
    plan: { status: 'unavailable' }, revision: 4, planReads: [],
    // The one-course read of an open attempt's course off the student's list, and what the page asked it for.
    bySlug: () => ({ status: 'not-found' }), slugReads: [] }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return { redirect: target => { throw Error('redirect:' + target) },
        // The free month button asks the router to read the page again; these renders mount no router.
        useRouter: () => ({ refresh() {} }) }
      if (name === '@/lib/entitlements/server') return {
        ...load.call(this, path.join(root, 'lib/entitlements/server.ts'), ...args),
        readEntitlementForVerifiedStudent: async (client, options) => {
          assert.equal(client, state.client); state.planReads.push(options); return state.plan
        },
      }
      if (name === '@/lib/profile/course-selection') return {
        ...load.call(this, path.join(root, 'lib/profile/course-selection.ts'), ...args),
        readProfileRevision: async (client, owner) => {
          assert.equal(client, state.client); assert.equal(owner, state.context.user.id); return state.revision
        },
      }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      if (name === '@/lib/ai-practice/config') return { isAiPracticeAvailable: () => state.aiAvailable }
      if (name === '@/lib/supabase/server') return { createClient: async () => state.client }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => {
        if (state.failure) throw Error('private provider details')
        return state.context
      } }
      if (name === '@/lib/auth/account-continuity') return { issueAccountContinuityToken: () => 'page-token' }
      if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfileForVerifiedStudent: async (client, user) => {
        assert.equal(client, state.client); assert.equal(user, state.context.user)
        state.profileReads++; return state.profile
      } }
      if (name === '@/components/auth/AuthFlowSync') return { AuthFlowSync: () => null }
      if (name === '@/lib/practice/progress') return { readPracticeProgress: async sessionId => {
        state.progressReads.push(sessionId); return state.progress
      } }
      if (name === '@/lib/courses/read-model') return {
        // Real central predicates; only the verified-student read is replaced by fixture state.
        ...load.call(this, path.join(__dirname, '../../lib/courses/read-model.ts'), ...args),
        getCurrentStudentCoursesForVerifiedStudent: async (client, user) => {
          assert.equal(client, state.client); assert.equal(user, state.context.user)
          state.courseReads++; return state.current
        },
        getStudentCourseBySlugForVerifiedStudent: async (client, slug, options) => {
          assert.equal(client, state.client); state.slugReads.push([slug, options]); return state.bySlug(slug)
        },
      }
      return load.call(this, name, ...args)
    }
    const page = require('./page.tsx').default
    await run({ state, page, html: async () => renderToStaticMarkup(await page()) })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!Object.hasOwn(cache, key)) delete require.cache[key]
  }
}

test('sprint plan 23 Oct item 2: home is a real personalized command centre with no fabricated activity', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready')]
  const html = await f.html()
  for (const text of ['Hi, Ọlá', 'Business Administration', '200 Level', 'First Semester',
    'My Courses', 'Practice', 'All Courses', 'Bookmarks', 'Request material', 'Help &amp; Support', 'Profile', 'Waitlist']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /Welcome back|Your study space/, 'a first visit is greeted like any other, with no filler beside the university')
  assert.doesNotMatch(html, /streak|GPA|credits remaining|Tobi|not-a-name@|Saved files/)
  assert.match(courseCard(html), /<h2 id="my-courses-title">My Courses<\/h2>/)
  assert.doesNotMatch(html, /This semester|Your courses ·/)
  assert.equal(f.state.profileReads, 1)
  assert.equal(f.state.courseReads, 1)
  assert.deepEqual(f.state.progressReads, ['session'], 'one practice read for every course, for the verified session')
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8'), /CourseRow|use client|cache\(|unstable_cache|use cache/)
}))

test('Practice describes Campus Bot practice according to its availability, separate from material requests', async () => fixture(async f => {
  const html = await f.html()
  assert.doesNotMatch(html, /Verified CBT practice/, 'no unbacked claim above Practice')
  assert.match(html, /href="\/my-courses"/)
  assert.match(html, /Practise from your notes/)
  assert.match(html, /Unavailable right now/)
  assert.doesNotMatch(html, /Campus Bot practice from your notes is unavailable|Choose a course to practise/, 'said once, by the tag')
  const upload = html.match(/<section aria-labelledby="upload-practice-title"[\s\S]*?<\/section>/)?.[0]
  assert.ok(upload)
  assert.doesNotMatch(upload, /<a |<button|type="file"|href=/)
  assert.match(html, /href="\/materials"/)
  assert.doesNotMatch(html, /sparkle|wand|robot|chat|copilot/i)
  const practice = html.match(/<article aria-labelledby="practice-title"[\s\S]*?<\/article>/)?.[0]
  assert.ok(practice.includes(upload), 'future upload is attached to the same Practice proposition')
  assert.ok(practice.indexOf(upload) < practice.indexOf('dashboard-practice-action'), 'quiet upload note precedes the live practice action')
  assert.match(html, /id="practice-title">Practice<\/h2>/)
  assert.doesNotMatch(html, /Practice quizzes|dashboard-status/)
  assert.match(upload, /class="student-status-rail" data-status="unavailable">Unavailable right now/)
  assert.match(html, /class="student-status-rail" data-status="waitlist">Waitlist/)
  f.state.aiAvailable = true
  const enabled = await f.html()
  assert.doesNotMatch(enabled, /Unavailable right now|Currently unavailable|Coming soon/)
  assert.match(enabled, /<p>Campus Bot turns your notes into practice questions\.<\/p>/)
  assert.doesNotMatch(enabled, /courses without study materials/, 'the card says what Campus Bot does, not which courses it opens for')
}))

test('academic identity owns a full-width band outside the bounded course/action workspace', async () => fixture(async f => {
  const tree = await f.page(), shell = tree.props.children[1]
  assert.equal(shell.type.name, 'StudentPage', 'the shared Student App root owns the page')
  const identity = shell.props.band
  const band = identity.type(identity.props)
  assert.equal(band.type, 'header', 'the identity header is the band, not enclosed by the workspace')
  assert.equal(band.props.className, 'dashboard-identity student-enter')
  const inner = band.props.children[1]
  assert.ok(inner.props.className.split(' ').includes('student-workspace'), 'only the inner academic content is constrained')
  assert.equal(shell.props.workspaceClassName, 'dashboard-workspace')
  const [offer, month, notice, next, primary, supporting] = shell.props.children
  assert.deepEqual([offer, month], [false, false], 'no free month card or line unless the database gives one')
  assert.equal(notice.type.name, 'AccessNotice', 'the plan notice leads the workspace')
  assert.ok(!next, 'no Continue card before the student has started')
  assert.equal(primary.type.name, 'PrimaryCards')
  assert.equal(supporting.type.name, 'SupportingActions')
  const html = await f.html()
  assert.match(html, /class="student-page-root" data-student-app="true"><header class="dashboard-identity/)
  assert.match(html, /class="student-workspace student-page-workspace dashboard-workspace"/)
}))

// What the database offers: a claim now ends when the claim closes, at the end of 30 December (Lagos).
const MONTH = { endsAt: END, closesAt: END }
const words = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const offerCard = html => html.match(/<section aria-labelledby="free-month-title" class="dashboard-offer student-enter" data-free-month="offer">[\s\S]*?<\/section>/)[0]

test('a student who can claim free access sees one card at the top of the Dashboard: "Free until {day}", one line and the button', async () => fixture(async f => {
  f.state.plan = planRead({ free_month: MONTH })
  f.state.revision = 7
  f.state.current.courses = [mappedCourse(0, 'ready')]
  const tree = await f.page(), shell = tree.props.children[1]
  const [offer, month] = shell.props.children
  assert.equal(offer.type.name, 'FreeMonthCard')
  // endsOn: the last Lagos day the end covers, not the 31st its midnight falls on. closesInMs: 30 Dec 23:00 UTC less the
  // database's now, 27 Oct 09:00.
  assert.deepEqual(offer.props, { continuityToken: 'page-token', profileRevision: 7, endsOn: '30 December',
    closesInMs: (64 * 24 + 14) * 3_600_000 },
    'bound to the page token, the profile revision the page read and the last day the database gave')
  assert.equal(month, false)
  assert.deepEqual(f.state.planReads, [{ freeMonth: true }], 'the page asks whether this student can claim now')
  const html = await f.html()
  const card = offerCard(html)
  assert.equal(words(card), 'Free until 30 December Full access to your courses and Campus Bot. Get free access')
  assert.match(card, /<h2 id="free-month-title" class="dashboard-offer-title">Free until 30 December<\/h2>/, 'the title carries the day')
  assert.equal((card.match(/<button\b/g) || []).length, 1)
  assert.ok(html.indexOf('data-free-month="offer"') < html.indexOf('my-courses-title'), 'above every other card')
  assert.equal((html.match(/data-free-month=/g) || []).length, 1, 'offered once: no banner, line or second card')
  assert.equal((html.match(/30 December/g) || []).length, 1, 'the day is said once, in the title')
  assert.doesNotMatch(html, /Early Access|Free pass|Get your free pass|31 Dec|data-access-notice/,
    'no pass beside it, and never the 31st')
}))

test('free access is offered by the database clock: on 1 December and on its last morning the card reads the same day', async () => fixture(async f => {
  f.state.revision = 7
  // 1 Dec, 09:00 Lagos: the claim closes in 29 days and 15 hours, longer than a page timer waits. 30 Dec, 11:00 Lagos:
  // in 13 hours.
  for (const [now, closesInMs] of [['2026-12-01T08:00:00.000Z', 2_559_600_000], ['2026-12-30T10:00:00.000Z', 13 * 3_600_000]]) {
    f.state.plan = planRead({ now, free_month: MONTH })
    const [offer] = (await f.page()).props.children[1].props.children
    assert.deepEqual(offer.props, { continuityToken: 'page-token', profileRevision: 7, endsOn: '30 December', closesInMs }, now)
    assert.equal(words(offerCard(await f.html())), 'Free until 30 December Full access to your courses and Campus Bot. Get free access', now)
  }
}))

test('no free access card when the database offers none, the revision cannot be read, or the plan cannot be read', async () => fixture(async f => {
  const offered = async () => (await f.page()).props.children[1].props.children[0]
  f.state.plan = planRead()
  assert.equal(await offered(), false)
  f.state.plan = planRead({ free_month: MONTH })
  f.state.revision = null
  assert.equal(await offered(), false, 'free access must be bound to the courses the student saw (D7)')
  f.state.revision = 7
  f.state.plan = { status: 'unavailable' }
  assert.equal(await offered(), false)
  assert.doesNotMatch(await f.html(), /Free until|free access|data-free-month/i)
}))

// Free access as the database reports it once claimed: running until `endsAt`, read at the database's clock `now`.
const running = (endsAt, now = NOW) => planRead({ now, tier: 'full', access: { source: 'early_access', ends_at: endsAt },
  trial: { status: 'not-offered', policy: null, starts_at: null, ends_at: null, available_from: null },
  early_access: { status: 'active', starts_at: hoursFromNow(-24), ends_at: endsAt, enrollment_closes_at: null } })

test('running free access is one line, "Free until {day}"; in its last hours the notice gives the time instead', async () => fixture(async f => {
  // A claim made under the old rule keeps its own end, which is not at a Lagos midnight (D2).
  f.state.plan = running(hoursFromNow(24 * 20))
  const html = await f.html()
  assert.match(html, /<p class="dashboard-free-month student-enter" data-free-month="active">Free until 16 November<\/p>/)
  assert.equal((html.match(/Free until|free access/gi) || []).length, 1, 'said once')
  assert.doesNotMatch(html, /data-free-month="offer"|data-access-notice|Early Access|Get free access|free month/i)
  // Inside the notice window (12 hours, by the database's clock) the notice says when, to the minute, and the line goes.
  f.state.plan = running(hoursFromNow(11))
  const ending = await f.html()
  assert.doesNotMatch(ending, /data-free-month="active"/)
  assert.match(ending, /data-access-notice="access-ending"/)
  assert.match(words(ending), /Your free access ends Tue, 27 Oct 2026, 21:00\. After that, only GST courses stay free\. View your plan/)
  // Once it has ended, the Dashboard says nothing about it (Plan & Access does, once).
  f.state.plan = planRead({ trial: { status: 'not-offered', policy: null, starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'ended', starts_at: hoursFromNow(-24 * 31), ends_at: hoursFromNow(-1), enrollment_closes_at: null } })
  assert.doesNotMatch(await f.html(), /Free until|free access|data-free-month|data-access-notice/i)
}))

test('free access to the end of 30 December reads "Free until 30 December", never the 31st; from 12:00 that day it ends "at midnight tonight"', async () => fixture(async f => {
  // 1 Dec, then 30 Dec at 11:00 Lagos and a moment before 12:00: more than 12 hours are left, so the line and no notice.
  for (const now of ['2026-12-01T08:00:00.000Z', '2026-12-30T10:00:00.000Z', '2026-12-30T10:59:59.999Z']) {
    f.state.plan = running(END, now)
    const html = await f.html()
    assert.match(html, /<p class="dashboard-free-month student-enter" data-free-month="active">Free until 30 December<\/p>/, now)
    assert.doesNotMatch(html, /data-access-notice|31 Dec/, now)
  }
  // From 12:00 Lagos on its last day to its end, by the database's clock: the notice names no date or time that would
  // read as the 31st, and the line goes.
  for (const now of ['2026-12-30T11:00:00.000Z', '2026-12-30T22:59:59.999Z']) {
    f.state.plan = running(END, now)
    const html = await f.html()
    assert.doesNotMatch(html, /data-free-month/, now)
    assert.match(html, /data-access-notice="access-ending"/, now)
    assert.match(words(html), /Your free access ends at midnight tonight\. After that, only GST courses stay free\. View your plan/, now)
    assert.doesNotMatch(html, /Free until|31 Dec|00:00/, now)
  }
  // At its end the database reports it ended and offers nothing: the Dashboard says nothing about it.
  f.state.plan = planRead({ now: '2026-12-30T23:00:00.000Z',
    trial: { status: 'not-offered', policy: null, starts_at: null, ends_at: null, available_from: null },
    early_access: { status: 'ended', starts_at: hoursFromNow(-24), ends_at: END, enrollment_closes_at: null } })
  assert.doesNotMatch(await f.html(), /Free until|free access|data-free-month|data-access-notice/i)
}))

test('Courses and material retains personal Bookmarks first and quiet icon-led help/account destinations', async () => fixture(async f => {
  const html = await f.html()
  const material = html.match(/<section aria-labelledby="material-title"[\s\S]*?<\/section>/)?.[0]
  assert.ok(material)
  assert.match(material, />Courses and material<\/h2>/)
  assert.deepEqual([...material.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]),
    ['/bookmarks', '/courses', '/materials'])
  assert.deepEqual([...material.matchAll(/<h3>(.*?)<\/h3>/g)].map(match => match[1]),
    ['Bookmarks', 'All Courses', 'Request material'])
  assert.doesNotMatch(material, /<p\b/, 'each card is its name and its action, with no sentence between')
  assert.match(material, /dashboard-bookmark-card/)
  const utilities = html.match(/<section aria-labelledby="utilities-title"[\s\S]*?<\/section>/)?.[0]
  assert.ok(utilities)
  assert.deepEqual([...utilities.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]),
    ['/tutors', '/contact', '/account'])
  assert.equal((utilities.match(/class="[^"]*dashboard-utility-icon"/g) || []).length, 3)
  assert.doesNotMatch(utilities, /dashboard-utility-arrow|lucide-arrow-right/)
  assert.match(utilities, /data-status="waitlist">Waitlist/)
  assert.doesNotMatch(utilities, /Sign out|Log out|Logout|<button/)
}))

test('Dashboard actions stay arrow-free with their labels, destinations and keyboard focus families intact', async () => fixture(async f => {
  // A student with courses: an empty list has no View your courses (below).
  f.state.current.courses = [mappedCourse(0, 'ready')]
  const html = await f.html()
  const actions = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, attributes]) => /class="[^"]*\bdashboard-(?:course-file|practice-action|material-card|utility-row)\b/.test(attributes))
  const expected = [
    ['/my-courses', 'View your courses', 'card'], ['/my-courses', 'Choose a course', 'control'],
    ['/bookmarks', 'Open bookmarks', 'card'], ['/courses', 'Browse all courses', 'card'],
    ['/materials', 'Send a request', 'card'], ['/tutors', 'Tutors', 'row'],
    ['/contact', 'Help &amp; Support', 'row'], ['/account', 'Profile', 'row'],
  ]
  assert.equal(actions.length, expected.length)
  for (const [index, [href, label, focus]] of expected.entries()) {
    const [, attributes, body] = actions[index]
    assert.ok(attributes.includes(`href="${href}"`), href)
    assert.ok(attributes.includes(`student-focus-${focus}`), `${label}: keyboard focus`)
    assert.ok(body.includes(label), label)
    assert.doesNotMatch(body, /lucide-[\w-]*(?:arrow|chevron|move)[\w-]*right|[→⇒➜⟶➡›»]/i)
    if (focus === 'row') {
      assert.equal((body.match(/<svg\b/g) || []).length, 1, `${label}: retain the meaningful leading icon only`)
      assert.match(body, /dashboard-utility-icon/)
    }
  }
}))

test('server guards redirect absent sessions or incomplete names and keep failures private', async () => fixture(async f => {
  f.state.context = null
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fdashboard/)
  assert.equal(f.state.profileReads, 0)
  assert.equal(f.state.courseReads, 0)
  f.state.context = { user: { id: 'student' }, sessionId: 'session' }
  f.state.profile = { status: 'incomplete', firstName: null, options: {} }
  await assert.rejects(f.page, /redirect:\/profile-selection/)
  f.state.failure = true
  const html = await f.html()
  assert.match(html, /complete your request right now/)
  assert.doesNotMatch(html, /private provider details|Hi, Ọlá/)
  // A profile that can't be shown: the way to the team is the page by its name.
  f.state.failure = false
  f.state.profile = { status: 'invariant-failure' }
  const broken = await f.html()
  assert.match(broken, /complete your request right now/)
  assert.match(broken, /<a[^>]*href="\/contact"[^>]*>Help &amp; Support<\/a>/)
  assert.doesNotMatch(broken, /Contact support|Hi, Ọlá/)
}))

const shelf = index => ({ slug: `course-${index}`, contentKey: `course-${index}`, code: `SHELF${index}`, title: `Shelf ${index}` })
const shelved = index => ({ state: 'shelved', repositoryCourseId: `repository-${index}`, contentKey: `course-${index}`,
  isShared: false, route: { slug: `course-${index}`, href: `/courses/course-${index}`, course: shelf(index) } })
const unshelved = index => ({ state: 'unshelved-repository', repositoryCourseId: `repository-${index}`,
  contentKey: `provisioned-${index}`, isShared: null })
const study = flags => ({ notes: false, theory: false, cbtPractice: false, overview: true, ...flags })
// `unshelved` carries ready study content with no route; `overview-only` has a route with nothing to study.
const mappedCourse = (index, state) => ({ institutionalCourseId: `course-${index}`, code: `COURSE${index}`,
  title: `Course ${index} title`, isFree: false, applicability: [],
  repository: state === 'not-built' ? { state: 'unlinked' } : state === 'unshelved' ? unshelved(index) : shelved(index),
  content: state === 'ready' || state === 'unshelved' ? { state: 'ready', study: study({ notes: true, cbtPractice: true }) }
    : state === 'not-built' ? { state, reason: 'unlinked' }
      : state === 'locked' ? { state: 'locked' }
        : state === 'overview-only' ? { state: 'no-published-learning', study: study({}) }
          : { state: 'temporarily-unavailable', reason: 'publication-read-failed' } })
const courseCard = html => html.match(/<(a|section)\b[^>]*class="dashboard-course-file\b[^"]*"[^>]*>[\s\S]*?<\/\1>/)?.[0]
const items = html => [...(courseCard(html) ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1])
const continueCard = html => html.match(/<a\b[^>]*class="dashboard-continue[^>]*>([\s\S]*?)<\/a>/)?.[0]
const FIGURES = /practised|Last score|\d+ of \d+|progress|completion|streak|%/i
const started = (f, courses) => { f.state.progress = { ...f.state.progress, courses: new Map(courses) } }
const minutesFromNow = minutes => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()


test('day-one course file shows seven courses and three ready without listing identities or figures', async () => fixture(async f => {
  f.state.current.courses = ['ready', 'ready', 'ready', 'locked', 'not-built', 'unshelved', 'overview-only']
    .map((state, index) => mappedCourse(index, state))
  f.state.current.cbtBankSizes = new Map([['course-0', 12]])
  const html = await f.html(), card = courseCard(html)
  assert.ok(card)
  assert.match(card, /^<a\b[^>]*href="\/my-courses"/)
  assert.match(card, /class="dashboard-file-tab">7 courses · 3 ready to study<\/span>/)
  assert.match(card, /<h2 id="my-courses-title">My Courses<\/h2>/)
  assert.doesNotMatch(card, /Your semester, in one place/)
  assert.match(card, />View your courses<\/span>/)
  assert.doesNotMatch(card, /dashboard-file-index|Overview|Notes|CBT practice|Theory/, 'no list of study families: it would read the same for every student')
  assert.equal((card.match(/<a\b/g) || []).length, 1, 'the whole card is one target')
  assert.doesNotMatch(card, /<ul\b|<li\b|<button\b|Available study materials vary by course/)
  assert.doesNotMatch(html, /COURSE\d|Course \d title|This semester|Your courses ·/)
  assert.doesNotMatch(card, FIGURES, 'bank sizes do not produce progress')
  assert.equal(continueCard(html), undefined)
}))

test('course-file tab derives readiness from actionable courses and handles singular and none ready', async () => fixture(async f => {
  for (const [states, expected] of [
    [['ready'], '1 course · 1 ready to study'],
    [['locked', 'not-built', 'unshelved', 'overview-only', 'unavailable', 'not-built', 'locked'], '7 courses'],
    [['not-built'], '1 course'],
  ]) {
    f.state.current.courses = states.map((state, index) => mappedCourse(index, state))
    const card = courseCard(await f.html())
    assert.ok(card.includes(`class="dashboard-file-tab">${expected}</span>`), expected)
    assert.doesNotMatch(card, /0 ready|COURSE\d|Course \d title|Study materials are not available/)
  }
}))

test('sprint plan 23 Oct item 2: after a graded attempt, a Continue card and that course\'s own progress', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25]])
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-0', contentKey: 'course-0' } }
  started(f, [['repository-0', { practised: 10, lastScore: { score: 6, total: 10 } }]])
  const html = await f.html()
  const next = continueCard(html)
  assert.match(next, /href="\/courses\/course-0#cbtPractice"/, 'practice continues from the course\'s topic list')
  assert.match(next, /data-continue="continue"/)
  assert.match(next, />Continue practising COURSE0</)
  assert.match(next, />Course 0 title</)
  assert.ok(html.indexOf('dashboard-continue') < html.indexOf('my-courses-title'), 'the Continue card comes first')
  assert.doesNotMatch(courseCard(html), FIGURES)
}))

test('sprint plan 23 Oct item 2: an open attempt comes first, with the time it has left', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25]])
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-1', contentKey: 'course-1',
    deadlineAt: minutesFromNow(11.5) }, latest: { courseId: 'repository-0', contentKey: 'course-0' } }
  // The open attempt's course has no graded attempt yet, so the database sends no figures for it.
  started(f, [['repository-0', { practised: 10, lastScore: { score: 6, total: 10 } }]])
  const html = await f.html()
  const next = continueCard(html)
  assert.match(next, /data-continue="resume"/)
  assert.match(next, /href="\/courses\/course-1\/quiz"/)
  assert.match(next, />Resume exam: COURSE1, 12 min left</, 'an open exam is never called practice')
  assert.equal((html.match(/class="dashboard-continue /g) || []).length, 1, 'one next step only')
  assert.doesNotMatch(courseCard(html), FIGURES)
  for (const [minutes, text] of [[60, '1 hr left'], [95, '1 hr 35 min left'], [0.2, '1 min left']]) {
    f.state.progress = { ...f.state.progress, open: { ...f.state.progress.open, deadlineAt: minutesFromNow(minutes) } }
    assert.match(continueCard(await f.html()), new RegExp(`>Resume exam: COURSE1, ${text}<`))
  }
  f.state.progress = { ...f.state.progress, open: { ...f.state.progress.open, deadlineAt: NOW } }
  assert.match(continueCard(await f.html()), />Continue practising COURSE0</, 'an attempt whose time is up is never offered')
}))

test('instant feedback: an open attempt is resumed with no clock, and picks show as practised before any score', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25]])
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-1', contentKey: 'course-1',
    deadlineAt: minutesFromNow(170), mode: 'instant' } }
  started(f, [['repository-1', { practised: 3, lastScore: null }]])
  const next = continueCard(await f.html())
  assert.match(next, />Resume practice: COURSE1</)
  assert.doesNotMatch(next, /(min|hr) left/, 'instant feedback shows no clock')
  const { formatCourseProgress } = require('../../lib/dashboard/home-courses.ts')
  assert.equal(formatCourseProgress({ practised: 3, total: 25, lastScore: null }), '3 of 25 questions practised')
  assert.equal(formatCourseProgress({ practised: 3, total: 25, lastScore: { score: 2, total: 3 } }),
    '3 of 25 questions practised · Last score 2 of 3 correct')
}))


test('the course file stays identical after a graded GST111 attempt while Continue appears', async () => fixture(async f => {
  const gst = { ...mappedCourse(0, 'ready'), code: 'GST111', title: 'Use of English',
    repository: { ...shelved(0), contentKey: 'use-of-english', route: { href: '/courses/use-of-english',
      course: { slug: 'use-of-english', contentKey: 'use-of-english', code: 'GST111', title: 'Use of English' } } } }
  f.state.current.courses = [gst, ...['ready', 'ready', 'locked', 'not-built', 'unshelved', 'overview-only']
    .map((state, index) => mappedCourse(index + 1, state))]
  f.state.current.cbtBankSizes = new Map([['course-0', 12]])
  const before = courseCard(await f.html())
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-0', contentKey: 'use-of-english' } }
  started(f, [['repository-0', { practised: 8, lastScore: { score: 6, total: 8 } }]])
  const html = await f.html()
  assert.equal(courseCard(html), before)
  assert.match(continueCard(html), />Continue practising GST111</)
  assert.match(continueCard(html), /href="\/courses\/use-of-english#cbtPractice"/)
  assert.doesNotMatch(courseCard(html), /GST111|Use of English/)
  assert.doesNotMatch(html, /questions? practised|Last score/)
}))


test('a course without a countable bank has no figures on home and a locked course offers no Continue', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'overview-only'), mappedCourse(1, 'locked'), mappedCourse(2, 'ready')]
  f.state.current.cbtBankSizes = new Map()
  started(f, [['repository-1', { practised: 3, lastScore: { score: 2, total: 3 } }],
    ['repository-2', { practised: 1, lastScore: { score: 1, total: 1 } }]])
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-1', contentKey: 'course-1' } }
  const html = await f.html()
  assert.match(courseCard(html), />3 courses · 1 ready to study</)
  assert.doesNotMatch(courseCard(html), FIGURES)
  assert.equal(continueCard(html), undefined, 'no Continue card into a course the plan now locks')
}))

test('owner content rule: Continue never points at a course that no longer offers practice; an open attempt still resumes', async () => fixture(async f => {
  // Course 0's practice questions were withdrawn: it still opens (its overview), but it has no bank to practise.
  f.state.current.courses = [mappedCourse(0, 'overview-only'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-1', 25]])
  started(f, [['repository-0', { practised: 10, lastScore: { score: 6, total: 10 } }]])
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-0', contentKey: 'course-0' } }
  assert.equal(continueCard(await f.html()), undefined, 'no Continue card into a course with no practice')
  // The same course on a list where it still has a bank is offered as before.
  f.state.current.courses = [mappedCourse(0, 'ready'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25]])
  assert.match(continueCard(await f.html()), />Continue practising COURSE0</)
  // An attempt left open in a course with no practice now is still resumed: the practice page finishes it.
  f.state.current.courses = [mappedCourse(0, 'overview-only'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-1', 25]])
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-0', contentKey: 'course-0',
    deadlineAt: minutesFromNow(20) } }
  const resume = continueCard(await f.html())
  assert.match(resume, /data-continue="resume"/)
  assert.match(resume, /href="\/courses\/course-0\/quiz"/)
  assert.match(resume, />Resume exam: COURSE0, 20 min left</)
}))

test('sprint plan 23 Oct item 2: an unavailable or signed-out practice read shows the day-one list, never guessed figures', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40]])
  for (const status of ['unavailable', 'signed-out']) {
    f.state.progress = { status }
    const html = await f.html()
    assert.match(courseCard(html), />1 course · 1 ready to study</)
    assert.doesNotMatch(html, /Resume practice|Resume exam|Continue practising|practised|Last score/)
  }
}))

test('sprint plan 23 Oct item 2: an attempt in a course off the shelf offers no Continue card', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready')]
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-x', contentKey: 'not-on-the-shelf',
    deadlineAt: minutesFromNow(20) }, latest: { courseId: 'repository-y', contentKey: 'also-not-on-the-shelf' } }
  assert.equal(continueCard(await f.html()), undefined)
  assert.deepEqual(f.state.slugReads, [], 'nothing is read for a course with no course page')
}))

test('owner decision D5 (25 Nov 2026): an open attempt off the student\'s list is named by its catalogue code, never the course list\'s', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40]])
  // An exam left open in LAG-BUA210, which the course list calls BUA210.
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-lag-bua210', contentKey: 'business-mathematics',
    deadlineAt: minutesFromNow(20) } }
  f.state.bySlug = () => ({ status: 'ok', learning: null, practice: null, course: { ...mappedCourse(9, 'ready'),
    code: 'LAG-BUA210', title: 'Business Mathematics', repository: { ...shelved(9), repositoryCourseId: 'repository-lag-bua210' } } })
  const resume = continueCard(await f.html())
  assert.match(resume, />Resume exam: LAG-BUA210, 20 min left</)
  assert.match(resume, />Business Mathematics</)
  assert.match(resume, /href="\/courses\/business-mathematics\/quiz"/)
  assert.deepEqual(f.state.slugReads, [['business-mathematics', { readRepositoryOnly: false }]])
  // Without its catalogue course the card names no course at all.
  for (const read of [{ status: 'unavailable' }, { status: 'repository-only', course: {}, learning: null, practice: null }]) {
    f.state.bySlug = () => read
    const html = await f.html()
    assert.equal(continueCard(html), undefined, read.status)
    assert.doesNotMatch(html, /BUA210/)
  }
  // A course on the student's list is named by its own row, with no further read.
  f.state.slugReads = []
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-0', contentKey: 'course-0', deadlineAt: minutesFromNow(20) } }
  assert.match(continueCard(await f.html()), />Resume exam: COURSE0, 20 min left</)
  assert.deepEqual(f.state.slugReads, [])
}))

test('sprint plan 23 Oct item 2: empty, unavailable and changed selections list no courses and no figures', async () => fixture(async f => {
  assert.match(courseCard(await f.html()), /Your courses are not available yet\./)
  assert.doesNotMatch(courseCard(await f.html()), /0 courses|ready to study/)
  assert.equal(items(await f.html()).length, 0)
  // Earlier practice in a real shelf course (GST111, Use of English), which the static shelf would otherwise resolve.
  const GST111 = { courseId: '40000000-0000-4000-8000-000000000008', contentKey: 'use-of-english' }
  started(f, [[GST111.courseId, { practised: 3, lastScore: { score: 2, total: 3 } }]])
  f.state.progress = { ...f.state.progress, latest: GST111 }
  // EST's decision: an empty list shows that one sentence and no extra detail, even after earlier practice.
  f.state.profile.selection.department.label = 'Accounting'
  f.state.profile.selection.academicLevel.label = '300 Level'
  const empty = await f.html()
  assert.deepEqual([...courseCard(empty).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(match => match[1]),
    ['Your courses are not available yet.'])
  assert.doesNotMatch(empty, FIGURES)
  assert.equal(continueCard(empty), undefined)
  // My Courses would open empty, so the card offers no way there.
  assert.doesNotMatch(courseCard(empty), /View your courses|href="\/my-courses"/)
  assert.equal(courseCard(empty).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
    'Your courses are not available yet.')
  for (const status of ['unavailable', 'missing-profile', 'invariant-failure']) {
    f.state.current = { status }
    const html = await f.html()
    // No count and no failure line beside a View your courses that still works.
    assert.doesNotMatch(courseCard(html), /temporarily unavailable|dashboard-file-tab/)
    assert.match(courseCard(html), />View your courses</, 'only an empty list loses the link')
    assert.doesNotMatch(html, FIGURES)
    assert.doesNotMatch(html, /Continue practising/)
  }
  for (const field of ['departmentId', 'academicLevelId', 'academicPeriodId']) {
    f.state.current = { status: 'ok', selection: {
      departmentId: 'dept', academicLevelId: 'level', academicPeriodId: 'period', [field]: 'changed',
    }, courses: [mappedCourse(0, 'ready')], cbtBankSizes: new Map([['course-0', 40]]) }
    const html = await f.html()
    assert.doesNotMatch(courseCard(html), /temporarily unavailable|dashboard-file-tab/)
    assert.match(courseCard(html), />View your courses</)
    assert.equal(items(html).length, 0)
    assert.doesNotMatch(html, /Continue practising|practised/)
  }
}))

test('sprint plan 23 Oct item 2: home reads courses and figures only through the shared models', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../components/dashboard/PrimaryCards.tsx'), 'utf8')
  assert.doesNotMatch(source, /content\.state|study\.(?:notes|overview|theory|cbtPractice)|getCourseBy|supabase|rpc\(/)
  const model = fs.readFileSync(path.join(__dirname, '../../lib/dashboard/home-courses.ts'), 'utf8')
  assert.match(model, /getStudentCourseUnavailability\(course\)/, 'open/locked is the read model\'s own rule')
  assert.doesNotMatch(model, /supabase|rpc\(|fetch\(/)
})

test('course-data session loss and incomplete selection retain server routing gates', async () => fixture(async f => {
  f.state.current = { status: 'signed-out' }
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fdashboard/)
  f.state.current = { status: 'incomplete' }
  await assert.rejects(f.page, /redirect:\/profile-selection/)
}))

test('semantic focus, official C texture and reduced motion have shared owners', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../styles/student-app.css'), 'utf8')
  for (const name of ['control', 'row', 'dark', 'card']) assert.match(css, new RegExp(`student-focus-${name}:focus-visible`))
  assert.match(css, /inset 0 0 0/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.match(css, /\.student-enter \{ animation: none; \}/)
  assert.match(css, /forced-colors: active/)
  assert.match(css, /c-pattern-white\.png/)
  assert.doesNotMatch(css, /text-decoration: underline|0 -3px 0|Geist|Playfair|Myriad/)
})

test('course-file CSS restores the reference tab, focus and equal-height cards without list styles', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../styles/student-app.css'), 'utf8')
  assert.match(css, /\.dashboard-primary-grid \{[^}]*grid-auto-rows: 1fr;[^}]*align-items: stretch;/)
  for (const selector of ['.dashboard-file-tab', '.dashboard-course-file:focus-visible']) {
    assert.ok(css.includes(selector), selector)
  }
  // The card's list of study families and the Practice card's sentence are gone, and so are their styles.
  assert.doesNotMatch(css, /\.dashboard-file-index|\.dashboard-cbt/)
  assert.doesNotMatch(css, /\.dashboard-course-(?:list|item|heading|code|status|title|progress)\b/)
  assert.ok(css.indexOf('[data-student-app] .dashboard-course-file:focus-visible') >
    css.indexOf('[data-student-app] .student-focus-card:focus-visible'), 'course-file focus overrides the shared card focus')
})

test('Dashboard uses its section gap after the plan notice and Continue at phone and desktop widths', () => {
  const css = require('postcss').parse(fs.readFileSync(path.join(__dirname, '../../styles/student-app.css'), 'utf8'))
  function declaration(selector, property, width) {
    let value
    css.walkRules(rule => {
      if (!rule.selectors.includes(selector)) return
      for (let parent = rule.parent; parent; parent = parent.parent) {
        if (parent.type !== 'atrule' || parent.name !== 'media') continue
        const min = /min-width:\s*(\d+)px/.exec(parent.params)
        const max = /max-width:\s*(\d+)px/.exec(parent.params)
        if ((min && width < Number(min[1])) || (max && width > Number(max[1]))) return
      }
      rule.walkDecls(property, item => { value = item.value })
    })
    return value
  }
  function margin(selector, property, width) {
    const value = declaration(selector, property, width)
    const variable = /^var\((--[^,)]+)/.exec(value ?? '')
    return Number.parseFloat(variable ? declaration('.dashboard-workspace', variable[1], width) : value)
  }
  for (const [width, expected] of [[375, 32], [1199, 32], [1200, 36], [1280, 36]]) {
    const section = margin('.dashboard-section', 'margin-top', width)
    assert.equal(section, expected, `section gap at ${width}px`)
    assert.equal(margin('.dashboard-workspace > [data-access-notice]', 'margin-bottom', width), section,
      `gap after the plan notice at ${width}px`)
    assert.equal(margin('.dashboard-continue', 'margin-bottom', width), section, `gap after Continue at ${width}px`)
  }
})
