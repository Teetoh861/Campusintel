// app/dashboard/dashboard.test.cjs — Real identity, command-centre hierarchy and private server boundaries. The course
// list, Continue card and progress follow the owner's sprint plan of 23 Oct, item 2, which replaced the earlier rule
// that home shows no semester rows and no progress.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

const NOW = '2026-10-27T09:00:00.000Z'

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
    progressReads: [], progress: { status: 'ok', now: NOW, open: null, latest: null, courses: new Map() } }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return { redirect: target => { throw Error('redirect:' + target) } }
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
      }
      return load.call(this, name, ...args)
    }
    const page = require('./page.tsx').default
    const home = require('../../components/auth/PublicHomeBoundary.tsx').PublicHomeBoundary
    await run({ state, page, home, html: async () => renderToStaticMarkup(await page()) })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!Object.hasOwn(cache, key)) delete require.cache[key]
  }
}

test('sprint plan 23 Oct item 2: home is a real personalized command centre with no fabricated activity', async () => fixture(async f => {
  const html = await f.html()
  for (const text of ['Welcome back, Ọlá', 'Business Administration', '200 Level', 'First Semester',
    'Your courses', 'Practice', 'All Courses', 'Bookmarks', 'Request Material', 'Help &amp; Support', 'Account', 'Waitlist']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /streak|GPA|credits remaining|Tobi|not-a-name@|Saved files/)
  assert.equal(f.state.profileReads, 1)
  assert.equal(f.state.courseReads, 1)
  assert.deepEqual(f.state.progressReads, ['session'], 'one practice read for every course, for the verified session')
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8'), /CourseRow|use client|cache\(|unstable_cache|use cache/)
}))

test('Practice describes personal AI practice according to its availability, separate from material requests', async () => fixture(async f => {
  const html = await f.html()
  assert.match(html, /Verified CBT practice/)
  assert.match(html, /href="\/my-courses"/)
  assert.match(html, /Practise from your notes/)
  assert.match(html, /Currently unavailable/)
  assert.match(html, /Personal AI practice from your own notes is currently unavailable/)
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
  assert.match(upload, /class="student-status-rail" data-status="unavailable">Currently unavailable/)
  assert.match(html, /class="student-status-rail" data-status="waitlist">Waitlist/)
  f.state.aiAvailable = true
  const enabled = await f.html()
  assert.doesNotMatch(enabled, /Currently unavailable|Coming soon/)
  assert.match(enabled, /With AI access on your account, upload notes for courses without CampusIntell study materials/)
  assert.match(enabled, /AI questions are for personal study and are not verified by CampusIntell/)
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
  assert.equal(shell.props.children[0].type.name, 'AccessNotice', 'the plan notice leads the workspace')
  assert.ok(!shell.props.children[1], 'no Continue card before the student has started')
  assert.equal(shell.props.children[2].type.name, 'PrimaryCards')
  assert.equal(shell.props.children[3].type.name, 'SupportingActions')
  const html = await f.html()
  assert.match(html, /class="student-page-root" data-student-app="true"><header class="dashboard-identity/)
  assert.match(html, /class="student-workspace student-page-workspace dashboard-workspace"/)
}))

test('Courses and material retains personal Bookmarks first and quiet icon-led help/account destinations', async () => fixture(async f => {
  const html = await f.html()
  const material = html.match(/<section aria-labelledby="material-title"[\s\S]*?<\/section>/)?.[0]
  assert.ok(material)
  assert.match(material, />Courses and material<\/h2>/)
  assert.deepEqual([...material.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]),
    ['/bookmarks', '/courses', '/materials'])
  assert.deepEqual([...material.matchAll(/<h3>(.*?)<\/h3>/g)].map(match => match[1]),
    ['Bookmarks', 'All Courses', 'Request Material'])
  assert.match(material, /dashboard-bookmark-card/)
  const utilities = html.match(/<section aria-labelledby="utilities-title"[\s\S]*?<\/section>/)?.[0]
  assert.ok(utilities)
  assert.deepEqual([...utilities.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match => match[1]),
    ['/tutors', '/contact', '/account'])
  assert.equal((utilities.match(/class="[^"]*dashboard-utility-icon"/g) || []).length, 3)
  assert.doesNotMatch(utilities, /dashboard-utility-arrow|lucide-arrow-right/)
  assert.match(utilities, /data-status="waitlist">Waitlist/)
  assert.doesNotMatch(utilities, /Log out|Logout|<button/)
}))

test('Dashboard actions stay arrow-free with their labels, destinations and keyboard focus families intact', async () => fixture(async f => {
  const html = await f.html()
  const actions = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
    .filter(([, attributes]) => /class="[^"]*\bdashboard-(?:primary-action|practice-action|material-card|utility-row)\b/.test(attributes))
  const expected = [
    ['/my-courses', 'View my courses', 'control'], ['/my-courses', 'Choose a course', 'control'],
    ['/bookmarks', 'Open bookmarks', 'card'], ['/courses', 'Browse the library', 'card'],
    ['/materials', 'Request course material', 'card'], ['/tutors', 'Tutors', 'row'],
    ['/contact', 'Help &amp; Support', 'row'], ['/account', 'Account', 'row'],
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
  assert.match(html, /Something went wrong/)
  assert.doesNotMatch(html, /private provider details|Welcome back/)
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
const courseCard = html => html.match(/<section aria-labelledby="my-courses-title"[\s\S]*?<\/section>/)?.[0]
const items = html => [...(courseCard(html) ?? '').matchAll(/<li>([\s\S]*?)<\/li>/g)].map(match => match[1])
const continueCard = html => html.match(/<a\b[^>]*class="dashboard-continue[^>]*>([\s\S]*?)<\/a>/)?.[0]
const FIGURES = /practised|Last score|\d+ of \d+|progress|completion|streak|%/i
const started = (f, courses) => { f.state.progress = { ...f.state.progress, courses: new Map(courses) } }
const minutesFromNow = minutes => new Date(Date.parse(NOW) + minutes * 60_000).toISOString()

test('sprint plan 23 Oct item 2: day-one home lists the chosen courses, open or locked, with nothing started and no figures', async () => fixture(async f => {
  const states = ['ready', 'locked', 'not-built', 'overview-only', 'unshelved', 'unavailable']
  f.state.current.courses = states.map((state, index) => mappedCourse(index, state))
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-4', 12]])
  const html = await f.html(), rows = items(html)
  assert.equal(rows.length, 6, 'every chosen course, in the read model\'s order')
  const expected = [['COURSE0', 'Open', '/courses/course-0'], ['COURSE1', 'Locked', '/courses/course-1'],
    ['COURSE2', 'No materials yet', null], ['COURSE3', 'No materials yet', '/courses/course-3'],
    ['COURSE4', 'Unavailable right now', null], ['COURSE5', 'Unavailable right now', '/courses/course-5']]
  for (const [index, [code, status, href]] of expected.entries()) {
    assert.ok(rows[index].includes(`>${code}<`), code)
    assert.ok(rows[index].includes(`Course ${index} title`), `${code}: title`)
    assert.ok(rows[index].includes(`>${status}<`), `${code}: ${status}`)
    if (href === null) assert.doesNotMatch(rows[index], /<a\b/, `${code}: no route, no link`)
    else assert.ok(rows[index].includes(`href="${href}"`), `${code}: ${href}`)
  }
  assert.doesNotMatch(courseCard(html), FIGURES, 'a bank size alone is not progress')
  assert.equal(continueCard(html), undefined)
  assert.doesNotMatch(html, /Resume practice|Continue practising/)
  assert.doesNotMatch(courseCard(html), /200 Level|First Semester|Business Administration/, 'academic details stay in the band')
}))

test('sprint plan 23 Oct item 2: after a graded attempt, a Continue card and that course\'s own progress', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25]])
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-0', contentKey: 'course-0' } }
  started(f, [['repository-0', { practised: 10, lastScore: { score: 6, total: 10 } }]])
  const html = await f.html(), rows = items(html)
  const next = continueCard(html)
  assert.match(next, /href="\/courses\/course-0\/quiz"/)
  assert.match(next, /data-continue="continue"/)
  assert.match(next, />Continue practising COURSE0</)
  assert.match(next, />Course 0 title</)
  assert.ok(html.indexOf('dashboard-continue') < html.indexOf('my-courses-title'), 'the Continue card comes first')
  assert.match(rows[0], />10 of 40 questions practised · Last score 6\/10</)
  assert.doesNotMatch(rows[1], FIGURES, 'a course not yet practised shows no figures')
}))

test('sprint plan 23 Oct item 2: an open attempt comes first, with the time it has left', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready'), mappedCourse(1, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25]])
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-1', contentKey: 'course-1',
    deadlineAt: minutesFromNow(11.5) }, latest: { courseId: 'repository-0', contentKey: 'course-0' } }
  // The open attempt's course has no graded attempt yet, so the database sends no figures for it.
  started(f, [['repository-0', { practised: 10, lastScore: { score: 6, total: 10 } }]])
  const html = await f.html(), rows = items(html)
  const next = continueCard(html)
  assert.match(next, /data-continue="resume"/)
  assert.match(next, /href="\/courses\/course-1\/quiz"/)
  assert.match(next, />Resume practice: COURSE1, 12 min left</)
  assert.equal((html.match(/class="dashboard-continue /g) || []).length, 1, 'one next step only')
  assert.doesNotMatch(rows[1], FIGURES, 'an open attempt adds nothing until it is graded')
  assert.match(rows[0], />10 of 40 questions practised · Last score 6\/10</)
  for (const [minutes, text] of [[60, '1 hr left'], [95, '1 hr 35 min left'], [0.2, '1 min left']]) {
    f.state.progress = { ...f.state.progress, open: { ...f.state.progress.open, deadlineAt: minutesFromNow(minutes) } }
    assert.match(continueCard(await f.html()), new RegExp(`>Resume practice: COURSE1, ${text}<`))
  }
  f.state.progress = { ...f.state.progress, open: { ...f.state.progress.open, deadlineAt: NOW } }
  assert.match(continueCard(await f.html()), />Continue practising COURSE0</, 'an attempt whose time is up is never offered')
}))

test('sprint plan 23 Oct item 2: several courses keep their own figures, matched by course and never mixed', async () => fixture(async f => {
  f.state.current.courses = [0, 1, 2, 3].map(index => mappedCourse(index, 'ready'))
  f.state.current.cbtBankSizes = new Map([['course-0', 40], ['course-1', 25], ['course-2', 30], ['course-3', 8]])
  started(f, [['repository-3', { practised: 8, lastScore: { score: 8, total: 8 } }],
    ['repository-1', { practised: 1, lastScore: { score: 0, total: 1 } }],
    ['repository-unknown', { practised: 99, lastScore: { score: 9, total: 9 } }]])
  const rows = items(await f.html())
  assert.doesNotMatch(rows[0], FIGURES)
  assert.match(rows[1], />1 of 25 questions practised · Last score 0\/1</)
  assert.doesNotMatch(rows[2], FIGURES)
  assert.match(rows[3], />8 of 8 questions practised · Last score 8\/8</)
  assert.doesNotMatch(rows.join(''), /99|9\/9/, 'a course outside the semester adds nothing')
}))

test('sprint plan 23 Oct item 2: a course without a question bank shows no total, and none it cannot count', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'overview-only'), mappedCourse(1, 'locked'), mappedCourse(2, 'ready')]
  f.state.current.cbtBankSizes = new Map()
  started(f, [['repository-1', { practised: 3, lastScore: { score: 2, total: 3 } }],
    ['repository-2', { practised: 1, lastScore: { score: 1, total: 1 } }]])
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-1', contentKey: 'course-1' } }
  const html = await f.html(), rows = items(html)
  assert.doesNotMatch(rows[0], FIGURES, 'no bank, never practised: nothing')
  assert.match(rows[1], />3 questions practised · Last score 2\/3</, 'a locked course keeps the student\'s own figures')
  assert.doesNotMatch(rows[1], / of \d+/, 'and no total it may not count now')
  assert.match(rows[2], />1 question practised · Last score 1\/1</)
  assert.equal(continueCard(html), undefined, 'no Continue card into a course the plan now locks')
}))

test('sprint plan 23 Oct item 2: an unavailable or signed-out practice read shows the day-one list, never guessed figures', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready')]
  f.state.current.cbtBankSizes = new Map([['course-0', 40]])
  for (const status of ['unavailable', 'signed-out']) {
    f.state.progress = { status }
    const html = await f.html()
    assert.match(items(html)[0], />Open</)
    assert.doesNotMatch(html, /Resume practice|Continue practising|practised|Last score/)
  }
}))

test('sprint plan 23 Oct item 2: an attempt in a course off the shelf offers no Continue card', async () => fixture(async f => {
  f.state.current.courses = [mappedCourse(0, 'ready')]
  f.state.progress = { ...f.state.progress, open: { courseId: 'repository-x', contentKey: 'not-on-the-shelf',
    deadlineAt: minutesFromNow(20) }, latest: { courseId: 'repository-y', contentKey: 'also-not-on-the-shelf' } }
  assert.equal(continueCard(await f.html()), undefined)
}))

test('sprint plan 23 Oct item 2: empty, unavailable and changed selections list no courses and no figures', async () => fixture(async f => {
  assert.match(courseCard(await f.html()), /No courses are listed for your academic details/)
  assert.equal(items(await f.html()).length, 0)
  started(f, [['repository-0', { practised: 3, lastScore: { score: 2, total: 3 } }]])
  f.state.progress = { ...f.state.progress, latest: { courseId: 'repository-0', contentKey: 'course-0' } }
  for (const status of ['unavailable', 'missing-profile', 'invariant-failure']) {
    f.state.current = { status }
    const html = await f.html()
    assert.match(courseCard(html), /Course information is temporarily unavailable/)
    assert.doesNotMatch(html, FIGURES)
    assert.doesNotMatch(html, /Continue practising/)
  }
  for (const field of ['departmentId', 'academicLevelId', 'academicPeriodId']) {
    f.state.current = { status: 'ok', selection: {
      departmentId: 'dept', academicLevelId: 'level', academicPeriodId: 'period', [field]: 'changed',
    }, courses: [mappedCourse(0, 'ready')], cbtBankSizes: new Map([['course-0', 40]]) }
    const html = await f.html()
    assert.match(courseCard(html), /Course information is temporarily unavailable/)
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

test('public Home survives lookup failures while verified students route through guarded Dashboard', async () => fixture(async f => {
  const children = 'public marketing'
  f.state.context = null
  assert.equal(await f.home({ children }), children)
  f.state.failure = true
  assert.equal(await f.home({ children }), children)
  f.state.failure = false
  f.state.context = { user: { id: 'student' }, sessionId: 'session' }
  await assert.rejects(f.home({ children }), /redirect:\/dashboard/)
  f.state.enabled = false
  assert.equal(await f.home({ children }), children)
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
