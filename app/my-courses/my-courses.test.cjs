// app/my-courses/my-courses.test.cjs — Register presentation and unchanged server ownership/recovery contracts.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const selection = { departmentId: 'department-id', academicLevelId: 'level-id', academicPeriodId: 'period-id' }
const profile = { status: 'complete', firstName: 'Adaeze', selection: {
  department: { id: selection.departmentId, label: 'Business Administration', isActive: true },
  academicLevel: { id: selection.academicLevelId, label: '200 Level', isActive: true },
  academicPeriod: { id: selection.academicPeriodId, label: 'First Semester', isActive: true },
} }
const course = (id, code, content) => ({ institutionalCourseId: id, code, title: `${code} institutional title`, isFree: false, content })
const ready = course('ready-id', 'BUA201', {
  state: 'ready', courseSlug: 'resolved-slug', courseHref: '/courses/resolved-slug',
  availability: { overview: true, theory: true, quiz: true },
})
const unbuilt = course('unbuilt-id', 'BUA203', { state: 'not-built' })
const broken = course('broken-id', 'BUA205', { state: 'broken-link' })
const noLearning = course('empty-id', 'BUA207', { state: 'no-learning' })
const unavailable = course('failed-id', 'BUA209', { state: 'unavailable' })

function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

async function fixture(run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const pageFile = require.resolve('./page.tsx')
  const rowFile = require.resolve('./CourseRow.tsx')
  const loadingFile = require.resolve('./loading.tsx')
  const state = {
    enabled: true, context: { user: { id: 'current-student' }, sessionId: 'live-session' },
    contextError: null, tokenError: null, result: { status: 'complete', selection, courses: [ready, unbuilt, broken] },
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
      if (name === '@/lib/dashboard/current-student-courses') return {
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
    const { CourseRow } = require(rowFile)
    const loading = require(loadingFile).default
    await run({ state, page, CourseRow, loading, render: async () => renderToStaticMarkup(await page()) })
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
    f.state.result = { status: 'complete', selection, courses }
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
  assert.match(source, /STUDENT_DESTINATIONS\.courses\.href/)
  assert.match(source, /STUDENT_DESTINATIONS\.materials\.href/)
}))

test('ready rows are one canonical link and advertise only existing learning families', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.CourseRow, { course: ready }))
  assert.equal(anchors(html).length, 1)
  assert.ok(anchor(html, '/courses/resolved-slug'))
  assert.match(html, /student-focus-row/)
  assert.match(html, /BUA201 institutional title/)
  assert.match(html, /Notes · Theory · CBT practice/)
  assert.doesNotMatch(html, /Open course|Available:|Overview|Practice quiz|<button\b/)
  for (const [availability, expected] of [
    [{ overview: true, theory: false, quiz: false }, 'Notes'],
    [{ overview: false, theory: true, quiz: false }, 'Theory'],
    [{ overview: false, theory: false, quiz: true }, 'CBT practice'],
    [{ overview: true, theory: false, quiz: true }, 'Notes · CBT practice'],
    [{ overview: true, theory: true, quiz: false }, 'Notes · Theory'],
    [{ overview: false, theory: true, quiz: true }, 'Theory · CBT practice'],
  ]) {
    const course = { ...ready, content: { ...ready.content, availability } }
    const partial = renderToStaticMarkup(React.createElement(f.CourseRow, { course }))
    assert.ok(partial.includes(`<p>${expected}</p>`), expected)
    assert.equal(anchors(partial).length, 1)
    assert.doesNotMatch(partial, /unavailable|disabled|<del\b/)
  }
}))

test('all unavailable course identities stay inert; hollow rails belong only to missing content', async () => fixture(async f => {
  for (const item of [unbuilt, noLearning, broken, unavailable]) {
    const html = renderToStaticMarkup(React.createElement(f.CourseRow, { course: item }))
    assert.ok(html.includes(item.code) && html.includes(item.title))
    assert.doesNotMatch(html, /<a\b|<button\b|href=|chevron|tabindex=/)
    if (item === unbuilt || item === noLearning) {
      assert.match(html, /data-status="unavailable"/)
      assert.match(html, /Study content not yet available/)
      assert.doesNotMatch(html, /Content temporarily unavailable/)
    } else {
      assert.match(html, /Content temporarily unavailable/)
      assert.match(html, /student-course-row-error/)
      assert.doesNotMatch(html, /student-status-rail|Study content not yet available|Coming soon/)
    }
  }
}))

test('Request Material appears once only for genuinely missing learning, using /materials', async () => fixture(async f => {
  for (const [courses, show] of [
    [[ready, unbuilt], true], [[noLearning], true], [[unbuilt, noLearning], true],
    [[ready], false], [[broken, unavailable], false], [[ready, broken, unavailable], false],
  ]) {
    f.state.result = { status: 'complete', selection, courses }
    const html = await f.render()
    assert.equal(anchors(html).filter(link => link.includes('href="/materials"')).length, show ? 1 : 0)
    assert.equal(html.includes('Missing material for one of your courses?'), show)
    assert.doesNotMatch(html, /href="\/request-material"/)
  }
}))

test('empty semester is distinct and offers Change selection plus Browse All Courses only', async () => fixture(async f => {
  f.state.result = { status: 'complete', selection, courses: [] }
  const html = await f.render()
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  assert.match(html, /No confirmed courses for this selection yet\./)
  assert.match(html, /hasn’t confirmed the course list for this academic selection/)
  assert.match(anchor(html, '/courses'), /Browse All Courses/)
  assert.ok(anchors(html).some(link => link.includes('href="/profile-selection"') && link.includes('Change selection')))
  assert.doesNotMatch(html, /<ul\b|href="\/(bookmarks|account|materials)"|role="alert"|ready to study/)
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
    ['invariant-failure', 'course information needs attention', '/contact'],
  ]) {
    f.state.result = { status, message: 'private Supabase provider error', courses: [ready] }
    const html = await f.render()
    assert.match(html, new RegExp(message))
    assert.match(html, /role="alert"/)
    assert.ok(anchor(html, href))
    assert.doesNotMatch(html, /current-student|live-session|department-id|Supabase|provider error|BUA201|No confirmed courses/)
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
    assert.doesNotMatch(html, /BUA201|Business Administration|No confirmed courses/)
  }
  f.state.contextError = new Error('provider secret')
  assert.doesNotMatch(await f.render(), /provider secret/)
}))

test('profile-label read failures cannot expose courses or bypass completion', async () => fixture(async f => {
  for (const [status, expected] of [
    ['missing-profile', 'profile could not be found'], ['invariant-failure', 'course information needs attention'],
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
