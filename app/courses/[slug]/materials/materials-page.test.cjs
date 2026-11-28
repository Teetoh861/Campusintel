// app/courses/[slug]/materials/materials-page.test.cjs — Request material names the student's own course: its verified
// catalogue code and title, on the page and in the email, never the course list's code (owner decision D5, 25 Nov 2026).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.join(__dirname, '../../../..')
// The course list calls LAG-BUA210 "BUA210"; the catalogue course is LAG-BUA210 Business Mathematics.
const listed = { slug: 'business-mathematics', code: 'BUA210', title: 'Business Mathematics (course list)', contentKey: 'business-mathematics' }
const route = { slug: 'business-mathematics', href: '/courses/business-mathematics', course: listed }
const repository = { state: 'shelved', repositoryCourseId: 'repository-id', contentKey: 'business-mathematics', isShared: null, route }
const ok = () => ({ status: 'ok', learning: null, practice: null, course: { institutionalCourseId: 'inst-id', code: 'LAG-BUA210',
  title: 'Business Mathematics', isFree: false, applicability: [], repository, content: { state: 'locked' } } })
const repositoryOnly = () => ({ status: 'repository-only', learning: null, practice: null,
  course: { repository, content: { state: 'not-available' } } })

const decode = html => html.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"')
const mailtos = html => [...decode(html).matchAll(/href="mailto:([^"]+)"/g)].map(match => decodeURIComponent(match[1]))

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const client = { name: 'verified materials client' }
  const state = { result: ok(), signedOut: false, lookups: [] }
  function StudentAccessGate() { return null }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    const central = require(path.join(root, 'lib/courses/read-model.ts'))
    Module._load = function(name, ...args) {
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
      if (name === 'next/navigation') return {
        redirect: destination => { throw new Error('redirect:' + destination) },
        notFound: () => { throw new Error('notFound') },
      }
      if (name === '@/lib/supabase/server') return { createClient: async () => client }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async (_, supplied) => {
        assert.equal(supplied, client)
        return state.signedOut ? null : { user: { id: 'verified-student' }, sessionId: 'live-session' }
      } }
      if (name === '@/lib/courses/read-model') return { ...central,
        getStudentCourseBySlugForVerifiedStudent: async (supplied, slug, options) => {
          assert.equal(supplied, client); state.lookups.push([slug, options]); return state.result
        },
      }
      return load.call(this, name, ...args)
    }
    const page = require('./page.tsx').default
    const html = async (slug = 'business-mathematics') => {
      const gated = await page({ params: Promise.resolve({ slug }) })
      assert.equal(gated.type, StudentAccessGate)
      assert.equal(gated.props.returnPath, `/courses/${slug}/materials`)
      const child = gated.props.children
      return renderToStaticMarkup(await child.type(child.props))
    }
    await run({ state, html })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
  }
}

test('the page and both emails name the catalogue course, LAG-BUA210 Business Mathematics, never the course list', async () => fixture(async f => {
  const html = await f.html()
  assert.deepEqual(f.state.lookups, [['business-mathematics', { readRepositoryOnly: false }]])
  assert.match(html, /<h1[^>]*>Business Mathematics<\/h1>/)
  assert.match(html, /<a [^>]*href="\/courses\/business-mathematics"[^>]*>LAG-BUA210<\/a>/, 'the breadcrumb')
  assert.match(html, />LAG-BUA210<\/div>/)
  assert.match(html, /aria-label="Request study material for LAG-BUA210 by email"/)
  assert.match(html, /aria-label="Share study material for LAG-BUA210 by email"/)
  assert.deepEqual(mailtos(html), [
    'campusintell@gmail.com?subject=LAG-BUA210 — Business Mathematics — study material request&body=Hi, I’d like to request study material for LAG-BUA210 — Business Mathematics.',
    'campusintell@gmail.com?subject=LAG-BUA210 — Business Mathematics — material to share&body=Hi, I’d like to share study material for LAG-BUA210 — Business Mathematics.',
  ])
  assert.doesNotMatch(decode(html), /(?<!LAG-)BUA210|course list/)
}))

test('a course no catalogue course owns is named by its title alone', async () => fixture(async f => {
  f.state.result = repositoryOnly()
  const html = await f.html()
  assert.match(html, /<h1[^>]*>Business Mathematics \(course list\)<\/h1>/)
  assert.match(html, /aria-label="Request study material for Business Mathematics \(course list\) by email"/)
  assert.deepEqual(mailtos(html).map(link => link.split('&body=')[0]), [
    'campusintell@gmail.com?subject=Business Mathematics (course list) — study material request',
    'campusintell@gmail.com?subject=Business Mathematics (course list) — material to share',
  ])
  assert.doesNotMatch(html, /BUA210/)
}))

test('a course that cannot be read now shows its notice and no email; an unknown one is not found', async () => fixture(async f => {
  for (const status of ['unavailable', 'invariant-failure']) {
    f.state.result = { status }
    const html = await f.html()
    // Unavailable now offers a retry of this page; an invariant failure, as on the course page, offers help instead.
    if (status === 'unavailable') assert.match(html, /href="\/courses\/business-mathematics\/materials"/)
    else assert.match(html, /href="\/contact"/)
    assert.match(html, /class="student-notice"/, status)
    assert.deepEqual(mailtos(html), [], status)
    assert.doesNotMatch(html, /BUA210|Business Mathematics/, status)
  }
  f.state.result = { status: 'not-found' }
  await assert.rejects(f.html('no-such-course'), /notFound/)
  f.state.signedOut = true
  await assert.rejects(f.html(), /redirect:\/login\?next=%2Fcourses%2Fbusiness-mathematics%2Fmaterials/)
}))
