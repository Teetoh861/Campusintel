// app/courses/ai-practice/[courseId]/disclaimer.test.cjs — The Personal · Unverified label on every AI practice step.
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

test('the full disclaimer is shown while answering a personal set', () => {
  const markup = html(React.createElement(PersonalPractice, { set, onClose: () => undefined }))
  assert.ok(markup.includes('Personal · Unverified.'), 'the label is present during active answering')
  assert.ok(markup.includes(PERSONAL_PRACTICE_DISCLAIMER), 'the disclaimer is rendered verbatim')
  assert.ok(markup.indexOf(PERSONAL_PRACTICE_DISCLAIMER) < markup.indexOf('Question 1?'), 'before the first question')
})

test('generation progress carries the unverified label next to its status', () => {
  const generating = html(React.createElement(JourneyProgress, { phase: 'generating' }))
  assert.match(generating, /Writing five questions.*Personal · Unverified/s)
  for (const phase of ['uploading', 'reading']) {
    assert.ok(!html(React.createElement(JourneyProgress, { phase })).includes('Unverified'), phase)
  }
})

test('the workspace leads with the verbatim disclaimer, entitled or not', () => {
  for (const initialAllowance of [null, { state: 'not-entitled', source: null, total: 0, used: 0, endsAt: null },
    { state: 'active', source: 'trial', total: 10, used: 2, endsAt: '2026-10-23T00:00:00.000Z' }]) {
    const markup = html(React.createElement(AiPracticeClient, { courseId: 'c', continuityToken: 't', initialAllowance,
      recentSets: [set] }))
    assert.ok(markup.indexOf(PERSONAL_PRACTICE_DISCLAIMER) >= 0, JSON.stringify(initialAllowance))
    assert.ok(markup.indexOf(PERSONAL_PRACTICE_DISCLAIMER) < markup.indexOf('ai-practice-history'),
      'above the list of sets')
  }
})
