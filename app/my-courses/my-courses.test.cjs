// app/my-courses/my-courses.test.cjs — Register presentation and unchanged server ownership/recovery contracts.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')
const { elementNodes } = require('../../lib/test/element-walker.cjs')


const selection = { departmentId: 'department-id', academicLevelId: 'level-id', academicPeriodId: 'period-id' }
const profile = { status: 'complete', firstName: 'Adaeze', selection: {
  department: { id: selection.departmentId, label: 'Business Administration', isActive: true },
  academicLevel: { id: selection.academicLevelId, label: '200 Level', isActive: true },
  academicPeriod: { id: selection.academicPeriodId, label: 'First Semester', isActive: true },
} }
const course = (id, code, repository, content) => ({ institutionalCourseId: id, code,
  title: `${code} institutional title`, isFree: false, applicability: [], repository, content })
const shelved = slug => ({ state: 'shelved', repositoryCourseId: `${slug}-repository`, contentKey: `${slug}-key`,
  isShared: false, route: { slug, href: `/courses/${slug}`, course: { slug } } })
const study = flags => ({ notes: false, theory: false, cbtPractice: false, overview: true, ...flags })
const ready = course('ready-id', 'BUA201', shelved('resolved-slug'),
  { state: 'ready', study: study({ notes: true, theory: true, cbtPractice: true }) })
const unbuilt = course('unbuilt-id', 'BUA203', { state: 'unlinked' }, { state: 'not-built', reason: 'unlinked' })
// A provisioned repository with published notes but no static route: real content, nowhere to go yet.
const broken = course('broken-id', 'BUA205', { state: 'unshelved-repository',
  repositoryCourseId: 'provisioned-repository', contentKey: 'provisioned-key', isShared: null },
{ state: 'ready', study: study({ notes: true }) })
const noLearning = course('empty-id', 'BUA207', shelved('empty-slug'), { state: 'no-published-learning', study: study({}) })
const unavailable = course('failed-id', 'BUA209', shelved('failed-slug'),
  { state: 'temporarily-unavailable', reason: 'publication-read-failed' })

const nodes = element => elementNodes(element)

async function fixture(run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const pageFile = require.resolve('./page.tsx')
  const rowFile = require.resolve('../../components/student/StudentCourseRow.tsx')
  const loadingFile = require.resolve('./loading.tsx')
  const state = {
    enabled: true, context: { user: { id: 'current-student' }, sessionId: 'live-session' },
    contextError: null, tokenError: null, result: { status: 'ok', selection, courses: [ready, unbuilt, broken] },
    profile, domainCalls: [], profileReads: 0, clientReads: 0, contextReads: 0,
    client: { source: 'request-scoped RLS client' },
  }
  const local = relative => path.join(__dirname, '../..', relative)
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return { redirect: destination => { throw new Error('redirect:' + destination) } }
      if (name === '@/lib/auth/config') return { isStudentAuthEnabled: () => state.enabled }
      if (name === '@/lib/supabase/server') return { createClient: async () => {
        state.clientReads++
        return state.client
      } }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_response, client) => {
        state.contextReads++
        assert.equal(client, state.client)
        if (state.contextError) throw state.contextError
        return state.context
      } }
      if (name === '@/lib/auth/account-continuity') return {
        issueAccountContinuityToken: (id, sessionId) => {
          if (state.tokenError) throw state.tokenError
          return `page:${id}:${sessionId}`
        },
      }
      if (name === '@/lib/courses/read-model') return {
        // Real central predicates; only the verified-student read is replaced by fixture state.
        ...originalLoad.call(this, local('lib/courses/read-model.ts'), ...args),
        getCurrentStudentCoursesForVerifiedStudent: async (client, user) => {
          assert.equal(client, state.client)
          assert.equal(user, state.context.user)
          state.domainCalls.push([client, user])
          return state.result
        },
      }
      if (name === '@/lib/profile/student-profile') return {
        getCurrentStudentProfileForVerifiedStudent: async (client, user) => {
          assert.equal(client, state.client)
          assert.equal(user, state.context.user)
          state.profileReads++
          return state.profile
        },
      }
      if (name === '@/lib/profile/paths') return { PROFILE_SELECTION_PATH: '/profile-selection' }
      if (name === '@/components/auth/AuthFlowSync') return { AuthFlowSync: function AuthFlowSync() { return null } }
      if (name === '@/components/ui/skeleton') return {
        Skeleton: ({ className, ...props }) => React.createElement('div', { className, ...props }),
      }
      if (name === '@/lib/auth/constants') return originalLoad.call(this, local('lib/auth/constants.ts'), ...args)
      if (name === '@/components/chrome/Feedback') return originalLoad.call(this, local('components/chrome/Feedback.tsx'), ...args)
      if (name === '@/components/chrome/ui') return originalLoad.call(this, local('components/chrome/ui.tsx'), ...args)
      return originalLoad.call(this, name, ...args)
    }
    for (const file of [pageFile, rowFile, loadingFile]) delete require.cache[file]
    const page = require(pageFile).default
    const { StudentCourseRow } = require(rowFile)
    const loading = require(loadingFile).default
    await run({ state, page, StudentCourseRow, loading, render: async () => renderToStaticMarkup(await page()) })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const file of [pageFile, rowFile, loadingFile]) delete require.cache[file]
  }
}

const anchors = html => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0])
const anchor = (html, href) => anchors(html).find(link => link.includes(`href="${href}"`))

test('verified student sees the PageBand, real context/counts and every course in domain order', async () => fixture(async f => {
  const tree = await f.page(), html = renderToStaticMarkup(tree)
  assert.equal(nodes(tree).find(node => node.type?.name === 'AuthFlowSync').props.continuityToken, 'page:current-student:live-session')
  assert.deepEqual(f.state.domainCalls, [[f.state.client, f.state.context.user]])
  assert.deepEqual([f.state.clientReads, f.state.contextReads, f.state.profileReads], [1, 1, 1])
  assert.match(html, /class="student-page-band"/)
  assert.match(html, /<h1[^>]*>My Courses<\/h1>/)
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.match(html, /Your semester, in one place\./)
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  assert.match(html, /3 courses · 1 ready to study/)
  assert.ok(html.indexOf('BUA201') < html.indexOf('BUA203') && html.indexOf('BUA203') < html.indexOf('BUA205'))
  assert.equal(nodes(tree).filter(node => node.type === f.StudentCourseRow).length, 3, 'rows come from the shared owner')
  assert.match(html, /Notes · CBT practice · Theory/)
  assert.match(html, /class="student-page-root" data-student-app="true"/)
  assert.equal((html.match(/<li\b/g) || []).length, 3)
  assert.match(html, /aria-label="Your semester courses"/)
  assert.match(html, /href="\/courses\/resolved-slug"/)
  assert.doesNotMatch(html, /Quick links|Open course|href="\/(bookmarks|account|courses)"|<aside\b|<input\b|<select\b|<form\b|role="tab/)
}))

test('summary derives total/readiness and singular grammar from the actual course set', async () => fixture(async f => {
  for (const [courses, expected] of [
    [[ready], '1 course · 1 ready to study'], [[ready, unbuilt], '2 courses · 1 ready to study'],
    [[unbuilt, noLearning], '2 courses · 0 ready to study'],
    [[ready, unbuilt, broken, noLearning, unavailable], '5 courses · 1 ready to study'],
  ]) {
    f.state.result = { status: 'ok', selection, courses }
    const html = await f.render()
    assert.ok(html.includes(expected))
    assert.equal((html.match(/<li\b/g) || []).length, courses.length)
    assert.doesNotMatch(html, /progress|completion|streak|study hours|score|last.studied|Continue studying/i)
  }
}))

test('Change and error recovery retain canonical routes, compact borders and shared focus', async () => fixture(async f => {
  const check = html => {
    assert.ok(html)
    const classes = new Set(/class="([^"]+)"/.exec(html)[1].split(/\s+/))
    for (const token of ['min-h-11', 'border-student-border-strong', 'student-focus-control', 'bg-student-surface', 'py-2']) assert.ok(classes.has(token), token)
    assert.equal(classes.has('border-transparent'), false)
  }
  check(anchor(await f.render(), '/profile-selection'))
  for (const [status, href] of [['missing-profile', '/contact'], ['invariant-failure', '/contact'], ['unavailable', '/my-courses']]) {
    f.state.result = { status }
    check(anchor(await f.render(), href))
  }
  const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
  assert.match(source, /href=\{PROFILE_SELECTION_PATH\}/)
  assert.match(source, /STUDENT_DESTINATIONS\.materials\.href/)
}))

test('Request Material appears once only for genuinely missing learning, using /materials', async () => fixture(async f => {
  for (const [courses, show] of [
    [[ready, unbuilt], true], [[noLearning], true], [[unbuilt, noLearning], true],
    [[ready], false], [[broken, unavailable], false], [[ready, broken, unavailable], false],
  ]) {
    f.state.result = { status: 'ok', selection, courses }
    const html = await f.render()
    assert.equal(anchors(html).filter(link => link.includes('href="/materials"')).length, show ? 1 : 0)
    assert.equal(html.includes('Missing material for one of your courses?'), show)
    assert.doesNotMatch(html, /href="\/request-material"/)
  }
}))

test('every empty semester shows only the approved sentence with no empty-state help or actions', async () => fixture(async f => {
  f.state.result = { status: 'ok', selection, courses: [] }
  const html = await f.render()
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  const empty = /<section class="student-empty-state"[^>]*>([\s\S]*?)<\/section>/.exec(html)[1]
  assert.equal(empty.replace(/<[^>]+>/g, ''), 'Your courses are not available yet.')
  assert.doesNotMatch(empty, /<a\b|<button\b|<svg\b/)
  assert.doesNotMatch(html, /Check your department|Browse All Courses|Change selection|<ul\b|href="\/(bookmarks|account|materials)"|role="alert"|ready to study/)
  for (const [department, period] of [['Business Administration', 'Second Semester'], ['Accounting', 'First Semester']]) {
    f.state.profile = { ...profile, selection: { ...profile.selection,
      department: { ...profile.selection.department, label: department },
      academicLevel: { ...profile.selection.academicLevel, label: '300 Level' },
      academicPeriod: { ...profile.selection.academicPeriod, label: period },
    } }
    const next = await f.render()
    assert.match(next, /300 Level/)
    assert.equal(/<section class="student-empty-state"[^>]*>([\s\S]*?)<\/section>/.exec(next)[1]
      .replace(/<[^>]+>/g, ''), 'Your courses are not available yet.')
  }
}))

test('signed-out and incomplete students follow existing login/selection routes', async () => fixture(async f => {
  f.state.context = null
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fmy-courses/)
  assert.equal(f.state.domainCalls.length, 0)
  f.state.context = { user: { id: 'current-student' }, sessionId: 'live-session' }
  f.state.result = { status: 'signed-out' }
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fmy-courses/)
  f.state.result = { status: 'incomplete' }
  await assert.rejects(f.page, /redirect:\/profile-selection/)
  assert.equal(f.state.profileReads, 0)
}))

test('continuity failure stays unavailable before private course/profile reads', async () => fixture(async f => {
  f.state.tokenError = new Error('signing secret')
  const html = await f.render()
  assert.match(html, /Courses temporarily unavailable/)
  assert.doesNotMatch(html, /signing secret|BUA201 institutional title/)
  assert.deepEqual([f.state.contextReads, f.state.domainCalls.length, f.state.profileReads], [1, 0, 0])
}))

test('domain failures retain truthful recovery and never look like an empty semester', async () => fixture(async f => {
  for (const [status, message, href] of [
    ['missing-profile', 'profile could not be found', '/contact'],
    ['unavailable', 'Courses temporarily unavailable', '/my-courses'],
    ['invariant-failure', 'Course details unavailable', '/contact'],
  ]) {
    f.state.result = { status, message: 'private Supabase provider error', courses: [ready] }
    const html = await f.render()
    assert.match(html, new RegExp(message))
    assert.match(html, /role="alert"/)
    assert.ok(anchor(html, href))
    assert.doesNotMatch(html, /current-student|live-session|department-id|Supabase|provider error|BUA201|Your courses are not available yet/)
  }
}))

test('every selection mismatch fails closed before rendering mixed context/courses', async () => fixture(async f => {
  for (const dimension of ['department', 'academicLevel', 'academicPeriod']) {
    f.state.profile = { ...profile, selection: { ...profile.selection,
      [dimension]: { ...profile.selection[dimension], id: 'changed-selection' },
    } }
    const html = await f.render()
    assert.match(html, /selection changed/)
    assert.ok(anchor(html, '/my-courses'))
    assert.doesNotMatch(html, /BUA201|Business Administration|Your courses are not available yet/)
  }
  f.state.contextError = new Error('provider secret')
  assert.doesNotMatch(await f.render(), /provider secret/)
}))

test('profile-label read failures cannot expose courses or bypass completion', async () => fixture(async f => {
  for (const [status, expected] of [
    ['missing-profile', 'profile could not be found'], ['invariant-failure', 'Course details unavailable'],
    ['unavailable', 'Courses temporarily unavailable'],
  ]) {
    f.state.profile = { status }
    assert.match(await f.render(), new RegExp(expected))
    assert.doesNotMatch(await f.render(), /BUA201 institutional title/)
  }
  for (const [status, destination] of [['incomplete', '/profile-selection'], ['signed-out', '/login?next=%2Fmy-courses']]) {
    f.state.profile = { status }
    await assert.rejects(f.page, error => error.message === 'redirect:' + destination)
  }
}))

test('loading reuses the PageBand/register and inert, static accessible skeletons', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.loading))
  assert.match(html, /class="student-page-band"/)
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/)
  assert.equal((html.match(/<li\b/g) || []).length, 6)
  assert.match(html, /aria-hidden="true"/)
  assert.match(html, /animate-none/)
  assert.doesNotMatch(html, /<a\b|<button\b|<input\b|<select\b|animate-pulse|Business Administration|BUA201|\d+%/)
}))

test('actionability needs a shelved route and ready content; overview alone is never Notes', async () => fixture(async f => {
  const overviewOnly = course('overview-id', 'BUA211', shelved('overview-slug'),
    { state: 'no-published-learning', study: study({ overview: true }) })
  const inert = renderToStaticMarkup(React.createElement(f.StudentCourseRow, { course: overviewOnly }))
  assert.doesNotMatch(inert, /<a\b|href=|Notes/)
  assert.match(inert, /Study materials are not available/)
  const unshelvedReady = renderToStaticMarkup(React.createElement(f.StudentCourseRow, { course: broken }))
  assert.doesNotMatch(unshelvedReady, /<a\b|href=|Notes|provisioned/)
  assert.match(unshelvedReady, /Study materials are temporarily unavailable/)
  const routed = renderToStaticMarkup(React.createElement(f.StudentCourseRow, { course: ready }))
  assert.ok(anchor(routed, '/courses/resolved-slug'))
  f.state.result = { status: 'ok', selection, courses: [ready, broken, overviewOnly, unavailable] }
  const html = await f.render()
  assert.match(html, /4 courses · 1 ready to study/)
  assert.equal(anchors(html).filter(link => link.includes('href="/courses/')).length, 1)
  assert.equal(anchors(html).filter(link => link.includes('href="/materials"')).length, 1, 'overview-only is missing content')
  f.state.result = { status: 'ok', selection, courses: [broken, unavailable] }
  assert.equal(anchors(await f.render()).filter(link => link.includes('href="/materials"')).length, 0, 'temporary states do not request material')
}))
