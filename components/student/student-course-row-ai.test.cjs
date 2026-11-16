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
// What a page passes its rows: the courses whose Campus Bot page opens for the student (readCampusBotLinks).
const OPEN = new Set([COURSE])

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
  const row = () => presentStudentCourseRow(unbuilt, { campusBotLinks: OPEN })
  withEnv(ENABLED, () => assert.deepEqual(row(), { code: 'MKT 201',
    title: 'Principles of Marketing', unavailable: 'missing', aiPracticeHref: `/courses/ai-practice/${COURSE}` }))
  withEnv({}, () => assert.equal('aiPracticeHref' in row(), false))
  withEnv({ AI_PRACTICE_ENABLED: 'true' }, () => assert.equal('aiPracticeHref' in row(), false),
    'no link without a configured credential')
})

test('the link shows only on the rows where Campus Bot opens for the student', () => {
  const { presentStudentCourseRow, StudentCourseRow } = load()
  const elsewhere = new Set(['42222222-2222-4222-8222-222222222222'])
  withEnv(ENABLED, () => {
    assert.deepEqual(presentStudentCourseRow(unbuilt), { code: 'MKT 201', title: 'Principles of Marketing',
      unavailable: 'missing' }, 'a page that was not told where Campus Bot opens shows no link')
    assert.equal('aiPracticeHref' in presentStudentCourseRow(unbuilt, { campusBotLinks: new Set() }), false)
    assert.equal('aiPracticeHref' in presentStudentCourseRow(unbuilt, { campusBotLinks: elsewhere }), false, 'another course')
    const html = renderToStaticMarkup(React.createElement(StudentCourseRow, { course: unbuilt, campusBotLinks: elsewhere }))
    assert.match(html, /Study materials are not available\./)
    assert.doesNotMatch(html, /<a\b|Campus Bot|Practise from your own notes/, 'the row says only that there are no materials')
  })
})

test('temporary problems and built courses never show the AI path', () => {
  const { presentStudentCourseRow } = load()
  const temporary = { ...unbuilt, repository: { state: 'unshelved-repository', repositoryCourseId: COURSE, contentKey: 'x', isShared: false } }
  withEnv(ENABLED, () => assert.equal('aiPracticeHref' in presentStudentCourseRow(temporary, { campusBotLinks: OPEN }), false))
})

test('the rendered row keeps "not yet available" first and labels the link as Campus Bot', () => {
  const { StudentCourseRow } = load()
  const html = withEnv(ENABLED, () => renderToStaticMarkup(React.createElement(StudentCourseRow, { course: unbuilt, campusBotLinks: OPEN })))
  assert.ok(html.indexOf('student-ai-practice-link') > html.indexOf('MKT 201'))
  assert.match(html, /href="\/courses\/ai-practice\/41111111-1111-4111-8111-111111111111"/)
  assert.match(html, /Practise from your own notes/)
  assert.match(html, /student-ai-practice-tag">Campus Bot</)
})

test('the link takes its own line under the status, so the two never run together', () => {
  const css = fs.readFileSync(require('node:path').join(__dirname, '../../styles/ai-practice.css'), 'utf8')
  const [, rule] = /\.student-ai-practice-link \{([^}]*)\}/.exec(css)
  assert.match(rule, /^ display: flex; width: fit-content;/, 'a block of its own at every width, no wider than its words')
  assert.doesNotMatch(rule, /inline/)
})
