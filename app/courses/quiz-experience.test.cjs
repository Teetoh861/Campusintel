const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, nodes, deferred } = require('./quiz-experience.fixture.cjs')

// A route-neutral entry also keeps these regressions in the workflow verifier's Node 22 discovery.
require('./[slug]/quiz/assessmentClock.test.cjs')
require('./[slug]/quiz/attemptRecording.test.cjs')
require('./[slug]/quiz/liveBank.test.cjs')

test('Flag is a named pressed toggle; the one h1 names the practice and cells name their state', async () => fixture(async f => {
  const { QuestionScreen } = require('./[slug]/quiz/QuestionScreen.tsx')
  const tree = f.render(QuestionScreen, { ...f.props, question: f.props.questions[0], current: 0, total: 2,
    selected: 1, isMarked: true, timeLeft: 60, isLowTime: false,
    navOpen: false, answersMap: { 0: 1 }, markedMap: { 0: true }, answeredCount: 1, markedCount: 1 })
  const all = nodes(tree)
  const flag = all.find(node => node.props?.['aria-pressed'] === true)
  assert.equal(nodes(flag).find(node => node.type === 'span').props.children, 'Flagged')
  assert.deepEqual(all.filter(node => node.type === 'h1').map(node => node.props.children), ['Practice — TST Test course'])
  assert.equal(all.find(node => node.type === 'legend').props.children, 'Choose one answer')
  assert.equal(all.filter(node => node.type === 'input' && node.props.type === 'radio').length, 2)
  assert.equal(all.find(node => node.props?.role === 'timer').props['aria-label'], 'Time left 1 minutes 0 seconds')
  const rail = all.find(node => node.type?.name === 'Navigator')
  const questions = nodes(f.render(rail.type, rail.props)).filter(node => node.props?.['aria-label'])
  assert.deepEqual(questions.map(node => node.props['aria-label']),
    ['Question 1, answered, flagged, current', 'Question 2, not answered'])
  assert.equal(questions[0].props['aria-current'], 'step')
}))

test('readiness is required, preparing cannot start, and the briefing states this attempt only', async () => fixture(async f => {
  let starts = 0
  const props = { ...f.props, courseCode: 'BUA202', questionCount: 2, bankSize: 3, preparing: false,
    briefingVersion: 0, error: null, onStart: () => starts++ }
  const render = () => f.render(f.IntroScreen, props)
  const button = () => nodes(render()).find(node => node.type === 'button')
  assert.equal(button().props.disabled, true)
  assert.equal(nodes(render()).some(node => /study guide|StudyGuide/i.test(String(node.type?.name ?? ''))), false)
  button().props.onClick()
  assert.equal(starts, 0)
  const facts = nodes(render()).filter(node => node.type?.name === 'Fact')
  assert.deepEqual(facts.map(node => node.props.label), ['Questions', 'Time', 'Answering', 'Finishing'])
  assert.equal(facts.find(node => node.props.label === 'Questions').props.value, '2 questions')
  assert.equal(facts.find(node => node.props.label === 'Time').props.value, '1 minute')
  assert.equal(nodes(render()).some(node => /practice target|section/i.test(String(node.props?.label ?? ''))), false)
  nodes(render()).find(node => node.props?.onCheckedChange).props.onCheckedChange(true)
  assert.equal(button().props.disabled, false)
  button().props.onClick()
  assert.equal(starts, 1)
  props.preparing = true
  assert.equal(button().props.disabled, true)
  button().props.onClick()
  assert.equal(starts, 1)
}))

function publishedQuestions(count) {
  return Array.from({ length: count }, (_, index) => ({ id: index + 1,
    questionId: `question-${index}`, itemId: `item-${index}`, question: `Question ${index}`, section: index % 2 ? 'Two' : 'One',
    publishedRevision: 1, options: ['A', 'B'], correctAnswer: 1 }))
}

const fiftyQuestionPage = { questions: publishedQuestions(50), maxQuestions: 50,
  totalInBank: 50, sections: ['One', 'Two', 'Configured but empty'] }

test('a fresh bank with fewer questions updates the briefing and resets readiness before any attempt starts', async () => fixture(async f => {
  assert.equal(f.child('IntroScreen').props.questionCount, 50)
  f.respond(() => ({ ...f.fresh, questions: f.fresh.questions.slice(0, 20), bankSize: 20, attemptSize: 20 }))
  await f.start()
  const intro = f.child('IntroScreen').props
  assert.equal(intro.questionCount, 20)
  assert.match(intro.error, /practice details have changed.*review them/i)
  const tree = nodes(f.briefing())
  assert.equal(tree.find(node => node.type?.name === 'Fact' && node.props.label === 'Questions').props.value, '20 questions')
  assert.equal(f.readiness().props.checked, false)
  assert.equal(tree.find(node => node.type === 'button').props.disabled, true)
  assert.equal(f.child('QuestionScreen'), undefined)
  assert.equal(f.writes.length, 0)
  assert.equal(f.intervals.size, 0)
  f.setNow(120_000)
  f.win.dispatchEvent(new Event('focus'))
  await f.pressStart()
  assert.equal(f.bankLoads(), 1, 'unchecked readiness cannot request another Start')
  assert.equal(f.writes.length, 0)
  assert.equal(f.intervals.size, 0)
}, fiftyQuestionPage))

test('bank coverage is tracked by the engine without a sections fact; empty configured sections never block Start', async () => fixture(async f => {
  assert.equal(f.child('IntroScreen').props.questionCount, 2)
  assert.equal(f.child('IntroScreen').props.sectionCount, undefined)
  await f.start()
  assert.equal(f.bankLoads(), 1)
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
}, { sections: ['One', 'Two', 'Three', 'Configured but empty'] }))

test('unchanged fresh conditions start normally with fresh revisions and no extra acknowledgement loop', async () => fixture(async f => {
  const fresh = { ...f.fresh, questions: f.fresh.questions.map(question => ({ ...question,
    question: `Updated ${question.question}`, publishedRevision: 2 })) }
  f.respond(() => fresh)
  await f.start()
  assert.equal(f.child('IntroScreen'), undefined)
  assert.equal(f.child('QuestionScreen').props.total, 2)
  assert.equal(f.bankLoads(), 1)
  const starts = f.writes.filter(write => write[0] === 'start')
  assert.equal(starts.length, 1)
  assert.ok(starts[0][2].every(question => fresh.questions.includes(question) && question.publishedRevision === 2))
}))

test('acknowledging updated conditions begins exactly one attempt from the verified fresh bank', async () => fixture(async f => {
  const fresh = { ...f.fresh, questions: f.fresh.questions.slice(0, 8).map(question => ({ ...question,
    publishedRevision: 2 })), bankSize: 8, attemptSize: 8 }
  f.respond(() => fresh)
  await f.start()
  assert.equal(f.child('IntroScreen').props.questionCount, 8)
  assert.equal(f.writes.length, 0)
  f.acknowledge()
  const start = nodes(f.briefing()).find(node => node.type === 'button')
  assert.equal(start.props.disabled, false)
  start.props.onClick()
  start.props.onClick()
  await f.settle()
  assert.equal(f.bankLoads(), 2, 'one verification per deliberate Start')
  assert.equal(f.child('IntroScreen'), undefined)
  assert.equal(f.child('QuestionScreen').props.total, 8)
  assert.equal(f.child('QuestionScreen').props.timeLeft, 60)
  assert.equal(f.intervals.size, 1)
  const starts = f.writes.filter(write => write[0] === 'start')
  assert.equal(starts.length, 1)
  assert.equal(starts[0][2].length, 8)
  assert.ok(starts[0][2].every(question => fresh.questions.includes(question)))
}, fiftyQuestionPage))

test('a change only to published bank coverage requires updated readiness with the same attempt size', async () => fixture(async f => {
  f.respond(() => ({ ...f.fresh, questions: f.fresh.questions.map(question => ({ ...question, section: 'One' })) }))
  await f.start()
  assert.equal(f.child('IntroScreen').props.questionCount, 2)
  assert.equal(f.readiness().props.checked, false)
  assert.equal(f.writes.length, 0)
  assert.equal(f.intervals.size, 0)
  await f.start()
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
  assert.equal(f.child('QuestionScreen').props.total, 2)
}))

test('a fresh 45-minute duration replaces the 60-minute briefing before any attempt or clock starts', async () => fixture(async f => {
  assert.equal(f.child('IntroScreen').props.timerSeconds, 3600)
  assert.equal(nodes(f.briefing()).find(node => node.type?.name === 'Fact' && node.props.label === 'Time').props.value, '60 minutes')
  f.respond(() => ({ ...f.fresh, timerSeconds: 2700 }))
  await f.start()
  const intro = f.child('IntroScreen').props
  assert.equal(intro.timerSeconds, 2700)
  assert.equal(intro.briefingVersion, 1)
  assert.match(intro.error, /practice details have changed.*review them/i)
  const tree = nodes(f.briefing())
  assert.equal(tree.find(node => node.type?.name === 'Fact' && node.props.label === 'Time').props.value, '45 minutes')
  assert.equal(f.readiness().props.checked, false)
  assert.equal(tree.find(node => node.type === 'button').props.disabled, true)
  assert.equal(f.child('QuestionScreen'), undefined)
  assert.deepEqual(f.writes, [])
  assert.equal(f.intervals.size, 0)
  f.setNow(6_600_000)
  f.win.dispatchEvent(new Event('focus'))
  await f.pressStart()
  assert.equal(f.bankLoads(), 1)
  assert.deepEqual(f.writes, [])
  assert.equal(f.intervals.size, 0)
}, { timerSeconds: 3600 }))

test('acknowledging 45 minutes opens exactly one attempt at 2700 seconds and expires at its accepted deadline', async () => fixture(async f => {
  f.respond(() => ({ ...f.fresh, timerSeconds: 2700 }))
  await f.start()
  assert.deepEqual(f.writes, [])
  const startTime = 500_000
  f.setNow(startTime)
  f.acknowledge()
  const start = nodes(f.briefing()).find(node => node.type === 'button')
  start.props.onClick()
  start.props.onClick()
  await f.settle()
  assert.equal(f.bankLoads(), 2)
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
  assert.equal(f.child('QuestionScreen').props.timeLeft, 2700)
  assert.equal(f.intervals.size, 1)
  f.setNow(startTime + 2_700_000 - 1)
  f.tick()
  assert.equal(f.child('QuestionScreen').props.timeLeft, 1)
  assert.equal(f.child('ResultsScreen'), undefined)
  f.setNow(startTime + 2_700_000)
  f.win.dispatchEvent(new Event('focus'))
  f.tick()
  assert.ok(f.child('ResultsScreen'))
  assert.deepEqual(f.writes.filter(write => write[0] === 'finish'), [['finish', 'timed_out']])
  assert.equal(f.intervals.size, 0)
}, { timerSeconds: 3600 }))

test('an unchanged fresh 60-minute duration starts in one pass with the full accepted time', async () => fixture(async f => {
  await f.start()
  assert.equal(f.child('IntroScreen'), undefined)
  assert.equal(f.bankLoads(), 1)
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
  assert.equal(f.child('QuestionScreen').props.timeLeft, 3600)
  f.setNow(1_800_000)
  f.tick()
  assert.equal(f.child('QuestionScreen').props.timeLeft, 1800)
}, { timerSeconds: 3600 }))

test('retake and redo verify changed duration, require readiness, and reset to the accepted fresh time', async () => {
  for (const action of ['onRetakeWithNewQuestions', 'onRedoQuestions']) await fixture(async f => {
    await f.start()
    f.child('QuestionScreen').props.onSelectOption(1)
    f.child('QuestionScreen').props.onToggleMark()
    f.child('QuestionScreen').props.onSubmit()
    f.dialog('submit').props.onConfirm()
    f.respond(() => ({ ...f.fresh, timerSeconds: 2700 }))
    f.child('ResultsScreen').props[action]()
    await f.settle()
    assert.equal(f.child('IntroScreen').props.timerSeconds, 2700)
    assert.equal(f.readiness().props.checked, false)
    assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
    assert.equal(f.intervals.size, 0)
    await f.start()
    assert.equal(f.child('QuestionScreen').props.timeLeft, 2700)
    assert.equal(f.child('QuestionScreen').props.answeredCount, 0)
    assert.equal(f.child('QuestionScreen').props.markedCount, 0)
    assert.equal(f.writes.filter(write => write[0] === 'start').length, 2)
    f.child('QuestionScreen').props.onSubmit()
    f.dialog('submit').props.onConfirm()
    const redoTime = 900_000
    f.setNow(redoTime)
    f.child('ResultsScreen').props.onRedoQuestions()
    await f.settle()
    assert.equal(f.child('IntroScreen'), undefined)
    assert.equal(f.child('QuestionScreen').props.timeLeft, 2700)
    assert.equal(f.writes.filter(write => write[0] === 'start').length, 3)
    f.setNow(redoTime + 2_700_000 - 1)
    f.tick()
    assert.equal(f.child('QuestionScreen').props.timeLeft, 1)
    f.setNow(redoTime + 2_700_000)
    f.tick()
    assert.ok(f.child('ResultsScreen'))
    assert.deepEqual(f.writes.filter(write => write[0] === 'finish').at(-1), ['finish', 'timed_out'])
  }, { timerSeconds: 3600 })
})

const sameQuestionPage = {
  questions: publishedQuestions(2).map((question, index) => ({ ...question, questionId: index ? 'B' : 'A' })),
  sections: ['One', 'Two'], totalInBank: 2, timerSeconds: 3600,
}

async function withSameQuestionPage(run) {
  const random = Math.random
  Math.random = () => 0
  try { await fixture(run, sameQuestionPage) } finally { Math.random = random }
}

function finishAnsweredAttempt(f) {
  f.child('QuestionScreen').props.onSelectOption(1)
  f.child('QuestionScreen').props.onToggleMark()
  f.child('QuestionScreen').props.onSubmit()
  f.dialog('submit').props.onConfirm()
}

function changedDurationBank(f) {
  const additional = f.props.questions.map((question, index) => ({ ...question,
    id: index + 3, questionId: index ? 'D' : 'C', question: `Additional question ${index}` }))
  return { ...f.fresh, timerSeconds: 2700, bankSize: 4, questions: [...f.props.questions, ...additional] }
}

test('Redo preserves A/B and revisions across changed-duration readiness without substituting a new sample', async () => withSameQuestionPage(async f => {
  await f.start()
  const completed = f.writes.filter(write => write[0] === 'start')[0][2]
  assert.deepEqual(completed.map(question => question.questionId), ['A', 'B'])
  finishAnsweredAttempt(f)
  f.respond(() => changedDurationBank(f))
  f.child('ResultsScreen').props.onRedoQuestions()
  await f.settle()
  assert.equal(f.child('IntroScreen').props.timerSeconds, 2700)
  const briefing = nodes(f.briefing())
  assert.equal(briefing.find(node => node.type?.name === 'Fact' && node.props.label === 'Time').props.value, '45 minutes')
  assert.equal(f.readiness().props.checked, false)
  assert.equal(briefing.find(node => node.type === 'button').props.disabled, true)
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
  assert.equal(f.intervals.size, 0)
  await f.pressStart()
  assert.equal(f.bankLoads(), 2, 'no request while waiting for readiness')
  f.acknowledge()
  const start = nodes(f.briefing()).find(node => node.type === 'button')
  start.props.onClick()
  start.props.onClick()
  await f.settle()
  const starts = f.writes.filter(write => write[0] === 'start')
  assert.equal(starts.length, 2, 'exactly one additional attempt begins')
  assert.equal(f.bankLoads(), 3, 'redo publication is checked again after acknowledgement')
  assert.deepEqual(starts[1][2].map(question => [question.questionId, question.publishedRevision]),
    completed.map(question => [question.questionId, question.publishedRevision]))
  const active = f.child('QuestionScreen').props
  assert.equal(active.timeLeft, 2700)
  assert.equal(active.answeredCount, 0)
  assert.equal(active.markedCount, 0)
  assert.deepEqual(active.answersMap, {})
  assert.deepEqual(active.markedMap, {})
}))

test('a changed or withdrawn required revision during acknowledgement blocks Redo and offers Retake', async () => {
  for (const change of ['revised', 'withdrawn']) await withSameQuestionPage(async f => {
    await f.start()
    finishAnsweredAttempt(f)
    const fresh = changedDurationBank(f)
    f.respond(() => fresh)
    f.child('ResultsScreen').props.onRedoQuestions()
    await f.settle()
    assert.equal(f.child('IntroScreen').props.timerSeconds, 2700)
    assert.equal(f.intervals.size, 0)
    const changed = change === 'revised'
      ? { ...fresh, questions: fresh.questions.map(question => question.questionId === 'A'
        ? { ...question, publishedRevision: 2 } : question) }
      : { ...fresh, bankSize: 3, questions: fresh.questions.filter(question => question.questionId !== 'B') }
    f.respond(() => changed)
    await f.start()
    assert.equal(f.bankLoads(), 3)
    assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
    assert.equal(f.child('QuestionScreen'), undefined)
    assert.equal(f.intervals.size, 0)
    assert.ok(f.child('ResultsScreen'), 'completed results retain the explicit Retake choice')
    assert.equal(f.child('ResultsScreen').props.error, 'These questions have changed. Retake with new questions instead.')
    f.child('ResultsScreen').props.onRetakeWithNewQuestions()
    await f.settle()
    assert.equal(f.writes.filter(write => write[0] === 'start').length, 2)
    assert.equal(f.child('QuestionScreen').props.timeLeft, 2700)
  })
})

test('Retake preserves its new-sample intent across changed-duration readiness', async () => withSameQuestionPage(async f => {
  await f.start()
  const completed = f.writes.filter(write => write[0] === 'start')[0][2]
  finishAnsweredAttempt(f)
  const fresh = changedDurationBank(f)
  f.respond(() => fresh)
  f.child('ResultsScreen').props.onRetakeWithNewQuestions()
  await f.settle()
  assert.equal(f.child('IntroScreen').props.timerSeconds, 2700)
  assert.equal(f.readiness().props.checked, false)
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
  assert.equal(f.intervals.size, 0)
  await f.start()
  const starts = f.writes.filter(write => write[0] === 'start')
  assert.equal(starts.length, 2)
  assert.notDeepEqual(starts[1][2].map(question => question.questionId), completed.map(question => question.questionId))
  assert.ok(starts[1][2].some(question => ['C', 'D'].includes(question.questionId)))
  assert.ok(starts[1][2].every(question => fresh.questions.includes(question)))
  assert.equal(f.child('QuestionScreen').props.timeLeft, 2700)
}))

test('delayed or failed fresh bank reads never start time or duplicate Start or replace page identity', async () => fixture(async f => {
  const gate = deferred()
  f.respond(() => gate.promise)
  const intro = f.child('IntroScreen')
  intro.props.onStart(); intro.props.onStart()
  f.props.continuityToken = 'page-B'
  f.setNow(90_000)
  assert.equal(f.child('IntroScreen').props.preparing, true)
  assert.equal(f.intervals.size, 0)
  assert.equal(f.bankLoads(), 1)
  assert.deepEqual(f.writes, [])
  gate.resolve(null)
  await f.settle()
  assert.match(f.child('IntroScreen').props.error, /couldn’t load your practice questions/)
  assert.equal(f.intervals.size, 0)
  f.respond(() => f.fresh)
  await f.start()
  assert.equal(f.child('QuestionScreen').props.timeLeft, 60)
  assert.deepEqual(f.tokens, ['page-A'])
  assert.equal(f.writes.filter(write => write[0] === 'start').length, 1)
}))

test('active delayed callbacks and visibility/focus catch up; timeout races finish only once', async () => fixture(async f => {
  await f.start()
  f.setNow(25_000); f.tick()
  assert.equal(f.child('QuestionScreen').props.timeLeft, 35)
  f.child('QuestionScreen').props.onSubmit()
  const staleSubmit = f.dialog('submit').props.onConfirm
  f.setNow(90_000)
  f.doc.dispatchEvent(new Event('visibilitychange'))
  staleSubmit()
  f.win.dispatchEvent(new Event('focus'))
  f.tick()
  assert.ok(f.child('ResultsScreen'))
  assert.deepEqual(f.writes.filter(write => write[0] === 'finish'), [['finish', 'timed_out']])
  assert.equal(f.intervals.size, 0)
  assert.equal(f.dialog('submit'), undefined)
}))

test('manual submit first wins once; a submit or answer after expiry records timed_out', async () => {
  for (const afterExpiry of [false, true]) await fixture(async f => {
    await f.start()
    f.child('QuestionScreen').props.onSubmit()
    const confirm = f.dialog('submit').props.onConfirm
    f.setNow(afterExpiry ? 60_001 : 59_999)
    confirm(); confirm(); f.tick(); f.render()
    assert.deepEqual(f.writes.filter(write => write[0] === 'finish'),
      [['finish', afterExpiry ? 'timed_out' : 'submitted']])
    assert.equal(f.intervals.size, 0)
  })
  await fixture(async f => {
    await f.start()
    f.setNow(61_000)
    f.child('QuestionScreen').props.onSelectOption(1)
    assert.equal(f.writes.some(write => write[0] === 'record'), false)
    assert.deepEqual(f.writes.at(-1), ['finish', 'timed_out'])
  })
})

test('answers, changes, flags and submission counts use only the actual sample; redo and retake reset time', async () => fixture(async f => {
  await f.start()
  const first = f.writes[0][2]
  f.child('QuestionScreen').props.onSelectOption(0)
  f.child('QuestionScreen').props.onSelectOption(1)
  f.child('QuestionScreen').props.onToggleMark()
  f.child('QuestionScreen').props.onSubmit()
  const dialog = f.dialog('submit')
  assert.deepEqual([dialog.props.answered, dialog.props.unanswered, dialog.props.flagged], [1, 1, 1])
  dialog.props.onOpenChange(false)
  assert.equal(f.child('QuestionScreen').props.selected, 1)
  assert.equal(f.child('QuestionScreen').props.isMarked, true)
  dialog.props.onConfirm()
  const results = f.child('ResultsScreen')
  assert.equal(results.props.correctCount, 1)
  assert.equal(results.props.questions.length, 2)
  assert.equal(results.props.finishReason, 'submitted')
  assert.equal(results.props.sections, undefined, 'no section judgement on this attempt')
  for (const action of ['onRedoQuestions', 'onRetakeWithNewQuestions']) {
    f.setNow(100_000)
    f.child('ResultsScreen').props[action]()
    await f.settle()
    assert.equal(f.child('QuestionScreen').props.timeLeft, 60)
    assert.equal(f.child('QuestionScreen').props.answeredCount, 0)
    assert.equal(f.child('QuestionScreen').props.markedCount, 0)
    if (action === 'onRedoQuestions') assert.deepEqual(f.writes.filter(write => write[0] === 'start').at(-1)[2], first)
    f.setNow(160_001); f.tick(); f.render()
  }
}))

test('leave and Back cancellation preserve answers; confirm leaves; completed pages remove guards', async () => fixture(async f => {
  await f.start()
  f.child('QuestionScreen').props.onSelectOption(1)
  f.child('QuestionScreen').props.onLeave()
  assert.equal(f.dialog('leave').props.open, true)
  f.dialog('leave').props.onOpenChange(false)
  assert.equal(f.child('QuestionScreen').props.selected, 1)
  assert.deepEqual(f.destinations, [])
  const refresh = new Event('beforeunload', { cancelable: true })
  f.win.dispatchEvent(refresh)
  assert.equal(refresh.defaultPrevented, true)
  f.confirmBack(false); f.win.history.back()
  assert.equal(f.child('QuestionScreen').props.selected, 1)
  assert.equal(f.history.length, 2)
  f.child('QuestionScreen').props.onLeave()
  f.dialog('leave').props.onConfirm()
  assert.deepEqual(f.destinations, ['/courses/test'])
  const leaving = new Event('beforeunload', { cancelable: true })
  f.win.dispatchEvent(leaving)
  assert.equal(leaving.defaultPrevented, false)
}))

test('confirmed browser Back leaves and Results navigation is not trapped', async () => {
  await fixture(async f => {
    await f.start(); f.confirmBack(true); f.win.history.back()
    assert.deepEqual(f.destinations, ['/courses/test'])
  })
  await fixture(async f => {
    await f.start(); f.child('QuestionScreen').props.onSubmit(); f.dialog('submit').props.onConfirm()
    assert.ok(f.child('ResultsScreen'))
    assert.equal(f.history.length, 1)
    const refresh = new Event('beforeunload', { cancelable: true })
    f.win.dispatchEvent(refresh)
    assert.equal(refresh.defaultPrevented, false)
    f.win.dispatchEvent(new Event('popstate'))
    assert.deepEqual(f.destinations, [])
  })
})

test('confirmation and report cancels return focus to the first named control that still exists, never the body', async () => fixture(async f => {
  await f.start()
  const invoker = new f.Element(), trigger = new f.Element(), flag = new f.Element()
  const restore = (dialog, targets) => { const event = f.closeEvent(); dialog.props.onRestoreFocus(event); return event.defaultPrevented }
  f.child('QuestionScreen').props.onSubmit([invoker, trigger])
  assert.equal(f.dialog('submit').props.open, true)
  assert.equal(restore(f.dialog('submit')), true)
  assert.equal(f.doc.activeElement, invoker, 'cancelling a main-action submit returns to its button')
  // Navigator-origin submit: the footer button left with the sheet, so the stable Questions trigger takes focus.
  const gone = new f.Element(); gone.isConnected = false
  f.child('QuestionScreen').props.onSubmit([gone, trigger, flag])
  assert.equal(restore(f.dialog('submit')), true)
  assert.equal(f.doc.activeElement, trigger)
  trigger.hidden = true
  f.doc.activeElement = f.doc.body
  f.child('QuestionScreen').props.onSubmit([gone, trigger, flag])
  assert.equal(restore(f.dialog('submit')), true)
  assert.equal(f.doc.activeElement, flag, 'a hidden trigger yields to the next stable control')
  f.doc.activeElement = f.doc.body
  f.child('QuestionScreen').props.onSubmit([gone])
  assert.equal(restore(f.dialog('submit')), false, 'with nothing to focus the primitive keeps its own default')
  assert.equal(f.doc.activeElement, f.doc.body)
  f.child('QuestionScreen').props.onLeave([invoker])
  assert.equal(restore(f.dialog('leave')), true)
  assert.equal(f.doc.activeElement, invoker)
  f.dialog('leave').props.onOpenChange(false)
  // Once the attempt has ended, the closing confirmation yields entirely: Results owns its entry focus, so the
  // primitive is told not to reach back, and the invoker that opened the confirmation is never refocused.
  f.child('QuestionScreen').props.onSubmit([invoker])
  const late = f.dialog('submit')
  late.props.onConfirm(); f.render()
  const resultsHeading = new f.Element()
  resultsHeading.focus()
  assert.equal(restore(late), true)
  assert.equal(f.doc.activeElement, resultsHeading, 'the late restore neither focuses the invoker nor hands the primitive the body')
  // Review: the report trigger first; once a sent report replaced it, the item's disclosure.
  f.child('ResultsScreen').props.onReview(); f.render()
  const reportTrigger = new f.Element(), disclosure = new f.Element()
  f.child('ReviewScreen').props.onReport(1, [reportTrigger, disclosure])
  assert.equal(restore(f.child('ReportQuestionDialog')), true)
  assert.equal(f.doc.activeElement, reportTrigger, 'cancel returns to Report a question')
  f.child('ReportQuestionDialog').props.onReported('question-1')
  reportTrigger.isConnected = false
  assert.equal(restore(f.child('ReportQuestionDialog')), true)
  assert.equal(f.doc.activeElement, disclosure, 'a successful report returns to the question disclosure')
  f.child('ReportQuestionDialog').props.onClose()
  assert.equal(f.child('ReportQuestionDialog'), undefined)
}))

test('a confirmed submit from the main action or the navigator, and a timeout, commit Results whose own heading takes entry focus', async () => fixture(async f => {
  const { ResultsScreen } = require('./[slug]/quiz/ResultsScreen.tsx')
  const restore = dialog => { const event = f.closeEvent(); dialog.props.onRestoreFocus(event); return event.defaultPrevented }
  // Mount the real ResultsScreen on the props the client committed; the band's heading ref is the only thing a DOM would add.
  const commitResults = reason => {
    const props = f.child('ResultsScreen').props
    assert.equal(f.dataset['data-screen'], 'results')
    assert.equal(props.finishReason, reason)
    const heading = new f.Element()
    let focused = 0
    heading.focus = function() { focused++; f.doc.activeElement = this }
    f.doc.activeElement = f.doc.body
    f.unmount(ResultsScreen)
    f.render(ResultsScreen, props, tree => { nodes(tree).find(node => node.props?.titleRef).props.titleRef.current = heading })
    assert.equal(f.doc.activeElement, heading, `${reason}: Results focuses its heading when it mounts`)
    f.render(ResultsScreen, { ...props, saveState: 'saved' })
    assert.equal(focused, 1, 'a save-state update never refocuses the heading')
    return heading
  }
  await f.start()
  // Main action submit → confirm → Results.
  const invoker = new f.Element()
  f.child('QuestionScreen').props.onSubmit([invoker])
  const main = f.dialog('submit')
  main.props.onConfirm(); f.render()
  const afterMain = commitResults('submitted')
  assert.equal(restore(main), true, 'the closing confirmation yields instead of reaching back')
  assert.equal(f.doc.activeElement, afterMain)
  // Navigator footer submit → confirm → Results: the footer button left with the sheet, the trigger is hidden, nothing wins but Results.
  f.setNow(100_000)
  f.child('ResultsScreen').props.onRedoQuestions(); await f.settle()
  const gone = new f.Element(); gone.isConnected = false
  const trigger = new f.Element(), flag = new f.Element()
  f.child('QuestionScreen').props.onSubmit([gone, trigger, flag])
  const navigator = f.dialog('submit')
  navigator.props.onConfirm(); f.render()
  const afterNavigator = commitResults('submitted')
  assert.equal(restore(navigator), true)
  assert.equal(f.doc.activeElement, afterNavigator, 'neither the stale footer button nor the Questions trigger takes focus from Results')
  // Timeout: the same Results transition, so the same destination.
  f.setNow(200_000)
  f.child('ResultsScreen').props.onRedoQuestions(); await f.settle()
  assert.equal(f.dataset['data-screen'], 'active')
  f.setNow(261_000); f.tick()
  commitResults('timed_out')
  assert.deepEqual(f.writes.filter(write => write[0] === 'finish').map(write => write[1]), ['submitted', 'submitted', 'timed_out'])
}))
