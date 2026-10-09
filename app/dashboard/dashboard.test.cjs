// app/dashboard/dashboard.test.cjs — Real identity, command-centre hierarchy and private server boundaries.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = { ...require.cache }
  const state = { enabled: true, context: { user: { id: 'student', email: 'not-a-name@example.test' }, sessionId: 'session' },
    failure: false, client: {}, profile: { status: 'complete', firstName: 'Ọlá', selection: {
      department: { id: 'dept', label: 'Business Administration', isActive: true },
      academicLevel: { id: 'level', label: '200 Level', isActive: true },
      academicPeriod: { id: 'period', label: 'First Semester', isActive: true },
    } }, profileReads: 0, courseReads: 0, current: { status: 'complete',
      selection: { departmentId: 'dept', academicLevelId: 'level', academicPeriodId: 'period' },
      courses: [] } }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return { redirect: target => { throw Error('redirect:' + target) } }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
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
      if (name === '@/lib/dashboard/current-student-courses') return { getCurrentStudentCoursesForVerifiedStudent: async (client, user) => {
        assert.equal(client, state.client); assert.equal(user, state.context.user)
        state.courseReads++; return state.current
      } }
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

test('Dashboard is a real personalized command centre, without semester rows or fabricated activity', async () => fixture(async f => {
  const html = await f.html()
  for (const text of ['Welcome back, Ọlá', 'Business Administration', '200 Level', 'First Semester',
    'My Courses', 'Practice', 'All Courses', 'Bookmarks', 'Request Material', 'Help &amp; Support', 'Account', 'Waitlist']) assert.ok(html.includes(text), text)
  assert.doesNotMatch(html, /Your semester courses|Progress|streak|GPA|credits remaining|Tobi|not-a-name@|Saved files/)
  assert.equal(f.state.profileReads, 1)
  assert.equal(f.state.courseReads, 1)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8'), /CourseRow|use client/)
}))

test('Practice includes current course CBT and nonfunctional Coming soon AI upload, separate from material requests', async () => fixture(async f => {
  const html = await f.html()
  assert.match(html, /Verified CBT practice/)
  assert.match(html, /href="\/my-courses"/)
  assert.match(html, /Upload to Practice/)
  assert.match(html, /Coming soon/)
  assert.match(html, /personal AI-assisted practice/)
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
  assert.match(upload, /class="student-status-rail" data-status="soon">Coming soon/)
  assert.match(html, /class="student-status-rail" data-status="waitlist">Waitlist/)
}))

test('academic identity owns a full-width band outside the bounded course/action workspace', async () => fixture(async f => {
  const tree = await f.page(), shell = tree.props.children[1]
  assert.equal(shell.props['data-student-app'], true)
  assert.equal(shell.props.className, 'dashboard-page', 'the band is not enclosed by a bounded page card')
  const [identity, workspace] = shell.props.children
  const band = identity.type(identity.props)
  assert.equal(band.type, 'header')
  assert.equal(band.props.className, 'dashboard-identity student-enter')
  const inner = band.props.children[1]
  assert.ok(inner.props.className.split(' ').includes('student-workspace'), 'only the inner academic content is constrained')
  assert.equal(workspace.props.className, 'student-workspace dashboard-workspace')
  assert.equal(workspace.props.children[0].type.name, 'PrimaryCards')
  assert.equal(workspace.props.children[1].type.name, 'SupportingActions')
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
  assert.equal((utilities.match(/class="[^"]*dashboard-utility-arrow"/g) || []).length, 3)
  assert.match(utilities, /data-status="waitlist">Waitlist/)
  assert.doesNotMatch(utilities, /Log out|Logout|<button/)
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

const mappedCourse = (index, state) => ({ institutionalCourseId: `course-${index}`, code: `COURSE${index}`,
  title: 'Mapped course', isFree: false, content: state === 'ready'
    ? { state, courseSlug: 'mapped-course', courseHref: '/courses/mapped-course',
      availability: { overview: true, theory: false, quiz: false } }
    : { state } })
const courseCard = html => html.match(/<a\b[^>]*class="dashboard-course-file[^>]*>(.*?)<\/a>/s)?.[1]

test('course summary uses the mapped collection and existing ready state, without repeating academic metadata', async () => fixture(async f => {
  const states = ['ready', 'ready', 'ready', 'ready', 'ready', 'not-built', 'no-learning', 'unavailable']
  f.state.current.courses = states.map((state, index) => mappedCourse(index, state))
  const html = await f.html(), card = courseCard(html)
  assert.ok(card)
  assert.match(card, /8 courses · 5 ready to study/)
  assert.doesNotMatch(card, /200 Level|First Semester|Business Administration|progress|completion|score|streak|study hours|%/i)
  assert.match(html, /200 Level/)
  assert.match(html, /First Semester/)
  assert.equal(f.state.profileReads, 1)
  assert.equal(f.state.courseReads, 1)
  const source = fs.readFileSync(path.join(__dirname, '../../components/dashboard/PrimaryCards.tsx'), 'utf8')
  assert.match(source, /course\.content\.state === 'ready'/)
  assert.doesNotMatch(source, /availability\.(?:overview|theory|quiz)|getCourseBy|supabase/)
}))

test('course summary handles singular, plural and zero-ready collections honestly', async () => fixture(async f => {
  for (const [states, expected] of [
    [['ready'], '1 course · 1 ready to study'],
    [['ready', 'not-built'], '2 courses · 1 ready to study'],
    [['not-built'], '1 course · Study content coming gradually'],
    [['not-built', 'broken-link', 'unavailable', 'no-learning'], '4 courses · Study content coming gradually'],
  ]) {
    f.state.current.courses = states.map((state, index) => mappedCourse(index, state))
    const card = courseCard(await f.html())
    assert.ok(card.includes(expected), expected)
    assert.doesNotMatch(card, /0 ready to study|1 courses|progress|completion/i)
  }
}))

test('empty, unavailable and changed selections do not invent course statistics', async () => fixture(async f => {
  assert.match(courseCard(await f.html()), /No confirmed courses for this selection yet/)
  assert.doesNotMatch(courseCard(await f.html()), /0 courses|ready to study/)
  for (const status of ['unavailable', 'missing-profile', 'invariant-failure']) {
    f.state.current = { status }
    assert.match(courseCard(await f.html()), /Course information is temporarily unavailable/)
    assert.doesNotMatch(courseCard(await f.html()), /\d+ courses?|ready to study/)
  }
  for (const field of ['departmentId', 'academicLevelId', 'academicPeriodId']) {
    f.state.current = { status: 'complete', selection: {
      departmentId: 'dept', academicLevelId: 'level', academicPeriodId: 'period', [field]: 'changed',
    }, courses: [mappedCourse(1, 'ready')] }
    assert.match(courseCard(await f.html()), /Course information is temporarily unavailable/)
    assert.doesNotMatch(courseCard(await f.html()), /1 course|ready to study/)
  }
}))

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
