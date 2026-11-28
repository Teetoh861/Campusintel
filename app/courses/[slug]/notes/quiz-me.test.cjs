// app/courses/[slug]/notes/quiz-me.test.cjs — "Quiz me on this topic" as a student meets it: the button in the topic's
// Campus Bot area beside Ask, only where a quiz can be written; the wait; every state's exact, owner-approved line; a
// set still being written waited for; and one request id per topic, so a retry or a reload never pays twice.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.join(__dirname, '../../../..')
const h = React.createElement
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [match[1], text(match[2])])
const buttons = html => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => text(match[1]))
const HREFS = { signInHref: '/login?next=%2Fback', reloadHref: '/back' }
const ITEM = '83000000-0000-4000-8000-000000000001'
const SET = '83000000-0000-4000-8000-000000000002'

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

// A Storage stand-in, and one that refuses every call (a private window, blocked storage).
const memory = () => { const map = new Map(); return { map, getItem: key => map.get(key) ?? null,
  setItem: (key, value) => { map.set(key, value) }, removeItem: key => { map.delete(key) } } }
const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') },
  removeItem() { throw new Error('blocked') } }

test('the approved quiz lines, word for word', () => {
  const { CAMPUS_BOT_COPY: copy } = require(path.join(root, 'lib/campus-bot/copy.ts'))
  assert.equal(copy.quiz.start, 'Quiz me on this topic')
  assert.equal(copy.quiz.writing, 'Campus Bot is writing your questions…')
  assert.equal(copy.quiz.passLeft(1, 1), '1 of 1 Campus Bot set left on your free pass.')
  assert.equal(copy.quiz.failed, 'We couldn’t create your questions.')
  assert.equal(copy.quiz.label, 'Made by Campus Bot from this study guide topic.')
  assert.equal(copy.quiz.fromNotes, 'From the study guide:')
  assert.equal(copy.quiz.backToTopic, 'Back to topic')
  assert.equal(copy.limits.passQuiz, 'You’ve used your free pass Campus Bot set.')
  assert.deepEqual(copy.limits.undelivered, { title: 'Campus Bot limit reached.', line: 'Try again tomorrow.' })
})

test('each topic keeps one request id in this tab until the server records an outcome against it', () => {
  const { settleTopicRequest, topicRequestId } = require(path.join(root, 'lib/ai-practice/topic-client.ts'))
  const store = memory()
  let next = 0
  const newId = () => `84000000-0000-4000-8000-00000000000${++next}`
  const first = topicRequestId(ITEM, newId, store)
  assert.equal(topicRequestId(ITEM, newId, store), first, 'a reload or a second tap repeats the request')
  for (const status of ['in-progress', 'busy', 'unavailable', 'limit', 'not-entitled', 'locked', 'signed-out']) {
    settleTopicRequest(ITEM, { status }, store)
    assert.equal(topicRequestId(ITEM, newId, store), first, `${status} keeps the id`)
  }
  settleTopicRequest(ITEM, { status: 'ready', setId: SET }, store)
  assert.notEqual(topicRequestId(ITEM, newId, store), first, 'a delivered set: the next tap is a new set')
  const other = topicRequestId('another-topic', newId, store)
  assert.notEqual(other, topicRequestId(ITEM, newId, store), 'one id per topic')
  store.map.set(`campus-bot-quiz:${ITEM}`, 'not-an-id')
  assert.match(topicRequestId(ITEM, newId, store), /^84000000-/, 'a stored value that is not an id is never sent')
  assert.match(topicRequestId(ITEM, newId, blocked), /^84000000-/, 'storage that refuses still gives an id')
  assert.doesNotThrow(() => settleTopicRequest(ITEM, { status: 'failed' }, blocked))
})

test('a set still being written is waited for, then opened; the page leaving stops the wait', async () => withTsx(async () => {
  const { runQuiz } = require('./QuizMe.tsx')
  const answers = [{ status: 'in-progress' }, { status: 'in-progress' }, { status: 'ready', setId: SET }]
  const sent = [], waits = []
  const deps = { send: async (command, token) => { sent.push([command, token]); return answers.shift() },
    newId: () => '85000000-0000-4000-8000-000000000001', store: memory(), wait: async ms => { waits.push(ms) } }
  assert.deepEqual(await runQuiz({ courseSlug: 'principles-economics-1', itemId: ITEM }, 'page-token', deps, () => true),
    { status: 'ready', setId: SET })
  assert.deepEqual(sent.map(([command]) => command.requestId), Array(3).fill('85000000-0000-4000-8000-000000000001'))
  assert.deepEqual(sent[0], [{ operation: 'generate-topic', courseSlug: 'principles-economics-1', itemId: ITEM,
    requestId: '85000000-0000-4000-8000-000000000001' }, 'page-token'])
  assert.deepEqual(waits, [3000, 3000])

  let wanted = true
  const stopping = { ...deps, send: async () => { wanted = false; return { status: 'in-progress' } } }
  assert.equal(await runQuiz({ courseSlug: 'x', itemId: ITEM }, 't', stopping, () => wanted), null)
  const forever = { ...deps, send: async () => ({ status: 'in-progress' }) }
  assert.deepEqual(await runQuiz({ courseSlug: 'x', itemId: ITEM }, 't', forever, () => true), { status: 'in-progress' },
    'a wait has an end: the busy notice offers Try again')
}))

for (const [name, store] of [['absent', null], ['throwing', blocked]]) {
  test(`a lost response keeps the pending request in component memory with ${name} session storage`, async () => withTsx(async () => {
    const { runQuiz } = require('./QuizMe.tsx')
    const pending = new Map(), delivered = new Map(), sent = []
    let next = 0
    const deps = { store, newId: () => `85000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
      wait: async () => {}, send: async command => {
        sent.push(command.requestId)
        if (!delivered.has(command.requestId)) delivered.set(command.requestId, SET)
        // The set was delivered, but its first HTTP response did not reach the browser.
        return sent.length === 1 ? { status: 'unavailable' } : { status: 'ready', setId: delivered.get(command.requestId) }
      } }
    const topic = { courseSlug: 'principles-economics-1', itemId: ITEM }
    assert.deepEqual(await runQuiz(topic, 'page-token', deps, () => true, pending), { status: 'unavailable' })
    assert.equal(pending.get(ITEM), sent[0], 'the component keeps the id when no outcome is known')
    assert.deepEqual(await runQuiz(topic, 'page-token', deps, () => true, pending), { status: 'ready', setId: SET })
    assert.equal(sent[1], sent[0], 'Try again replays the same request')
    assert.equal(delivered.size, 1, 'one delivered set, never a second reservation')
    assert.equal(pending.has(ITEM), false, 'a recorded outcome clears the component memory')
    await runQuiz(topic, 'page-token', deps, () => true, pending)
    assert.notEqual(sent[2], sent[0], 'the next intentional set has a new request id')
  }))
}

test('the quiz’s part of the area: the button, the wait, the free pass line, and each problem with its one way on',
  async () => withTsx(async () => {
    const { QuizMeView } = require('./QuizMe.tsx')
    const view = (writing, problem = null, passLine = null) => renderToStaticMarkup(h(QuizMeView,
      { view: { writing, problem }, passLine, onStart: () => {}, ...HREFS }))

    const idle = view(false)
    assert.deepEqual(buttons(idle), ['Quiz me on this topic'])
    assert.equal(text(idle), 'Quiz me on this topic')
    assert.match(idle, /class="[^"]*bg-student-surface/, 'a secondary button: the topic’s own practice stays primary')
    assert.equal(text(view(false, null, '1 of 1 Campus Bot set left on your free pass.')),
      'Quiz me on this topic 1 of 1 Campus Bot set left on your free pass.')
    const writing = view(true, null, '1 of 1 Campus Bot set left on your free pass.')
    assert.equal(text(writing), 'Quiz me on this topic Campus Bot is writing your questions…')
    assert.match(writing, /<button[^>]*disabled=""/)
    assert.match(writing, /role="status"/)

    const notice = problem => { const html = view(false, problem); return [text(html).replace(/^Quiz me on this topic ?/, ''),
      links(html), buttons(html).slice(1)] }
    assert.deepEqual(notice({ status: 'not-entitled', notice: 'subscribe' }),
      ['Campus Bot is included when you subscribe. Plan & Access', [['/access', 'Plan & Access']], []])
    assert.deepEqual(notice({ status: 'not-entitled', notice: 'free-pass' }),
      ['Campus Bot opens with a free pass. Get your free pass', [['/access', 'Get your free pass']], []])
    assert.deepEqual(notice({ status: 'not-entitled', notice: 'plan' }),
      ['Campus Bot is included with a plan. Plan & Access', [['/access', 'Plan & Access']], []])
    assert.deepEqual(notice({ status: 'limit', limit: 'pass', resetsAt: null }),
      ['You’ve used your free pass Campus Bot set. Plan & Access', [['/access', 'Plan & Access']], []])
    assert.deepEqual(notice({ status: 'limit', limit: 'session', resetsAt: '2026-11-17T09:05:00Z' }),
      ['You’ve used up Campus Bot for now. It resets at 10:05.', [], []])
    assert.deepEqual(notice({ status: 'limit', limit: 'week', resetsAt: '2026-11-16T09:05:00Z' }),
      ['You’ve used up Campus Bot for this week. It resets Monday at 10:05.', [], []])
    assert.deepEqual(notice({ status: 'limit', limit: 'undelivered', resetsAt: null }),
      ['Campus Bot limit reached. Try again tomorrow.', [], []])
    for (const status of ['busy', 'in-progress']) {
      assert.deepEqual(notice({ status }), ['Campus Bot is busy. Try again in a few minutes. Try again', [], ['Try again']])
    }
    assert.deepEqual(notice({ status: 'failed' }), ['We couldn’t create your questions. Try again', [], ['Try again']])
    assert.deepEqual(notice({ status: 'unavailable' }), ['We couldn’t create your questions. Try again', [], ['Try again']])
    assert.deepEqual(notice({ status: 'not-found' }), ['We couldn’t create your questions.', [], []])
    const { AUTH_PATHS, SIGNED_IN_ON_ANOTHER_TAB } = require(path.join(root, 'lib/auth/constants.ts'))
    assert.ok(AUTH_PATHS.login)
    assert.deepEqual(notice({ status: 'signed-out' }), ['You’ve been signed out. Sign in',
      [['/login?next=%2Fback', 'Sign in']], []])
    assert.deepEqual(notice({ status: 'session-changed' }), [`${SIGNED_IN_ON_ANOTHER_TAB} Reload`, [['/back', 'Reload']], []],
      'the one sign-in line every screen uses (copy-standard makes it "Reload this page to continue.")')
    assert.deepEqual(notice({ status: 'locked', plansOnSale: true })[0], 'Included when you subscribe. Plan & Access')
  }))

// The topic page and the free pass's topic page, with the student's course and the switches as fixtures.
async function topicPage({ features, words = 'long', passLine = null }, run) {
  const load = Module._load
  const ask = features.ask, quiz = features.topicSets
  const body = words === 'long' ? Array.from({ length: 160 }, (_, index) => `word${index}`).join(' ') : 'Too short to quiz on.'
  const note = { itemId: ITEM, publishedRevision: 1, title: 'Price Elasticity', body, noteType: 'topic_note',
    keyPoints: ['A point'] }
  const route = { slug: 'principles-economics-1', href: '/courses/principles-economics-1',
    course: { slug: 'principles-economics-1', code: 'ECO101', title: 'Principles of Economics I' } }
  const result = { status: 'ok', course: { institutionalCourseId: 'inst', code: 'ECO101', title: 'Principles of Economics I',
    isFree: false, applicability: [], repository: { state: 'shelved', repositoryCourseId: 'repo',
      contentKey: 'principles-economics-1', isShared: false, route },
    content: { state: 'ready', study: { notes: true, cbtPractice: false, theory: false, overview: false } } },
  learning: { overview: null, notes: [note], theoryPractice: false, theoryPracticeItems: [], theoryQuestions: [] },
  practice: null }
  function StudentAccessGate() { return null }
  const reads = { pass: 0 }
  try {
    await withTsx(async () => {
      const central = require(path.join(root, 'lib/courses/read-model.ts'))
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/navigation') return { useRouter: () => ({ push() {} }),
          redirect: destination => { throw new Error('redirect:' + destination) }, notFound: () => { throw new Error('notFound') } }
        if (name === '@/lib/supabase/server') return { createClient: async () => ({ name: 'client' }) }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () =>
          ({ user: { id: 'student' }, sessionId: 'session' }) }
        if (name === '@/lib/courses/read-model') return { ...central, getStudentCourseBySlugForVerifiedStudent: async () => result }
        if (name === '@/lib/entitlements/server') return { readPlansOnSale: async () => false }
        if (name === '@/lib/campus-bot/features') return { readCampusBotFeatures: async () =>
          ({ explain: false, ask, topicSets: quiz }) }
        if (name === '@/lib/ai-practice/quiz-pass') return { readQuizPassLine: async () => { reads.pass += 1; return passLine } }
        return load.call(this, name, ...args)
      }
      const topic = require('./[topic]/page.tsx').default
      const gated = await topic({ params: Promise.resolve({ slug: 'principles-economics-1', topic: '1' }) })
      const child = gated.props.children('page-token')
      await run(renderToStaticMarkup(await child.type(child.props)), reads)
    })
  } finally { Module._load = load }
}

const area = html => /<section class="student-campus-bot-area"[\s\S]*?<\/section>/.exec(html)?.[0] ?? null

test('the topic page: one Campus Bot area under the notes, with Quiz me beside Ask, only where a quiz can be written',
  async () => {
    await topicPage({ features: { ask: true, topicSets: true }, passLine: '1 of 1 Campus Bot set left on your free pass.' },
      (html, reads) => {
        const section = area(html)
        assert.ok(section, 'the area is on the page')
        assert.deepEqual(buttons(section), ['Ask a question', 'Quiz me on this topic'])
        assert.match(text(section), /^Campus Bot Ask a question Quiz me on this topic 1 of 1 Campus Bot set left on your free pass\.$/)
        assert.ok(html.indexOf('student-campus-bot-area') > html.indexOf('</article>'), 'under the topic and its own practice')
        assert.ok(html.indexOf('student-campus-bot-area') < html.indexOf('student-guide-pager'), 'above the next topic')
        assert.equal(reads.pass, 1)
      })
    await topicPage({ features: { ask: false, topicSets: true } }, html => {
      assert.deepEqual(buttons(area(html)), ['Quiz me on this topic'])
    })
    await topicPage({ features: { ask: true, topicSets: false } }, (html, reads) => {
      assert.deepEqual(buttons(area(html)), ['Ask a question'])
      assert.equal(reads.pass, 0, 'no allowance read when the quiz is not offered')
    })
    await topicPage({ features: { ask: true, topicSets: true }, words: 'short' }, (html, reads) => {
      assert.deepEqual(buttons(area(html)), ['Ask a question'], 'a note under 150 words offers no quiz')
      assert.equal(reads.pass, 0)
    })
    await topicPage({ features: { ask: false, topicSets: false } }, html => {
      assert.equal(area(html), null, 'nothing switched on: no area at all')
    })
  })
