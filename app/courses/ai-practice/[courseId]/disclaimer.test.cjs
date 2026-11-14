// app/courses/ai-practice/[courseId]/disclaimer.test.cjs — The one Campus Bot label on every personal set.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { PERSONAL_PRACTICE_DISCLAIMER } = require('../../../../lib/ai-practice/contract.ts')

function load(file) {
  const previous = Module._extensions['.tsx']
  Module._extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true } }).outputText, filename)
  try { return require(file) } finally { Module._extensions['.tsx'] = previous }
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
  assert.match(offered, /Campus Bot opens with a free pass or Early Access\.<\/p>/)
  assert.match(offered, /<a[^>]*href="\/access"[^>]*>Get your free pass<\/a>/, 'the button leads to Plan & Access, where the pass starts')
  assert.equal((offered.match(/<a\b/g) || []).length, 1, 'one button')
  assert.doesNotMatch(offered, /GST|type="file"/)
  for (const [props, line] of [[{ trial: { policy: null, passAvailable: false } }, 'Campus Bot opens with Early Access.'],
    [{}, 'Campus Bot opens with Early Access.'],
    [{ trial: { policy: null, passAvailable: true }, plansOnSale: true }, 'Campus Bot is included when you subscribe.']]) {
    const markup = page(props)
    assert.ok(markup.includes(line), line)
    assert.doesNotMatch(markup, /free pass|GST|<a\b/, `${line}: no pass is offered, so there is no pass button`)
  }
})

test('the workspace leads with the verbatim label, entitled or not', () => {
  for (const initialAllowance of [null, { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null },
    { state: 'active', source: 'trial', total: 10, used: 2, endsAt: '2026-10-23T00:00:00.000Z' }]) {
    const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance,
      recentSets: [set] }))
    assert.ok(markup.indexOf(PERSONAL_PRACTICE_DISCLAIMER) >= 0, JSON.stringify(initialAllowance))
    assert.ok(markup.indexOf(PERSONAL_PRACTICE_DISCLAIMER) < markup.indexOf('ai-practice-history'),
      'above the list of sets')
  }
})

for (const [reason, line] of [
  ['outside-list', 'Uploads are available for your courses this semester. Your saved sets are still here.'],
  ['paused', 'Uploads are paused for now. Your saved sets are still here.'],
]) test(`saved sets explain hidden uploads: ${reason}`, () => {
  const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance: null,
    recentSets: [set], canGenerate: false, uploadsUnavailableReason: reason }))
  assert.equal(markup.split(line).length - 1, 1)
  assert.match(markup, /notes.pdf/)
  assert.doesNotMatch(markup, /type="file"|Choose a file/)
})

test('token-funded access (Early Access or a paid plan) never claims there is no set limit', () => {
  for (const source of ['early_access', 'paid']) {
    const initialAllowance = { state: 'active', source, total: null, used: 3, endsAt: '2026-12-01T00:00:00.000Z' }
    assert.equal(allowanceLine(initialAllowance), null, source)
    const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance, recentSets: [] }))
    assert.doesNotMatch(markup, /no set limit|ai-practice-allowance/, source)
  }
  assert.equal(allowanceLine({ state: 'active', source: 'trial', total: 3, used: 1, endsAt: null }),
    '2 of 3 Campus Bot sets left in your trial access.', 'a counted grant still shows what is left')
})
