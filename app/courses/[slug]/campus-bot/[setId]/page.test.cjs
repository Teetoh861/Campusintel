// app/courses/[slug]/campus-bot/[setId]/page.test.cjs — A quiz's own page: the topic as its title, the set on the Campus
// Bot set screen with the topic's label, and the way back to the topic wherever the student reads it now. A set that is
// not this student's delivered topic set, for this course, is not found.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.join(__dirname, '../../../../..')
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [match[1], text(match[2])])
const SET = '86000000-0000-4000-8000-000000000001'
const ITEM = '86000000-0000-4000-8000-000000000002'
const COURSE = '86000000-0000-4000-8000-000000000003'

async function withTsx(run) {
  const tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    await run()
  } finally {
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
  }
}

const question = index => ({ id: `ai_${String(index).repeat(24)}`, prompt: `Question ${index}?`,
  options: ['Right', 'Wrong one', 'Wrong two', 'Wrong three'], correctOption: 0, explanation: 'Because the notes say so.',
  section: 'Elasticity', sourceQuote: 'the notes say so' })
const view = { generationId: SET, createdAt: '2026-11-17T10:00:00Z', fileName: null,
  topic: { itemId: ITEM, title: 'Price Elasticity of Demand', number: 2 }, questions: [1, 2, 3, 4, 5].map(question) }
const route = { slug: 'principles-economics-1', href: '/courses/principles-economics-1',
  course: { slug: 'principles-economics-1', code: 'ECO 101', title: 'Static' } }
const courseResult = { status: 'ok', course: { code: 'ECO101', title: 'Principles of Economics I',
  repository: { repositoryCourseId: COURSE, route } } }

async function page({ set = { view, courseId: COURSE, pinned: false }, course = courseResult, notes, signedOut = false,
  setId = SET }) {
  const load = Module._load
  function StudentAccessGate() { return null }
  try {
    let html = null
    await withTsx(async () => {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/navigation') return { useRouter: () => ({ push() {} }),
          redirect: destination => { throw new Error('redirect:' + destination) }, notFound: () => { throw new Error('notFound') } }
        if (name === '@/lib/supabase/server') return { createClient: async () => ({ name: 'client' }) }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () =>
          signedOut ? null : { user: { id: 'student' }, sessionId: 'session' } }
        if (name === '@/lib/ai-practice/topic-set-read') return { readTopicSet: async (_client, user, id) => {
          assert.deepEqual([user, id], ['student', setId]); return set } }
        if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async () => course }
        if (name === '../../notes/load') return { getNotesForVerifiedStudent: async () => notes }
        if (name === '@/components/student/result-state') return { redirectForStudentState: (state, back) => {
          throw new Error(`redirect:${state}:${back}`) } }
        return load.call(this, name, ...args)
      }
      const Page = require('./page.tsx').default
      const gated = await Page({ params: Promise.resolve({ slug: 'principles-economics-1', setId }) })
      assert.equal(gated.props.returnPath, `/courses/principles-economics-1/campus-bot/${setId}`)
      const child = gated.props.children('page-token')
      html = renderToStaticMarkup(await child.type(child.props))
    })
    return html
  } finally { Module._load = load }
}

const readable = { status: 'ready', notes: [{ itemId: 'other' }, { itemId: ITEM }] }

test('the topic is the page’s title, and the set carries the topic’s label', async () => {
  const html = await page({ notes: readable })
  assert.match(html, /<h1[^>]*>Price Elasticity of Demand<\/h1>/)
  assert.match(text(html), /^ECO101 · Topic 2 Price Elasticity of Demand Back to topic/)
  assert.deepEqual(links(html), [['/courses/principles-economics-1/notes/2', 'Back to topic']])
  assert.match(text(html), /Question 1 of 5 · 0 correct so far Made by Campus Bot from this topic’s notes\. Elasticity Question 1\?/)
  assert.match(html, /<h2[^>]*class="sr-only"[^>]*>Quiz<\/h2>/, 'the visible title already names the topic')
  for (const hidden of ['Personal practice', 'Practise from your notes', 'Made by Campus Bot from your notes.']) {
    assert.equal(text(html).includes(hidden), false, hidden)
  }
})

test('the way back is the topic wherever the student reads it now', async () => {
  const pinned = await page({ set: { view, courseId: COURSE, pinned: true }, notes: { status: 'locked' } })
  assert.deepEqual(links(pinned), [['/courses/principles-economics-1/preview/study-guide', 'Back to topic']])
  assert.match(text(pinned), /^ECO101 Price Elasticity of Demand/, 'a pinned topic has no place on the notes page')
  const moved = await page({ notes: { status: 'ready', notes: [{ itemId: 'other' }] } })
  assert.deepEqual(links(moved), [['/courses/principles-economics-1', 'Back to topic']], 'a topic no longer published')
})

test('a set that is not this student’s topic set for this course is not found', async () => {
  await assert.rejects(page({ set: null, notes: readable }), /notFound/)
  await assert.rejects(page({ setId: 'not-an-id', notes: readable }), /notFound/)
  await assert.rejects(page({ course: { ...courseResult, course: { ...courseResult.course,
    repository: { ...courseResult.course.repository, repositoryCourseId: 'another-course' } } }, notes: readable }), /notFound/)
  await assert.rejects(page({ course: { status: 'not-found' }, notes: readable }), /notFound/)
  await assert.rejects(page({ signedOut: true, notes: readable }),
    /redirect:signed-out:\/courses\/principles-economics-1\/campus-bot\//)
})

test('the stored set is read on the student’s own client, as a delivered topic set that has not expired', async () => {
  const { readTopicSet } = require(path.join(root, 'lib/ai-practice/topic-set-read.ts'))
  const stored = { formatVersion: 1, origin: 'ai-generated', visibility: 'personal', verification: 'unverified',
    source: { kind: 'notes-topic', courseId: COURSE, itemId: ITEM, revision: 3, title: 'Price Elasticity of Demand',
      number: 2, pinned: true },
    questions: [1, 2, 3].map(index => ({ ...question(index), correctOption: 0, grounding: { documentId: ITEM,
      sourceSha256: 'a'.repeat(64), passageId: `N${index}`, passageStart: 0, passageEnd: 10, quote: 'the notes say so' } })) }
  const filters = []
  const client = row => ({ from: table => { filters.push(['from', table]); const query = {
    select: columns => { filters.push(['select', columns]); return query },
    eq: (key, value) => { filters.push([key, value]); return query },
    gt: (key) => { filters.push(['gt', key]); return query },
    maybeSingle: async () => ({ data: row, error: null }) }; return query } })
  const row = { id: SET, created_at: '2026-11-17T10:00:00Z', question_set: stored, source_course_id: COURSE,
    source_item_id: ITEM, expires_at: '2026-12-17T10:00:00Z' }
  const read = await readTopicSet(client(row), 'student', SET)
  assert.deepEqual([read.courseId, read.pinned, read.view.topic, read.view.questions.length],
    [COURSE, true, { itemId: ITEM, title: 'Price Elasticity of Demand', number: 2 }, 3])
  assert.deepEqual(filters.filter(([key]) => !['from', 'select'].includes(key)),
    [['id', SET], ['user_id', 'student'], ['source_kind', 'notes-topic'], ['status', 'generated'], ['gt', 'expires_at']])
  assert.equal(await readTopicSet(client({ ...row, source_item_id: COURSE }), 'student', SET), null, 'the set and its row agree')
  assert.equal(await readTopicSet(client(null), 'student', SET), null)
  assert.equal(await readTopicSet(client({ ...row, question_set: { ...stored, source: { fileName: 'notes.pdf' } } }),
    'student', SET), null, 'a set from an upload has no topic page')
})
