// Production All Courses page and row behavior at the central model boundary.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const ref = (id, label) => ({ id, label, isActive: true })
const applicability = [{ department: ref('department', 'Department'), academicLevel: ref('level', '300 Level'),
  academicPeriod: ref('period', 'Second Semester') }]
const shelved = { state: 'shelved', repositoryCourseId: 'confirmed-repository', contentKey: 'confirmed-key',
  isShared: false, route: { slug: 'central-route', href: '/courses/central-route', course: { slug: 'central-route' } } }
const study = flags => ({ notes: false, cbtPractice: false, theory: false, overview: true, ...flags })
const course = (id, code, repository = shelved, content = { state: 'ready', study: study({ notes: true }) }) => ({
  institutionalCourseId: id, code, title: code + ' institutional title', isFree: false, applicability, repository, content,
})
function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...[element.props?.children].flat(Infinity).flatMap(nodes)]
}

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const calls = [], client = { name: 'verified catalogue client' }
  const state = { result: { status: 'ok', courses: [course('inst-one', 'INST101')] }, signedOut: false, sessionError: false }
  function StudentAccessGate() { return null }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    const central = require('../../lib/courses/read-model.ts')
    Module._load = function(name, ...args) {
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
      if (name === 'next/navigation') return { redirect: destination => { throw new Error('redirect:' + destination) } }
      if (name === '@/lib/supabase/server') return { createClient: async () => { calls.push('client'); return client } }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
        calls.push('verify'); assert.equal(supplied, client)
        if (state.sessionError) throw new Error('private provider details')
        return state.signedOut ? null : { user: { id: 'verified-student' }, sessionId: 'live-session' }
      } }
      if (name === '@/lib/courses/read-model') return { ...central,
        getStudentCatalogueForVerifiedStudent: async supplied => {
          calls.push('catalogue'); assert.equal(supplied, client); return state.result
        },
        getCurrentStudentCoursesForVerifiedStudent: () => { throw new Error('selection-scoped reader forbidden') },
      }
      if (args[0]?.filename.endsWith('/app/courses/page.tsx') &&
          ['@/lib/data/courses','@/lib/data/quizzes','@/lib/managed-content/published',
            '@/lib/managed-content/student-projection','@/lib/managed-content/quiz'].includes(name)) {
        throw new Error('page-level static/publication import forbidden')
      }
      return load.call(this, name, ...args)
    }
    const page = require('./page.tsx').default, gated = page()
    assert.equal(gated.type, StudentAccessGate); assert.equal(gated.props.returnPath, '/courses')
    assert.deepEqual(calls, [], 'the account gate is crossed before any catalogue work')
    const granted = () => gated.props.children.type(gated.props.children.props)
    const { CourseDirectory } = require('./CourseDirectory.tsx'), { CourseResult } = require('./CourseResult.tsx')
    const { Notice } = require('../../components/student/Notice.tsx')
    await run({ state, calls, granted, nodes, CourseDirectory, CourseResult, Notice,
      html: renderToStaticMarkup })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('gated server page reads the full central catalogue once on its verified client and projects only institutional metadata', async () => fixture(async f => {
  const shared = course('shared', 'GST111')
  shared.applicability = [...applicability, { ...applicability[0], department: ref('other', 'Another department') }]
  const alias = course('official-alias', 'LAG-BUA210', { state: 'unlinked' }, { state: 'not-built', reason: 'unlinked' })
  f.state.result = { status: 'ok', courses: [shared, alias] }
  const tree = await f.granted(), directory = f.nodes(tree).find(node => node.type === f.CourseDirectory)
  assert.deepEqual(f.calls, ['client','verify','catalogue'])
  assert.deepEqual(directory.props.items.map(item => item.institutionalCourseId), ['shared','official-alias'])
  assert.equal(directory.props.items[0].applicability.length, 2)
  assert.deepEqual(Object.keys(directory.props.items[0]).sort(), ['applicability','code','institutionalCourseId','row','title'])
  assert.equal(directory.props.items[0].row.props.course, shared)
  const html = f.html(tree)
  assert.match(html, /Institutional course catalogue/)
  assert.match(html, /2 courses/)
  assert.match(html, /LAG-BUA210 institutional title/)
  assert.equal((html.match(/<li\b/g) || []).length, 2)
  assert.doesNotMatch(html, /Business Administration|Difficulty|credits|Exam-critical|15 courses|Business Mathematics/)
}))

test('central actionable rows use only the central href and Notes/CBT/Theory flags', async () => fixture(async f => {
  for (const [flags, labels] of [
    [{ notes: true }, 'Notes'], [{ cbtPractice: true }, 'CBT practice'], [{ theory: true }, 'Theory'],
    [{ cbtPractice: true, theory: true }, 'CBT practice · Theory'],
    [{ notes: true, cbtPractice: true, theory: true }, 'Notes · CBT practice · Theory'],
  ]) {
    const input = course('ready', 'OFFICIAL', shelved, { state: 'ready', study: study(flags) })
    const html = f.html(React.createElement(f.CourseResult, { course: input }))
    assert.match(html, /href="\/courses\/central-route"/)
    assert.ok(html.includes(labels))
    assert.equal((html.match(/<a\b/g) || []).length, 1)
    assert.equal(html.includes('Notes'), flags.notes === true, 'overview is never Notes')
    assert.doesNotMatch(html, /Start quiz|questions|minutes|\/courses\/OFFICIAL/)
  }
}))

test('no published learning, unlinked, unshelved-ready and publication failure keep honest inert rows', async () => fixture(async f => {
  const inputs = [
    [course('empty', 'EMPTY', shelved, { state: 'no-published-learning', study: study({}) }), 'Study content not yet available.'],
    [course('unlinked', 'UNLINKED', { state: 'unlinked' }, { state: 'not-built', reason: 'unlinked' }), 'Study content not yet available.'],
    [course('unshelved', 'UNSHELVED', { state: 'unshelved-repository', repositoryCourseId: 'provisioned', contentKey: 'new-key', isShared: null },
      { state: 'ready', study: study({ notes: true, theory: true }) }), 'Content temporarily unavailable.'],
    [course('failed', 'FAILED', shelved, { state: 'temporarily-unavailable', reason: 'publication-read-failed' }), 'Content temporarily unavailable.'],
  ]
  for (const [input, message] of inputs) {
    const html = f.html(React.createElement(f.CourseResult, { course: input }))
    assert.ok(html.includes(input.title)); assert.ok(html.includes(message))
    assert.doesNotMatch(html, /<a\b|href=|tabindex=|role="link"|<button\b/)
  }
  f.state.result = { status: 'ok', courses: [course('ready','READY'), ...inputs.map(([input]) => input)] }
  const html = f.html(await f.granted())
  assert.equal((html.match(/<li\b/g) || []).length, 5, 'one individual failure never hides other identities')
  assert.equal((html.match(/href="\/courses\/central-route"/g) || []).length, 1)
}))

test('catalogue unavailable and invariant failure retain the PageBand and safe recovery without fallback', async () => fixture(async f => {
  for (const status of ['unavailable','invariant-failure']) {
    f.state.result = { status }
    const tree = await f.granted(), html = f.html(tree)
    assert.match(html, /All Courses/)
    assert.equal(f.nodes(tree).some(node => node.type === f.CourseDirectory), false)
    if (status === 'unavailable') { assert.match(html, /Content temporarily unavailable\./); assert.match(html, /Try again/) }
    else { assert.match(html, /Course information needs attention/); assert.match(html, /Contact support/) }
    assert.doesNotMatch(html, /private|0 courses|15 courses|BUA201/)
  }
}))

test('session loss before or during the catalogue preserves the existing login return path', async () => fixture(async f => {
  f.state.signedOut = true
  await assert.rejects(f.granted(), /redirect:\/login\?next=%2Fcourses$/)
  assert.deepEqual(f.calls, ['client','verify'])
  f.state.signedOut = false; f.state.result = { status: 'signed-out' }
  await assert.rejects(f.granted(), /redirect:\/login\?next=%2Fcourses$/)
  assert.deepEqual(f.calls.slice(2), ['client','verify','catalogue'])
}))

test('validation failure is sanitized and empty catalogue remains a genuine empty institutional state', async () => fixture(async f => {
  f.state.sessionError = true
  assert.match(f.html(await f.granted()), /Content temporarily unavailable\./)
  assert.doesNotMatch(f.html(await f.granted()), /private provider details/)
  f.state.sessionError = false; f.state.result = { status: 'ok', courses: [] }
  const html = f.html(await f.granted())
  assert.match(html, /0 courses/); assert.match(html, /No institutional courses available yet\./)
  assert.doesNotMatch(html, /<input\b|<select\b|<nav\b|No courses match/)
}))

test('loading follows the shared Student register pattern and is inert without fabricated identities', async () => fixture(async f => {
  const html = f.html(require('./loading.tsx').default())
  assert.match(html, /All Courses|Institutional course catalogue/)
  assert.match(html, /aria-busy="true"|Loading institutional courses\./)
  assert.match(html, /student-course-register/)
  assert.doesNotMatch(html, /<a\b|<button\b|<input\b|<select\b|animate-pulse|Business Administration|\d+ courses/)
}))
