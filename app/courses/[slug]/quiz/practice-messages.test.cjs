// app/courses/[slug]/quiz/practice-messages.test.cjs — Start and resume messages say what happened: no connection
// (Try again repeats the same start, so it finds the attempt with its real time left or starts it), a start the server
// refused, and the resume screen's own messages, never start wording.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../../lib/test/tsx-loader.cjs')

const COURSE = 'bua-216'
const ATTEMPT = '11111111-1111-4111-8111-111111111111'
const NOW = '2026-10-27T09:00:00.000Z', DEADLINE = '2026-10-27T09:30:00.000Z'
const BANNED = /may already be running|couldn.t be confirmed|Nothing was started/i
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const openAttempt = (id, mode = 'exam') => ({ status: 'in_progress', id, courseId: 'course-1', mode,
  topic: mode === 'instant' ? 'Capital Budgeting' : null, intent: 'new', redoOf: null, startedAt: NOW,
  deadlineAt: DEADLINE, durationSeconds: 1800, questionCount: 1, bankSize: 214,
  saved: { revision: 0, answers: {} }, questions: [{ questionId: 'q-1', prompt: 'Prompt', options: ['A', 'B'], section: 'One' }] })
const identity = { courseCode: 'BUA 216', courseTitle: 'Financial Management', repositoryOnly: false }

/** QuizClient with controlled hooks, a scripted server and immediate retry timers. */
async function flow(initial, run) {
  const load = Module._load, saved = { window: global.window, document: global.document, setTimeout: global.setTimeout }
  const realSetTimeout = global.setTimeout
  const answers = [], requests = [], assigned = [], records = new Map()
  const events = new Map()
  const store = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value),
    removeItem: key => records.delete(key) }
  let active = null
  const hooks = {
    useState(initialValue) {
      if (!active) return React.useState(initialValue)
      const owner = active, n = owner.index++
      if (!(n in owner.slots)) owner.slots[n] = typeof initialValue === 'function' ? initialValue() : initialValue
      return [owner.slots[n], value => { owner.slots[n] = typeof value === 'function' ? value(owner.slots[n]) : value }]
    },
    useRef(value) { if (!active) return React.useRef(value); const n = active.index++; return active.slots[n] ??= { current: value } },
    useMemo(factory, deps) {
      if (!active) return React.useMemo(factory, deps)
      const n = active.index++, prior = active.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) active.slots[n] = { deps, value: factory() }
      return active.slots[n].value
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps) },
    useEffect(effect, deps) {
      if (!active) return React.useEffect(effect, deps)
      const owner = active, n = owner.index++, prior = owner.slots[n]
      if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
        owner.effects.push(() => { prior?.cleanup?.(); owner.slots[n] = { deps, cleanup: effect() } })
      }
    },
  }
  global.window = { sessionStorage: store, localStorage: store,
    addEventListener: (event, callback) => { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(callback) },
    removeEventListener: (event, callback) => events.get(event)?.delete(callback),
    location: { pathname: `/courses/${COURSE}/quiz`, assign: href => { assigned.push(href) } },
    history: { replaceState() {} } }
  global.document = { body: { setAttribute() {}, removeAttribute() {} } }
  // The automatic re-check's waits run at once; the number of requests still shows every re-check.
  global.setTimeout = fn => { realSetTimeout(fn, 0); return 0 }
  Module._load = function(name, ...args) {
    if (name === 'react') return { ...React, ...hooks }
    if (name === '@/lib/practice/client') return { postPracticeCommand: async command => {
      requests.push(command)
      const next = answers.shift()
      assert.ok(next, `no scripted answer for ${command.action}`)
      return typeof next === 'function' ? next(command) : next
    } }
    return load.call(this, name, ...args)
  }
  try {
    await withTsx(async () => {
      const { QuizClient } = require('./QuizClient.tsx')
      const props = { continuityToken: 'verified-student', courseSlug: COURSE, courseHref: `/courses/${COURSE}`,
        repositoryCourseId: 'course-1', brief: { questionCount: 50, durationSeconds: 1800 }, bankSize: 214,
        topics: ['Capital Budgeting', 'Working Capital'], lastResultHref: null, initial, ...identity }
      const instance = { slots: [], effects: [], index: 0 }
      const render = () => {
        instance.index = 0; instance.effects = []; active = instance
        let tree
        try { tree = QuizClient(props) } finally { active = null }
        for (const effect of instance.effects) effect()
        return tree
      }
      const settle = async () => { for (let n = 0; n < 40; n++) await new Promise(resolve => realSetTimeout(resolve, 2)) }
      await run({ render, settle, answers, requests, assigned, emit: event => { for (const callback of events.get(event) ?? []) callback() } })
    })
  } finally {
    Module._load = load
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete global[key]; else global[key] = value
    }
  }
}

test('no reply to a start: the automatic re-check runs, then "No connection." with Try again; Try again opens the attempt with its real time left', async () => flow({ kind: 'intro' }, async f => {
  f.answers.push({ status: 'unavailable' }, { status: 'unavailable' }, { status: 'unavailable' })
  const brief = f.render()
  assert.equal(brief.type.name, 'IntroScreen', 'Exam mode opens straight on its brief: there is no choice of mode')
  brief.props.onStart()
  await f.settle()
  const intro = f.render()
  assert.equal(intro.type.name, 'IntroScreen')
  assert.equal(f.requests.length, 3, 'the automatic re-check is kept')
  assert.equal(new Set(f.requests.map(request => request.attemptId)).size, 1, 'every re-check asks for the same start')
  assert.deepEqual(intro.props.error, { title: 'No connection.', body: '', retry: true })
  // Reconnected: the same start reaches the server, which returns the attempt it started (or starts it now).
  f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId) }))
  intro.props.onRetry()
  await f.settle()
  const active = f.render()
  assert.equal(f.requests[3].attemptId, f.requests[0].attemptId, 'Try again can only find or make this one attempt')
  assert.equal(active.type.name, 'ActiveAttempt')
  assert.equal(active.props.attempt.deadlineAt, DEADLINE, 'the attempt carries the server\'s own deadline')
  assert.equal(active.props.serverNow, NOW, 'and the server\'s clock, so the time left is real')
}))

test('a start the server refused: "We couldn’t start your practice." with Try again; Try again asks for a new start', async () => flow({ kind: 'intro' }, async f => {
  f.answers.push({ status: 'not-found' })
  f.render().props.onStart()
  await f.settle()
  const intro = f.render()
  assert.equal(f.requests.length, 1, 'a server answer is not re-checked')
  assert.deepEqual(intro.props.error, { title: 'We couldn’t start your practice.', body: '', retry: true })
  f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId) }))
  intro.props.onRetry()
  await f.settle()
  assert.notEqual(f.requests[1].attemptId, f.requests[0].attemptId, 'a refused start is not repeated; a new one is asked for')
  assert.equal(f.render().type.name, 'ActiveAttempt')
}))

test('a topic from the course page starts its instant feedback at once, with no brief; a lost reply keeps the same attempt id', async () => flow({ kind: 'topic', topic: 'Capital Budgeting' }, async f => {
  f.answers.push({ status: 'unavailable' }, { status: 'unavailable' }, { status: 'unavailable' })
  f.render()
  await f.settle()
  const starting = f.render()
  assert.equal(starting.type.name, 'InstantStarting')
  assert.equal(starting.props.topic, 'Capital Budgeting')
  assert.deepEqual(Object.keys(f.requests[0]).sort(), ['action', 'attemptId', 'courseSlug', 'topic'], 'no brief, size or time')
  assert.equal(f.requests[0].action, 'start-instant')
  assert.equal(f.requests[0].topic, 'Capital Budgeting')
  assert.equal(f.requests.length, 3, 'started once, with the automatic re-checks only')
  assert.deepEqual(starting.props.error, { title: 'No connection.', body: '', retry: true })
  f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId, 'instant') }))
  starting.props.onRetry()
  await f.settle()
  assert.equal(new Set(f.requests.map(request => request.attemptId)).size, 1, 'a replayed start can only find this attempt')
  const attempt = f.render()
  assert.equal(attempt.type.name, 'InstantAttempt')
  assert.equal(attempt.props.courseHref, `/courses/${COURSE}#cbtPractice`, 'Exit returns to the topic list')
  f.render()
  await f.settle()
  assert.equal(f.requests.length, 4, 'the topic never starts a second time')
}))

test('a topic the course no longer has: "This topic isn’t available.", with no Try again', async () => flow({ kind: 'topic', topic: 'Gone' }, async f => {
  f.answers.push({ status: 'not-found' })
  f.render()
  await f.settle()
  const starting = f.render()
  assert.equal(f.requests.length, 1)
  assert.deepEqual(starting.props.error, { title: 'This topic isn’t available.', body: 'Choose another topic from the course page.' })
}))

test('a topic while an exam is open: "Finish your exam first.", with Resume exam and no Try again', async () => flow({ kind: 'topic', topic: 'Capital Budgeting' }, async f => {
  f.answers.push({ status: 'exam-open', now: NOW, attempt: openAttempt(ATTEMPT) })
  f.render()
  await f.settle()
  const starting = f.render()
  assert.equal(f.requests.length, 1, 'refused once, not re-checked')
  assert.deepEqual(starting.props.error, { title: 'Finish your exam first.',
    body: 'Practice opens again once your exam is submitted or its time runs out.',
    action: { label: 'Resume exam', href: `/courses/${COURSE}/quiz?attempt=${ATTEMPT}` } })
}))

test('the exam-open notice links to the exam and offers no Try again', async () => withTsx(async () => {
  const { InstantStarting } = require('./InstantStarting.tsx')
  const html = renderToStaticMarkup(React.createElement(InstantStarting, { ...identity, courseHref: `/courses/${COURSE}#cbtPractice`,
    topic: 'Capital Budgeting', busy: false, onRetry() {}, error: { title: 'Finish your exam first.',
      body: 'Practice opens again once your exam is submitted or its time runs out.',
      action: { label: 'Resume exam', href: `/courses/${COURSE}/quiz?attempt=${ATTEMPT}` } } }))
  assert.match(text(html), /Capital Budgeting .*Finish your exam first\. Practice opens again .* Resume exam Back to course$/)
  assert.match(html, new RegExp(`href="/courses/${COURSE}/quiz\\?attempt=${ATTEMPT}"`))
  assert.doesNotMatch(html, /Try again/)
}))

test('the end of a topic: Practise again draws this topic again, Next topic starts the next one, none after the last', async () => {
  const graded = (topic) => ({ kind: 'graded', latest: false, attempt: { status: 'submitted', id: ATTEMPT, courseId: 'course-1',
    mode: 'instant', reviewAvailable: true, topic, intent: 'new', redoOf: null, startedAt: NOW, deadlineAt: DEADLINE, durationSeconds: 10800,
    questionCount: 1, bankSize: 12, result: { score: 1, total: 1, timedOut: false, finishedAt: NOW },
    questions: [{ questionId: 'q-1', prompt: 'Prompt', options: ['A', 'B'], section: topic, itemId: 'i-1', revision: 1,
      selected: 0, correctOption: 0, explanation: null }] } })
  await flow(graded('Capital Budgeting'), async f => {
    const end = f.render()
    assert.equal(end.type.name, 'InstantResult')
    assert.equal(end.props.nextTopic, 'Working Capital')
    assert.equal(end.props.courseHref, `/courses/${COURSE}#cbtPractice`)
    f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId, 'instant') }))
    end.props.onPractiseAgain()
    await f.settle()
    assert.equal(f.requests[0].action, 'start-instant')
    assert.equal(f.requests[0].topic, 'Capital Budgeting')
  })
  await flow(graded('Capital Budgeting'), async f => {
    f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId, 'instant') }))
    f.render().props.onNextTopic()
    await f.settle()
    assert.equal(f.requests[0].topic, 'Working Capital')
  })
  await flow(graded('Working Capital'), async f => {
    assert.equal(f.render().props.nextTopic, null, 'the last topic has no Next topic')
  })
})

test('resume with no connection: "No connection." with Try again; Try again continues the attempt', async () => flow(
  { kind: 'resume', attemptId: ATTEMPT, answered: 3, total: 50, minutesLeft: 12 }, async f => {
    f.answers.push({ status: 'unavailable' })
    f.render().props.onContinue()
    await f.settle()
    const resume = f.render()
    assert.equal(resume.type.name, 'ResumeScreen')
    assert.deepEqual(resume.props.error, { title: 'No connection.', body: '', retry: true })
    f.answers.push({ status: 'ready', now: NOW, attempt: openAttempt(ATTEMPT) })
    resume.props.onRetry()
    await f.settle()
    assert.deepEqual(f.requests.map(request => [request.action, request.attemptId]), [['attempt', ATTEMPT], ['attempt', ATTEMPT]])
    assert.equal(f.render().type.name, 'ActiveAttempt')
  }))

test('resume signed out: "You’ve been signed out." with Sign in back to this attempt, and no Try again', async () => flow(
  { kind: 'resume', attemptId: ATTEMPT, answered: 3, total: 50, minutesLeft: 12 }, async f => {
    f.answers.push({ status: 'signed-out' })
    f.render().props.onContinue()
    await f.settle()
    assert.deepEqual(f.render().props.error, { title: 'You’ve been signed out.', body: '',
      action: { label: 'Sign in', href: '/login?next=%2Fcourses%2Fbua-216%2Fquiz%3Fattempt%3D11111111-1111-4111-8111-111111111111' } })
  }))

test('each problem is its title on screen, with Try again or its one link only where it can help; the resume screen has no start wording', async () => withTsx(async () => {
  const { ProblemNotice } = require('./ProblemNotice.tsx')
  const { ResumeScreen } = require('./ResumeScreen.tsx')
  const shown = problem => text(renderToStaticMarkup(React.createElement(ProblemNotice, { problem, busy: false, onRetry() {} })))
  assert.equal(shown({ title: 'No connection.', body: '', retry: true }), 'No connection. Try again')
  assert.equal(shown({ title: 'We couldn’t start your practice.', body: '', retry: true }), 'We couldn’t start your practice. Try again')
  const signedOut = { title: 'You’ve been signed out.', body: '', action: { label: 'Sign in', href: '/login?next=%2Fcourses%2Fbua-216%2Fquiz%3Fattempt%3D11111111-1111-4111-8111-111111111111' } }
  assert.equal(shown(signedOut), 'You’ve been signed out. Sign in')
  // A full load, so signing in starts from the server's view of the attempt.
  assert.match(renderToStaticMarkup(React.createElement(ProblemNotice, { problem: signedOut, busy: false })), /<a href="\/login\?next=/)
  for (const error of [{ title: 'No connection.', body: '', retry: true },
    { title: 'You’ve been signed out.', body: '', action: { label: 'Sign in', href: '/login?next=%2Fcourses%2Fbua-216%2Fquiz%3Fattempt%3D11111111-1111-4111-8111-111111111111' } }]) {
    const html = renderToStaticMarkup(React.createElement(ResumeScreen, { ...identity, courseHref: `/courses/${COURSE}`,
      answered: 3, total: 50, minutesLeft: 12, opening: false, error, onContinue() {}, onRetry() {} }))
    // The last notice on the screen is the problem (the first is the attempt in progress).
    const notice = text(html.match(/<div class="student-notice"[\s\S]*?<\/div><\/div>/g).at(-1))
    assert.ok(notice.startsWith(error.title), notice)
    assert.doesNotMatch(html, /student-notice-text">Reconnect|Sign in again to continue/, 'no instruction under the title')
    assert.doesNotMatch(notice, /start|timer/i, 'no start wording on the resume screen')
    assert.equal(/>Try again</.test(html), error.retry === true)
  }
}))

test('the briefing says once that the timer keeps running after Start', async () => withTsx(async () => {
  const { IntroScreen } = require('./IntroScreen.tsx')
  const html = text(renderToStaticMarkup(React.createElement(IntroScreen, { ...identity, courseHref: `/courses/${COURSE}`,
    brief: { questionCount: 50, durationSeconds: 1800 }, wholeBank: false, briefingVersion: 0, starting: false,
    error: null, lastResultHref: null, onStart() {}, onRetry() {} })))
  const line = 'Once you start, the timer keeps running, even if you leave or lose connection.'
  assert.equal(html.split(line).length - 1, 1)
  assert.doesNotMatch(html, /keeps running even if you leave this page/)
}))

test('practice copy is plain: curly apostrophes, save lines from PRACTICE_COPY, none of the retired phrases', () => {
  const { PRACTICE_COPY, saveLineFor } = require('./practice-presentation.ts')
  assert.equal(PRACTICE_COPY.exitUnsafe, 'Some answers aren’t saved yet. If you leave now, they’ll be lost.')
  for (const value of Object.values(PRACTICE_COPY)) assert.doesNotMatch(value, /'/, value)
  const base = { timeUp: false, refusal: null, clockSynced: true, clockFailures: 0, answered: 1, answersSafe: false }
  assert.equal(saveLineFor({ ...base, submitFailing: true, save: 'failed' }).text, PRACTICE_COPY.submitUnsaved)
  assert.equal(saveLineFor({ ...base, submitFailing: false, save: 'failed' }).text, PRACTICE_COPY.saveFailedUnsaved)
  for (const file of fs.readdirSync(__dirname).filter(name => /\.tsx?$/.test(name))) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), BANNED, file)
  }
})

test('opening a past review refreshes access and shows only the score if the plan ended', async () => {
  const attempt={...openAttempt(ATTEMPT),status:'submitted',reviewAvailable:true,
    result:{score:0,total:1,timedOut:false,finishedAt:NOW},
    questions:[{questionId:'q-1',itemId:'i-1',revision:1,prompt:'Prompt',options:['A','B'],section:'One',selected:0,correctOption:1,explanation:'Because'}]}
  await flow({kind:'graded',latest:false,attempt},async f=>{
    f.answers.push({status:'graded',now:NOW,attempt:{...attempt,reviewAvailable:false,questions:[]}})
    f.render().props.onReview();await f.settle()
    const screen=f.render()
    assert.equal(screen.type.name,'ScoreOnly')
    assert.deepEqual(screen.props.attempt.questions,[])
    assert.deepEqual(f.requests.map(request=>request.action),['attempt'])
    const html=renderToStaticMarkup(screen)
    assert.match(html,/0 of 1 correct/)
    assert.match(html,/Answers and explanations are included with full access\./)
    assert.doesNotMatch(html,/Prompt|Because|Review answers/)
  })
})

const reviewAttempt = () => ({ ...openAttempt(ATTEMPT), status: 'submitted', reviewAvailable: true,
  result: { score: 0, total: 1, timedOut: false, finishedAt: NOW },
  questions: [{ questionId: 'q-1', itemId: 'i-1', revision: 1, prompt: 'Prompt', options: ['A', 'B'], section: 'One',
    selected: 0, correctOption: 1, explanation: 'Because' }] })
const reviewScreen = tree => tree.props.children[0]

test('score-only retake uses the current server permission rather than a stale page brief', async () => {
  for (const canStartNew of [false, true]) {
    const attempt = { ...reviewAttempt(), reviewAvailable: false, questions: [], canStartNew }
    await flow({ kind: 'graded', latest: false, attempt }, async f => {
      const result = f.render()
      assert.equal(result.type.name, 'ScoreOnly')
      assert.equal(result.props.canStartNew, canStartNew)
    })
  }
})

test('review opening failure is visible and Try again retries that review', async () => {
  const attempt = reviewAttempt()
  await flow({ kind: 'graded', latest: false, attempt }, async f => {
    f.answers.push({ status: 'unavailable' })
    f.render().props.onReview(); await f.settle()
    const result = f.render()
    assert.equal(result.type.name, 'ResultsScreen')
    assert.equal(result.props.error.title, "Couldn't open the review. Try again.")
    f.answers.push({ status: 'graded', now: NOW, attempt })
    result.props.onRetry(); await f.settle()
    assert.equal(reviewScreen(f.render()).type.name, 'ReviewScreen')
    assert.deepEqual(f.requests.map(request => request.attemptId), [ATTEMPT, ATTEMPT])
  })
})

test('a restored review ignores network failures, rate limits, unavailable and unrelated replies', async () => {
  const attempt = reviewAttempt()
  await flow({ kind: 'graded', latest: false, attempt }, async f => {
    f.answers.push({ status: 'graded', now: NOW, attempt })
    f.render().props.onReview(); await f.settle(); f.render()
    for (const reply of [() => { throw new Error('offline') }, { status: 'unavailable' }, { status: 'rate-limited' },
      { status: 'graded', now: NOW, attempt: { ...attempt, id: 'another-attempt', reviewAvailable: false, questions: [] } }]) {
      f.answers.push(reply); f.emit('focus'); await f.settle()
      assert.equal(reviewScreen(f.render()).type.name, 'ReviewScreen')
    }
  })
})

// Signed out goes to sign-in and comes back to this result; the others leave in place.
for (const status of ['not-found', 'signed-out', 'no-review']) test(`a restored review leaves on definite ${status}`, async () => {
  const attempt = reviewAttempt()
  await flow({ kind: 'graded', latest: false, attempt }, async f => {
    f.answers.push({ status: 'graded', now: NOW, attempt })
    f.render().props.onReview(); await f.settle(); f.render()
    f.answers.push(status === 'no-review' ? { status: 'graded', now: NOW,
      attempt: { ...attempt, reviewAvailable: false, questions: [], reviewUnavailableReason: 'outside-list' } } : { status })
    f.emit('pageshow'); await f.settle()
    if (status === 'signed-out') {
      assert.deepEqual(f.assigned, [`/login?next=${encodeURIComponent(`/courses/${COURSE}/quiz?attempt=${attempt.id}`)}`])
      return
    }
    assert.deepEqual(f.assigned, [])
    const next = f.render()
    assert.equal(next.type.name, status === 'no-review' ? 'ScoreOnly' : 'IntroScreen')
    if (status === 'no-review') assert.equal(next.props.attempt.reviewUnavailableReason, 'outside-list')
  })
})

test('opening a review while signed out goes to sign-in and returns to this result', async () => {
  const attempt = reviewAttempt()
  await flow({ kind: 'graded', latest: false, attempt }, async f => {
    f.answers.push({ status: 'signed-out' })
    f.render().props.onReview(); await f.settle()
    assert.deepEqual(f.assigned, [`/login?next=${encodeURIComponent(`/courses/${COURSE}/quiz?attempt=${attempt.id}`)}`])
  })
})

test('a late review check cannot replace the newer attempt now on screen', async () => {
  const attempt = reviewAttempt()
  await flow({ kind: 'graded', latest: false, attempt }, async f => {
    f.answers.push({ status: 'graded', now: NOW, attempt })
    f.render().props.onReview(); await f.settle(); f.render()
    let release
    f.answers.push(() => new Promise(resolve => { release = resolve }))
    f.emit('focus'); await f.settle()
    reviewScreen(f.render()).props.onBack()
    const result = f.render()
    f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId) }))
    result.props.onRetake(); await f.settle()
    const newer = f.render()
    assert.equal(newer.type.name, 'ActiveAttempt')
    release({ status: 'graded', now: NOW, attempt: { ...attempt, reviewAvailable: false, questions: [] } })
    await f.settle()
    assert.equal(f.render().props.attempt.id, newer.props.attempt.id)
  })
})

test('a late opening response cannot replace a new attempt', async () => {
  const attempt = reviewAttempt()
  await flow({ kind: 'graded', latest: false, attempt }, async f => {
    let release
    f.answers.push(() => new Promise(resolve => { release = resolve }))
    const result = f.render()
    result.props.onReview(); await f.settle()
    f.answers.push(command => ({ status: 'ready', now: NOW, attempt: openAttempt(command.attemptId) }))
    result.props.onRetake(); await f.settle(); const newer = f.render()
    release({ status: 'graded', now: NOW, attempt }); await f.settle()
    assert.equal(f.render().props.attempt.id, newer.props.attempt.id)
    assert.equal(f.render().type.name, 'ActiveAttempt')
  })
})

test('a past topic run whose topic the course no longer has offers no Practise again; a live topic still does', async () => {
  const run = topic => ({ ...openAttempt(ATTEMPT, 'instant'), topic, status: 'submitted', reviewAvailable: true, canStartNew: true,
    result: { score: 1, total: 1, timedOut: false, finishedAt: DEADLINE },
    questions: [{ questionId: 'q-1', prompt: 'Prompt', options: ['A', 'B'], section: topic,
      feedback: { selected: 1, correctOption: 1, explanation: null } }] })
  await flow({ kind: 'graded', attempt: run('Leadership Overview'), latest: false }, async f => {
    const result = f.render()
    assert.equal(result.type.name, 'InstantResult')
    assert.equal(result.props.canStartNew, false, 'a retired topic: the button is hidden, not an error after the tap')
    assert.equal(result.props.nextTopic, null, 'and no Next topic is guessed for it')
    assert.equal(f.requests.length, 0, 'nothing is sent')
  })
  await flow({ kind: 'graded', attempt: run('Capital Budgeting'), latest: false }, async f => {
    const result = f.render()
    assert.equal(result.props.canStartNew, true, 'a topic the course still has keeps Practise again')
    assert.equal(result.props.nextTopic, 'Working Capital')
  })
})
