// components/student/student-page.test.cjs — Page root, loading semantics, register skeleton and band long-text safety.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const subject = () => withTsx(() => ({
  ...require('./StudentPage.tsx'), ...require('./StudentLoadingState.tsx'),
  ...require('./CourseRegisterSkeleton.tsx'), ...require('./PageBand.tsx'),
}))

test('StudentPage owns the root attribute, band slot and one bounded workspace, nothing else', async () => {
  const { StudentPage } = await subject()
  const html = renderToStaticMarkup(React.createElement(StudentPage, { band: React.createElement('header', null, 'band') },
    React.createElement('p', null, 'body')))
  assert.match(html, /^<div class="student-page-root" data-student-app="true"><header>band<\/header><div class="student-workspace student-page-workspace"><p>body<\/p><\/div><\/div>$/)
  const custom = renderToStaticMarkup(React.createElement(StudentPage, { workspaceClassName: 'dashboard-workspace' }, 'x'))
  assert.match(custom, /class="student-workspace student-page-workspace dashboard-workspace"/)
  assert.doesNotMatch(custom, /<header/)
  const source = fs.readFileSync(path.join(__dirname, 'StudentPage.tsx'), 'utf8')
  assert.doesNotMatch(source, /role=|aria-|Notice|Feedback|redirect|Skeleton|status/, 'no auth, error or loading behavior in the root')
})

test('StudentLoadingState is exactly one polite busy live region with one announcement and hidden visuals', async () => {
  const { StudentLoadingState } = await subject()
  const html = renderToStaticMarkup(React.createElement(StudentLoadingState, { message: 'Loading course.' },
    React.createElement('a', { href: '/x' }, 'placeholder')))
  assert.equal((html.match(/role="status"/g) || []).length, 1)
  assert.match(html, /role="status" aria-live="polite" aria-busy="true"/)
  assert.equal((html.match(/Loading course\./g) || []).length, 1)
  assert.match(html, /<span class="sr-only">Loading course\.<\/span><div aria-hidden="true">/)
})

test('CourseRegisterSkeleton renders inert rows in the shared register with no identity or actions', async () => {
  const { CourseRegisterSkeleton } = await subject()
  const html = renderToStaticMarkup(React.createElement(CourseRegisterSkeleton, { rows: 4 }))
  assert.match(html, /aria-label="Course placeholders"/)
  assert.equal((html.match(/<li\b/g) || []).length, 4)
  assert.equal((html.match(/class="student-course-row"/g) || []).length, 4)
  assert.doesNotMatch(html, /<a\b|<button\b|animate-pulse|BUA|href=/)
  assert.match(html, /data-columns="responsive"/)
  const single = renderToStaticMarkup(React.createElement(CourseRegisterSkeleton, { rows: 10, columns: 'single' }))
  assert.match(single, /data-columns="single"/)
  assert.equal((single.match(/<li\b/g) || []).length, 10)
  assert.equal((single.match(/data-column="1"/g) || []).length, 10, 'single-column skeleton geometry matches the live register')
})

test('PageBand wraps unbroken titles and ledes inside the band at the shared owner', async () => {
  const { PageBand } = await subject()
  const title = 'X'.repeat(600)
  const html = renderToStaticMarkup(React.createElement(PageBand, { title, lede: 'Y'.repeat(300) }))
  assert.match(html, /<h1 class="student-page-band-title">X{600}<\/h1>/)
  const css = fs.readFileSync(path.join(__dirname, '../../styles/student-app.css'), 'utf8')
  const rule = key => css.split('\n').find(line => line.startsWith(`.${key} {`))
  assert.match(rule('student-page-band-title'), /min-width: 0/)
  assert.match(rule('student-page-band-title'), /overflow-wrap: anywhere/)
  assert.match(rule('student-page-band-lede'), /overflow-wrap: anywhere/)
  assert.match(css, /\.student-page-band-body,\n\.student-page-band-aside \{ min-width: 0; \}/)
})

test('every migrated loading boundary uses the shared owners and stays inert', async () => {
  for (const [file, message] of [
    ['app/my-courses/loading.tsx', 'Loading your semester courses.'],
    ['app/courses/loading.tsx', 'Loading institutional courses.'],
    ['app/courses/[slug]/loading.tsx', 'Loading course.'],
    ['app/dashboard/loading.tsx', 'Loading your Dashboard.'],
    ['app/bookmarks/loading.tsx', 'Loading your bookmarks.'],
  ]) {
    const html = await withTsx(() => renderToStaticMarkup(React.createElement(require(path.join(__dirname, '../..', file)).default)))
    assert.equal((html.match(/role="status"/g) || []).length, 1, file)
    assert.equal((html.match(/aria-live="polite"/g) || []).length, 1, file)
    assert.equal((html.match(new RegExp(message.replace('.', '\\.'), 'g')) || []).length, 1, file)
    assert.match(html, /class="student-page-root" data-student-app="true"/, file)
    assert.doesNotMatch(html, /<a\b|<button\b|animate-pulse|aria-pressed|lucide-bookmark|Practice|BUA|INST/, file)
    const source = fs.readFileSync(path.join(__dirname, '../..', file), 'utf8')
    assert.match(source, /StudentLoadingState/, file)
    assert.doesNotMatch(source, /role="status"|aria-busy|sr-only/, `${file} must not hand-write loading semantics`)
  }
})
