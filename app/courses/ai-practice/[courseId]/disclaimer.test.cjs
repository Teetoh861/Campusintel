// app/courses/ai-practice/[courseId]/disclaimer.test.cjs — The one Campus Bot label on every personal set (and only on
// a set), and the one line that says where Campus Bot opens: the free month when this student can claim it.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { PERSONAL_PRACTICE_DISCLAIMER } = require('../../../../lib/ai-practice/contract.ts')

function load(file) {
  const previous = Module._extensions['.tsx'], original = Module._load
  Module._extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true } }).outputText, filename)
  // The free month button asks the router to read the page again; these renders mount no router.
  Module._load = function(name, ...args) {
    if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) }
    return original.call(this, name, ...args)
  }
  try { return require(file) } finally { Module._extensions['.tsx'] = previous; Module._load = original }
}

const { AiPracticeClient, JourneyProgress, allowanceLine } = load('./AiPracticeClient.tsx')
const { PersonalPractice } = load('./PersonalPractice.tsx')
const question = index => ({ id: `ai_${String(index).repeat(24)}`, prompt: `Question ${index}?`,
  options: ['A', 'B', 'C', 'D'], correctOption: 1, explanation: 'Because.', section: 'Pricing', sourceQuote: 'quote' })
const set = { generationId: 'g1', createdAt: '2026-10-16T10:00:00.000Z', fileName: 'notes.pdf',
  questions: [question(1), question(2)] }
const html = element => renderToStaticMarkup(element).replace(/&#x27;/g, "'")

test('the Campus Bot label is shown while answering a personal set', () => {
  const markup = html(React.createElement(PersonalPractice, { set, onClose: () => undefined }))
  assert.equal(PERSONAL_PRACTICE_DISCLAIMER, 'Made by Campus Bot from your notes.')
  assert.ok(markup.includes(PERSONAL_PRACTICE_DISCLAIMER), 'the label is rendered verbatim')
  assert.doesNotMatch(markup, /Unverified|Personal ·/, 'one label only')
  assert.match(markup, /<h2 id="[^"]+" class="ai-practice-run-title">Practise from your notes<\/h2>/, 'the set is named as the feature is')
  assert.doesNotMatch(markup, /Personal practice/)
  assert.ok(markup.indexOf(PERSONAL_PRACTICE_DISCLAIMER) < markup.indexOf('Question 1?'), 'before the first question')
})

test('generation progress shows its status only; the label belongs to the finished set', () => {
  assert.match(html(React.createElement(JourneyProgress, { phase: 'generating' })), /Writing five questions/)
  for (const phase of ['uploading', 'reading', 'generating']) {
    const markup = html(React.createElement(JourneyProgress, { phase }))
    assert.ok(!markup.includes('Unverified') && !markup.includes(PERSONAL_PRACTICE_DISCLAIMER), phase)
  }
})

test('"Keep this page open" shows only while the file uploads', () => {
  assert.match(html(React.createElement(JourneyProgress, { phase: 'uploading' })),
    /Uploading your file<\/p><p[^>]*>Keep this page open while your file uploads\.<\/p>/)
  for (const phase of ['reading', 'generating']) {
    assert.doesNotMatch(html(React.createElement(JourneyProgress, { phase })), /Keep this page open/, phase)
  }
})

test('Campus Bot closed: the notice offers the free pass with its button only to a student who can still get one', () => {
  const closed = { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null }
  const page = props => html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance: closed,
    recentSets: [], ...props }))
  const offered = page({ trial: { policy: null, passAvailable: true } })
  assert.match(offered, /<h2 class="student-notice-title">Campus Bot opens with a free pass\.<\/h2><div class="student-notice-action">/,
    'one line, then the button')
  assert.match(offered, /<a[^>]*href="\/access"[^>]*>Get your free pass<\/a>/, 'the button leads to Plan & Access, where the pass starts')
  assert.equal((offered.match(/<a\b/g) || []).length, 1, 'one button')
  assert.doesNotMatch(offered, /GST|type="file"|Early Access/)
  for (const [props, line] of [[{ trial: { policy: null, passAvailable: false } }, 'Campus Bot is included with a plan.'],
    [{}, 'Campus Bot is included with a plan.'],
    [{ trial: { policy: null, passAvailable: true }, plansOnSale: true }, 'Campus Bot is included when you subscribe.']]) {
    const markup = page(props)
    assert.ok(markup.includes(`<h2 class="student-notice-title">${line}</h2></div></div>`), `${line}: one line and nothing under it`)
    assert.doesNotMatch(markup, /free pass|GST|<a\b|<button|Early Access/, `${line}: no pass is offered, so there is no pass button`)
  }
})

test('Campus Bot closed, and this student can claim the free month: one line and "Claim your free month", in place of the pass', () => {
  const closed = { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null }
  const freeMonth = { continuityToken: 't', profileRevision: 7, endsOn: '16 December' }
  // Whatever else the page could say (a pass, plans on sale), the month is the one thing offered.
  for (const props of [{}, { trial: { policy: null, passAvailable: true } }, { plansOnSale: true }]) {
    const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance: closed,
      recentSets: [], freeMonth, ...props }))
    assert.match(markup, /<h2 class="student-notice-title">Campus Bot is included in your free month\.<\/h2><div class="student-notice-action"><button type="button" data-free-month-start=""[^>]*>Claim your free month<\/button>/)
    assert.equal((markup.match(/<button\b/g) || []).length, 1, 'one button')
    assert.doesNotMatch(markup, /free pass|when you subscribe|with a plan|full access|Early Access|<a\b|type="file"|16 December/,
      'the end date is in the confirmation, not on the page')
  }
  // A student who already has Campus Bot is not offered anything.
  const active = { state: 'active', source: 'paid', total: null, used: 0, endsAt: '2027-03-08T22:59:59.000Z' }
  const entitled = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance: active,
    recentSets: [], freeMonth }))
  assert.doesNotMatch(entitled, /free month|data-free-month-start/)
  assert.match(entitled, /type="file"/)
})

test('the label belongs to a question set: the upload screen and the list of sets do not carry it', () => {
  for (const initialAllowance of [null, { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null },
    { state: 'active', source: 'trial', total: 10, used: 2, endsAt: '2026-10-23T00:00:00.000Z' }]) {
    const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance,
      recentSets: [set] }))
    assert.ok(!markup.includes(PERSONAL_PRACTICE_DISCLAIMER), JSON.stringify(initialAllowance))
    assert.match(markup, /ai-practice-history/, 'the saved sets are still listed')
  }
})

test('the upload help says what to upload, in two short sentences', () => {
  const active = { state: 'active', source: 'paid', total: null, used: 0, endsAt: '2027-03-08T22:59:59.000Z' }
  const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance: active,
    recentSets: [] }))
  assert.match(markup, /<p class="ai-practice-upload-help">PDF, Word \(\.docx\) or plain text, up to 5 MB\. One topic or chapter at a time\s+works best\.<\/p>/)
  assert.doesNotMatch(markup, /deleted|kept privately|7 days|for the best questions/)
})

test('"Reading your notes" has no second line', () => {
  assert.doesNotMatch(html(React.createElement(JourneyProgress, { phase: 'reading' })), /ai-practice-progress-detail|Preparing your notes/)
})

for (const [reason, line] of [
  ['outside-list', 'You can’t upload notes for this course.'],
  ['paused', 'Uploads are paused for now. Your saved sets are still here.'],
]) test(`saved sets explain hidden uploads: ${reason}`, () => {
  const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance: null,
    recentSets: [set], canGenerate: false, uploadsUnavailableReason: reason }))
  assert.equal(markup.split(line).length - 1, 1)
  assert.match(markup, /notes.pdf/)
  assert.doesNotMatch(markup, /type="file"|Choose a file/)
})

test('token-funded access (a free month or a paid plan) never claims there is no set limit', () => {
  for (const source of ['early_access', 'paid']) {
    const initialAllowance = { state: 'active', source, total: null, used: 3, endsAt: '2026-12-01T00:00:00.000Z' }
    assert.equal(allowanceLine(initialAllowance), null, source)
    const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance, recentSets: [] }))
    assert.doesNotMatch(markup, /no set limit|ai-practice-allowance/, source)
  }
  assert.equal(allowanceLine({ state: 'active', source: 'trial', total: 3, used: 1, endsAt: null }),
    '2 of 3 Campus Bot sets left in your trial access.', 'a counted grant still shows what is left')
})
