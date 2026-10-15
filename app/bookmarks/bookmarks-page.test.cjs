// app/bookmarks/bookmarks-page.test.cjs — Server composition: bounded central preload, repository-only resolution, shared shell and result states.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')
const { elementNodes } = require('../../lib/test/element-walker.cjs')

const shelfCourse = (slug, code) => ({ id: slug, contentKey: `${slug}-key`, slug, code, title: `${slug} shelf title`, textbooks: [], topics: [] })
const shelf = [shelfCourse('owned-course', 'BUA201'), shelfCourse('repo-course', 'REPO101'), shelfCourse('unbridged-course', 'GST301')]
const shelved = course => ({ state: 'shelved', repositoryCourseId: `${course.slug}-repository`, contentKey: course.contentKey,
  isShared: false, route: { slug: course.slug, href: `/courses/${course.slug}`, course } })
const study = flags => ({ notes: false, cbtPractice: false, theory: false, overview: false, ...flags })
const institutional = (course, code, content) => ({ institutionalCourseId: `${code}-id`, code, title: `${code} institutional title`,
  isFree: true, applicability: [], repository: shelved(course), content })
const owned = institutional(shelf[0], 'BUA201', { state: 'ready', study: study({ notes: true, theory: true }) })
const repositoryOnly = { repository: shelved(shelf[1]), content: { state: 'no-published-learning', study: study({}) } }

async function fixture(run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const root = path.join(__dirname, '../..')
  const files = ['./page.tsx'].map(file => require.resolve(file))
  const state = {
    context: { user: { id: 'current-student' }, sessionId: 'live-session' }, contextError: null,
    lookups: new Map([['owned-course', { status: 'ok', course: owned }], ['repo-course', { status: 'repository-only', course: repositoryOnly, learning: null, practice: null }],
      ['unbridged-course', { status: 'not-found' }]]),
    catalogueCalls: 0, lookupCalls: [], currentStudentCalls: 0, client: { source: 'request-scoped RLS client' }, clientReads: 0,
  }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'next/navigation') return { redirect: to => { throw new Error('redirect:' + to) } }
      if (name === '@/lib/supabase/server') return { createClient: async () => { state.clientReads++; return state.client } }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_response, client) => {
        assert.equal(client, state.client)
        if (state.contextError) throw state.contextError
        return state.context
      } }
      if (name === '@/lib/data/courses') return { courses: shelf,
        getCourseBySlug: slug => shelf.find(course => course.slug === slug),
        getCourseByContentKey: key => shelf.find(course => course.contentKey === key) }
      if (name === '@/lib/courses/read-model') return {
        ...originalLoad.call(this, path.join(root, 'lib/courses/read-model.ts'), ...args),
        getStudentCatalogueForVerifiedStudent: async () => { state.catalogueCalls++; throw new Error('no duplicate catalogue preload') },
        getStudentCourseBySlugForVerifiedStudent: async (client, slug) => {
          assert.equal(client, state.client); state.lookupCalls.push(slug)
          return state.lookups.get(slug) ?? { status: 'not-found' }
        },
        getCurrentStudentCoursesForVerifiedStudent: async () => { state.currentStudentCalls++; throw new Error('saved courses are not the current selection') },
      }
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate: ({ children }) => children }
      if (name === './BookmarksClient') return { BookmarksClient: ({ catalog }) => React.createElement('div', { 'data-catalog': true },
        catalog.map(item => React.createElement('article', { key: item.contentKey, 'data-key': item.contentKey, 'data-slug': item.slug, 'data-code': item.code },
          JSON.stringify(item.row)))) }
      return originalLoad.call(this, name, ...args)
    }
    for (const file of files) delete require.cache[file]
    const page = require(files[0]).default
    const render = async () => {
      const gated = page()
      assert.equal(gated.type.name, 'StudentAccessGate')
      assert.equal(gated.props.returnPath, '/bookmarks')
      const inner = gated.props.children
      assert.equal(inner.type.name, 'Bookmarks')
      return inner.type(inner.props)
    }
    await run({ state, render, html: async () => renderToStaticMarkup(await render()) })
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const file of files) delete require.cache[file]
  }
}

const catalogOf = html => [...html.matchAll(/<article data-key="([^"]+)" data-slug="([^"]+)" data-code="([^"]+)">([\s\S]*?)<\/article>/g)]
  .map(match => ({ key: match[1], slug: match[2], code: match[3], row: JSON.parse(match[4].replace(/&quot;/g, '"')) }))

test('the page preloads the bounded shelf through the existing central reader, independent of current selection', async () => fixture(async f => {
  const catalog = catalogOf(await f.html())
  assert.deepEqual(catalog.map(course => course.key), ['owned-course-key', 'repo-course-key'])
  assert.deepEqual(f.state.lookupCalls, ['owned-course', 'repo-course', 'unbridged-course'])
  assert.equal(f.state.catalogueCalls, 0)
  assert.equal(f.state.currentStudentCalls, 0)
  assert.ok(!fs.existsSync(path.join(__dirname, 'shelf.ts')), 'no Bookmarks-specific course reader')
}))

test('the page composes StudentPage, the locked PageBand copy and the client catalog from the central adapter', async () => fixture(async f => {
  const tree = await f.render()
  const html = renderToStaticMarkup(tree)
  assert.match(html, /^<div class="student-page-root" data-student-app="true"><header class="student-page-band">/)
  assert.equal((html.match(/<h1\b/g) || []).length, 1)
  assert.match(html, /<h1 class="student-page-band-title">Bookmarks<\/h1>/)
  assert.match(html, /Courses you’ve bookmarked to come back to\./)
  assert.doesNotMatch(html, /TaskHeader|breadcrumb|Cover|student-grid/)
  const catalog = catalogOf(html)
  assert.deepEqual(catalog.map(item => [item.key, item.slug, item.code]),
    [['owned-course-key', 'owned-course', 'BUA201'], ['repo-course-key', 'repo-course', 'REPO101']])
  assert.deepEqual(catalog[0].row, { code: 'BUA201', title: 'BUA201 institutional title', href: '/courses/owned-course', learningTypes: ['Notes', 'Theory'] })
  assert.deepEqual(catalog[1].row, { repositoryOnly: true, title: 'repo-course shelf title', unavailable: 'missing' })
  assert.doesNotMatch(html, /Free|credits|difficulty|Exam-critical|BUA999|Unlinked institutional/, 'no Bookmarks-local metadata, no unbookmarkable identity')
  assert.ok(elementNodes(tree).some(node => node.type?.name === 'BookmarksClient'))
  assert.deepEqual([f.state.clientReads, f.state.catalogueCalls], [1, 0])
}))

test('read failures and lost sessions use the shared result states and gated redirects', async () => fixture(async f => {
  f.state.lookups.set('owned-course', { status: 'unavailable' })
  let html = await f.html()
  assert.match(html, /role="alert"[\s\S]*Courses temporarily unavailable[\s\S]*Content temporarily unavailable\./)
  assert.match(html, /href="\/bookmarks"[^>]*>Try again/)
  assert.match(html, /<h1 class="student-page-band-title">Bookmarks<\/h1>/)
  assert.doesNotMatch(html, /data-catalog/)
  f.state.lookups.set('owned-course', { status: 'invariant-failure' })
  html = await f.html()
  assert.match(html, /Course information needs attention[\s\S]*href="\/contact"/)
  f.state.lookups.set('owned-course', { status: 'signed-out' })
  await assert.rejects(f.render(), /redirect:\/login\?next=%2Fbookmarks/)
  f.state.lookups.set('owned-course', { status: 'ok', course: owned })
  f.state.context = null
  await assert.rejects(f.render(), /redirect:\/login\?next=%2Fbookmarks/)
  f.state.context = { user: { id: 'current-student' }, sessionId: 'live-session' }
  f.state.contextError = new Error('session infrastructure down')
  assert.match(await f.html(), /Courses temporarily unavailable/)
}))

test('route contract: per-request, gated, indexed-off, with the migrated shell and no old presentation left behind', () => {
  const page = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
  assert.match(page, /export const dynamic = 'force-dynamic'/)
  assert.match(page, /robots: \{ index: false, follow: false \}/)
  assert.match(page, /StudentAccessGate|StudentPage|PageBand|ResultNotice|presentStudentCourseRow/)
  assert.doesNotMatch(page, /'use client'|chrome\/Card|TaskHeader|SignalBar|buildCardProps|courses\.map\(\(c\)|student-grid/)
  assert.ok(!fs.existsSync(path.join(__dirname, 'bookmarks-ui.test.cjs')), 'the card-based suite is retired')
  const client = fs.readFileSync(path.join(__dirname, 'BookmarksClient.tsx'), 'utf8')
  assert.match(client, /CourseRegister[\s\S]*columns="single"/)
  assert.match(client, /BookmarkFeedback[\s\S]*Pagination/)
  assert.doesNotMatch(client, /TaskHeader|Card\b|SignalBar|student-grid|Skeleton className="h-44|Saved to this device|Saved to your account/)
})


test('one lost session takes precedence over another lookup failure and no Detail payload reaches the client', async () => fixture(async f => {
  f.state.lookups.set('owned-course', { status: 'unavailable' })
  f.state.lookups.set('repo-course', { status: 'signed-out' })
  await assert.rejects(f.render(), /redirect:\/login\?next=%2Fbookmarks/)
  f.state.lookups.set('owned-course', { status: 'ok', course: owned, learning: { body: 'Private Detail payload' }, practice: { bankSize: 99 } })
  f.state.lookups.set('repo-course', { status: 'repository-only', course: repositoryOnly })
  const tree = await f.render()
  const client = elementNodes(tree).find(node => node.type?.name === 'BookmarksClient')
  for (const course of client.props.catalog) assert.deepEqual(Object.keys(course).sort(), ['code', 'contentKey', 'row', 'slug'])
  assert.doesNotMatch(JSON.stringify(client.props.catalog), /Private Detail payload|bankSize|department|academicLevel|academicPeriod|isFree/)
}))
