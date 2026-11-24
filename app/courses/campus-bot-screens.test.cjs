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

test('the approved lines, word for word', () => {
  const { CAMPUS_BOT_COPY: copy } = require(path.join(root, 'lib/campus-bot/copy.ts'))
  assert.equal(copy.name, 'Campus Bot')
  assert.equal(copy.explain, 'Explain')
  assert.equal(copy.explaining, 'Campus Bot is explaining…')
  assert.equal(copy.fromNotes, 'From your notes:')
  assert.equal(copy.notCovered, 'The notes for this course don’t cover this question.')
  assert.equal(copy.checkFailed('Demand'), 'This question is from Demand.')
  assert.equal(copy.openNotes, 'Open notes')
  assert.equal(copy.explainFailed, 'Campus Bot couldn’t explain this. Try again.')
  assert.equal(copy.ask, 'Ask a question')
  assert.equal(copy.askPlaceholder('Demand'), 'Ask about Demand')
  assert.equal(copy.send, 'Send')
  assert.equal(copy.answering, 'Campus Bot is answering…')
  assert.equal(copy.you, 'You')
  assert.equal(copy.outsideNotes, 'This isn’t covered in this topic’s notes.')
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
  assert.match(text(explained), /From your notes: Demand$/)
  assert.deepEqual(links(explained), [['/courses/principles-economics-1/notes/3', 'Demand']])
  assert.doesNotMatch(explained, /<img|<b>/, 'markup in a reply is shown as its characters, never as HTML')
  assert.match(explained, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.match(explained, /aria-label="Campus Bot"/)
  assert.equal(text(show({ status: 'explained', text: 'B is right.', topic: null })), 'Campus Bot B is right.')

  assert.equal(text(show({ status: 'not-covered' })), 'Campus Bot The notes for this course don’t cover this question.')
  const unchecked = show({ status: 'check-failed', topic: { number: 5, title: 'Break-even' } })
  assert.equal(text(unchecked), 'Campus Bot This question is from Break-even. Open notes')
  assert.deepEqual(links(unchecked), [['/courses/principles-economics-1/notes/5', 'Open notes']])
  assert.equal(text(show({ status: 'check-failed', topic: null })), 'Campus Bot The notes for this course don’t cover this question.')

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
  const closed = renderToStaticMarkup(h(AskCampusBot, { courseSlug: 'x', itemId: 'i', topicTitle: 'Demand', continuityToken: 't', ...HREFS }))
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
    + 'You And GDP? Campus Bot This isn’t covered in this topic’s notes. In general, it is total output.')
  assert.doesNotMatch(log(), /<i>/, 'a reply is text, never HTML')
  assert.equal((log().match(/This isn’t covered in this topic’s notes\./g) ?? []).length, 1)
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
  const outside = 'This isn’t covered in this topic’s notes.'
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
