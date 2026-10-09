// components/student/course-register.test.cjs — Shared register ordering, inert states and safe identity rendering.
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

const originalTsx = Module._extensions['.tsx']
let CourseRow, CourseRegister
before(() => {
  Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file)
  ;({ CourseRow, CourseRegister } = require('./CourseRow.tsx'))
})
after(() => {
  if (originalTsx) Module._extensions['.tsx'] = originalTsx
  else delete Module._extensions['.tsx']
})

test('seven rows preserve DOM/keyboard order down each column as one semantic list', () => {
  const codes = ['ACC201', 'BUA201', 'BUA203', 'BUA205', 'ENT211', 'LAG-BUA210', 'LAG-BUA221']
  const children = codes.map(code => React.createElement(CourseRow, { key: code,
    code, title: code + ' title', unavailable: 'missing' }))
  const register = CourseRegister({ children, label: 'Your semester courses' })
  assert.equal(register.type, 'ul')
  assert.equal(register.props['aria-label'], 'Your semester courses')
  assert.deepEqual(register.props.children.map(row => row.type), ['li', 'li', 'li', 'li', 'li', 'li', 'li'])
  assert.deepEqual(register.props.children.map(row => row.props.children.props.code), codes)
  assert.deepEqual(register.props.children.map(row => row.props['data-column']), [1, 1, 1, 1, 2, 2, 2])
  assert.deepEqual(register.props.children.map(row => row.props['data-column-end']), [false, false, false, true, false, false, true])
  assert.equal(register.props.style['--student-register-rows'], 4)
})

test('one course stays one row without a fabricated second course', () => {
  const register = CourseRegister({ label: 'Your semester courses', children: [
    React.createElement(CourseRow, { key: 'ACC201', code: 'ACC201', title: 'Accounting',
      href: '/courses/accounting', learningTypes: ['Notes'] }),
  ] })
  assert.equal(register.props['data-count'], 1)
  assert.equal(register.props.children.length, 1)
  assert.equal(register.props.children[0].props['data-column-end'], true)
  assert.equal(register.props.style['--student-register-rows'], 1)
})

test('long/untrusted course identity remains escaped text with one focusable ready target', () => {
  const html = renderToStaticMarkup(React.createElement(CourseRow, {
    code: 'LAG-BUA-ACADEMIC-REGISTER-203', title: '<script>Not executable</script> & institutional title',
    href: '/courses/approved-course', learningTypes: ['Notes', 'CBT practice'],
  }))
  assert.match(html, /&lt;script&gt;Not executable&lt;\/script&gt;/)
  assert.match(html, /href="\/courses\/approved-course"/)
  assert.match(html, /student-focus-row/)
  assert.equal((html.match(/<a\b/g) || []).length, 1)
  assert.doesNotMatch(html, /<script\b|<button\b|tabindex=|Open course/)
})
