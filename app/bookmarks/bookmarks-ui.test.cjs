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
    toggle: async () => null, remove: async () => false, refresh: async () => {} }) }
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
  assert.match(buttonHtml, /Bookmarked/)
  assert.match(listHtml, /Saved to your account/)
  assert.match(listHtml, /FIRST101/)
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
