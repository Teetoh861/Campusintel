// components/student/state-primitives.test.cjs — EmptyState safety, shared result states, bookmark feedback and toggle.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const anchors = html => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0])

test('two EmptyState instances on one page get distinct heading ids, with icon override and omission', async () => {
  const { EmptyState } = await withTsx(() => require('./EmptyState.tsx'))
  const html = renderToStaticMarkup(React.createElement('main', null,
    React.createElement(EmptyState, { title: 'First', actions: null }, 'one'),
    React.createElement(EmptyState, { title: 'Second', icon: null, actions: null }, 'two'),
    React.createElement(EmptyState, { id: 'stable-id', title: 'Third', icon: React.createElement('i', null, 'custom'), actions: null }, 'three')))
  const labelled = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map(match => match[1])
  const ids = [...html.matchAll(/<h2 id="([^"]+)"/g)].map(match => match[1])
  assert.equal(labelled.length, 3)
  assert.deepEqual(labelled, ids, 'each section labels itself by its own heading')
  assert.equal(new Set(ids).size, 3, 'ids are unique')
  assert.equal(ids[2], 'stable-id')
  assert.equal((html.match(/student-empty-icon/g) || []).length, 2, 'icon omitted when null')
  assert.match(html, /<i>custom<\/i>/)
  assert.equal((html.match(/lucide-book-open/g) || []).length, 1)
})

test('result states map to one copy and one recovery action; redirects share the gated-page outcomes', async () => {
  const redirects = []
  const originalLoad = Module._load
  Module._load = function(name, ...args) {
    if (name === 'next/navigation') return { redirect: to => { redirects.push(to); throw new Error('redirect:' + to) } }
    return originalLoad.call(this, name, ...args)
  }
  try {
    const { RESULT_COPY, recoveryAction, redirectForStudentState, ResultNotice } = await withTsx(() => ({
      ...require('./result-state.ts'), ...require('./ResultNotice.tsx') }))
    assert.deepEqual(recoveryAction('course-invariant', '/x'), { kind: 'support', href: '/contact', label: 'Contact support' })
    assert.deepEqual(recoveryAction('missing-profile', '/x'), { kind: 'support', href: '/contact', label: 'Contact support' })
    assert.deepEqual(recoveryAction('courses-unavailable', '/courses'), { kind: 'retry', href: '/courses', label: 'Try again' })
    assert.deepEqual(recoveryAction('course-unavailable', '/courses/x'), { kind: 'retry', href: '/courses/x', label: 'Try again' })
    assert.equal(RESULT_COPY['courses-unavailable'].body, 'Study materials are temporarily unavailable.')
    assert.equal(RESULT_COPY['course-unavailable'].body, RESULT_COPY['courses-unavailable'].body)
    assert.throws(() => redirectForStudentState('signed-out', '/my-courses'), /redirect:\/login\?next=%2Fmy-courses/)
    assert.throws(() => redirectForStudentState('signed-out', '/courses/../evil'), /redirect:\/login\?next=%2Fdashboard/)
    assert.throws(() => redirectForStudentState('incomplete', '/my-courses'), /redirect:\/profile-selection/)
    assert.deepEqual(redirects, ['/login?next=%2Fmy-courses', '/login?next=%2Fdashboard', '/profile-selection'])
    const invariant = renderToStaticMarkup(React.createElement(ResultNotice, { state: 'course-invariant', retryHref: '/courses' }))
    assert.match(invariant, /role="alert"/)
    assert.match(invariant, /Course details unavailable/)
    assert.ok(anchors(invariant).some(link => link.includes('href="/contact"') && link.includes('Contact support')))
    assert.doesNotMatch(invariant, /Try again/)
    const unavailable = renderToStaticMarkup(React.createElement(ResultNotice, { state: 'courses-unavailable', retryHref: '/courses',
      extra: React.createElement('a', { href: '/materials' }, 'Request Material') }))
    assert.ok(anchors(unavailable).some(link => link.includes('href="/courses"') && link.includes('Try again') && link.includes('min-h-11')))
    assert.ok(anchors(unavailable).some(link => link.includes('href="/materials"')))
    assert.match(unavailable, /Courses temporarily unavailable/)
  } finally { Module._load = originalLoad }
})

test('BookmarkFeedback is one persistent live region with exact copy and a 44px saved-list action', async () => {
  const { BookmarkFeedback, BOOKMARK_FEEDBACK_COPY } = await withTsx(() => require('./BookmarkFeedback.tsx'))
  const render = state => renderToStaticMarkup(React.createElement(BookmarkFeedback, { state }))
  assert.deepEqual(BOOKMARK_FEEDBACK_COPY, { added: 'Added to bookmarks', removed: 'Removed from bookmarks',
    error: 'Could not update bookmarks. Try again.' })
  const idle = render(null)
  assert.match(idle, /role="status" aria-live="polite" aria-atomic="true" class="student-bookmark-feedback" data-state="idle"/)
  assert.doesNotMatch(idle, /<span|<a\b/)
  const added = render('added')
  assert.match(added, /Added to bookmarks/)
  const link = anchors(added)[0]
  assert.ok(link.includes('href="/bookmarks"') && link.includes('View bookmarks') && link.includes('min-h-11'), link)
  assert.doesNotMatch(render('removed'), /<a\b/)
  assert.match(render('error'), /data-state="error"[\s\S]*Could not update bookmarks\. Try again\./)
  assert.doesNotMatch(render('error'), /<a\b/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'BookmarkFeedback.tsx'), 'utf8'), /fixed|z-\[|toast|sonner/)
})

test('BookmarkToggle keeps pressed state, label, size and interaction on the library icon', async () => {
  const { BookmarkToggle } = await withTsx(() => require('./BookmarkToggle.tsx'))
  let clicks = 0
  const html = renderToStaticMarkup(React.createElement(BookmarkToggle, { pressed: true, label: 'Bookmark BUA201',
    text: 'Bookmark', onClick: () => { clicks++ } }))
  assert.match(html, /<button type="button" aria-label="Bookmark BUA201" aria-pressed="true"/)
  assert.match(html, /lucide-bookmark/)
  assert.match(html, /width="22" height="22"/)
  assert.match(html, /fill="currentColor"/)
  assert.match(html, /<span>Bookmark<\/span>/)
  const off = renderToStaticMarkup(React.createElement(BookmarkToggle, { pressed: false, onClick: () => {}, disabled: true }))
  assert.match(off, /aria-pressed="false"[^>]*disabled=""/)
  assert.match(off, /fill="none"/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'BookmarkToggle.tsx'), 'utf8'), /<svg|<path/)
  assert.equal(clicks, 0)
})

test('a busy BookmarkToggle keeps pressed state, reports aria-busy, blocks activation and shows the library spinner', async () => {
  const { BookmarkToggle } = await withTsx(() => require('./BookmarkToggle.tsx'))
  const ref = { current: null }
  const element = React.createElement(BookmarkToggle, { pressed: true, busy: true, label: 'Bookmark BUA201', onClick: () => {}, ref })
  const html = renderToStaticMarkup(element)
  assert.match(html, /aria-pressed="true"/)
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /aria-disabled="true"/)
  assert.doesNotMatch(html, /disabled=""/, 'a busy control stays focusable')
  assert.match(html, /lucide-loader-circle[^"]*animate-spin/)
  assert.doesNotMatch(html, /lucide-bookmark/)
  assert.equal(element.props.ref, ref, 'the ref reaches the shared control')
  const rendered = BookmarkToggle({ pressed: true, busy: true, onClick: () => { throw new Error('must not run') } })
  assert.equal(rendered.props.onClick, undefined, 'repeated activation is ignored while busy')
  assert.equal(rendered.props.ref, undefined)
  const idle = renderToStaticMarkup(React.createElement(BookmarkToggle, { pressed: true, onClick: () => {} }))
  assert.doesNotMatch(idle, /aria-busy|aria-disabled|loader/)
})

test('EmptyState makes its heading a programmatic focus target only when a heading ref is requested', async () => {
  const { EmptyState } = await withTsx(() => require('./EmptyState.tsx'))
  const plain = renderToStaticMarkup(React.createElement(EmptyState, { title: 'Nothing', actions: null }, 'body'))
  assert.doesNotMatch(plain, /tabindex/)
  const focusable = renderToStaticMarkup(React.createElement(EmptyState, { title: 'Nothing', actions: null,
    headingRef: { current: null } }, 'body'))
  assert.match(focusable, /<h2 id="[^"]+" class="student-empty-title" tabindex="-1">Nothing<\/h2>/)
})
