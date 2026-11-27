// app/courses/campus-bot-screens.test.cjs — What a student reads in Explain and Ask Campus Bot: every state with its
// exact, owner-approved line, where the Explain button appears (and where it never does), and that Campus Bot's words
// are only ever text.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const root = path.join(__dirname, '../..')
const text = html => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [match[1], text(match[2])])
const buttons = html => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match => text(match[1]))

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
const h = React.createElement
const HREFS = { signInHref: '/login?next=%2Fback', reloadHref: '/back' }
// The chat opens a quiz's set with the app router, as the area's Quiz me does; a page always has one.
const withRouter = element => {
  const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime')
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} }
  return h(AppRouterContext.Provider, { value: router }, element)
}

test('the approved lines, word for word', () => {
  const { CAMPUS_BOT_COPY: copy } = require(path.join(root, 'lib/campus-bot/copy.ts'))
  assert.equal(copy.name, 'Campus Bot')
  assert.equal(copy.explain, 'Explain')
  assert.equal(copy.explaining, 'Campus Bot is explaining…')
  assert.equal(copy.fromNotes, 'From your study guide:')
  assert.equal(copy.notCovered, 'The study guide for this course doesn’t cover this question.')
  assert.equal(copy.checkFailed('Demand'), 'This question is from Demand.')
  assert.equal(copy.openNotes, 'Open study guide')
  assert.equal(copy.explainFailed, 'Campus Bot couldn’t explain this. Try again.')
  assert.equal(copy.ask, 'Ask a question')
  assert.equal(copy.askPlaceholder('Demand'), 'Ask about Demand')
  assert.equal(copy.send, 'Send')
  assert.equal(copy.answering, 'Campus Bot is answering…')
  assert.equal(copy.you, 'You')
  assert.equal(copy.outsideNotes, 'This isn’t covered in this study guide topic.')
  // Marking a check answer: the owner's mock 8 words, and no others.
  assert.deepEqual([copy.correct, copy.notQuite, copy.quickCheck, copy.tryAnother, copy.memoryTrick, copy.answerPlaceholder],
    ['Correct', 'Not quite', 'Quick check', 'Try another', 'Memory trick:', 'Type your answer…'])
  assert.equal(copy.askFailed, 'Campus Bot couldn’t answer that.')
  assert.equal(copy.askFailedNoRetry, 'Campus Bot couldn’t answer that. Try again.')
  assert.deepEqual([copy.busyTitle, copy.busyLine], ['Campus Bot is busy.', 'Try again in a few minutes.'])
  assert.deepEqual(copy.notice, { subscribe: 'Campus Bot is included when you subscribe.',
    'free-pass': 'Campus Bot opens with a free pass.', plan: 'Campus Bot is included with a plan.' })
  assert.equal(copy.limits.session.title, 'You’ve used up Campus Bot for now.')
  assert.equal(copy.limits.week.title, 'You’ve used up Campus Bot for this week.')
  assert.equal(copy.limits.passExplain, 'You’ve used your free pass explanations.')
  assert.equal(copy.limits.passChat, 'You’ve used your free pass messages.')
  assert.deepEqual(copy.limits.undelivered, { title: 'Campus Bot limit reached.', line: 'Try again tomorrow.' })
  // 10:05 on a Monday in Lagos, whatever the device's own zone.
  assert.equal(copy.limits.session.line('2026-11-16T09:05:00Z'), 'It resets at 10:05.')
  assert.equal(copy.limits.week.line('2026-11-16T09:05:00Z'), 'It resets Monday at 10:05.')
  assert.equal(copy.limits.session.line(null), '')
})

test('a student without Campus Bot reads one line and has one place to go, for each of the three cases', async () => withTsx(async () => {
  const { CampusBotStatus } = require(path.join(root, 'components/student/CampusBotStatus.tsx'))
  const show = notice => renderToStaticMarkup(h(CampusBotStatus, { problem: { status: 'not-entitled', notice }, feature: 'explain', ...HREFS }))
  assert.equal(text(show('subscribe')), 'Campus Bot is included when you subscribe. Plan & Access')
  assert.deepEqual(links(show('subscribe')), [['/access', 'Plan & Access']])
  assert.equal(text(show('free-pass')), 'Campus Bot opens with a free pass. Get your free pass')
  assert.deepEqual(links(show('free-pass')), [['/access', 'Get your free pass']])
  assert.equal(text(show('plan')), 'Campus Bot is included with a plan. Plan & Access')
}))

test('limits, a busy moment and problems: each state has its own notice, the same for both features where the words are shared', async () => withTsx(async () => {
  const { CampusBotStatus } = require(path.join(root, 'components/student/CampusBotStatus.tsx'))
  const show = (problem, feature = 'explain', onRetry) => renderToStaticMarkup(h(CampusBotStatus, { problem, feature, onRetry, ...HREFS }))
  const at = '2026-11-16T09:05:00Z'
  assert.equal(text(show({ status: 'limit', limit: 'session', resetsAt: at })), 'You’ve used up Campus Bot for now. It resets at 10:05.')
  assert.equal(text(show({ status: 'limit', limit: 'week', resetsAt: at }, 'ask')), 'You’ve used up Campus Bot for this week. It resets Monday at 10:05.')
  assert.equal(text(show({ status: 'limit', limit: 'session', resetsAt: null })), 'You’ve used up Campus Bot for now.')
  assert.equal(text(show({ status: 'limit', limit: 'pass', resetsAt: null })), 'You’ve used your free pass explanations. Plan & Access')
  assert.equal(text(show({ status: 'limit', limit: 'pass', resetsAt: null }, 'ask')), 'You’ve used your free pass messages. Plan & Access')
  assert.equal(text(show({ status: 'limit', limit: 'undelivered', resetsAt: null })), 'Campus Bot limit reached. Try again tomorrow.')
  assert.equal(text(show({ status: 'busy' }, 'explain', () => {})), 'Campus Bot is busy. Try again in a few minutes. Try again')
  assert.equal(text(show({ status: 'busy' })), 'Campus Bot is busy. Try again in a few minutes.')
  assert.equal(text(show({ status: 'exam-open' }, 'ask')), 'Campus Bot is available when your exam ends.')
  assert.equal(text(show({ status: 'failed' }, 'explain', () => {})), 'Campus Bot couldn’t explain this. Try again. Try again')
  assert.deepEqual(buttons(show({ status: 'failed' }, 'ask', () => {})), ['Try again'])
  // Ask: with the Try again button, the line does not repeat it; without the button, the line keeps "Try again." so
  // the student still has a next step.
  for (const status of ['failed', 'unavailable']) {
    const withButton = show({ status }, 'ask', () => {})
    assert.deepEqual([text(withButton), buttons(withButton)], ['Campus Bot couldn’t answer that. Try again', ['Try again']], status)
  }
  for (const status of ['not-found', 'invalid-request']) {
    const alone = show({ status }, 'ask', () => {})
    assert.deepEqual([text(alone), buttons(alone)], ['Campus Bot couldn’t answer that. Try again.', []], status)
  }
  const nothingToRetry = show({ status: 'failed' }, 'ask')
  assert.deepEqual([text(nothingToRetry), buttons(nothingToRetry)], ['Campus Bot couldn’t answer that. Try again.', []],
    'a failure with nothing to retry says it in the line')
  assert.deepEqual(buttons(show({ status: 'not-found' }, 'explain', () => {})), [], 'trying again cannot help a question that is not there')
  assert.deepEqual(links(show({ status: 'signed-out' })), [['/login?next=%2Fback', 'Sign in']])
  assert.match(text(show({ status: 'signed-out' })), /^You’ve been signed out\./)
  assert.deepEqual(links(show({ status: 'session-changed' })), [['/back', 'Reload']])
  // The shared line for a changed sign-in, whatever its current wording.
  const { SIGNED_IN_ON_ANOTHER_TAB } = require(path.join(root, 'lib/auth/constants.ts'))
  assert.ok(text(show({ status: 'session-changed' })).startsWith(SIGNED_IN_ON_ANOTHER_TAB))
  assert.equal(text(show({ status: 'locked', plansOnSale: true })), 'Answers and explanations are included when you subscribe. Plan & Access')
  assert.equal(show({ status: 'disabled' }), '', 'a switched-off feature says nothing')
  // A limit and a busy moment are information, not errors; a failure is announced.
  assert.match(show({ status: 'busy' }), /role="status"/)
  assert.match(show({ status: 'failed' }), /role="alert"/)
}))

test('Explain: Campus Bot’s block names itself, shows the explanation as text only and links the notes topic it came from', async () => withTsx(async () => {
  const { ExplanationBlock, ExplainPanel } = require('./[slug]/quiz/ExplainPanel.tsx')
  const show = result => renderToStaticMarkup(h(ExplanationBlock, { result, courseHref: '/courses/principles-economics-1' }))
  const explained = show({ status: 'explained', text: 'B is right.\n<img src=x onerror=alert(1)> <b>bold</b>', topic: { number: 3, title: 'Demand' } })
  assert.match(text(explained), /^Campus Bot B is right\./)
  assert.match(text(explained), /From your study guide: Demand$/)
  assert.deepEqual(links(explained), [['/courses/principles-economics-1/notes/3', 'Demand']])
  assert.doesNotMatch(explained, /<img|<b>/, 'markup in a reply is shown as its characters, never as HTML')
  assert.match(explained, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(explained, /aria-label="Campus Bot"/)
  assert.equal(text(show({ status: 'explained', text: 'B is right.', topic: null })), 'Campus Bot B is right.')

  assert.equal(text(show({ status: 'not-covered' })), 'Campus Bot The study guide for this course doesn’t cover this question.')
  const unchecked = show({ status: 'check-failed', topic: { number: 5, title: 'Break-even' } })
  assert.equal(text(unchecked), 'Campus Bot This question is from Break-even. Open study guide')
  assert.deepEqual(links(unchecked), [['/courses/principles-economics-1/notes/5', 'Open study guide']])
  assert.equal(text(show({ status: 'check-failed', topic: null })), 'Campus Bot The study guide for this course doesn’t cover this question.')

  const panel = renderToStaticMarkup(h(ExplainPanel, { attemptId: 'a', questionId: 'q', continuityToken: 't',
    courseHref: '/courses/x', ...HREFS }))
  assert.deepEqual(buttons(panel), ['Explain'])
  assert.doesNotMatch(panel, /<button[^>]* disabled=""/)
}))

const graded = (selected, extra = {}) => ({ questionId: '11111111-1111-4111-8111-111111111111', itemId: 'i', revision: 1,
  prompt: 'What happens to quantity demanded when price rises?', options: ['It rises', 'It falls'], section: 'Demand',
  selected, correctOption: 1, explanation: 'The law of demand.', ...extra })
const WIRING = { attemptId: 'attempt-1', continuityToken: 'page-token', courseHref: '/courses/x', ...HREFS }

test('answer review: Explain sits under the official answer of every question of a graded exam, answered or left out, and only when switched on', async () => withTsx(async () => {
  const { ReviewCard, reviewStatus } = require('./[slug]/quiz/ReviewCard.tsx')
  const card = (question, props = {}) => renderToStaticMarkup(h('ol', null, h(ReviewCard, { question, n: 1,
    status: reviewStatus(question), open: true, reported: false, onToggle() {}, onReport() {}, ...props })))
  for (const selected of [0, 1, null]) {
    assert.ok(buttons(card(graded(selected), { explain: WIRING })).includes('Explain'), `selected ${selected}`)
  }
  const on = card(graded(0), { explain: WIRING })
  assert.ok(on.indexOf('The law of demand.') < on.indexOf('>Explain<'), 'after the official explanation')
  assert.ok(on.indexOf('>Explain<') < on.indexOf('Report a question'))
  assert.equal(buttons(card(graded(0), { explain: null })).includes('Explain'), false)
  assert.equal(buttons(card(graded(0))).includes('Explain'), false, 'a caller that passes nothing shows no button')
  assert.equal(buttons(card(graded(0), { explain: WIRING, open: false })).includes('Explain'), false, 'a closed card shows no button')
}))

test('topic practice: Explain appears only once a question is answered, and only when switched on', async () => withTsx(async () => {
  const { InstantAttempt } = require('./[slug]/quiz/InstantAttempt.tsx')
  const question = (id, feedback) => ({ questionId: id, prompt: `Question ${id}`, options: ['A1', 'B1'], section: 'Demand',
    ...(feedback ? { feedback } : {}) })
  const attempt = questions => ({ status: 'in_progress', id: 'attempt-1', courseId: 'c', mode: 'instant', topic: 'Demand', intent: 'new',
    redoOf: null, startedAt: '2026-11-16T09:00:00Z', deadlineAt: '2026-11-16T12:00:00Z', durationSeconds: 10800,
    questionCount: questions.length, bankSize: 20, questions, saved: { revision: 0, answers: {} } })
  const render = (questions, explainAvailable) => renderToStaticMarkup(h(InstantAttempt, { continuityToken: 't', courseCode: 'ECO101',
    courseTitle: 'Economics', repositoryOnly: false, topicsHref: '/courses/x/practice', coursePageHref: '/courses/x',
    attempt: attempt(questions), onGraded() {}, explainAvailable }))
  const answered = { selected: 0, correctOption: 1, explanation: 'Because.' }
  // The first question not yet answered is the one on screen: nothing to explain yet.
  assert.equal(buttons(render([question('q1', answered), question('q2')], true)).includes('Explain'), false)
  // Every question answered: the last one is on screen with its result, and Explain under its Why.
  const done = render([question('q1', answered), question('q2', answered)], true)
  assert.ok(buttons(done).includes('Explain'))
  assert.ok(done.indexOf('Because.') < done.indexOf('>Explain<'))
  assert.equal(buttons(render([question('q1', answered), question('q2', answered)], false)).includes('Explain'), false)
  assert.equal(buttons(render([question('q1', answered), question('q2', answered)])).includes('Explain'), false)
}))

test('Ask Campus Bot: the button, then the chat — each turn under its name, an answer from outside the notes says so first', async () => withTsx(async () => {
  const { AskCampusBot, ChatLog } = require('./[slug]/notes/AskCampusBot.tsx')
  const closed = renderToStaticMarkup(withRouter(h(AskCampusBot, { courseSlug: 'x', itemId: 'i', topicTitle: 'Demand',
    continuityToken: 't', offers: { flashcards: true, quiz: true }, ...HREFS })))
  assert.deepEqual(buttons(closed), ['Ask a question'], 'closed, the page shows the one button and nothing of the chat')
  // Its place on a topic page: one area labelled Campus Bot, each feature a child, a wide child on a row of its own.
  const { CampusBotArea } = require(path.join(root, 'components/student/CampusBotArea.tsx'))
  const area = renderToStaticMarkup(h(CampusBotArea, null, h('button', { type: 'button' }, 'Ask a question'),
    h('button', { type: 'button' }, 'Quiz me on this topic'), h('p', { className: 'student-campus-bot-wide' }, 'Writing…')))
  assert.match(area, /^<section class="student-campus-bot-area" aria-labelledby="campus-bot-area-title"><h2 id="campus-bot-area-title" class="student-campus-bot-area-title">Campus Bot<\/h2><div class="student-campus-bot-actions">/)
  assert.deepEqual(buttons(area), ['Ask a question', 'Quiz me on this topic'])

  const turns = [{ id: '1', role: 'student', text: 'What is demand?' },
    { id: '2', role: 'bot', text: 'Your notes say <i>it falls</i> as price rises.', inNotes: true },
    { id: '3', role: 'student', text: 'And GDP?' }, { id: '4', role: 'bot', text: 'In general, it is total output.', inNotes: false }]
  const log = props => renderToStaticMarkup(h(ChatLog, { turns, answering: false, problem: null, ...HREFS, ...props }))
  assert.equal(text(log()), 'You What is demand? Campus Bot Your notes say &lt;i&gt;it falls&lt;/i&gt; as price rises. '
    + 'You And GDP? Campus Bot This isn’t covered in this study guide topic. In general, it is total output.')
  assert.doesNotMatch(log(), /<i>/, 'a reply is text, never HTML')
  assert.equal((log().match(/This isn’t covered in this study guide topic\./g) ?? []).length, 1)
  assert.match(text(log({ answering: true })), /Campus Bot is answering…$/)
  assert.match(text(log({ problem: { status: 'limit', limit: 'pass', resetsAt: null } })), /You’ve used your free pass messages\. Plan & Access$/)
  assert.deepEqual(buttons(log({ problem: { status: 'failed' }, onRetry() {} })), ['Try again'])
}))

test('Ask Campus Bot marks an answer (mock 8): the badge, the memory trick, Quick check then Try another, and the field', async () => withTsx(async () => {
  const { ChatForm, ChatLog } = require('./[slug]/notes/AskCampusBot.tsx')
  const asked = { id: '2', role: 'bot', text: 'A statistic describes a sample.', inNotes: true, verdict: 'none',
    check: 'What does a parameter describe?', memoryTrick: null }
  const turns = [{ id: '1', role: 'student', text: 'Ask me a quick question.' }, asked]
  const log = list => renderToStaticMarkup(h(ChatLog, { turns: list, answering: false, problem: null, ...HREFS }))
  // The check question is a bubble of its own under the reply, labelled Quick check, with no badge.
  assert.equal(text(log(turns)), 'You Ask me a quick question. Campus Bot A statistic describes a sample. '
    + 'Quick check What does a parameter describe?')
  // Its label is the practice eyebrow, in the signal blue; the names are for screen readers only.
  assert.match(log(turns), /<\/p><\/div><div class="student-ask-turn" data-role="bot" data-kind="check"><p class="student-practice-eyebrow student-ask-eyebrow">Quick check<\/p>/)
  assert.match(log(turns), /<p class="student-ask-who sr-only">You<\/p>.*<p class="student-ask-who sr-only">Campus Bot<\/p>/)
  assert.doesNotMatch(log(turns), /data-verdict=/)

  // A wrong answer: the Not quite badge (an x icon and the word), "The answer is …", the memory trick, then Try another.
  const wrong = { id: '4', role: 'bot', text: 'The answer is the **population**. A parameter describes all of it.', inNotes: true,
    verdict: 'not-quite', check: 'Is 31 a **parameter** or a **statistic**?',
    memoryTrick: '**S**tatistic goes with **S**ample, **P**arameter goes with **P**opulation.' }
  const marked = log([...turns, { id: '3', role: 'student', text: 'A sample' }, wrong])
  assert.match(text(marked.replace(/<\/?strong>/g, '')), /Campus Bot Not quite The answer is the population\. A parameter describes all of it\. Memory trick: Statistic goes with Sample, Parameter goes with Population\. Try another Is 31 a parameter or a statistic\?$/)
  // The card carries the verdict; the pill holds the icon and the word.
  assert.match(marked, /<div class="student-ask-turn" data-role="bot" data-verdict="not-quite"><p class="student-ask-who sr-only">Campus Bot<\/p><p class="student-ask-badge" data-verdict="not-quite"><svg[^>]*stroke-width="1.75"[^>]*class="lucide lucide-circle-x" aria-hidden="true">.*?<\/svg>Not quite<\/p>/)
  // "The answer is …" is a paragraph of its own; key words are <strong> elements; the memory trick's label is plain.
  assert.match(marked, /<p class="student-ask-text">The answer is the <strong>population<\/strong>\.<\/p><p class="student-ask-text">A parameter describes all of it\.<\/p>/)
  assert.match(marked, /<p class="student-ask-text">Memory trick: <strong>S<\/strong>tatistic goes with <strong>S<\/strong>ample/)
  assert.match(marked, /<p class="student-ask-text">Is 31 a <strong>parameter<\/strong> or a <strong>statistic<\/strong>\?<\/p>/)
  assert.doesNotMatch(marked, /\*\*/, 'no marker is ever shown')
  // A right answer: the Correct pill with a check icon.
  const right = log([{ ...wrong, verdict: 'correct', text: 'A parameter describes the whole population.', memoryTrick: null, check: null }])
  assert.match(right, /data-verdict="correct"><svg[^>]*width="16"[^>]*stroke-width="1.75"[^>]*class="lucide lucide-circle-check" aria-hidden="true">.*?<\/svg>Correct<\/p>/)
  assert.equal(text(right), 'Campus Bot Correct A parameter describes the whole population.')

  // "Not covered" shows only on an unmarked reply the notes don't cover, never on a reply to the check question.
  const outside = 'This isn’t covered in this study guide topic.'
  assert.match(text(log([{ ...asked, inNotes: false, check: null }])), new RegExp(`^Campus Bot ${outside}`))
  assert.doesNotMatch(text(log([{ ...wrong, inNotes: false }])), new RegExp(outside))
  assert.doesNotMatch(text(log([{ ...wrong, verdict: 'correct', inNotes: false }])), new RegExp(outside))
  // A reply kept from before replies were marked reads as it always did.
  assert.equal(text(log([{ id: '9', role: 'bot', text: 'Kept.', inNotes: false }])), `Campus Bot ${outside} Kept.`)

  // The field asks for the answer while the latest Campus Bot turn has a check question; its label says the same.
  const form = list => renderToStaticMarkup(h(ChatForm, { turns: list, topicTitle: 'Sampling', draft: '', closed: false,
    answering: false, onDraft() {}, onSubmit() {} }))
  const field = html => [html.match(/<label[^>]*>([^<]*)<\/label>/)[1], html.match(/placeholder="([^"]*)"/)[1]]
  assert.deepEqual(field(form(turns)), ['Type your answer…', 'Type your answer…'])
  assert.deepEqual(field(form([...turns, { id: '3', role: 'student', text: 'A sample' }])), ['Type your answer…', 'Type your answer…'])
  assert.deepEqual(field(form([...turns, { id: '3', role: 'student', text: 'A sample' }, { ...wrong, check: null }])),
    ['Ask about Sampling', 'Ask about Sampling'])
  assert.deepEqual(field(form([])), ['Ask about Sampling', 'Ask about Sampling'])
  // Send is mock 8's shape with the library's send icon, 20px at stroke 1.75, named Send.
  assert.match(form(turns), /<button type="submit" class="student-ask-send student-focus-dark" aria-label="Send"( disabled="")?><svg[^>]*width="20"[^>]*stroke-width="1.75"[^>]*class="lucide lucide-send" aria-hidden="true">/)
  // Text from a model never becomes markup: a tag in a reply is shown as its characters.
  const unsafe = log([{ id: '7', role: 'bot', text: 'A **<img src=x onerror=alert(1)>** tag.', inNotes: true, verdict: 'none' }])
  assert.match(unsafe, /<strong>&lt;img src=x onerror=alert\(1\)&gt;<\/strong>/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '[slug]/notes/AskCampusBot.tsx'), 'utf8'), /dangerouslySetInnerHTML/)
}))

test('Ask Campus Bot sends each Campus Bot turn with its check question, and shows the marked reply it gets', async () => withTsx(async () => {
  const source = fs.readFileSync(path.join(__dirname, '[slug]/notes/AskCampusBot.tsx'), 'utf8')
  assert.match(source, /check: turn\.check\.slice\(0, CHAT_LIMITS\.checkChars\)/)
  assert.match(source, /verdict: result\.verdict, check: result\.check, memoryTrick: result\.memoryTrick/)
  assert.doesNotMatch(source, /checkAnswer/, 'the page never has the check question’s answer')
}))

// The buttons under Campus Bot's newest turn and its flashcards (owner decisions B5 and B6, mock 8).
const CARDS = [{ term: 'Statistic', meaning: 'A number that describes a sample.' },
  { term: 'Parameter', meaning: 'A number that describes a whole population.' },
  { term: 'Sample', meaning: 'The part of a population that is studied.' },
  { term: 'Population', meaning: 'Every member of the group being studied.' }]
const OFFERS = { flashcards: true, quiz: true }

test('the new chat lines, word for word, and no others', () => {
  const { CAMPUS_BOT_COPY: copy } = require(path.join(root, 'lib/campus-bot/copy.ts'))
  assert.equal(copy.explainAgain, 'Explain again')
  assert.equal(copy.makeFlashcards, 'Make flashcards')
  const { position, ...lines } = copy.flashcards
  assert.deepEqual(lines, { heading: 'Flashcards', hint: 'Tap a card to flip it.', term: 'Term', meaning: 'Meaning',
    previous: 'Previous', next: 'Next', making: 'Campus Bot is making your flashcards…',
    failed: 'Campus Bot couldn’t make your flashcards.', failedNoRetry: 'Campus Bot couldn’t make your flashcards. Try again.' })
  assert.equal(position(3, 10), '3 of 10')
  // "Quiz me on this topic" in the chat is the area's own button's words.
  assert.equal(copy.quiz.start, 'Quiz me on this topic')
})

test('the buttons under the newest turn: when each shows, in mock 8’s order, and when none does', async () => withTsx(async () => {
  const { chatOffers } = require('./[slug]/notes/ChatOffers.tsx')
  const reply = { id: '2', role: 'bot', text: 'A statistic describes a sample.', inNotes: true, verdict: 'none', check: null }
  const asked = [{ id: '1', role: 'student', text: 'What is a statistic?' }]
  assert.deepEqual(chatOffers([], OFFERS), ['flashcards', 'quiz'], 'an empty chat: Make flashcards, then Quiz me')
  assert.deepEqual(chatOffers([...asked, reply], OFFERS), ['explain-again', 'flashcards', 'quiz'],
    'after a Campus Bot reply: Explain again, Make flashcards, then Quiz me')
  assert.deepEqual(chatOffers([...asked, { ...reply, check: 'What does a parameter describe?' }], OFFERS),
    ['explain-again', 'flashcards', 'quiz'], 'a reply with its Quick check is still a reply to explain again')
  assert.deepEqual(chatOffers([...asked, { ...reply, text: 'Here’s one.', check: 'What does a parameter describe?' }], OFFERS),
    ['flashcards', 'quiz'], 'but not one that only introduces its Quick check')
  const flashcards = [...asked, reply, { id: '3', role: 'student', text: 'Make flashcards', action: 'flashcards' },
    { id: '4', role: 'bot', text: '', cards: CARDS }]
  assert.deepEqual(chatOffers(flashcards, OFFERS), ['quiz'], 'after flashcards: Quiz me only')
  assert.deepEqual(chatOffers(asked, OFFERS), [], 'never under the student’s own turn')
  // A button whose offer is off is not shown.
  assert.deepEqual(chatOffers([], { flashcards: false, quiz: true }), ['quiz'])
  assert.deepEqual(chatOffers([...asked, reply], { flashcards: false, quiz: false }), ['explain-again'])
  assert.deepEqual(chatOffers(flashcards, { flashcards: true, quiz: false }), [])
  // Nothing while something is being written or a notice is showing.
  assert.deepEqual(chatOffers([...asked, reply], OFFERS, true), [])
  assert.deepEqual(chatOffers([], OFFERS, true), [])
}))

test('the buttons look like mock 8’s pills: the area’s ghost button, in a row that wraps, each its action’s words', async () => withTsx(async () => {
  const { ChatOffers } = require('./[slug]/notes/ChatOffers.tsx')
  const html = renderToStaticMarkup(h(ChatOffers, { offers: ['explain-again', 'flashcards', 'quiz'], onPick() {} }))
  assert.deepEqual(buttons(html), ['Explain again', 'Make flashcards', 'Quiz me on this topic'])
  assert.match(html, /^<div class="student-ask-offers"><button type="button" class="[^"]*student-ask-pill[^"]*">/)
  // The area's ghost button: at least 44px high (min-h-11), its focus ring, never filled navy or orange.
  for (const [, classes] of html.matchAll(/<button type="button" class="([^"]*)"/g)) {
    assert.match(classes, /min-h-11/)
    assert.match(classes, /student-focus-control/)
    assert.match(classes, /bg-student-surface/)
    assert.doesNotMatch(classes, /bg-student-primary|accent|orange/)
  }
  assert.equal(renderToStaticMarkup(h(ChatOffers, { offers: [], onPick() {} })), '', 'no buttons, no row')
  // Fix round D9: the buttons live in a file of their own, and the chat stays within AGENTS.md's 300 lines.
  assert.ok(fs.readFileSync(path.join(__dirname, '[slug]/notes/AskCampusBot.tsx'), 'utf8').split('\n').length <= 300)
  const css = fs.readFileSync(path.join(root, 'styles/campus-bot.css'), 'utf8')
  assert.match(css, /\.student-ask-offers \{ display: flex; flex-wrap: wrap; gap: 8px;/)
  assert.match(css, /\.student-ask-sheet \.student-ask-pill \{ border-radius: var\(--ci-radius-pill\); \}/)
}))

test('the history sent with a message leaves out flashcards and the turn that asked for them', async () => withTsx(async () => {
  const { chatHistory } = require('./[slug]/notes/AskCampusBot.tsx')
  const turns = [{ id: '1', role: 'student', text: 'What is a statistic?' },
    { id: '2', role: 'bot', text: 'It describes a sample.', check: 'What does a parameter describe?' },
    { id: '3', role: 'student', text: 'Make flashcards', action: 'flashcards' },
    { id: '4', role: 'bot', text: '', cards: CARDS },
    { id: '5', role: 'student', text: 'Explain again', action: 'explain-again' },
    { id: '6', role: 'bot', text: 'Put simply, a sample is part of the group.', check: null }]
  assert.deepEqual(chatHistory(turns), [{ role: 'student', text: 'What is a statistic?' },
    { role: 'bot', text: 'It describes a sample.', check: 'What does a parameter describe?' },
    { role: 'student', text: 'Explain again' }, { role: 'bot', text: 'Put simply, a sample is part of the group.' }])
  // A Quick check asked before the flashcards still waits for its answer, as the server reads it.
  const { awaitingAnswer } = require('./[slug]/notes/AskCampusBot.tsx')
  assert.equal(awaitingAnswer(turns.slice(0, 4)), true)
  assert.equal(awaitingAnswer(turns), false)
  const source = fs.readFileSync(path.join(__dirname, '[slug]/notes/AskCampusBot.tsx'), 'utf8')
  assert.match(source, /const history = message\.action === 'flashcards' \? \[\] : chatHistory\(earlier\)/,
    'Make flashcards sends no turns at all: the cards are written from the notes alone')
}))

test('a flashcards turn (mock 8): the eyebrow and hint, one card as a single button, then Previous, its place and Next', async () => withTsx(async () => {
  const { FlashcardsView } = require('./[slug]/notes/ChatFlashcards.tsx')
  const view = state => renderToStaticMarkup(h(FlashcardsView, { cards: CARDS, state, announcement: '', onFlip() {}, onMove() {} }))
  const first = view({ index: 0, side: 'term' })
  assert.match(first, /^<p class="student-practice-eyebrow student-ask-eyebrow">Flashcards<\/p><p class="student-ask-text">Tap a card to flip it\.<\/p>/)
  // One button holds both sides; only the side showing is read out.
  assert.match(first, /<button type="button" class="student-flashcard" data-side="term"><span class="student-flashcard-inner"><span class="student-flashcard-face" data-face="term" aria-hidden="false"><span class="student-flashcard-eyebrow">Term<\/span><span class="student-flashcard-term">Statistic<\/span><\/span><span class="student-flashcard-face" data-face="meaning" aria-hidden="true"><span class="student-flashcard-eyebrow">Meaning<\/span><span class="student-flashcard-meaning">A number that describes a sample\.<\/span><\/span><\/span><\/button>/)
  assert.match(first, /<p class="sr-only" aria-live="polite"><\/p>/, 'the new side is announced politely, and nothing before a move')
  assert.equal(text(first.slice(first.indexOf('student-flashcards-nav'))).replace(/^[^>]*> /, ''), 'Previous 1 of 4 Next')
  assert.match(first, /<button type="button" class="[^"]*" disabled="">Previous<\/button>/, 'Previous is disabled on the first card')
  assert.doesNotMatch(first, /disabled="">Next/)
  const flipped = view({ index: 3, side: 'meaning' })
  assert.match(flipped, /data-side="meaning"/)
  assert.match(flipped, /data-face="term" aria-hidden="true"><span class="student-flashcard-eyebrow">Term<\/span><span class="student-flashcard-term">Population/)
  assert.match(flipped, /data-face="meaning" aria-hidden="false">/)
  assert.match(text(flipped), /Previous 4 of 4 Next$/)
  assert.match(flipped, /<button type="button" class="[^"]*" disabled="">Next<\/button>/, 'Next is disabled on the last card')
  assert.doesNotMatch(flipped, /disabled="">Previous/)
  // Text only: a card's words are never markup, and never bold.
  const unsafe = renderToStaticMarkup(h(FlashcardsView, { cards: [{ term: '<b>x</b>', meaning: '**y**' }, ...CARDS],
    state: { index: 0, side: 'term' }, announcement: '', onFlip() {}, onMove() {} }))
  assert.match(unsafe, /&lt;b&gt;x&lt;\/b&gt;/)
  assert.doesNotMatch(unsafe, /<strong>|<b>/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '[slug]/notes/ChatFlashcards.tsx'), 'utf8'), /dangerouslySetInnerHTML/)
}))

test('flip, Previous and Next: a tap turns the card, a move shows the next card’s term, and the ends stay put', async () => withTsx(async () => {
  const { flashcardsAnnouncement, flashcardsStep } = require('./[slug]/notes/ChatFlashcards.tsx')
  const start = { index: 0, side: 'term' }
  assert.deepEqual(flashcardsStep(start, 'flip', 4), { index: 0, side: 'meaning' })
  assert.deepEqual(flashcardsStep({ index: 0, side: 'meaning' }, 'flip', 4), start)
  assert.deepEqual(flashcardsStep({ index: 0, side: 'meaning' }, 'next', 4), { index: 1, side: 'term' },
    'moving to a card shows its term side')
  assert.deepEqual(flashcardsStep({ index: 2, side: 'meaning' }, 'previous', 4), { index: 1, side: 'term' })
  assert.equal(flashcardsStep(start, 'previous', 4), start, 'nothing before the first card')
  const last = { index: 3, side: 'meaning' }
  assert.equal(flashcardsStep(last, 'next', 4), last, 'nor after the last')
  assert.equal(flashcardsAnnouncement(CARDS, { index: 0, side: 'meaning' }, 'flip'), 'Meaning: A number that describes a sample.')
  assert.equal(flashcardsAnnouncement(CARDS, { index: 1, side: 'term' }, 'next'), '2 of 4. Term: Parameter')
  // The card keeps focus when it flips (the button is never replaced), and takes it when Previous or Next is disabled.
  const source = fs.readFileSync(path.join(__dirname, '[slug]/notes/ChatFlashcards.tsx'), 'utf8')
  assert.match(source, /<span key=\{state\.index\} className="student-flashcard-inner">/)
  assert.match(source, /if \(step !== 'flip' && \(next\.index === 0 \|\| next\.index === cards\.length - 1\)\) card\.current\?\.focus\(\)/)
}))

test('the flip is at most 250ms, none with reduced motion, never moves what is below, and keeps both borders in forced colours', () => {
  const css = fs.readFileSync(path.join(root, 'styles/campus-bot.css'), 'utf8')
  assert.match(css, /\.student-flashcard-inner \{[^}]*transition: transform 250ms ease;/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\n  \.student-flashcard-inner \{ transition: none; \}\n\}/)
  // Both sides share one grid cell, so the card is as tall as its taller side whichever is showing.
  assert.match(css, /\.student-flashcard-face \{ grid-area: 1 \/ 1;/)
  // Mock 8's sides in our tokens: signal blue with white text, then white with a 2px signal-blue border. Never orange.
  assert.match(css, /\.student-flashcard-face\[data-face='term'\] \{ color: var\(--student-primary-text\); background: var\(--student-signal\); \}/)
  assert.match(css, /\.student-flashcard-face\[data-face='meaning'\] \{ color: var\(--student-text-primary\); background: var\(--student-elevated-surface\);/)
  assert.match(css, /\.student-flashcard-face \{[^}]*border: 2px solid var\(--student-signal\);/)
  assert.match(css, /\.student-flashcard-term \{ font-size: 20px; font-weight: 700;/)
  assert.match(css, /@media \(forced-colors: active\) \{[^@]*\.student-flashcard-face \{ border: 2px solid CanvasText; \}/)
  assert.match(css, /\.student-flashcard:focus-visible \{ outline: 3px solid var\(--student-focus\); outline-offset: 3px; \}/)
  const flashcardRules = css.split('\n').filter(line => line.includes('flashcard')).join('\n')
  assert.doesNotMatch(flashcardRules, /orange|accent/)
})

test('the chat log: the flashcards turn, the flashcards wait and failure lines, and the quiz’s wait and notice', async () => withTsx(async () => {
  const { ChatLog } = require('./[slug]/notes/AskCampusBot.tsx')
  const log = props => renderToStaticMarkup(h(ChatLog, { turns: [], answering: false, problem: null, ...HREFS, ...props }))
  const turns = [{ id: '1', role: 'student', text: 'Make flashcards', action: 'flashcards' },
    { id: '2', role: 'bot', text: '', cards: CARDS }]
  const shown = log({ turns })
  assert.match(shown, /<div class="student-ask-turn" data-role="bot" data-kind="flashcards"><p class="student-ask-who sr-only">Campus Bot<\/p><p class="student-practice-eyebrow student-ask-eyebrow">Flashcards<\/p>/)
  assert.match(text(shown), /^You Make flashcards Campus Bot Flashcards Tap a card to flip it\. Term Statistic Meaning A number that describes a sample\. Previous 1 of 4 Next$/)
  assert.equal(text(log({ answering: true, action: 'flashcards' })), 'Campus Bot is making your flashcards…')
  assert.equal(text(log({ answering: true, action: 'explain-again' })), 'Campus Bot is answering…')
  assert.equal(text(log({ answering: true })), 'Campus Bot is answering…')
  const failed = log({ problem: { status: 'failed' }, action: 'flashcards', onRetry() {} })
  assert.deepEqual([text(failed), buttons(failed)], ['Campus Bot couldn’t make your flashcards. Try again', ['Try again']])
  assert.equal(text(log({ problem: { status: 'not-found' }, action: 'flashcards', onRetry() {} })),
    'Campus Bot couldn’t make your flashcards. Try again.', 'with nothing to retry, the line says it')
  assert.equal(text(log({ problem: { status: 'failed' }, action: 'explain-again', onRetry() {} })),
    'Campus Bot couldn’t answer that. Try again', 'Explain again fails as any message does')
  assert.equal(text(log({ quiz: { writing: true, problem: null } })), 'Campus Bot is writing your questions…')
  const quizFailed = log({ quiz: { writing: false, problem: { status: 'failed' } }, onQuizRetry() {} })
  assert.deepEqual([text(quizFailed), buttons(quizFailed)], ['We couldn’t create your questions. Try again', ['Try again']])
}))

test('flashcards’ states: their own failure line, the free pass’s messages line, and everything else as Ask', async () => withTsx(async () => {
  const { CampusBotStatus } = require(path.join(root, 'components/student/CampusBotStatus.tsx'))
  const show = (problem, onRetry) => renderToStaticMarkup(h(CampusBotStatus, { problem, feature: 'flashcards', onRetry, ...HREFS }))
  const ask = (problem, onRetry) => renderToStaticMarkup(h(CampusBotStatus, { problem, feature: 'ask', onRetry, ...HREFS }))
  for (const status of ['failed', 'unavailable']) {
    assert.deepEqual([text(show({ status }, () => {})), buttons(show({ status }, () => {}))],
      ['Campus Bot couldn’t make your flashcards. Try again', ['Try again']], status)
  }
  for (const status of ['not-found', 'invalid-request']) {
    assert.equal(text(show({ status }, () => {})), 'Campus Bot couldn’t make your flashcards. Try again.', status)
  }
  assert.equal(text(show({ status: 'limit', limit: 'pass', resetsAt: null })), 'You’ve used your free pass messages. Plan & Access')
  const at = '2026-11-16T09:05:00Z'
  for (const problem of [{ status: 'limit', limit: 'session', resetsAt: at }, { status: 'limit', limit: 'week', resetsAt: at },
    { status: 'limit', limit: 'undelivered', resetsAt: null }, { status: 'busy' }, { status: 'in-progress' },
    { status: 'exam-open' }, { status: 'signed-out' }, { status: 'session-changed' }, { status: 'not-entitled', notice: 'plan' },
    { status: 'locked', plansOnSale: true }, { status: 'disabled' }]) {
    assert.equal(show(problem, () => {}), ask(problem, () => {}), JSON.stringify(problem))
  }
}))

test('Quiz me in the chat is the area’s Quiz me: the same request ids for the topic, then the set’s page', async () => withTsx(async () => {
  const source = fs.readFileSync(path.join(__dirname, '[slug]/notes/AskCampusBot.tsx'), 'utf8')
  assert.match(source, /import \{ DEFAULT_DEPS as DEFAULT_QUIZ_DEPS, runQuiz \} from '\.\/QuizMe'/)
  assert.match(source, /quizDeps = DEFAULT_QUIZ_DEPS/)
  assert.match(source, /router\.push\(topicSetPath\(courseSlug, result\.setId\)\)/)
  // Switched off since the page loaded: the chat stops offering Quiz me, as the area hides its button.
  assert.match(source, /if \(result\.status === 'disabled'\) setQuizOff\(true\)/)
  assert.match(source, /quiz: offers\.quiz && !quizOff/)
  const { DEFAULT_DEPS, runQuiz } = require('./[slug]/notes/QuizMe.tsx')
  assert.equal(DEFAULT_DEPS.store, undefined, 'the tab’s session storage, which the area’s button keeps its ids in too')
  // A tap in the area and one in the chat, sharing the tab's store, repeat one request: never two sets.
  const store = new Map()
  const tab = { getItem: key => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value) },
    removeItem: key => { store.delete(key) } }
  const sent = []
  let next = 0
  const deps = { send: async command => { sent.push(command.requestId); return { status: 'in-progress' } },
    newId: () => `85000000-0000-4000-8000-00000000000${++next}`, store: tab, wait: async () => {} }
  const topic = { courseSlug: 'x', itemId: '83000000-0000-4000-8000-000000000001' }
  let calls = 0
  const once = () => ++calls <= 1
  await runQuiz(topic, 't', deps, once, new Map())
  calls = 0
  await runQuiz(topic, 't', deps, once, new Map())
  assert.deepEqual(sent, ['85000000-0000-4000-8000-000000000001', '85000000-0000-4000-8000-000000000001'])
}))

test('fix round 4 (3A): Explain again with a question waiting ends it: no Quick check under the explanation, the normal field', async () => withTsx(async () => {
  const { awaitingAnswer, chatHistory, ChatLog, ChatForm } = require('./[slug]/notes/AskCampusBot.tsx')
  // Run 4, Listening Skills (rows 55 and 56): a question waits, then Explain again; the server returns no check question.
  const psychological = 'Which person does the psychological condition concern: the lecturer or the listener?'
  const explanation = 'Listening can be hurt by three things. The **physical** problem is the room, like noise or bad air.'
  const trick = '**P**hysical is the room, **P**hysiological is the lecturer, **P**sychological is the listener.'
  const waiting = [{ id: '1', role: 'student', text: 'physiological' },
    { id: '2', role: 'bot', text: 'The answer is **physical**.', verdict: 'not-quite', check: psychological }]
  const turns = [...waiting, { id: '3', role: 'student', text: 'Explain again', action: 'explain-again' },
    { id: '4', role: 'bot', text: explanation, inNotes: true, verdict: 'none', check: null, memoryTrick: trick }]
  assert.deepEqual([awaitingAnswer(waiting), awaitingAnswer(turns)], [true, false], 'the question no longer waits')
  const form = turnsNow => renderToStaticMarkup(h(ChatForm, { turns: turnsNow, topicTitle: 'Listening Skills', draft: '',
    closed: false, answering: false, onDraft() {}, onSubmit() {} }))
  assert.match(form(waiting), /placeholder="Type your answer…"/)
  assert.match(form(turns), /placeholder="Ask about Listening Skills"/)
  const last = renderToStaticMarkup(withRouter(h(ChatLog, { turns: turns.slice(3), answering: false, problem: null, ...HREFS })))
  assert.doesNotMatch(last, /Quick check|Try another|data-kind="check"/)
  assert.match(last, /The <strong>physical<\/strong> problem is the room/)
  // The next message goes as an ordinary one: the explanation travels with no check question.
  assert.deepEqual(chatHistory(turns).at(-1), { role: 'bot', text: explanation })
  // No hidden carry: a turn has no waiting question of its own.
  const source = fs.readFileSync(path.join(__dirname, '[slug]/notes/AskCampusBot.tsx'), 'utf8')
  assert.doesNotMatch(source, /waitingQuestion|turn\.waiting|waiting\?:/)
}))
