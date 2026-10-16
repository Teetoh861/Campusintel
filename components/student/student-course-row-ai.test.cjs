// components/student/student-course-row-ai.test.cjs — The secondary AI practice link on unbuilt course rows.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const COURSE = '41111111-1111-4111-8111-111111111111'
const unbuilt = { institutionalCourseId: COURSE, code: 'MKT 201', title: 'Principles of Marketing', isFree: false,
  applicability: [], repository: { state: 'unlinked' }, content: { state: 'not-built', reason: 'unlinked' } }
const ENABLED = { AI_PRACTICE_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-test' }

function load() {
  const previous = Module._extensions['.tsx']
  Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true } }).outputText, file)
  try { return require('./StudentCourseRow.tsx') } finally { Module._extensions['.tsx'] = previous }
}

function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(ENABLED).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  for (const key of Object.keys(ENABLED)) if (!(key in values)) delete process.env[key]
  try { return run() } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  }
}

test('an unbuilt institutional course offers the AI path only when AI practice is available', () => {
  const { presentStudentCourseRow } = load()
  withEnv(ENABLED, () => assert.deepEqual(presentStudentCourseRow(unbuilt), { code: 'MKT 201',
    title: 'Principles of Marketing', unavailable: 'missing', aiPracticeHref: `/courses/ai-practice/${COURSE}` }))
  withEnv({}, () => assert.equal('aiPracticeHref' in presentStudentCourseRow(unbuilt), false))
  withEnv({ AI_PRACTICE_ENABLED: 'true' }, () => assert.equal('aiPracticeHref' in presentStudentCourseRow(unbuilt), false),
    'no link without a configured credential')
})

test('temporary problems and built courses never show the AI path', () => {
  const { presentStudentCourseRow } = load()
  const temporary = { ...unbuilt, repository: { state: 'unshelved-repository', repositoryCourseId: COURSE, contentKey: 'x', isShared: false } }
  withEnv(ENABLED, () => assert.equal('aiPracticeHref' in presentStudentCourseRow(temporary), false))
})

test('the rendered row keeps "not yet available" first and labels the link as AI and unverified', () => {
  const { StudentCourseRow } = load()
  const html = withEnv(ENABLED, () => renderToStaticMarkup(React.createElement(StudentCourseRow, { course: unbuilt })))
  assert.ok(html.indexOf('student-ai-practice-link') > html.indexOf('MKT 201'))
  assert.match(html, /href="\/courses\/ai-practice\/41111111-1111-4111-8111-111111111111"/)
  assert.match(html, /Practise from your own notes/)
  assert.match(html, /AI · Unverified/)
})
