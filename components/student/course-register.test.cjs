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

test('explicit single-column mode keeps one column at every width without changing the responsive default', () => {
  const codes = ['ACC201', 'BUA201', 'BUA203', 'BUA205', 'ENT211']
  const children = codes.map(code => React.createElement(CourseRow, { key: code, code, title: code + ' title', unavailable: 'missing' }))
  const single = CourseRegister({ children, label: 'Bookmarked courses', columns: 'single' })
  assert.equal(single.props['data-columns'], 'single')
  assert.equal(single.props['data-count'], 5)
  assert.deepEqual(single.props.children.map(row => row.props['data-column']), [1, 1, 1, 1, 1])
  assert.deepEqual(single.props.children.map(row => row.props['data-column-end']), [false, false, false, false, true])
  assert.deepEqual(single.props.children.map(row => row.props.children.props.code), codes, 'order is untouched')
  assert.equal(single.props.style['--student-register-rows'], 5)
  const responsive = CourseRegister({ children, label: 'Your semester courses' })
  assert.equal(responsive.props['data-columns'], 'responsive')
  assert.deepEqual(responsive.props.children.map(row => row.props['data-column']), [1, 1, 1, 2, 2])
  assert.equal(responsive.props.style['--student-register-rows'], 3)
  const css = fs.readFileSync(require('node:path').join(__dirname, '../../styles/student-app.css'), 'utf8')
  assert.match(css, /\.student-course-register\[data-columns='single'\] \{ display: block; \}/)
  assert.match(css, /\.student-course-register\[data-columns='single'\] > li \{ padding-inline: 0; border-left: 0;/)
})

test('a trailing action is a sibling of the course target, never nested inside the link, and absent by default', () => {
  const action = React.createElement('button', { type: 'button', 'aria-pressed': 'true' }, 'Bookmark')
  const ready = renderToStaticMarkup(React.createElement(CourseRow, { code: 'ACC201', title: 'Accounting',
    href: '/courses/accounting', learningTypes: ['Notes'], trailingAction: action }))
  assert.match(ready, /^<div class="student-course-row-shell"><a /)
  assert.equal((ready.match(/<a\b/g) || []).length, 1)
  assert.equal((ready.match(/<button\b/g) || []).length, 1)
  assert.ok(ready.indexOf('</a>') < ready.indexOf('<button'), 'the control follows the closed link')
  assert.match(ready, /<div class="student-course-row-action"><button /)
  const inert = renderToStaticMarkup(React.createElement(CourseRow, { code: 'ACC201', title: 'Accounting',
    unavailable: 'temporary', trailingAction: action }))
  assert.doesNotMatch(inert, /<a\b/)
  assert.match(inert, /student-course-row-shell[\s\S]*student-course-row-action/)
  const plain = renderToStaticMarkup(React.createElement(CourseRow, { code: 'ACC201', title: 'Accounting',
    href: '/courses/accounting', learningTypes: ['Notes'] }))
  assert.match(plain, /^<a /)
  assert.doesNotMatch(plain, /student-course-row-shell|student-course-row-action/)
})

test('repository-only identity shows the shared label instead of a code and never fabricates one', () => {
  const html = renderToStaticMarkup(React.createElement(CourseRow, { repositoryOnly: true, title: 'Business Statistics',
    href: '/courses/business-statistics', learningTypes: ['CBT practice'] }))
  assert.match(html, /<p class="student-course-row-code" data-identity="repository">Additional study material<\/p>/)
  assert.match(html, /Business Statistics/)
  assert.doesNotMatch(html, /undefined|null/)
  assert.equal(require('./CourseRow.tsx').REPOSITORY_COURSE_LABEL, 'Additional study material')
})
