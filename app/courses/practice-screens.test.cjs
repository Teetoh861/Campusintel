// app/courses/practice-screens.test.cjs — The locked Practice surfaces: briefing, attempt, results, review, report, states.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../lib/test/element-walker.cjs')

const QUIZ = './[slug]/quiz/'
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
const count = (html, pattern) => (html.match(pattern) || []).length
// A graded question as the server returns it; an open attempt's question is its prompt, options and section only.
const question = (index, extra = {}) => ({ questionId: `question-${index}`, prompt: `Prompt ${index}`,
  options: ['Alpha', 'Beta', 'Gamma', 'Delta'], section: index % 2 ? 'Two' : 'One', itemId: `item-${index}`, revision: 1,
  selected: null, correctOption: 1, explanation: null, ...extra })
const openQuestion = index => { const { questionId, prompt, options, section } = question(index); return { questionId, prompt, options, section } }
/** The graded questions with the given choices: index -> option. */
const choose = (questions, answers) => questions.map((item, index) => ({ ...item, selected: answers[index] ?? null }))
const gradedAttempt = (questions, extra = {}) => ({ status: 'submitted', id: 'attempt-1', courseId: 'course-1', intent: 'new',
  redoOf: null, startedAt: '2026-10-24T10:00:00.000Z', deadlineAt: '2026-10-24T11:00:00.000Z', durationSeconds: 3600,
  questionCount: questions.length, bankSize: 214, questions,
  result: { score: questions.filter(item => item.selected === item.correctOption).length, total: questions.length,
    timedOut: false, finishedAt: '2026-10-24T10:41:00.000Z' }, ...extra })
const identity = { courseCode: 'BUA 216', courseTitle: 'Financial Management', courseHref: '/courses/bua-216', repositoryOnly: false }

/** Controlled hook state for one client screen: effects run after render, matchMedia answers the desktop query. */
async function screenFixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const saved = { window: global.window, document: global.document, fetch: global.fetch, requestAnimationFrame: global.requestAnimationFrame }
  const state = { desktop: false, fetch: null }
  const mediaListeners = new Set()
  // A focusable stand-in: focus lands only on a connected, visible control, exactly as the browser decides.
  const control = name => ({ name, isConnected: true, hidden: false,
    focus() { if (this.isConnected && !this.hidden) global.document.activeElement = this } })
  const body = control('BODY')
  let active = null, ids = 0
  const hooks = {
    useState(initial) {
      if (!active) return React.useState(initial)
      const instance = active, index = instance.index++
      if (!(index in instance.slots)) instance.slots[index] = typeof initial === 'function' ? initial() : initial
      return [instance.slots[index], value => {
        instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value
        // A render-phase update restarts the render before anything commits, exactly as React does.
        if (active === instance) instance.again = true
      }]
    },
    useRef(initial) {
      if (!active) return React.useRef(initial)
      const index = active.index++
      if (!(index in active.slots)) active.slots[index] = { current: initial }
      return active.slots[index]
    },
    useId() {
      if (!active) return React.useId()
      const index = active.index++
      if (!(index in active.slots)) active.slots[index] = `:test-id-${++ids}:`
      return active.slots[index]
    },
    useMemo(factory) { if (!active) return React.useMemo(factory); active.index++; return factory() },
    useCallback(callback, deps) { if (!active) return React.useCallback(callback, deps); active.index++; return callback },
    // Effects commit against the deps of the last run; a restarted render compares with committed deps, not a discarded pass.
    useEffect(effect, deps) {
      if (!active) return React.useEffect(effect, deps)
      const instance = active, index = instance.index++, committed = instance.slots[index]
      if (committed && deps && committed.deps && deps.length === committed.deps.length &&
          deps.every((value, i) => Object.is(value, committed.deps[i]))) return
      instance.effects.push({ index, deps, effect })
    },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      if (!active) return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
      active.index++
      return getSnapshot()
    },
  }
  try {
    global.window = { matchMedia: () => ({ get matches() { return state.desktop },
      addEventListener: (_, listener) => mediaListeners.add(listener), removeEventListener: (_, listener) => mediaListeners.delete(listener) }),
      innerWidth: 390 }
    global.document = { body, activeElement: body }
    global.fetch = (...args) => state.fetch(...args)
    global.requestAnimationFrame = callback => { callback(); return 1 }
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      return name === 'react' ? { ...React, ...hooks } : load.call(this, name, ...args)
    }
    // `prepare` runs between render and effects, where a test seeds the refs a real DOM would have attached.
    const mount = (Component, props) => {
      const instance = { slots: [], props, index: 0, effects: [], again: false, prepare: null }
      instance.render = () => {
        let result, passes = 0
        do {
          active = instance; instance.index = 0; instance.effects = []; instance.again = false
          try { result = Component(instance.props) } finally { active = null }
        } while (instance.again && ++passes < 8)
        instance.prepare?.(result)
        for (const { index, deps, effect } of instance.effects) { instance.slots[index] = { deps }; effect() }
        return result
      }
      return instance
    }
    // Screens return their collaborators as elements, so a plain walk sees them without re-rendering hook owners.
    const crossTo = desktop => { state.desktop = desktop; for (const listener of mediaListeners) listener() }
    const closeEvent = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true } })
    await run({ mount, state, crossTo, control, body, closeEvent, html: renderToStaticMarkup, all: element => elementNodes(element) })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete global[name]; else global[name] = value }
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('results show the server grading with the locked bands, truthful counts and only the actions allowed now', async () => withTsx(async () => {
  const { ResultsScreen } = require(QUIZ + 'ResultsScreen.tsx')
  const questions = choose(Array.from({ length: 10 }, (_, index) => question(index)),
    { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0 })
  const render = (props, attempt = {}) => renderToStaticMarkup(React.createElement(ResultsScreen, { ...identity,
    attempt: gradedAttempt(questions, attempt), canStartNew: true, unsentAtDeadline: false, starting: false, error: null,
    onReview() {}, onRetake() {}, onRedo() {}, ...props }))
  const actions = html => [...html.matchAll(/<(?:button|a)\b[^>]*>([^<]*)<\/(?:button|a)>/g)].map(match => match[1])
  const html = render({})
  assert.equal(count(html, /<h1\b/g), 1)
  assert.match(html, /<h1[^>]*>Exam result<\/h1>/)
  assert.match(html, /BUA 216 · Financial Management/)
  assert.match(html, /Submitted · 41 of 60 minutes used/)
  assert.match(text(html), /70% 7 of 10 correct/)
  assert.match(html, /Great work/)
  assert.doesNotMatch(html, /Practice feedback|official grade/)
  assert.match(text(html), /Correct 7 .*Incorrect 2 .*Unanswered 1/)
  assert.doesNotMatch(html, /Result saved to your account/, 'no process talk on the result')
  assert.doesNotMatch(html, /weakest|Mastered|Revisit|Section [A-Z]\b|history|best score/i)
  assert.deepEqual(actions(html), ['Review answers', 'New questions', 'Same questions', 'Back to course'])
  assert.doesNotMatch(html, /Retake gives you|Redo repeats/, 'the buttons name what they do')
  assert.match(html, /href="\/courses\/bua-216"/)
  assert.match(text(html), /3 questions to review/)
  assert.doesNotMatch(html, /See the correct answer for every question/, 'the heading is not contradicted by a second line')
  // D4: a bank no larger than the attempt offers one "Practise again".
  const whole = render({}, { bankSize: 10 })
  assert.deepEqual(actions(whole), ['Review answers', 'Practise again', 'Back to course'])
  assert.doesNotMatch(whole, /New questions|Same questions/)
  // No new attempt may start now (access or bank): review only.
  assert.deepEqual(actions(render({ canStartNew: false })), ['Review answers', 'Back to course'])
  const timedOut = render({}, { status: 'timed_out', result: { score: 7, total: 10, timedOut: true,
    finishedAt: '2026-10-24T11:00:00.000Z' } })
  // Time running out is said once, in the line under the title; a notice only when it cost the student answers.
  assert.match(timedOut, /Time ran out · 60 of 60 minutes used/)
  assert.doesNotMatch(timedOut, /student-notice|Submitted|attempt has been submitted|count as missed|weren’t saved in time/)
  const unsent = render({ unsentAtDeadline: true }, { status: 'timed_out', result: { score: 7, total: 10, timedOut: true,
    finishedAt: '2026-10-24T11:00:00.000Z' } })
  assert.match(unsent, /<h2 class="student-notice-title">Some answers weren’t saved in time, so they don’t count\.<\/h2>/)
  assert.doesNotMatch(unsent, /on this device|didn’t reach us/)
  assert.match(render({ starting: true }), /role="status"[^>]*>Starting…/)
  for (const out of [html, whole, timedOut, unsent]) {
    assert.doesNotMatch(out, /couldn’t be saved|Saving your result|until you leave|timer has not started/)
  }
}))

test('Exam mode starts from the server brief and the timer rule, with one button, and names repository identity honestly', async () => withTsx(async () => {
  const { IntroScreen } = require(QUIZ + 'IntroScreen.tsx')
  const render = props => renderToStaticMarkup(React.createElement(IntroScreen, { ...identity,
    brief: { questionCount: 50, durationSeconds: 3600 }, bankSize: 200, starting: false, error: null,
    lastResultHref: null, onStart() {}, ...props }))
  const html = render({})
  assert.equal(count(html, /<h1\b/g), 1)
  assert.match(html, /<h1[^>]*>Exam mode<\/h1>/)
  assert.doesNotMatch(html, /student-page-band-lede|CBT practice|One timed attempt|This attempt/, 'the title names the mode; nothing sits under it')
  assert.match(text(html), /50 questions from a bank of 200 · 60 min The timer keeps running, even if your connection drops\./)
  assert.doesNotMatch(html, /fresh set|can’t be resumed|ends the attempt|new set of questions|new order each time|Answering|Finishing|Move freely/)
  // One button starts the exam: no tick box, and nothing to confirm first.
  assert.doesNotMatch(html, /role="checkbox"|ready to start|Confirm you/)
  assert.match(html, /<button type="button"[^>]*>Start exam<\/button>/)
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Start exam/)
  assert.match(html, /<a[^>]*href="\/courses\/bua-216"[^>]*>Back to course<\/a>/, 'Exam mode\'s way back is the course page, by its name')
  assert.doesNotMatch(html, /practice target|Bank sections|study guide|BUA202|last result/i)
  const whole = render({ brief: { questionCount: 50, durationSeconds: 1800 }, bankSize: 50 })
  assert.match(text(whole), /50 questions · 30 min/)
  assert.doesNotMatch(whole, /from a bank/)
  const smaller = render({ bankSize: 49 })
  assert.match(text(smaller), /49 questions · 60 min/)
  assert.doesNotMatch(smaller, /50 questions|from a bank/)
  const repository = render({ repositoryOnly: true, courseCode: 'INS 999', courseTitle: 'Principles of Insurance' })
  assert.match(repository, /Additional study material · Principles of Insurance/)
  assert.doesNotMatch(repository, /Check that this material matches your course and syllabus/)
  assert.doesNotMatch(repository, /INS 999 · Principles/)
  const starting = render({ starting: true })
  assert.match(starting, /role="status"[^>]*>Starting…</)
  assert.match(starting, /<button[^>]*disabled=""[^>]*>Start exam<\/button>/, 'a start on its way cannot be asked for twice')
  const changed = render({ error: { title: 'The exam has changed.', body: 'Check the questions and time, then start.' } })
  assert.match(changed, /role="alert"[\s\S]*The exam has changed/)
  const last = render({ lastResultHref: '/courses/bua-216/quiz?attempt=a' })
  assert.match(last, /href="\/courses\/bua-216\/quiz\?attempt=a"[^>]*>See your last result</)
  for (const out of [html, whole, smaller, repository, starting, changed]) {
    assert.doesNotMatch(out, /repository|published|question bank|random|new set|fresh set|shuffl|order each|try it more than once|timer has not started/i)
  }
}))

test('the attempt shows one question with native answers, one sr-only h1, a real timer and in-flow steps', async () => withTsx(async () => {
  const { QuestionScreen } = require(QUIZ + 'QuestionScreen.tsx')
  const questions = Array.from({ length: 50 }, (_, index) => openQuestion(index))
  const render = props => renderToStaticMarkup(React.createElement(QuestionScreen, { ...identity, question: questions[11],
    current: 11, total: 50, selected: undefined, isMarked: false, timeLeft: 2538, isLowTime: false, canAnswer: true,
    saveLine: null, onRetrySave() {}, navOpen: false,
    answeredCount: 9, markedCount: 2, answersMap: { 0: 1, 1: 1 }, markedMap: { 5: true, 10: true },
    onSelectOption() {}, onToggleMark() {}, onPrev() {}, onNext() {}, onJump() {}, onSubmit() {}, onOpenNav() {}, onCloseNav() {}, onLeave() {}, ...props }))
  const html = render({})
  assert.equal(count(html, /<h1\b/g), 1)
  assert.match(html, /<h1 class="sr-only">Exam mode — BUA 216 Financial Management<\/h1>/)
  assert.match(html, /<b>BUA 216<\/b> · Financial Management · Exam mode/)
  assert.match(html, /role="timer" aria-label="Time left 42 minutes 18 seconds"/)
  assert.match(html, />42:18</)
  assert.doesNotMatch(html, /data-urgency/)
  assert.match(text(html), /Question 12 of 50/)
  assert.doesNotMatch(html, /<h[1-6][^>]*>Prompt 11</, 'the prompt is never a heading')
  assert.match(html, /<legend class="sr-only">Choose one answer<\/legend>/)
  assert.equal(count(html, /type="radio"/g), 4)
  assert.equal(new Set([...html.matchAll(/type="radio" name="([^"]+)"/g)].map(match => match[1])).size, 1)
  assert.match(html, /aria-pressed="false"[^>]*>[\s\S]*?Flag question/)
  assert.match(html, /lucide-flag/)
  assert.match(html, /9 of 50 answered · 2 flagged/)
  assert.deepEqual([...html.matchAll(/student-practice-steps[\s\S]*?<\/div>/g)].length, 1)
  assert.match(html, /<button[^>]*>Previous<\/button>[\s\S]*<button[^>]*>Next<\/button>/)
  assert.doesNotMatch(html, /class="[^"]*\bfixed\b/, 'no fixed mobile action bar')
  assert.equal(count(html, /aria-label="Question \d+, /g), 50, 'inline navigator lists every cell')
  assert.match(html, /aria-label="Question 12, unanswered, current"[^>]*aria-current="step"/)
  assert.match(html, /aria-label="Question 6, unanswered, flagged"/)
  assert.match(html, /aria-label="Question 1, answered"/)
  assert.doesNotMatch(html, /Question numbers/, 'the navigator sheet stays closed until requested')
  const low = render({ timeLeft: 272, isLowTime: true })
  assert.match(low, /data-urgency="low"/)
  assert.match(low, /aria-live="polite">5 minutes left</)
  const last = render({ current: 49, question: questions[49], selected: 2 })
  assert.match(last, /<button[^>]*aria-haspopup="dialog"[^>]*>Submit exam<\/button>/)
  assert.match(last, /data-selected="true"><input[^>]*checked=""[^>]*value="2"/)
  assert.match(last, />Selected</)
  assert.match(html, /<button[^>]*aria-haspopup="dialog"[^>]*>Exit<\/button>/)
  assert.doesNotMatch(html, /Leave practice/)
  // The exam marks itself open from the first paint, so the stylesheet hides the site's header and footer at once.
  assert.match(html, /class="student-practice-bar" data-exam-open=""/)
  // J5: the time left always shows, never a placeholder; answers wait only for a trustworthy reading.
  const waiting = render({ canAnswer: false, saveLine: null })
  assert.match(waiting, /role="timer" aria-label="Time left 42 minutes 18 seconds"/)
  assert.doesNotMatch(waiting, /––:––|Checking the time left/)
  assert.equal(count(waiting, /type="radio"[^>]*disabled=""/g), 4)
  assert.equal(count(html, /type="radio"[^>]*disabled=""/g), 0)
  // While the exam is being handed in, Exit has nothing to ask.
  assert.match(render({ canExit: false }), /<button[^>]*disabled=""[^>]*>Exit<\/button>/)
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>Exit<\/button>/)
  const failed = render({ saveLine: { text: 'We couldn’t save your answers. Keep this page open.', retry: true } })
  assert.match(failed, /Keep this page open\. <button[^>]*>Try again<\/button>/)
}))

test('review lists this attempt, never labels unanswered as incorrect, filters honestly and pages 5 or 10', async () => screenFixture(async f => {
  const { ReviewScreen } = require(QUIZ + 'ReviewScreen.tsx')
  const base = Array.from({ length: 23 }, (_, index) => question(index, index === 2 ? { explanation: 'Because.' } : {}))
  const answers = {}
  for (let index = 0; index < 23; index++) if (index % 5 !== 4) answers[index] = index % 3 === 0 ? 0 : 1
  const questions = choose(base, answers)
  const correct = Object.values(answers).filter(value => value === 1).length
  const unanswered = 23 - Object.keys(answers).length
  const props = { ...identity, questions, correctCount: correct, reported: { 'question-3': true }, onReport() {}, onBack() {} }
  const ssr = f.html(React.createElement(ReviewScreen, props))
  assert.equal(count(ssr, /<h1\b/g), 1)
  assert.match(ssr, /<h1[^>]*>Answer review<\/h1>/)
  assert.match(ssr, new RegExp(`>${correct} of 23 correct<`))
  assert.match(ssr, />All 23</)
  assert.match(ssr, new RegExp(`>To review ${23 - correct}<`))
  assert.match(ssr, new RegExp(`>Correct ${correct}<`))
  assert.equal(count(ssr, /aria-expanded="false"/g), 5, 'compact pages hold five collapsed items')
  assert.match(ssr, /Questions 1–5 of 23/)
  assert.match(ssr, /aria-label="Review pages"/)
  assert.match(ssr, /aria-expanded="false" aria-controls="student-practice-review-5"[\s\S]*?>Unanswered</)
  assert.doesNotMatch(ssr, /Question 5<\/span><span class="student-practice-status" data-status="incorrect"/)
  assert.match(ssr, /Review answer/)
  assert.doesNotMatch(ssr, /Hide answer/)

  const screen = f.mount(ReviewScreen, props)
  const rendered = () => f.all(screen.render())
  const find = (type, test) => rendered().find(node => node.type === type && test(node.props))
  const pagination = () => rendered().find(node => node.type?.name === 'Pagination')
  assert.equal(pagination().props.totalPages, 5)
  const filter = value => find('input', props => props.value === value).props.onChange()
  filter('to-review'); screen.render()
  assert.equal(pagination().props.totalPages, Math.ceil((23 - correct) / 5))
  const cards = () => rendered().filter(node => node.type?.name === 'ReviewCard')
  assert.equal(cards().filter(card => card.props.status === 'incorrect').length + cards().filter(card => card.props.status === 'unanswered').length, cards().length)
  assert.ok(cards().some(card => card.props.status === 'unanswered'), 'To review includes unanswered questions')
  assert.ok(cards().every(card => card.props.status !== 'correct'))
  assert.match(f.html(screen.render()), new RegExp(`${23 - correct - unanswered} incorrect and ${unanswered} unanswered\\.`))
  cards()[0].props.onToggle(); screen.render()
  cards()[1].props.onToggle(); screen.render()
  assert.deepEqual(cards().map(card => card.props.open), [false, true, false, false, false], 'one open item below 1200')
  pagination().props.onPageChange(2); screen.render()
  assert.ok(cards().every(card => !card.props.open), 'a page change collapses everything')
  assert.equal(pagination().props.page, 2)
  filter('all'); screen.render()
  assert.equal(pagination().props.page, 1)
  assert.equal(pagination().props.totalPages, 5)
  assert.ok(cards().some(card => card.props.reported === true))

  f.state.desktop = true
  const desktop = f.mount(ReviewScreen, props)
  desktop.render(); desktop.render()
  const desktopCards = () => f.all(desktop.render()).filter(node => node.type?.name === 'ReviewCard')
  assert.equal(desktopCards().length, 10, 'ten per page from 1200')
  desktopCards()[0].props.onToggle(); desktop.render()
  desktopCards()[1].props.onToggle(); desktop.render()
  assert.deepEqual(desktopCards().slice(0, 3).map(card => card.props.open), [true, true, false], 'several open items at desktop')

  const none = f.mount(ReviewScreen, { ...props, questions: choose(base, { 0: 0 }), correctCount: 0 })
  none.render()
  f.all(none.render()).find(node => node.type === 'input' && node.props.value === 'correct').props.onChange()
  const empty = f.all(none.render()).find(node => node.type?.name === 'EmptyState')
  assert.equal(empty.props.title, 'No correct answers.')
  assert.equal(empty.props.children, null, 'the title says it all')
  assert.equal(f.all(none.render()).some(node => node.type?.name === 'Pagination'), false)
  const perfect = f.mount(ReviewScreen, { ...props, questions: choose(base, Object.fromEntries(base.map((_, index) => [index, 1]))), correctCount: 23 })
  perfect.render()
  f.all(perfect.render()).find(node => node.type === 'input' && node.props.value === 'to-review').props.onChange()
  assert.equal(f.all(perfect.render()).find(node => node.type?.name === 'EmptyState').props.title, 'Every answer correct.')
}))

test('a review item exposes its status and stem collapsed, and explanation only when authored', async () => withTsx(async () => {
  const { ReviewCard, reviewStatus } = require(QUIZ + 'ReviewCard.tsx')
  const q = question(0, { explanation: 'Beta because of the rule.', selected: 0 })
  assert.equal(reviewStatus({ ...q, selected: null }), 'unanswered')
  assert.equal(reviewStatus(q), 'incorrect')
  assert.equal(reviewStatus({ ...q, selected: 1 }), 'correct')
  const render = (props, item = q) => renderToStaticMarkup(React.createElement('ol', null, React.createElement(ReviewCard, { question: item, n: 3,
    status: 'incorrect', open: false, reported: false, onToggle() {}, onReport() {}, ...props })))
  const closed = render({})
  assert.match(closed, /<h3[^>]*><button[^>]*aria-expanded="false" aria-controls="student-practice-review-3"/)
  assert.match(closed, /class="student-practice-stem">Prompt 0</)
  assert.doesNotMatch(closed, />Why<|Report a question/)
  const open = render({ open: true })
  assert.match(open, /aria-expanded="true"/)
  assert.match(open, /id="student-practice-review-3"/)
  assert.match(open, /data-mark="correct"[\s\S]*?Correct answer/)
  assert.match(open, /data-mark="incorrect"[\s\S]*?Your answer</)
  assert.match(open, />Why<[\s\S]*Beta because of the rule\./)
  assert.doesNotMatch(open, /Explanation/, 'one word for it, the one topic practice uses')
  assert.match(open, /<button[^>]*aria-haspopup="dialog"[^>]*>Report a question<\/button>/)
  const unanswered = render({ open: true, status: 'unanswered' }, { ...q, selected: null })
  assert.match(unanswered, /data-status="unanswered"[\s\S]*?Unanswered</)
  assert.doesNotMatch(unanswered, /Incorrect|Your answer/)
  assert.match(unanswered, /You didn’t answer this question\./)
  const plain = renderToStaticMarkup(React.createElement('ol', null, React.createElement(ReviewCard, { question: question(1, { selected: 1 }), n: 2,
    status: 'correct', open: true, reported: true, onToggle() {}, onReport() {} })))
  assert.doesNotMatch(plain, />Why<|Explanation/)
  assert.match(plain, /Your answer · Correct/)
  assert.match(plain, /Reported</)
  assert.doesNotMatch(plain, /Report a question/)
}))

test('reports send the exact item, revision and saved attempt to the existing backend and map every outcome', async () => screenFixture(async f => {
  const { sendQuestionReport, ReportQuestionDialog, REPORT_ENDPOINT } = require(QUIZ + 'ReportQuestionDialog.tsx')
  const { AUTH_CONTINUITY_HEADER } = require('../../lib/auth/constants.ts')
  const target = { courseId: 'course-uuid', itemId: 'item-uuid', revision: 4, questionId: 'question-uuid', attemptId: null }
  const requests = []
  const respond = (body, status = 200) => async (url, init) => {
    requests.push([url, init]); return new Response(JSON.stringify(body), { status })
  }
  assert.equal(await sendQuestionReport(target, '  a note  ', 'token-A', respond({ status: 'reported', reportId: 'r' }, 201)), 'reported')
  const [url, init] = requests[0]
  assert.equal(url, REPORT_ENDPOINT)
  assert.equal(init.method, 'POST')
  assert.equal(init.credentials, 'same-origin')
  assert.equal(init.headers[AUTH_CONTINUITY_HEADER], 'token-A')
  assert.deepEqual(JSON.parse(init.body), { courseId: 'course-uuid', itemId: 'item-uuid', revision: 4, questionId: 'question-uuid', attemptId: null, note: 'a note' })
  await sendQuestionReport({ ...target, attemptId: 'attempt-uuid' }, '   ', 'token-A', respond({ status: 'reported', reportId: 'r' }, 201))
  assert.deepEqual(JSON.parse(requests[1][1].body).attemptId, 'attempt-uuid')
  assert.equal(JSON.parse(requests[1][1].body).note, null)
  assert.equal(await sendQuestionReport(target, '', 'token-A', respond({ status: 'already-reported', reportId: 'r' })), 'already-reported')
  assert.equal(await sendQuestionReport(target, '', 'token-A', respond({ status: 'limited' }, 429)), 'limited')
  assert.equal(await sendQuestionReport(target, '', 'token-A', respond({ status: 'signed-out' }, 401)), 'signed-out')
  assert.equal(await sendQuestionReport(target, '', 'token-A', respond({ status: 'session-changed' }, 409)), 'session-changed')
  assert.equal(await sendQuestionReport(target, '', 'token-A', respond({ status: 'unavailable' }, 503)), 'failed')
  assert.equal(await sendQuestionReport(target, '', 'token-A', respond({ status: 'invalid-request' }, 400)), 'failed')
  assert.equal(await sendQuestionReport(target, '', 'token-A', async () => { throw new Error('offline') }), 'failed')
  assert.equal(await sendQuestionReport(target, '', 'token-A', async () => new Response('<html>', { status: 200 })), 'failed')

  const reported = []
  let closed = 0
  const dialog = f.mount(ReportQuestionDialog, { target, questionNumber: 3, continuityToken: 'token-A',
    onClose: () => closed++, onReported: id => reported.push(id), onRestoreFocus() {} })
  const all = () => f.all(dialog.render())
  const byText = (type, label) => all().find(node => node.type === type && node.props.children === label)
  const joined = node => Array.isArray(node.props?.children) ? node.props.children.join('') : node.props?.children
  assert.ok(all().some(node => node.type?.displayName === 'DialogDescription' && joined(node) === 'Question 3'))
  const textarea = () => all().find(node => node.type?.displayName === 'Textarea')
  const counter = () => all().find(node => node.props?.className === 'student-practice-count-chars').props.children.join('')
  assert.equal(textarea().props.maxLength, undefined, 'no native UTF-16 maxLength on the note')
  assert.equal(all().find(node => node.type?.displayName === 'DialogContent').props.onCloseAutoFocus, dialog.props.onRestoreFocus,
    'the shared Dialog close lifecycle carries the review item\'s focus decision')
  textarea().props.onChange({ target: { value: 'x'.repeat(1200) } })
  assert.equal(textarea().props.value.length, 1000)
  assert.equal(counter(), '1,000 / 1,000')
  // The limit is 1000 Unicode code points on every layer: 1000 emoji fit although they are 2000 UTF-16 units.
  for (const [value, kept, shown] of [['x'.repeat(1000), 1000, '1,000 / 1,000'], ['x'.repeat(1001), 1000, '1,000 / 1,000'],
    ['😀'.repeat(1000), 2000, '1,000 / 1,000'], ['😀'.repeat(1001), 2000, '1,000 / 1,000'],
    ['a😀'.repeat(400), 1200, '800 / 1,000'], ['a😀'.repeat(600), 1500, '1,000 / 1,000']]) {
    textarea().props.onChange({ target: { value } })
    assert.equal(textarea().props.value.length, kept)
    assert.equal(counter(), shown)
    assert.ok(Array.from(textarea().props.value).every(point => point.codePointAt(0) < 0xd800 || point.codePointAt(0) > 0xdfff),
      'clamping never leaves a lone surrogate')
  }
  textarea().props.onChange({ target: { value: '😀'.repeat(1001) } })
  assert.equal(textarea().props.value, '😀'.repeat(1000), 'the 1001st code point is dropped whole')
  textarea().props.onChange({ target: { value: 'Marked answer looks wrong.' } })
  let release
  f.state.fetch = () => new Promise(resolve => { release = resolve })
  all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  dialog.render()
  assert.equal(byText('button', 'Sending…').props.disabled, true)
  assert.equal(byText('button', 'Cancel').props.disabled, true)
  all().find(node => node.type?.name === 'Dialog').props.onOpenChange(false)
  assert.equal(closed, 0, 'a busy dialog cannot be dismissed mid-request')
  release(new Response(JSON.stringify({ status: 'unavailable' }), { status: 503 }))
  await new Promise(resolve => setTimeout(resolve, 0))
  dialog.render()
  assert.equal(all().find(node => node.type?.name === 'Notice').props.title, 'We couldn’t send your report.')
  assert.equal(textarea().props.value, 'Marked answer looks wrong.', 'the note is kept')
  assert.ok(byText('button', 'Try again'))
  // A report refused for the sign-in says what to do, starting with the note, which lives only in this dialog.
  for (const [status, code, title, body] of [
    ['signed-out', 401, 'You’ve been signed out.', 'Copy your note, then sign in again.'],
    ['session-changed', 409, 'We couldn’t send your report.', 'Copy your note, then reload this page.']]) {
    f.state.fetch = async () => new Response(JSON.stringify({ status }), { status: code })
    all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise(resolve => setTimeout(resolve, 0))
    dialog.render()
    const refused = all().find(node => node.type?.name === 'Notice')
    assert.deepEqual([refused.props.title, refused.props.children], [title, body], status)
    assert.equal(textarea().props.value, 'Marked answer looks wrong.', `${status}: the note is kept`)
    assert.deepEqual(reported, [], `${status}: nothing was reported`)
  }
  f.state.fetch = async () => new Response(JSON.stringify({ status: 'reported', reportId: 'r' }), { status: 201 })
  all().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  await new Promise(resolve => setTimeout(resolve, 0))
  dialog.render()
  assert.equal(all().find(node => node.type?.name === 'Notice').props.title, 'Report sent.')
  assert.deepEqual(reported, ['question-uuid'])
  assert.ok(byText('button', 'Done'))
  for (const [status, title, marks] of [['already-reported', 'You’ve already reported this question.', true], ['limited', 'Report not sent.', false]]) {
    const again = f.mount(ReportQuestionDialog, { target, questionNumber: 4, continuityToken: 'token-A', onClose() {}, onReported: id => reported.push(id), onRestoreFocus() {} })
    f.state.fetch = async () => new Response(JSON.stringify({ status, reportId: 'r' }), { status: 200 })
    const before = reported.length
    f.all(again.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await new Promise(resolve => setTimeout(resolve, 0))
    assert.equal(f.all(again.render()).find(node => node.type?.name === 'Notice').props.title, title)
    assert.equal(reported.length, before + (marks ? 1 : 0))
  }
}))

test('confirmations carry the locked copy and truthful counts; the safe action is the cancel', async () => screenFixture(async f => {
  const { AssessmentConfirmation } = require(QUIZ + 'AssessmentConfirmation.tsx')
  const { EndExamDialog } = require('../../components/student/EndExamDialog.tsx')
  const { PRACTICE_COPY } = require(QUIZ + 'practice-presentation.ts')
  const strings = element => element.filter(node => typeof node.props?.children === 'string').map(node => node.props.children)
  // J1: leaving asks "End exam?" in the owner's words; Keep going is the safe choice, so it is the cancel (focused first).
  const ended = [], kept = []
  const end = f.all(f.mount(EndExamDialog, { open: true, onKeepGoing: () => kept.push(1), onEnd: () => ended.push(1) }).render())
  assert.ok(strings(end).includes('End exam?'))
  assert.ok(strings(end).includes('Your answers will be submitted and marked. You can’t change them after this.'))
  const cancel = end.find(node => node.type?.displayName === 'AlertDialogCancel')
  const action = end.find(node => node.type?.displayName === 'AlertDialogAction')
  assert.deepEqual([action.props.children, cancel.props.children], ['End and see results', 'Keep going'])
  // The dialog's Cancel starts from an outline button, whose hover text is dark: Keep going keeps white text on navy.
  const { buttonVariants } = require('../../components/ui/button.tsx')
  const keepGoing = require('tailwind-merge').twMerge(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', cancel.props.className)
  assert.match(keepGoing, /(^| )hover:text-student-primary-text( |$)/)
  assert.doesNotMatch(keepGoing, /hover:text-accent-foreground/)
  const click = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
  action.props.onClick(click)
  assert.equal(click.defaultPrevented, true, 'End keeps the dialog up until the hand-in is done')
  end.find(node => node.type?.displayName === 'AlertDialog').props.onOpenChange(false)
  assert.deepEqual([ended.length, kept.length], [1, 1], 'End hands in; any other close is Keep going')
  // While the hand-in is on its way both buttons wait, and nothing closes it: a second tap lands on Submitting….
  const waiting = f.all(f.mount(EndExamDialog, { open: true, submitting: true, onKeepGoing: () => kept.push(1),
    onEnd: () => ended.push(1) }).render())
  const busy = waiting.find(node => node.type?.displayName === 'AlertDialogAction')
  assert.deepEqual([busy.props.children, busy.props.disabled], ['Submitting…', true])
  assert.equal(waiting.find(node => node.type?.displayName === 'AlertDialogCancel').props.disabled, true)
  busy.props.onClick({ preventDefault() {} })
  waiting.find(node => node.type?.displayName === 'AlertDialog').props.onOpenChange(false)
  assert.deepEqual([ended.length, kept.length], [1, 1], 'neither a second End nor a close while it is on its way')
  assert.doesNotMatch(Object.values(PRACTICE_COPY).join(' '), /Exit exam\?|Come back to this page|Leave anyway|Stay\b/)
  assert.doesNotMatch(Object.values(PRACTICE_COPY).join(' '), /can’t be resumed|won’t be submitted|Leave practice/)
  const submit = f.all(f.mount(AssessmentConfirmation, { kind: 'submit', open: true, answered: 39, unanswered: 11, flagged: 2,
    onOpenChange() {}, onConfirm() {}, onRestoreFocus() {} }).render())
  assert.ok(strings(submit).includes('Submit exam?'))
  assert.ok(strings(submit).includes('You won’t be able to change your answers.'))
  assert.deepEqual(submit.filter(node => node.type?.name === 'SummaryCount').map(node => [node.props.label, node.props.value]),
    [['Answered', 39], ['Unanswered', 11], ['Flagged', 2]])
  // The counts say how many are unanswered; no sentence repeats them, and nothing narrates how answers are sent.
  assert.equal(submit.some(node => Array.isArray(node.props?.children) && String(node.props.children.join('')).includes('unanswered.')), false)
  assert.equal(strings(submit).some(value => /count as missed|latest answers|ends this attempt/.test(value)), false)
  assert.equal(submit.find(node => node.type?.displayName === 'AlertDialogCancel').props.children, 'Keep going')
  assert.equal(submit.find(node => node.type?.displayName === 'AlertDialogAction').props.children, 'Submit exam')
}))

test('the loading boundary announces once with inert placeholders and no unverified course identity', async () => withTsx(async () => {
  const Loading = require(QUIZ + 'loading.tsx').default
  const html = renderToStaticMarkup(React.createElement(Loading))
  assert.equal(count(html, /<h1\b/g), 1)
  assert.match(html, /<h1[^>]*>Practice<\/h1>/)
  assert.equal(count(html, /role="status"/g), 1)
  assert.match(html, /aria-live="polite" aria-busy="true"><span class="sr-only">Loading practice\.<\/span>/)
  assert.doesNotMatch(html, /BUA|Financial|\d+ questions|\d+ minutes/)
}))

test('the practice stylesheet hides global chrome only in the active attempt and bounds the navigator', async () => {
  const css = fs.readFileSync(path.join(__dirname, '../../styles/student-app.css'), 'utf8')
  const practice = css.slice(css.indexOf('/* Practice / CBT'))
  assert.match(practice, /body\[data-screen='active'\] > nav,\s*body\[data-screen='active'\] > footer \{ display: none; \}/)
  // A timed exam hides them from the first paint, before the page can run anything (J1).
  assert.match(practice, /body:has\(\[data-exam-open\]\) > nav,\s*body:has\(\[data-exam-open\]\) > footer \{ display: none; \}/)
  // A result that has just replaced the exam ignores taps for a moment (components/student/tap-guard.ts).
  assert.match(practice, /\[data-tap-guard\] \{ pointer-events: none; \}/)
  assert.doesNotMatch(practice, /data-screen='(?:results|review|intro)'/)
  assert.match(practice, /\.student-practice-navscroll \{[^}]*max-height: min\(calc\(100dvh - 400px\), 360px\)[^}]*overflow-y: auto/)
  assert.deepEqual([...new Set([...practice.matchAll(/@media \(min-width: (\d+)px\)/g)].map(match => match[1]))].sort(), ['1200', '768'])
  assert.doesNotMatch(practice, /1024px/)
  assert.match(practice, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(practice, /\.student-practice-timer\[data-urgency='low'\]/)
  assert.match(practice, /\.student-practice-cell \{[^}]*height: 44px/)
  assert.match(practice, /\.student-practice-option \{[^}]*min-height: 56px/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../app/globals.css'), 'utf8'), /quiz\.css/)
  assert.equal(fs.existsSync(path.join(__dirname, '../../styles/quiz.css')), false)
})

test('the route page distinguishes not found, signed out, unavailable, invariant, temporary and not built', async () => {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const state = { session: { user: { id: 'student' }, sessionId: 'session-x' }, result: null, practice: { status: 'none' } }
  const staticCourse = { slug: 'x', code: 'STAT 1', title: 'Static title', contentKey: 'key-x' }
  const repository = { state: 'shelved', repositoryCourseId: 'repo-uuid', contentKey: 'key-x', isShared: null,
    route: { slug: 'x', href: '/courses/x', course: staticCourse } }
  const institutional = (content, practice) => ({ status: 'ok', learning: null, practice, course: { institutionalCourseId: 'inst',
    code: 'BUA 216', title: 'Financial Management', isFree: true, applicability: [], repository, content } })
  const ready = flags => ({ state: 'ready', study: { notes: false, cbtPractice: false, theory: false, overview: true, ...flags } })
  const practice = { href: '/courses/x/quiz', bankSize: 3, attemptSize: 2, timerSeconds: 1800 }
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function(name, ...args) {
      if (name === 'server-only') return {}
      if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate: ({ children }) => children }
      if (name === 'next/navigation') return { redirect: to => { throw new Error('redirect:' + to) }, notFound: () => { throw new Error('notFound') } }
      if (name === '@/lib/supabase/server') return { createClient: async () => ({ scoped: true }) }
      if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => state.session }
      if (name === '@/lib/courses/read-model') return { getStudentCourseBySlugForVerifiedStudent: async () => state.result }
      if (name === '@/lib/practice/server') return { readPracticeState: async () => state.practice,
        readPracticeAttempt: async () => ({ status: 'not-found' }) }
      if (name === './QuizClient') return { QuizClient: function QuizClient() { return null } }
      return load.call(this, name, ...args)
    }
    const page = require(QUIZ + 'page.tsx').default
    // Exam mode's entry; a bare visit goes to the course's topic list.
    const render = async (search = { mode: 'exam' }) => {
      const gated = await page({ params: Promise.resolve({ slug: 'x' }), searchParams: Promise.resolve(search) })
      const inner = gated.props.children('token-x')
      return inner.type(inner.props)
    }
    const html = async () => renderToStaticMarkup(await render())
    state.result = { status: 'not-found' }
    await assert.rejects(render(), /notFound/)
    state.result = { status: 'signed-out' }
    await assert.rejects(render(), /redirect:\/login\?next=%2Fcourses%2Fx%2Fquiz/)
    state.session = null
    state.result = institutional(ready({ cbtPractice: true }), practice)
    await assert.rejects(render(), /redirect:\/login\?next=%2Fcourses%2Fx%2Fquiz/)
    state.session = { user: { id: 'student' }, sessionId: 'session-x' }
    state.result = { status: 'unavailable' }
    let out = await html()
    assert.match(out, /<h1[^>]*>Exam mode<\/h1>/, 'the exam\'s own address is titled Exam mode')
    assert.match(renderToStaticMarkup(await render({ topic: 'A' })), /<h1[^>]*>Practice<\/h1>/, 'a topic\'s address is titled Practice')
    assert.doesNotMatch(out, /student-page-band-lede|Test your knowledge/, 'nothing sits under the title')
    assert.match(out, /We couldn’t load this course\./)
    assert.match(out, /href="\/courses\/x\/quiz"/)
    state.result = { status: 'invariant-failure' }
    out = await html()
    assert.match(out, /role="alert"/)
    assert.doesNotMatch(out, /QuizClient|Start exam|Start practice/)
    state.result = institutional({ state: 'temporarily-unavailable', reason: 'publication-read-failed' }, null)
    out = await html()
    assert.match(out, /BUA 216 · Financial Management/)
    assert.match(out, /We couldn’t load the exam\./)
    assert.doesNotMatch(out, /Study materials are temporarily unavailable/)
    assert.match(out, /href="\/courses\/x\/quiz"[^>]*>Try again/)
    assert.match(out, /href="\/courses\/x"[^>]*>Back to course/)
    state.result = institutional(ready({ cbtPractice: false }), null)
    out = await html()
    assert.match(out, /role="status"/)
    assert.match(out, /Practice isn’t available for this course\./)
    assert.doesNotMatch(out, /Try again/)
    state.result = institutional(ready({ cbtPractice: true }), practice)
    state.practice = { status: 'unavailable' }
    out = await html()
    assert.match(out, /We couldn’t load the exam\./)
    state.practice = { status: 'none' }
    await assert.rejects(render({}), /redirect:\/courses\/x#cbtPractice/)
    const client = await render()
    assert.equal(client.type.name, 'QuizClient')
    assert.equal(client.props.continuityToken, 'token-x')
    assert.equal(client.props.courseHref, '/courses/x')
    assert.equal(client.props.courseSlug, 'x')
    assert.equal(client.props.repositoryCourseId, 'repo-uuid')
    assert.equal(client.props.repositoryOnly, false)
    assert.equal(client.props.courseCode, 'BUA 216')
    assert.equal(client.props.bankSize, 3)
    assert.deepEqual(client.props.brief, { questionCount: 2, durationSeconds: 1800 })
    assert.deepEqual(client.props.initial, { kind: 'intro' })
    state.result = { status: 'repository-only', learning: null, practice, course: { repository, content: ready({ cbtPractice: true }) } }
    const repo = await render()
    assert.equal(repo.props.repositoryOnly, true)
    assert.equal(repo.props.courseCode, 'STAT 1')
    assert.equal(repo.props.courseTitle, 'Static title')
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
})

test('the navigator sheet returns focus to its trigger, closes on the desktop crossing and names a stable submit return target', async () => screenFixture(async f => {
  const { QuestionScreen } = require(QUIZ + 'QuestionScreen.tsx')
  const questions = Array.from({ length: 12 }, (_, index) => openQuestion(index))
  const calls = { open: 0, close: 0, submit: [], leave: [] }
  const screen = f.mount(QuestionScreen, { ...identity, question: questions[3], current: 3, total: 12, selected: undefined, isMarked: false,
    timeLeft: 900, isLowTime: false, canAnswer: true, saveLine: null, onRetrySave() {}, navOpen: true, answeredCount: 2, markedCount: 0, answersMap: { 0: 1, 1: 0 }, markedMap: {},
    onSelectOption() {}, onToggleMark() {}, onPrev() {}, onNext() {}, onJump() {}, onSubmit: targets => calls.submit.push(targets),
    onOpenNav: () => calls.open++, onCloseNav: () => calls.close++, onLeave: targets => calls.leave.push(targets) })
  const all = () => f.all(screen.render())
  const sheet = () => all().find(node => node.type?.displayName === 'Dialog')
  const content = () => all().find(node => node.type?.displayName === 'DialogContent')
  const trigger = () => all().find(node => node.type?.displayName === 'DialogTrigger')
  const buttons = label => all().filter(node => node.type === 'button' && node.props.children === label)
  const questionsButton = buttons('Questions')[0]
  const flagButton = all().find(node => node.props?.className === 'student-practice-flag student-focus-control')
  assert.equal(trigger().props.asChild, true)
  assert.equal(trigger().props.children.props.ref, questionsButton.props.ref, 'the Questions button is the shared Sheet trigger')
  assert.equal(questionsButton.props['aria-haspopup'], undefined, 'the trigger contract supplies the popup semantics')
  const questionsTrigger = f.control('Questions trigger'), flag = f.control('Flag question')
  questionsButton.props.ref.current = questionsTrigger
  flagButton.props.ref.current = flag
  assert.equal(sheet().props.open, true)
  assert.equal(calls.close, 0)

  // F1: closing the sheet hands focus back to the Questions trigger through the Sheet's own close lifecycle.
  let event = f.closeEvent()
  content().props.onCloseAutoFocus(event)
  assert.equal(document.activeElement, questionsTrigger)
  assert.equal(event.defaultPrevented, true)
  sheet().props.onOpenChange(false)
  assert.equal(calls.close, 1)
  sheet().props.onOpenChange(true)
  assert.equal(calls.open, 1)

  // F3: the navigator footer submit closes the sheet and names the trigger, then Flag, as the confirmation's return chain.
  const footerSubmit = buttons('Submit exam').at(-1)
  footerSubmit.props.onClick()
  assert.equal(calls.close, 2)
  assert.deepEqual(calls.submit[0], [questionsTrigger, flag])
  const mainSubmit = f.control('In-flow submit')
  buttons('Submit exam')[0].props.onClick({ currentTarget: mainSubmit })
  assert.deepEqual(calls.submit[1], [mainSubmit])
  const leaveControl = f.control('Exit')
  buttons('Exit')[0].props.onClick({ currentTarget: leaveControl })
  assert.deepEqual(calls.leave, [[leaveControl]])
  screen.props = { ...screen.props, current: 11, question: questions[11] }
  const lastStep = f.control('Last step submit')
  buttons('Submit exam')[0].props.onClick({ currentTarget: lastStep })
  assert.deepEqual(calls.submit[2], [lastStep])

  // F2: crossing to 1200 closes the overlay in the same render and tells the owner once; focus moves to a visible control.
  f.crossTo(true)
  assert.equal(sheet().props.open, false, 'no overlay navigator at desktop')
  assert.equal(screen.props.navOpen, true)
  assert.equal(calls.close, 3, 'the shared breakpoint hook closes the navigator')
  screen.props = { ...screen.props, navOpen: false }
  // The closing sheet's own lifecycle still runs: the trigger is hidden at desktop, so Flag takes focus.
  questionsTrigger.hidden = true
  document.activeElement = f.body
  event = f.closeEvent()
  content().props.onCloseAutoFocus(event)
  assert.equal(document.activeElement, flag, 'a hidden trigger yields to the question\'s Flag control')
  assert.equal(event.defaultPrevented, true)
  questionsTrigger.hidden = false
  for (const desktop of [false, true, false, true, false]) {
    f.crossTo(desktop)
    assert.equal(sheet().props.open, false, `the sheet stays closed at desktop=${desktop}`)
  }
  assert.equal(calls.close, 3, 'repeated crossings with a closed navigator never close it again')
  assert.ok(all().some(node => node.props?.['aria-label'] === 'Question navigator'), 'the inline navigator is the only navigator')
  assert.doesNotMatch(f.html(screen.render()), /Question numbers/, 'the sheet does not render at desktop')
}))

test('a review item hands the report dialog its own trigger and then its disclosure as the focus return chain', async () => screenFixture(async f => {
  const { ReviewCard } = require(QUIZ + 'ReviewCard.tsx')
  const chains = []
  const card = f.mount(ReviewCard, { question: question(2), n: 3, your: 0, status: 'incorrect', open: true, reported: false,
    onToggle() {}, onReport: chain => chains.push(chain) })
  const all = () => f.all(card.render())
  const disclosure = all().find(node => node.props?.['aria-expanded'] !== undefined)
  const report = () => all().find(node => node.type === 'button' && node.props.children === 'Report a question')
  disclosure.props.ref.current = f.control('disclosure')
  report().props.ref.current = f.control('report trigger')
  report().props.onClick()
  assert.deepEqual(chains[0].map(target => target.current.name), ['report trigger', 'disclosure'])
  assert.equal(chains[0][0], report().props.ref, 'the chain carries the live trigger ref, read only when the dialog closes')
  assert.equal(chains[0][1], disclosure.props.ref, 'and the live disclosure ref')
  card.props = { ...card.props, reported: true }
  assert.equal(report(), undefined, 'a sent report replaces the trigger')
  assert.ok(all().some(node => node.props?.className === 'student-practice-reported'))
  assert.equal(all().find(node => node.props?.['aria-expanded'] !== undefined).props.ref, chains[0][1],
    'the disclosure keeps its identity across the reported transition')
  // Once the trigger has left the tree its ref reads null, so the chain resolves to the disclosure without a stale node.
  chains[0][0].current = null
  const { focusFirst } = require(QUIZ + 'focus-return.ts')
  assert.equal(focusFirst(chains[0]), true)
  assert.equal(document.activeElement.name, 'disclosure')
}))

test('results hands entry focus to its own heading once, after a submit and after a timeout alike', async () => screenFixture(async f => {
  const { ResultsScreen } = require(QUIZ + 'ResultsScreen.tsx')
  const questions = choose(Array.from({ length: 10 }, (_, index) => question(index)), { 0: 1 })
  const base = { ...identity, canStartNew: true, unsentAtDeadline: false, starting: false, error: null,
    onReview() {}, onRetake() {}, onRedo() {} }
  for (const finishReason of ['submitted', 'timed_out']) {
    const heading = f.control(`Exam result heading after ${finishReason}`)
    let focused = 0
    heading.focus = function() { focused++; global.document.activeElement = this }
    f.body.focus()
    const screen = f.mount(ResultsScreen, { ...base, attempt: gradedAttempt(questions, finishReason === 'timed_out'
      ? { status: 'timed_out', result: { score: 1, total: 10, timedOut: true, finishedAt: '2026-10-24T11:00:00.000Z' } } : {}) })
    const band = tree => f.all(tree).find(node => node.type?.name === 'PageBand')
    screen.prepare = tree => { band(tree).props.titleRef.current = heading }
    const tree = screen.render()
    assert.equal(band(tree).props.titleRef.current, heading, 'ResultsScreen owns the heading ref it hands the band')
    assert.equal(document.activeElement, heading, `${finishReason}: focus lands on the Results heading, never the body`)
    assert.equal(focused, 1)
    screen.props = { ...screen.props, starting: true }; screen.render(); screen.render()
    assert.equal(focused, 1, 'later updates and re-renders never focus the heading again')
    assert.match(f.html(React.createElement(ResultsScreen, screen.props)), /<h1 class="student-page-band-title" tabindex="-1">Exam result<\/h1>/,
      'the heading is a programmatic focus target, not a tab stop')
  }
}))

test('a result entered in place of the exam ignores taps for a moment, over every action; one rendered with the page never does', async () => screenFixture(async f => {
  const { ResultsScreen } = require(QUIZ + 'ResultsScreen.tsx')
  // Read from the source: requiring tap-guard.ts here would cache it bound to React's own hooks, outside the fixture.
  const guardMs = Number(/export const TAP_GUARD_MS = (\d+)/.exec(fs.readFileSync(path.join(__dirname, '../../components/student/tap-guard.ts'), 'utf8'))[1])
  const questions = choose(Array.from({ length: 10 }, (_, index) => question(index)), { 0: 1 })
  const props = { ...identity, attempt: gradedAttempt(questions), canStartNew: true, unsentAtDeadline: false, starting: false,
    error: null, onReview() {}, onRetake() {}, onRedo() {} }
  const results = tree => f.all(tree).find(node => node.props?.className === 'student-practice-results')
  const screen = f.mount(ResultsScreen, props)
  const first = results(screen.render())
  assert.equal(first.props['data-tap-guard'], '', 'mounted after the exam: a second tap presses nothing at first')
  const labels = f.all(first).filter(node => node.type === 'button' || node.type?.displayName === 'Link' || node.props?.href)
    .map(node => [node.props.children].flat().join(''))
  assert.deepEqual(labels, ['Review answers', 'New questions', 'Same questions', 'Back to course'], 'every action is under the guard')
  await new Promise(resolve => setTimeout(resolve, guardMs + 50))
  assert.equal(results(screen.render()).props['data-tap-guard'], undefined, 'then the result takes taps')
  assert.doesNotMatch(f.html(React.createElement(ResultsScreen, props)), /data-tap-guard/, 'a result rendered with the page takes taps at once')
}))

test('a report keeps its exact review item mounted and open through every page-size crossing until the dialog closes', async () => screenFixture(async f => {
  const { ReviewScreen } = require(QUIZ + 'ReviewScreen.tsx')
  const questions = Array.from({ length: 23 }, (_, index) => question(index))
  const answers = Object.fromEntries(questions.map((_, index) => [index, index % 2]))
  const reports = []
  const props = { ...identity, questions, answers, correctCount: 11, reported: {}, reporting: null,
    onReport: (index, chain) => reports.push([index, chain]), onBack() {} }
  f.state.desktop = true
  const screen = f.mount(ReviewScreen, props)
  const tree = () => f.all(screen.render())
  const cards = t => (t ?? tree()).filter(node => node.type?.name === 'ReviewCard')
  const numbers = t => cards(t).map(card => card.props.n)
  const openItems = t => cards(t).filter(card => card.props.open).map(card => card.props.n)
  const page = t => (t ?? tree()).find(node => node.type?.name === 'Pagination').props.page
  const toggle = n => { cards().find(card => card.props.n === n).props.onToggle(); screen.render() }
  const setReporting = reporting => { screen.props = { ...screen.props, reporting }; screen.render() }
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

  // Desktop page 1 holds Questions 1–10. Question 8 is expanded before Question 3, so recency alone would keep 3 at compact.
  toggle(8); toggle(3)
  assert.deepEqual(openItems(), [3, 8])
  const chain = [f.control('Question 8 report trigger'), f.control('Question 8 disclosure')]
  cards().find(card => card.props.n === 8).props.onReport(chain)
  assert.deepEqual(reports, [[7, chain]], 'the screen names the exact item by its stable index')
  setReporting(7)
  assert.deepEqual([numbers(), openItems(), page()], [range(1, 10), [3, 8], 1], 'desktop is untouched while the dialog opens')
  const key8 = cards().find(card => card.props.n === 8).key

  // 1280 → 834: the first render after the crossing is already the compact page holding Question 8, with Question 8 the one open item.
  f.crossTo(false)
  const first = tree()
  assert.deepEqual(numbers(first), range(6, 10), 'the visible slice settles on the compact page that holds Question 8')
  assert.deepEqual(openItems(first), [8], 'the reported item is the one disclosure that survives, not merely the most recent')
  assert.equal(page(first), 2)
  assert.equal(cards(first).find(card => card.props.n === 8).key, key8, 'same key: React keeps the instance and its refs')

  // 834 → 1280 with the dialog still open: back to the desktop page holding Question 8, still open.
  f.crossTo(true)
  assert.deepEqual([numbers(), openItems(), page()], [range(1, 10), [8], 1])
  for (const desktop of [false, true, false, true, false]) {
    f.crossTo(desktop)
    const t = tree()
    assert.ok(numbers(t).includes(8), `repeated crossing to desktop=${desktop} keeps Question 8 mounted`)
    assert.deepEqual(openItems(t), [8])
  }
  // Success or already-reported: the trigger is replaced by "Reported"; the item stays mounted and open for its disclosure.
  screen.props = { ...screen.props, reported: { 'question-7': true } }; screen.render()
  assert.deepEqual(cards().find(card => card.props.n === 8).props.reported, true)
  assert.deepEqual(openItems(), [8])
  // The dialog closes (Cancel or Done): nothing re-pages; the student is left on the page that holds the item.
  setReporting(null)
  assert.deepEqual([numbers(), openItems(), page()], [range(6, 10), [8], 2])
  // With no report open the existing clamp rule stands (F6/F8): compact page 2 → desktop page 2, nothing re-pages.
  f.crossTo(true)
  assert.deepEqual([numbers(), page()], [range(11, 20), 2])
  f.crossTo(false)
  assert.deepEqual([numbers(), page()], [range(6, 10), 2])

  // Compact start: at 834 on page 2 (Questions 6–10) report Question 8, then grow to 1280 → page 1 with Question 8 open.
  const compact = f.mount(ReviewScreen, { ...props })
  const ctree = () => f.all(compact.render())
  compact.render()
  ctree().find(node => node.type?.name === 'Pagination').props.onPageChange(2); compact.render()
  cards(ctree()).find(card => card.props.n === 8).props.onToggle(); compact.render()
  compact.props = { ...compact.props, reporting: 7 }; compact.render()
  assert.deepEqual([numbers(ctree()), openItems(ctree())], [range(6, 10), [8]])
  f.crossTo(true)
  const grown = ctree()
  assert.deepEqual([numbers(grown), openItems(grown), page(grown)], [range(1, 10), [8], 1])
  f.crossTo(false)
  assert.deepEqual([numbers(ctree()), openItems(ctree()), page(ctree())], [range(6, 10), [8], 2])

  // An item deep in the list: desktop page 2 (11–20), Question 18 reported → compact page 4 (16–20).
  f.crossTo(true)
  const deep = f.mount(ReviewScreen, { ...props })
  const dtree = () => f.all(deep.render())
  deep.render()
  dtree().find(node => node.type?.name === 'Pagination').props.onPageChange(2); deep.render()
  cards(dtree()).find(card => card.props.n === 18).props.onToggle(); deep.render()
  deep.props = { ...deep.props, reporting: 17 }; deep.render()
  f.crossTo(false)
  assert.deepEqual([numbers(dtree()), openItems(dtree()), page(dtree())], [range(16, 20), [18], 4])
  // Under a filter the page is computed over the filtered order, so the item still lands on its own page.
  f.crossTo(true)
  const filtered = f.mount(ReviewScreen, { ...props })
  const ftree = () => f.all(filtered.render())
  filtered.render()
  ftree().find(node => node.type === 'input' && node.props.value === 'to-review').props.onChange(); filtered.render()
  const seventh = cards(ftree())[6]
  seventh.props.onToggle(); filtered.render()
  filtered.props = { ...filtered.props, reporting: seventh.props.n - 1 }; filtered.render()
  f.crossTo(false)
  assert.ok(numbers(ftree()).includes(seventh.props.n))
  assert.deepEqual([openItems(ftree()), page(ftree())], [[seventh.props.n], 2])
}))

test('review opens at the real viewport width and keeps at most one disclosure open below 1200', async () => screenFixture(async f => {
  const { ReviewScreen } = require(QUIZ + 'ReviewScreen.tsx')
  const questions = Array.from({ length: 23 }, (_, index) => question(index))
  const answers = Object.fromEntries(questions.map((_, index) => [index, index % 2]))
  const props = { ...identity, questions, answers, correctCount: 11, reported: {}, onReport() {}, onBack() {} }
  f.state.desktop = true
  const screen = f.mount(ReviewScreen, props)
  const cards = tree => (tree ?? f.all(screen.render())).filter(node => node.type?.name === 'ReviewCard')
  const pagination = tree => (tree ?? f.all(screen.render())).find(node => node.type?.name === 'Pagination')
  const openItems = tree => cards(tree).filter(card => card.props.open).map(card => card.props.n - 1)
  const toggle = index => { cards().find(card => card.props.n === index + 1).props.onToggle(); screen.render() }

  // F8: the very first client render already reflects the 1280 viewport: ten items, three pages.
  const first = f.all(screen.render())
  assert.equal(cards(first).length, 10)
  assert.deepEqual([pagination(first).props.page, pagination(first).props.totalPages], [1, 3])
  assert.match(f.html(screen.render()), /Questions 1–10 of 23/)

  // F6: desktop two open → 834 keeps the most recently expanded item.
  toggle(0); toggle(4)
  assert.deepEqual(openItems(), [0, 4])
  f.crossTo(false)
  const compact = f.all(screen.render())
  assert.equal(cards(compact).length, 5)
  assert.equal(pagination(compact).props.totalPages, 5)
  assert.deepEqual(openItems(compact), [4], 'only the most recent disclosure survives the crossing')
  f.crossTo(true)
  assert.deepEqual(openItems(), [4], 'returning to desktop invents no expanded items')
  // Recency follows the user: reopening an item makes it the one that survives.
  toggle(0); toggle(2)
  assert.deepEqual(openItems(), [0, 2, 4])
  toggle(0); toggle(0)
  assert.deepEqual(openItems(), [0, 2, 4])
  f.crossTo(false)
  assert.deepEqual(openItems(), [0], 'the item reopened last is the one that survives')
  // Compact one open → desktop keeps exactly that item.
  f.crossTo(true)
  assert.deepEqual(openItems(), [0])
  // Desktop → compact across a page change and a filter change collapses everything, as page and filter changes always do.
  toggle(1); toggle(3)
  pagination().props.onPageChange(2); screen.render()
  f.crossTo(false)
  assert.deepEqual(openItems(), [])
  assert.equal(pagination().props.page, 2)
  f.crossTo(true)
  toggle(10); toggle(11)
  assert.deepEqual(openItems(), [10, 11])
  f.all(screen.render()).find(node => node.type === 'input' && node.props.value === 'to-review').props.onChange(); screen.render()
  f.crossTo(false)
  assert.deepEqual(openItems(), [])
  assert.equal(pagination().props.page, 1)
}))
