// components/ui/use-mobile.test.cjs — One media-query store: live client snapshots, crossing updates, a stable server answer.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

/** A fake matchMedia that records queries and lets the test cross the breakpoint. */
function fakeWindow(initial) {
  const listeners = new Set()
  const window = { queries: [], matches: initial,
    matchMedia(query) {
      window.queries.push(query)
      return { get matches() { return window.matches },
        addEventListener: (_, listener) => listeners.add(listener), removeEventListener: (_, listener) => listeners.delete(listener) }
    },
    cross(value) { window.matches = value; for (const listener of listeners) listener() },
    listeners }
  return window
}

async function withWindow(window, run) {
  const saved = global.window
  global.window = window
  try { return await withTsx(run) } finally { if (saved === undefined) delete global.window; else global.window = saved }
}

test('the store answers synchronously from matchMedia, notifies on crossings and stays false on the server', async () => {
  const window = fakeWindow(true)
  await withWindow(window, () => {
    const { createMediaQueryStore, DESKTOP_MEDIA_QUERY, DESKTOP_BREAKPOINT } = require('./use-mobile.tsx')
    assert.equal(DESKTOP_BREAKPOINT, 1200)
    assert.equal(DESKTOP_MEDIA_QUERY, '(min-width: 1200px)')
    const store = createMediaQueryStore(DESKTOP_MEDIA_QUERY)
    assert.equal(store.getServerSnapshot(), false)
    assert.equal(window.queries.length, 0, 'nothing touches the browser until a client read')
    assert.equal(store.getSnapshot(), true, 'the first client read is the actual browser answer')
    let notified = 0
    const stop = store.subscribe(() => notified++)
    window.cross(false)
    assert.equal(notified, 1)
    assert.equal(store.getSnapshot(), false)
    window.cross(true)
    assert.equal(notified, 2)
    stop()
    window.cross(false)
    assert.equal(notified, 2, 'unsubscribing removes the change listener')
    assert.equal(window.listeners.size, 0)
    assert.deepEqual(window.queries, ['(min-width: 1200px)'], 'one MediaQueryList per store')
    assert.equal(store.getServerSnapshot(), false, 'the server snapshot never follows the browser')
  })
})

test('useIsDesktop is useSyncExternalStore over the desktop store, so a client-mounted screen renders the live width first', async () => {
  const window = fakeWindow(true)
  const calls = []
  const load = Module._load
  Module._load = function(name, ...args) {
    if (name === 'react') return { ...React, useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      calls.push({ subscribe, getSnapshot, getServerSnapshot }); return getSnapshot()
    } }
    return load.call(this, name, ...args)
  }
  try {
    await withWindow(window, () => {
      const { useIsDesktop, useIsMobile } = require('./use-mobile.tsx')
      assert.equal(useIsDesktop(), true, 'the first client render is already desktop at 1280')
      assert.equal(calls.length, 1)
      assert.equal(calls[0].getServerSnapshot(), false)
      let notified = 0
      const stop = calls[0].subscribe(() => notified++)
      window.cross(false)
      assert.equal(notified, 1, 'React is told about the crossing through the store subscription')
      assert.equal(useIsDesktop(), false)
      stop()
      assert.equal(useIsMobile(), false, 'the mobile hook shares the store shape and the same fake answer')
      assert.deepEqual(window.queries, ['(min-width: 1200px)', '(max-width: 767px)'])
    })
  } finally { Module._load = load }
})

test('a server render prints the server snapshot without reading the browser', async () => {
  const window = fakeWindow(true)
  await withWindow(window, () => {
    const { useIsDesktop } = require('./use-mobile.tsx')
    const Probe = () => React.createElement('p', null, String(useIsDesktop()))
    assert.equal(renderToStaticMarkup(React.createElement(Probe)), '<p>false</p>')
    assert.equal(window.queries.length, 0)
  })
})
