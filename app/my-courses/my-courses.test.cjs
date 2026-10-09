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
        Skeleton: ({ className }) => React.createElement('div', { className }),
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

test('complete student sees saved context and every institutional course in domain order', async () => fixture(async f => {
  const tree = await f.page()
  const sync = nodes(tree).find(node => node.type?.name === 'AuthFlowSync')
  assert.equal(sync.props.continuityToken, 'page:current-student:live-session')
  const html = renderToStaticMarkup(tree)
  assert.deepEqual(f.state.domainCalls, [[f.state.client, f.state.context.user]])
  assert.equal(f.state.clientReads, 1)
  assert.equal(f.state.contextReads, 1)
  assert.equal(f.state.profileReads, 1)
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  assert.match(html, /href="\/profile-selection"/)
  assert.ok(html.indexOf('BUA201') < html.indexOf('BUA203'))
  assert.ok(html.indexOf('BUA203') < html.indexOf('BUA205'))
  assert.match(html, /BUA201 institutional title/)
  assert.match(html, /href="\/courses\/resolved-slug"/)
  assert.match(html, /Study content not yet available/)
  assert.match(html, /Content temporarily unavailable/)
  assert.match(html, /href="\/bookmarks"/)
  assert.match(html, /href="\/courses"/)
  assert.match(html, /href="\/account"/)
  assert.equal((html.match(/href="\/profile-selection"/g) || []).length, 1)
}))

test('selection and recovery actions lead to their existing safe destinations', async () => fixture(async f => {
  const checkOutline = action => {
    const classes = new Set(action.props.className.split(/\s+/))
    for (const token of ['border-student-border-strong', 'text-[14px]', 'py-2',
      'student-focus-control']) assert.ok(classes.has(token), `missing ${token}`)
    for (const token of ['border-transparent', 'text-[15px]', 'py-2.5']) assert.equal(classes.has(token), false)
  }
  const context = nodes(await f.page()).find(node => node.type?.name === 'SemesterContext')
  const change = nodes(context.type(context.props)).find(node => node.props?.href === '/profile-selection')
  assert.ok(change)
  assert.equal(change.props.prefetch, false)
  assert.match(change.props.className, /min-h-11/)
  assert.match(change.props.className, /focus-visible:outline/)
  checkOutline(change)
  checkOutline(nodes(await f.page()).find(node => node.props?.href === '/bookmarks'))
  for (const [status, href] of [['missing-profile', '/contact'], ['unavailable', '/my-courses']]) {
    f.state.result = { status }
    const error = nodes(await f.page()).find(node => node.type?.name === 'MyCoursesError')
    const action = nodes(error.type(error.props)).find(node => node.props?.href === href)
    assert.ok(action)
    assert.match(action.props.className, /min-h-11/)
    assert.match(action.props.className, /focus-visible:outline/)
    checkOutline(action)
  }
}))

test('product surfaces own navy focus through shared chrome UI, not auth form styling', () => {
  const root = path.join(__dirname, '../..')
  const source = file => fs.readFileSync(path.join(root, file), 'utf8')
  assert.match(source('components/chrome/ui.tsx'), /export const focusRingNavy\b/)
  assert.doesNotMatch(source('components/chrome/FormField.tsx'), /\bAUTH_FOCUS\b/)
  for (const file of ['app/my-courses/page.tsx', 'app/my-courses/CourseRow.tsx', 'app/account/page.tsx',
    'app/profile-selection/page.tsx', 'app/profile-selection/ProfileSelectionForm.tsx']) {
    const text = source(file)
    assert.match(text, /import\s*\{[^}]*\bstudentFocus(?:Control|Card)\b[^}]*\}\s*from\s*['"]@\/components\/student\/ui['"]/, file)
    assert.doesNotMatch(text, /\bAUTH_(?:FOCUS|LINK)\b/, file)
    assert.doesNotMatch(text, /import\s*\{[^}]*\bAUTH_[A-Z_]+\b[^}]*\}\s*from\s*['"]@\/components\/chrome\/FormField['"]/, file)
  }
})

test('ready course has one large route target and labels only available published learning', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.CourseRow, { course: ready }))
  assert.match(html, /<li[^>]*><a[^>]*href="\/courses\/resolved-slug"/)
  assert.match(html, /min-h-\[112px\]/)
  assert.match(html, /student-focus-card/)
  assert.match(html, /BUA201 institutional title/)
  assert.match(html, /Available: Overview · Theory · Practice quiz/)
  assert.match(html, /Open course/)
  assert.equal((html.match(/<a\b/g) || []).length, 1, 'the row contains no nested links')

  const partial = { ...ready, content: { ...ready.content,
    availability: { overview: false, theory: true, quiz: false } } }
  const partialHtml = renderToStaticMarkup(React.createElement(f.CourseRow, { course: partial }))
  assert.match(partialHtml, /Available: Theory/)
  assert.doesNotMatch(partialHtml, /Overview|Practice quiz/)
  assert.match(partialHtml, /href="\/courses\/resolved-slug"/)
}))

test('courses without usable published learning remain visible and inert', async () => fixture(async f => {
  for (const [item, message] of [
    [unbuilt, 'Study content not yet available'], [noLearning, 'Study content not yet available'],
    [broken, 'Content temporarily unavailable'], [unavailable, 'Content temporarily unavailable'],
  ]) {
    const html = renderToStaticMarkup(React.createElement(f.CourseRow, { course: item }))
    assert.match(html, new RegExp(message))
    assert.doesNotMatch(html, /<a\b|<button\b|href=/)
  }
}))

test('My Courses uses semantic course and utility regions with a Bookmarks action', async () => fixture(async f => {
  const html = await f.render()
  assert.match(html, /<section[^>]*aria-labelledby="my-courses-list-title"/)
  assert.match(html, /<aside[^>]*aria-labelledby="my-courses-utilities-title"/)
  assert.match(html, /href="\/bookmarks"[^>]*>Bookmarks/)
  assert.match(html, /aria-label="Your semester courses"/)
}))

test('zero-course complete selection is an honest empty semester', async () => fixture(async f => {
  f.state.result = { status: 'complete', selection, courses: [] }
  const html = await f.render()
  assert.match(html, /Business Administration · 200 Level · First Semester/)
  assert.match(html, /No confirmed courses for this selection yet/)
  assert.match(html, /href="\/bookmarks"/)
  assert.doesNotMatch(html, /<ul\b|Browse courses|CourseDirectory/)
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

test('continuity token failure stays in the unavailable state before student data reads', async () => fixture(async f => {
  f.state.tokenError = new Error('signing secret')
  const html = await f.render()
  assert.match(html, /Something went wrong/)
  assert.doesNotMatch(html, /signing secret|BUA201 institutional title/)
  assert.equal(f.state.contextReads, 1)
  assert.equal(f.state.domainCalls.length, 0)
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
  await assert.rejects(f.page, /redirect:\/login\?next=%2Fmy-courses/)
}))

test('loading announces status and shows inert course placeholders', async () => fixture(async f => {
  const html = renderToStaticMarkup(React.createElement(f.loading))
  assert.match(html, /role="status"[^>]*aria-live="polite"[^>]*aria-busy="true"/)
  assert.equal((html.match(/min-h-\[112px\]/g) || []).length, 4)
  assert.match(html, /motion-reduce:animate-none/)
  assert.doesNotMatch(html, /<a\b|<button\b|<input\b|<select\b/)
}))
