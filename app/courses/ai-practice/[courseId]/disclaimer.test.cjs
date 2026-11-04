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

const { AiPracticeClient, JourneyProgress } = load('./AiPracticeClient.tsx')
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
