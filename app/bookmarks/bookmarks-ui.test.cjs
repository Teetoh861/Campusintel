// app/bookmarks/bookmarks-ui.test.cjs — Saved-grid rendering for local, account, and unavailable states.
// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

let snapshot = { mode: 'loading', keys: [] }
const toggled = []
const originalLoad = Module._load
const originalTsx = Module._extensions['.tsx']
Module._extensions['.tsx'] = function (module, file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } })
  module._compile(output.outputText, file)
}
Module._load = function (name, ...args) {
  if (name === 'next/link') return ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children)
  if (name === '@/lib/bookmarks/client') return { useBookmarks: () => ({ snapshot,
    toggle: async course => {
      toggled.push(course.contentKey)
      const pressed = snapshot.keys.includes(course.contentKey)
      snapshot = { ...snapshot, keys: pressed ? snapshot.keys.filter(key => key !== course.contentKey) : [...snapshot.keys, course.contentKey] }
      return pressed ? 'removed' : 'added'
    }, remove: async () => { throw Error('Use the reversible toggle') }, refresh: async () => {} }) }
  if (name === '@/components/chrome/Card') return { Card: ({ code, cornerAction }) =>
    React.createElement('article', null, code, cornerAction) }
  if (name === '@/components/chrome/ui') return {
    btnAccent: 'accent', btnBase: 'base', btnGhostOnBlue: 'ghost', btnLight: 'light',
    cx: (...parts) => parts.filter(Boolean).join(' '),
  }
  return originalLoad.call(this, name, ...args)
}
const { BookmarksClient } = require('./BookmarksClient.tsx')
const { BookmarkButton } = require('../courses/[slug]/BookmarkButton.tsx')
Module._load = originalLoad
Module._extensions['.tsx'] = originalTsx

const course = { id: 'legacy-card-key', code: 'FIRST101', slug: 'first-slug',
  contentKey: 'first-content', cardProps: { code: 'FIRST101' } }
const button = () => React.createElement(BookmarkButton, {
  slug: course.slug, code: course.code, contentKey: course.contentKey,
  catalog: [course], variant: 'closing',
})
const list = () => React.createElement(BookmarksClient, { catalog: [course] })

test('account state drives both the course button and saved grid with account copy', () => {
  snapshot = { mode: 'account', keys: ['first-content'] }
  const buttonHtml = renderToStaticMarkup(button())
  const listHtml = renderToStaticMarkup(list())
  assert.match(buttonHtml, /aria-pressed="true"/)
  assert.match(buttonHtml, /aria-label="Bookmark FIRST101"/)
  assert.match(buttonHtml, /fill="currentColor"/)
  assert.match(listHtml, /Saved to your account/)
  assert.match(listHtml, /FIRST101/)
  assert.match(listHtml, /01 bookmarks/)
  assert.doesNotMatch(listHtml, /01 saved/)
  assert.doesNotMatch(listHtml, /kept on this device/)
})

test('signed-out legacy course-code entries remain visible in both surfaces', () => {
  snapshot = { mode: 'local', keys: ['FIRST101'] }
  assert.match(renderToStaticMarkup(button()), /aria-pressed="true"/)
  const listHtml = renderToStaticMarkup(list())
  assert.match(listHtml, /Saved to this device/)
  assert.match(listHtml, /FIRST101/)
})

test('an unavailable account does not render a false saved or empty state', () => {
  snapshot = { mode: 'unavailable', keys: [] }
  assert.match(renderToStaticMarkup(button()), /aria-pressed="false"/)
  const listHtml = renderToStaticMarkup(list())
  assert.match(listHtml, /Could not load bookmarks/)
  assert.doesNotMatch(listHtml, /Your bookmarks are empty/)
  // A mounted authenticated page that loses its session never claims a device fallback.
  assert.doesNotMatch(listHtml, /this device/)
  assert.doesNotMatch(renderToStaticMarkup(button()), /Bookmarked|this device/)
})

test('loading keeps the Bookmarks heading and never claims the account has no bookmarks', () => {
  snapshot = { mode: 'loading', keys: [] }
  const html = renderToStaticMarkup(list())
  assert.match(html, /<h1[^>]*>Bookmarks<\/h1>/)
  assert.match(html, /role="status"[^>]*>Loading your saved courses/)
  assert.doesNotMatch(html, /Your bookmarks are empty|No bookmarks yet|00 bookmarks|Browse courses/)
})

test('empty copy appears only after the store resolves an empty result, without replacing page identity', () => {
  for (const mode of ['account', 'local']) {
    snapshot = { mode, keys: [] }
    const html = renderToStaticMarkup(list())
    assert.match(html, /<h1[^>]*>Bookmarks<\/h1>/)
    assert.match(html, /Your bookmarks are empty/)
    assert.match(html, /00 bookmarks/)
    assert.doesNotMatch(html, /Loading your saved courses/)
  }
  snapshot = { mode: 'account', keys: ['first-content'] }
  const saved = renderToStaticMarkup(list())
  assert.match(saved, /<h1[^>]*>Bookmarks<\/h1>/)
  assert.match(saved, /aria-label="Bookmark FIRST101" aria-pressed="true"/)
  assert.doesNotMatch(saved, /Your bookmarks are empty/)
})

test('bookmark controls keep a stable name and explicit outline/filled toggle state without destructive styling', () => {
  for (const pressed of [false, true]) {
    snapshot = { mode: 'account', keys: pressed ? ['first-content'] : [] }
    const html = renderToStaticMarkup(button())
    assert.match(html, /aria-label="Bookmark FIRST101"/)
    assert.match(html, new RegExp(`aria-pressed="${pressed}"`))
    assert.match(html, new RegExp(`fill="${pressed ? 'currentColor' : 'none'}"`))
    assert.doesNotMatch(html, /Remove bookmark|&times;|student-error|text-red|rounded-full/)
  }
})

test('pressing the selected course control unbookmarks and pressing it again restores the same course', async () => {
  const hooks = Object.fromEntries(['useState', 'useEffect', 'useRef', 'useCallback'].map(name => [name, React[name]]))
  const timeout = global.setTimeout
  try {
    React.useState = initial => [initial, () => {}]
    React.useEffect = () => {}
    React.useRef = initial => ({ current: initial })
    React.useCallback = fn => fn
    global.setTimeout = () => 1
    snapshot = { mode: 'account', keys: ['first-content'] }
    const props = { slug: course.slug, code: course.code, contentKey: course.contentKey, catalog: [course] }
    const control = () => BookmarkButton(props).props.children[0]
    let toggle = control()
    assert.equal(toggle.props.pressed, true)
    toggle.props.onClick()
    await new Promise(setImmediate)
    toggle = control()
    assert.equal(toggle.props.pressed, false)
    toggle.props.onClick()
    await new Promise(setImmediate)
    assert.equal(control().props.pressed, true)
    assert.deepEqual(toggled.slice(-2), ['first-content', 'first-content'])
  } finally {
    Object.assign(React, hooks)
    global.setTimeout = timeout
  }
})

test('a selected Bookmarks card uses the same toggle boundary and disappears after unbookmarking', async () => {
  const useState = React.useState
  try {
    React.useState = initial => [initial, () => {}]
    snapshot = { mode: 'account', keys: ['first-content'] }
    const nodes = tree => !tree || typeof tree !== 'object' ? [] :
      [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
    const card = nodes(BookmarksClient({ catalog: [course] })).find(node => node.props?.cornerAction)
    assert.ok(card)
    assert.equal(card.props.cornerAction.props.pressed, true)
    assert.equal(card.props.cornerAction.props.label, 'Bookmark FIRST101')
    card.props.cornerAction.props.onClick()
    await new Promise(setImmediate)
    assert.deepEqual(snapshot.keys, [])
    assert.match(renderToStaticMarkup(list()), /Your bookmarks are empty/)
  } finally { React.useState = useState }
})
