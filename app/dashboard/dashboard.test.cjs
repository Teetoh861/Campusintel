const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const selection = { departmentId: 'department-id', academicLevelId: 'level-id', academicPeriodId: 'period-id' }
const profile = { status: 'complete', selection: {
  department: { id: selection.departmentId, label: 'Business Administration', isActive: true },
  academicLevel: { id: selection.academicLevelId, label: '200 Level', isActive: true },
  academicPeriod: { id: selection.academicPeriodId, label: 'First Semester', isActive: true },
} }
const availability = (cbt, theory, notes = false) => ({
  notes: { hasData: notes, href: null },
  cbt: { hasData: cbt, href: cbt ? '/courses/resolved-slug/quiz' : null },
  theory: { hasData: theory, href: theory ? '/courses/resolved-slug' : null },
})
const course = (id, code, content) => ({ institutionalCourseId: id, code, title: `${code} institutional title`, isFree: false, content })
const ready = course('ready-id', 'BUA201', {
  state: 'ready', courseSlug: 'resolved-slug', courseHref: '/courses/resolved-slug',
  availability: availability(true, true, true),
})
const unbuilt = course('unbuilt-id', 'BUA203', { state: 'not-built' })
const broken = course('broken-id', 'BUA205', { state: 'broken-link' })

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
    contextError: null, result: { status: 'complete', selection, courses: [ready, unbuilt, broken] },
    profile, domainCalls: [], profileReads: 0,
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
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => {
        if (state.contextError) throw state.contextError
        return state.context
      } }
      if (name === '@/lib/auth/account-continuity') return {
        issueAccountContinuityToken: (id, sessionId) => `page:${id}:${sessionId}`,
      }
      if (name === '@/lib/dashboard/current-student-courses') return {
        getCurrentStudentCourses: async (...args) => { state.domainCalls.push(args); return state.result },
      }
      if (name === '@/lib/profile/student-profile') return {
        getCurrentStudentProfile: async () => { state.profileReads++; return state.profile },
      }
      if (name === '@/lib/profile/paths') return { PROFILE_SELECTION_PATH: '/profile-selection' }
      if (name === '@/components/auth/AuthFlowSync') return { AuthFlowSync: function AuthFlowSync() { return null } }
      if (name === '@/components/ui/skeleton') return {
        Skeleton: ({ className }) => React.createElement('div', { className }),
      }
      if (name === '@/lib/auth/constants') return originalLoad.call(this, local('lib/auth/constants.ts'), ...args)
      if (name === '@/components/chrome/FormField') return originalLoad.call(this, local('components/chrome/FormField.tsx'), ...args)
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

test('complete student sees saved context and every institutional course in domain order', async () => fixture(async f => {
  const tree = await f.page()
  const sync = nodes(tree).find(node => node.type?.name === 'AuthFlowSync')
  assert.equal(sync.props.continuityToken, 'page:current-student:live-session')
  const html = renderToStaticMarkup(tree)
  assert.deepEqual(f.state.domainCalls, [[]], 'the page supplies no identity or selection argument')
  assert.equal(f.state.profileReads, 1)
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  assert.match(html, /href="\/profile-selection"/)
  assert.ok(html.indexOf('BUA201') < html.indexOf('BUA203'))
  assert.ok(html.indexOf('BUA203') < html.indexOf('BUA205'))
  assert.match(html, /BUA201 institutional title/)
  assert.match(html, /href="\/courses\/resolved-slug"/)
  assert.match(html, /Content not yet available/)
  assert.match(html, /Content temporarily unavailable/)
}))

test('ready row has one large resolved-route target and only usable Quiz/Theory signals', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.CourseRow, { course: ready }))
  assert.match(html, /<li[^>]*><a[^>]*href="\/courses\/resolved-slug"/)
  assert.match(html, /min-h-\[76px\]/)
  assert.match(html, /focus-visible:outline/)
  assert.match(html, /Quiz · Theory/)
  assert.doesNotMatch(html, /Notes|<button\b/)
  assert.equal((html.match(/<a\b/g) || []).length, 1, 'the row contains no nested links')

  const noQuiz = { ...ready, content: { ...ready.content, availability: {
    ...ready.content.availability, cbt: { hasData: true, href: null },
  } } }
  const noQuizHtml = renderToStaticMarkup(React.createElement(f.CourseRow, { course: noQuiz }))
  assert.doesNotMatch(noQuizHtml, /Quiz|Notes/)
  assert.match(noQuizHtml, /Theory/)
}))

test('unbuilt and broken institutional rows remain visible without click targets', async () => fixture(async f => {
  for (const [item, message] of [[unbuilt, 'Content not yet available'], [broken, 'Content temporarily unavailable']]) {
    const html = renderToStaticMarkup(React.createElement(f.CourseRow, { course: item }))
    assert.match(html, new RegExp(item.code))
    assert.match(html, new RegExp(message))
    assert.doesNotMatch(html, /<a\b|<button\b|href=/)
  }
}))

test('zero-course complete selection is an honest empty semester', async () => fixture(async f => {
  f.state.result = { status: 'complete', selection, courses: [] }
  const html = await f.render()
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  assert.match(html, /No confirmed courses for this selection yet/)
  assert.doesNotMatch(html, /<ul\b|Browse courses|CourseDirectory/)
}))

test('signed-out and incomplete students follow existing login/selection routes', async () => fixture(async f => {
  f.state.context = null
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fdashboard/)
  assert.equal(f.state.domainCalls.length, 0)
  f.state.context = { user: { id: 'current-student' }, sessionId: 'live-session' }
  f.state.result = { status: 'signed-out' }
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fdashboard/)
  f.state.result = { status: 'incomplete' }
  await assert.rejects(f.page, /redirect:\/profile-selection/)
  assert.equal(f.state.profileReads, 0)
}))

test('domain errors remain distinct and profile-label reads cannot mix selections', async () => fixture(async f => {
  for (const [status, message] of [
    ['missing-profile', 'profile could not be found'],
    ['unavailable', 'Something went wrong'],
    ['invariant-failure', 'course information needs attention'],
  ]) {
    f.state.result = { status }
    const html = await f.render()
    assert.match(html, new RegExp(message))
    assert.doesNotMatch(html, /current-student|live-session|department-id/)
  }
  f.state.result = { status: 'complete', selection, courses: [ready] }
  f.state.profile = { ...profile, selection: { ...profile.selection,
    academicPeriod: { ...profile.selection.academicPeriod, id: 'changed-period' },
  } }
  const html = await f.render()
  assert.match(html, /selection changed/)
  assert.doesNotMatch(html, /BUA201 institutional title|Business Administration · 200 Level/)
  f.state.contextError = new Error('provider secret')
  assert.doesNotMatch(await f.render(), /provider secret/)
}))

test('profile-label read failures never display courses under stale context', async () => fixture(async f => {
  for (const [status, expected] of [
    ['missing-profile', 'profile could not be found'],
    ['invariant-failure', 'course information needs attention'],
    ['unavailable', 'Something went wrong'],
  ]) {
    f.state.profile = { status }
    const html = await f.render()
    assert.match(html, new RegExp(expected))
    assert.doesNotMatch(html, /BUA201 institutional title/)
  }
  f.state.profile = { status: 'incomplete' }
  await assert.rejects(f.page, /redirect:\/profile-selection/)
  f.state.profile = { status: 'signed-out' }
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fdashboard/)
}))

test('loading shows four inert list placeholders without course or dashboard widgets', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.loading))
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/)
  assert.equal((html.match(/min-h-\[76px\]/g) || []).length, 4)
  assert.match(html, /motion-reduce:animate-none/)
  assert.doesNotMatch(html, /<a\b|<button\b|<input\b|<select\b/)
}))

test('public /courses still builds its own browse items from repository courses', () => {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const file = require.resolve('../courses/page.tsx')
  const repositoryCourse = { id: 'built-id', slug: 'public-built', code: 'BUA999', title: 'Public built course',
    overview: 'Repository overview', level: 200, semester: 1, credits: 2, difficulty: 'Easy' }
  try {
    Module._extensions['.tsx'] = (module, filePath) => module._compile(ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, filePath)
    Module._load = function(name, ...args) {
      if (name === '@/lib/data/courses') return { courses: [repositoryCourse] }
      if (name === '@/lib/data/quizzes') return { quizzes: {} }
      if (name === './CourseDirectory') return { CourseDirectory: function CourseDirectory() { return null } }
      return originalLoad.call(this, name, ...args)
    }
    delete require.cache[file]
    const tree = require(file).default()
    const directory = nodes(tree).find(node => node.type?.name === 'CourseDirectory')
    assert.equal(directory.props.totalCount, 1)
    assert.equal(directory.props.items[0].cardProps.cta.href, '/courses/public-built')
    assert.equal(directory.props.items[0].cardProps.title, 'Public built course')
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
})
