// app/courses/[slug]/bookmark-button.test.cjs — Retry clears stale failure feedback and reports the refreshed state.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { fixture } = require('../../../components/student/control-fixture.cjs')

async function withStore(run) {
  const store = { snapshot: { mode: 'account', keys: [] }, toggleResult: null, refreshes: 0, toggles: 0, afterRefresh: null }
  const originalLoad = Module._load
  Module._load = function(name, ...args) {
    if (name === '@/lib/bookmarks/client') return { useBookmarks: () => ({
      snapshot: store.snapshot,
      toggle: async () => { store.toggles++; return store.toggleResult },
      refresh: async () => { store.refreshes++; if (store.afterRefresh) store.snapshot = store.afterRefresh },
      remove: async () => true,
    }) }
    if (name === 'next/link') return { __esModule: true, default: ({ href, children, onClick }) =>
      require('react').createElement('a', { href, onClick }, children) }
    return originalLoad.call(this, name, ...args)
  }
  try {
    await fixture(async f => {
      const { BookmarkButton } = require('./BookmarkButton.tsx')
      const view = f.mount(BookmarkButton, { slug: 'central-route', code: 'BUA204', contentKey: 'central-key', catalog: [] })
      const html = () => f.html(view.render())
      const feedback = () => /class="student-bookmark-feedback" data-state="([^"]+)"/.exec(html())?.[1]
      // The shared toggle is a component element here; its props carry the control's state and action.
      const control = () => f.nodes(view.render()).find(node => node.type?.name === 'BookmarkToggle')
      await run({ ...f, store, view, html, feedback, control })
    })
  } finally { Module._load = originalLoad }
}

test('a failed mutation followed by a lost recovery state, then a successful retry, leaves no stale failure', async () => withStore(async f => {
  f.store.toggleResult = null
  await f.control().props.onClick()
  assert.equal(f.feedback(), 'error', 'the failed mutation is announced')
  assert.match(f.html(), /Could not update bookmarks\. Try again\./)
  f.store.snapshot = { mode: 'unavailable', keys: [] }
  assert.equal(f.control().props.label, 'Retry bookmarks')
  assert.equal(f.feedback(), 'error', 'the failure is still visible while recovery is unavailable')
  f.store.afterRefresh = { mode: 'account', keys: ['central-key'] }
  await f.control().props.onClick()
  assert.equal(f.store.refreshes, 1)
  assert.equal(f.store.toggles, 1, 'a retry refreshes; it never re-sends the mutation')
  const restored = f.html()
  assert.equal(f.control().props.pressed, true, 'the refreshed snapshot restores the saved state')
  assert.equal(f.control().props.label, 'Bookmark BUA204')
  assert.equal(f.feedback(), 'idle', 'stale failure feedback is gone')
  assert.doesNotMatch(restored, /Could not update|Added to bookmarks|Removed from bookmarks/, 'no manufactured success either')
}))

test('a retry that fails again shows the current failure, and clears as soon as the retry begins', async () => withStore(async f => {
  f.store.snapshot = { mode: 'unavailable', keys: [] }
  f.store.afterRefresh = { mode: 'unavailable', keys: [] }
  await f.control().props.onClick()
  assert.equal(f.control().props.label, 'Retry bookmarks')
  assert.equal(f.feedback(), 'error', 'a failed retry is announced as the current failure')
  f.store.afterRefresh = { mode: 'local', keys: ['BUA204'] }
  const pending = f.control().props.onClick()
  assert.equal(f.feedback(), 'idle', 'the obsolete failure is cleared the moment the retry begins')
  await pending
  assert.equal(f.feedback(), 'idle')
  assert.equal(f.control().props.pressed, true, 'the local alias snapshot is reflected after recovery')
}))
