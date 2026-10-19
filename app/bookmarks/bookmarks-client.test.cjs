// app/bookmarks/bookmarks-client.test.cjs — Snapshot order, ten per page, confirmed-only removal, refill/clamp and focus over the shared store.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const { fixture } = require('../../components/student/control-fixture.cjs')

const LONG_TITLE = 'Actuarial Mathematics and Contingencies: Life Insurance Models, Annuities and Applications '.repeat(3).trim()
const ready = (n, extra = {}) => ({ code: `BUA${String(n).padStart(3, '0')}`, title: `Course ${n}`, href: `/courses/course-${n}`,
  learningTypes: ['Notes', 'CBT practice'], ...extra })
const entry = (n, row = ready(n)) => ({ slug: `course-${n}`, code: row.code ?? `REPO${n}`, contentKey: `key-${n}`, row })
const catalogOf = count => Array.from({ length: count }, (_, i) => entry(i + 1))
const keysOf = count => Array.from({ length: count }, (_, i) => `key-${i + 1}`)

async function bookmarks(run, { catalog = catalogOf(23), snapshot = { mode: 'account', keys: keysOf(23) } } = {}) {
  const store = { snapshot, removals: [], refreshes: 0, outcome: 'confirmed', release: null }
  const focused = []
  const focusDocument = { activeElement: null }
  const events = []
  const deferredRefs = new Set()
  const originalLoad = Module._load
  const timers = { setTimeout: global.setTimeout }
  Module._load = function(name, ...args) {
    if (name === '@/lib/bookmarks/client') return { useBookmarks: () => ({
      snapshot: store.snapshot,
      refresh: async () => { store.refreshes++ },
      toggle: async () => { throw new Error('the register removes; it never toggles') },
      remove: course => new Promise((resolve, reject) => {
        store.removals.push(course.contentKey)
        const settle = () => {
          if (store.outcome === 'confirmed') {
            store.snapshot = { ...store.snapshot, keys: store.snapshot.keys.filter(key => key !== course.contentKey) }
            resolve(true)
          } else if (store.outcome === 'rejected') reject(new Error('transport rejected'))
          else resolve(false)
        }
        if (store.release === 'manual') store.settle = settle; else settle()
      }),
    }) }
    if (name === 'next/link') return { __esModule: true, default: ({ href, children, prefetch, ...rest }) =>
      require('react').createElement('a', { href, ...rest }, children) }
    return originalLoad.call(this, name, ...args)
  }
  try {
    // Success feedback dismisses on a real timer; the suite observes state, not timing.
    global.setTimeout = () => 1
    await fixture(async f => {
      const { BookmarksClient } = require('./BookmarksClient.tsx')
      const { BookmarkToggle } = require('../../components/student/BookmarkToggle.tsx')
      const { EmptyState } = require('../../components/student/EmptyState.tsx')
      const { Pagination } = require('../../components/student/Pagination.tsx')
      const { CourseRegister } = require('../../components/student/CourseRow.tsx')
      const node = name => ({ name, isConnected: true, disabled: false, ownerDocument: focusDocument, focus() {
        assert.ok(this.isConnected, 'focus must use a currently mounted node')
        assert.equal(this.disabled, false, 'global serialization must clear before restoration focuses a toggle')
        focusDocument.activeElement = this
        focused.push(name)
        events.push({ kind: 'focus', name })
      } })
      const attached = new Map()
      const emptyNode = node('empty-heading')
      const headNode = node('head')
      const view = f.mount(BookmarksClient, { catalog }, { onCommit: tree => {
        const register = f.nodes(tree).find(element => element.type === CourseRegister)
        const current = new Map((register?.props.children ?? []).map(row => [row.key, row.props.trailingAction]))
        for (const [key, old] of attached) if (!current.has(key)) {
          old.node.isConnected = false
          old.ref(null)
          attached.delete(key)
        }
        for (const [key, toggle] of current) {
          if (deferredRefs.has(key)) {
            const old = attached.get(key)
            if (old) { old.node.isConnected = false; old.ref(null); attached.delete(key) }
            toggle.props.ref(null)
            continue
          }
          const currentNode = attached.get(key)?.node ?? node(toggle.props.label)
          currentNode.disabled = toggle.props.disabled ?? false
          toggle.props.ref(currentNode)
          attached.set(key, { node: currentNode, ref: toggle.props.ref })
          events.push({ kind: 'attach', key, name: currentNode.name, disabled: currentNode.disabled })
        }
        for (const element of f.nodes(tree)) {
          if (element.type === EmptyState) element.props.headingRef.current = emptyNode
          if (element.type === 'div' && /student-bookmarks-head/.test(element.props.className ?? '')) element.props.ref.current = headNode
        }
      } })
      // Effects may request a different page; commit that page and its refs before observing settled output.
      const tree = () => {
        for (let commits = 0; commits < 8; commits++) {
          const previous = view.slots.slice()
          const rendered = view.render()
          if (previous.length === view.slots.length && previous.every((value, index) => Object.is(value, view.slots[index]))) return rendered
        }
        throw new Error('Bookmark focus restoration did not settle')
      }
      const html = () => f.html(tree())
      const toggles = () => f.nodes(tree()).filter(element => element.type === BookmarkToggle)
      const visibleKeys = () => {
        const register = f.nodes(tree()).find(element => element.type === CourseRegister)
        return register ? register.props.children.map(child => child.key) : []
      }
      const pager = () => f.nodes(tree()).find(element => element.type === Pagination)
      const feedback = () => /class="student-bookmark-feedback" data-state="([^"]+)"/.exec(html())?.[1]
      const count = () => /student-bookmarks-count">([^<]+)</.exec(html())?.[1] ?? null
      const press = async key => {
        const toggle = toggles().find(element => element.props.label === `Bookmark ${key}`)
        assert.ok(toggle, `toggle for ${key}`)
        const button = BookmarkToggle(toggle.props)
        if (button.props.onClick && !button.props.disabled) await button.props.onClick()
        return tree()
      }
      await run({ ...f, store, focused, focusDocument, events, attached, deferredRefs, view, tree, html, toggles, visibleKeys, pager, feedback, count, press,
        BookmarkToggle, EmptyState, Pagination, CourseRegister })
    })
  } finally {
    Module._load = originalLoad
    global.setTimeout = timers.setTimeout
  }
}

const titleOf = n => `Course ${n}`
const keys = (...ns) => ns.map(n => `key-${n}`)

test('rows follow the bookmark snapshot order through the central presentation, deduplicated, never re-sorted', async () =>
  bookmarks(async f => {
    assert.deepEqual(f.visibleKeys(), keys(3, 1, 2))
    assert.equal(f.count(), '3 courses')
    const html = f.html()
    assert.ok(html.indexOf('Course 3') < html.indexOf('Course 1') && html.indexOf('Course 1') < html.indexOf('Course 2'))
    assert.match(html, /aria-label="Bookmarked courses"[^>]*data-columns="single"/)
    assert.doesNotMatch(html, /Recently saved|Sort|Filter|<input\b|<select\b|student-grid|class="student-pagination"/)
    assert.equal(f.pager().props.totalPages, 1, 'one page renders no pager')
  }, { catalog: catalogOf(4), snapshot: { mode: 'account', keys: ['key-3', 'key-1', 'key-3', 'unknown-key', 'key-2'] } }))

test('legacy device keys resolve by slug or code only in local mode; account keys are content keys only', async () => {
  await bookmarks(async f => assert.deepEqual(f.visibleKeys(), keys(2, 1)),
    { catalog: catalogOf(3), snapshot: { mode: 'local', keys: ['BUA002', 'course-1', 'key-3'] } })
  await bookmarks(async f => assert.deepEqual(f.visibleKeys(), keys(3)),
    { catalog: catalogOf(3), snapshot: { mode: 'account', keys: ['BUA002', 'course-1', 'key-3'] } })
})

test('ten logical bookmarks per page at every width, with the count showing the whole set', async () => bookmarks(async f => {
  assert.deepEqual(f.visibleKeys(), keys(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
  assert.equal(f.count(), '23 courses')
  assert.deepEqual([f.pager().props.page, f.pager().props.totalPages, f.pager().props.label], [1, 3, 'Bookmarks pages'])
  f.pager().props.onPageChange(2)
  assert.deepEqual(f.visibleKeys(), keys(11, 12, 13, 14, 15, 16, 17, 18, 19, 20))
  assert.equal(f.count(), '23 courses')
  f.pager().props.onPageChange(3)
  assert.deepEqual(f.visibleKeys(), keys(21, 22, 23))
  assert.equal(f.html().match(/student-course-row-shell/g).length, 3, 'no cumulative rendering')
  const source = fs.readFileSync(path.join(__dirname, 'BookmarksClient.tsx'), 'utf8')
  assert.doesNotMatch(source, /Show more|Load more|IntersectionObserver|matchMedia|innerWidth/)
  assert.match(fs.readFileSync(path.join(__dirname, 'presentation.ts'), 'utf8'), /BOOKMARKS_PER_PAGE = 10/)
  assert.ok(f.pager().props.scrollTarget.current.name === 'head', 'page changes return focus to the count line')
}))

test('a confirmed removal drops the row, updates the count, refills the page from following items and focuses the next toggle', async () =>
  bookmarks(async f => {
    f.pager().props.onPageChange(2)
    await f.press(titleOf(15))
    assert.deepEqual(f.store.removals, ['key-15'])
    assert.deepEqual(f.visibleKeys(), keys(11, 12, 13, 14, 16, 17, 18, 19, 20, 21))
    assert.equal(f.pager().props.page, 2)
    assert.equal(f.count(), '22 courses')
    assert.equal(f.feedback(), 'removed')
    assert.match(f.html(), /Removed from bookmarks/)
    assert.deepEqual(f.focused, [`Bookmark ${titleOf(16)}`])
  }))

test('removing the only item on the last page clamps to the previous page and focuses the previous toggle', async () =>
  bookmarks(async f => {
    f.pager().props.onPageChange(3)
    assert.deepEqual(f.visibleKeys(), keys(21))
    await f.press(titleOf(21))
    assert.deepEqual(f.visibleKeys(), keys(11, 12, 13, 14, 15, 16, 17, 18, 19, 20))
    assert.equal(f.pager().props.page, 2)
    assert.equal(f.pager().props.totalPages, 2)
    assert.deepEqual(f.focused, [`Bookmark ${titleOf(20)}`])
  }, { catalog: catalogOf(21), snapshot: { mode: 'account', keys: keysOf(21) } }))

test('removing the last row of a page with no following items falls back to the previous toggle without leaving the page', async () =>
  bookmarks(async f => {
    f.pager().props.onPageChange(3)
    await f.press(titleOf(23))
    assert.deepEqual(f.visibleKeys(), keys(21, 22))
    assert.equal(f.pager().props.page, 3)
    assert.deepEqual(f.focused, [`Bookmark ${titleOf(22)}`])
  }))

test('the final removal leaves the success feedback mounted, renders EmptyState and focuses its heading', async () =>
  bookmarks(async f => {
    await f.press(titleOf(1))
    const html = f.html()
    assert.equal(f.visibleKeys().length, 0)
    assert.equal(f.count(), '0 courses')
    assert.equal(f.feedback(), 'removed')
    assert.match(html, /Removed from bookmarks/)
    assert.match(html, /You haven’t bookmarked any courses yet\./)
    assert.match(html, /tabindex="-1">You haven’t bookmarked any courses yet\.</)
    assert.ok(html.indexOf('student-bookmark-feedback') < html.indexOf('student-empty-state'), 'feedback stays beside the count line')
    assert.deepEqual(f.focused, ['empty-heading'])
    assert.doesNotMatch(html, /class="student-pagination"|aria-pressed/)
  }, { catalog: catalogOf(1), snapshot: { mode: 'account', keys: keysOf(1) } }))

test('a failed removal keeps the row, keeps the toggle pressed, keeps focus there and shows the shared failure copy', async () =>
  bookmarks(async f => {
    f.store.outcome = 'failed'
    await f.press(titleOf(2))
    assert.deepEqual(f.visibleKeys(), keys(1, 2, 3))
    assert.equal(f.count(), '3 courses')
    assert.equal(f.feedback(), 'error')
    assert.match(f.html(), /Could not update bookmarks\. Try again\./)
    const toggle = f.toggles().find(element => element.props.label === `Bookmark ${titleOf(2)}`)
    assert.deepEqual([toggle.props.pressed, toggle.props.busy], [true, false])
    assert.deepEqual(f.focused, [`Bookmark ${titleOf(2)}`])
    // A new deliberate operation clears the obsolete failure while it is pending.
    f.store.release = 'manual'
    const second = f.press(titleOf(2))
    assert.equal(f.feedback(), 'idle')
    f.store.settle(); await second
    assert.equal(f.feedback(), 'error')
    assert.deepEqual(f.store.removals, ['key-2', 'key-2'])
  }, { catalog: catalogOf(3), snapshot: { mode: 'account', keys: keysOf(3) } }))

test('while a removal is pending the toggle is busy and still pressed, and repeated activation is ignored', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    const pending = f.press(titleOf(2))
    const busy = f.toggles().find(element => element.props.label === `Bookmark ${titleOf(2)}`)
    assert.deepEqual([busy.props.pressed, busy.props.busy], [true, true])
    assert.match(f.html(), /aria-pressed="true" aria-busy="true"/)
    assert.deepEqual(f.visibleKeys(), keys(1, 2, 3), 'nothing optimistic')
    await f.press(titleOf(3))
    await f.press(titleOf(2))
    assert.deepEqual(f.store.removals, ['key-2'], 'one store mutation per deliberate operation')
    f.store.settle(); await pending
    assert.deepEqual(f.visibleKeys(), keys(1, 3))
  }, { catalog: catalogOf(3), snapshot: { mode: 'account', keys: keysOf(3) } }))

test('each row is a course link and a sibling toggle: two independent targets, nothing nested, nothing Bookmarks-local', async () =>
  bookmarks(async f => {
    const html = f.html()
    const rows = [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map(match => match[1])
    assert.equal(rows.length, 2)
    for (const row of rows) {
      assert.match(row, /^<div class="student-course-row-shell"><a [^>]*href="\/courses\/course-\d"/)
      assert.ok(row.indexOf('</a>') < row.indexOf('<button'), 'the toggle follows the closed link')
      assert.match(row, /<button type="button" aria-label="Bookmark Course \d" aria-pressed="true"/)
      assert.doesNotMatch(row, /Free|credits|Difficulty|Exam-critical|Tracked|View course|Open course|data-level/)
    }
    assert.match(html, /Notes · CBT practice/)
    assert.equal((html.match(/<h1\b/g) || []).length, 0, 'the band owns the one h1; the register adds none')
    for (const file of ['BookmarksClient.tsx', 'page.tsx', 'presentation.ts']) {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      assert.doesNotMatch(source, /chrome\/Card|TaskHeader|SignalBar|CardProps|difficulty|credits|examCritical|student-grid|tagline|\/courses\/\$\{|Toast|Toaster|sonner|<svg|aria-live/, file)
    }
  }, { catalog: catalogOf(2), snapshot: { mode: 'account', keys: keysOf(2) } }))

test('inert rows keep the shared status copy, stay removable, and offer no row-level recovery actions', async () =>
  bookmarks(async f => {
    const html = f.html()
    assert.match(html, /Study materials are temporarily unavailable\./)
    assert.match(html, /Study materials are not available\./)
    assert.doesNotMatch(html, /Try again|Request Material|\/materials/)
    assert.equal((html.match(/<a\b/g) || []).length, 1, 'only the ready row links')
    assert.equal(f.toggles().length, 3)
    await f.press(titleOf(2))
    assert.deepEqual(f.visibleKeys(), keys(1, 3))
    assert.equal(f.feedback(), 'removed')
  }, { catalog: [entry(1), entry(2, { code: 'BUA002', title: 'Course 2', unavailable: 'temporary' }),
    entry(3, { code: 'BUA003', title: 'Course 3', unavailable: 'missing' })], snapshot: { mode: 'account', keys: keysOf(3) } }))

test('repository-only rows present the shared label, never a code, and name the toggle by title', async () =>
  bookmarks(async f => {
    const html = f.html()
    assert.match(html, /data-identity="repository">Additional study material</)
    assert.match(html, /aria-label="Bookmark Business Statistics" aria-pressed="true"/)
    assert.doesNotMatch(html, /REPO1|undefined/)
    assert.ok(html.includes(LONG_TITLE), 'long titles stay complete')
    assert.doesNotMatch(html, /line-clamp|truncate|text-ellipsis/)
  }, { catalog: [entry(1, { repositoryOnly: true, title: 'Business Statistics', href: '/courses/business-statistics', learningTypes: ['CBT practice'] }),
    entry(2, { code: 'ACT301', title: LONG_TITLE, href: '/courses/course-2', learningTypes: ['Notes'] })],
  snapshot: { mode: 'account', keys: keysOf(2) } }))

test('loading, unavailable and empty states come from the shared owners with real destinations', async () => {
  await bookmarks(async f => {
    const html = f.html()
    assert.match(html, /role="status" aria-live="polite" aria-busy="true"><span class="sr-only">Loading your bookmarks\.<\/span>/)
    assert.match(html, /aria-label="Course placeholders"[^>]*data-count="10"[^>]*data-columns="single"/)
    assert.equal((html.match(/<li\b/g) || []).length, 10)
    assert.doesNotMatch(html, /aria-pressed|student-bookmarks-count|student-pagination|<a\b|<button\b/)
  }, { snapshot: { mode: 'loading', keys: [] } })
  await bookmarks(async f => {
    const html = f.html()
    assert.match(html, /role="alert"[\s\S]*Bookmarks temporarily unavailable/)
    assert.match(html, /We couldn’t load your bookmarks just now\. Try again to see your latest bookmarks\./)
    assert.doesNotMatch(html, /aria-pressed|student-bookmarks-count|haven’t bookmarked/)
    f.nodes(f.tree()).find(element => element.type === 'button' && element.props.children === 'Try again').props.onClick()
    assert.equal(f.store.refreshes, 1)
  }, { snapshot: { mode: 'unavailable', keys: [] } })
  await bookmarks(async f => {
    const html = f.html()
    assert.match(html, /You haven’t bookmarked any courses yet\./)
    assert.match(html, /Bookmark a course from All Courses or its course page and it will appear here\./)
    assert.match(html, /lucide-bookmark/)
    const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(match => [match[1], match[2].replace(/<[^>]+>/g, '').trim()])
    assert.deepEqual(links, [['/courses', 'Browse All Courses'], ['/my-courses', 'My Courses']])
    assert.ok(links.every(() => /min-h-11/.test(html)))
    assert.doesNotMatch(html, /aria-pressed|student-bookmarks-count|class="student-pagination"/)
    assert.equal(f.feedback(), 'idle')
  }, { snapshot: { mode: 'account', keys: [] } })
})


test('a rejected removal retains confirmed rows, pressed state and the same focused toggle', async () =>
  bookmarks(async f => {
    f.store.outcome = 'rejected'
    await f.press(titleOf(2))
    assert.deepEqual(f.visibleKeys(), keys(1, 2, 3))
    assert.equal(f.feedback(), 'error')
    assert.deepEqual(f.focused, ['Bookmark Course 2'])
    assert.deepEqual(f.toggles().map(toggle => toggle.props.pressed), [true, true, true])
  }, { catalog: catalogOf(3), snapshot: { mode: 'account', keys: keysOf(3) } }))

test('focus uses stable neighbors when another confirmed store update removes an earlier row during the write', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    const pending = f.press(titleOf(2))
    f.store.snapshot = { mode: 'account', keys: keys(2, 3, 4) }
    f.tree()
    f.store.settle(); await pending
    assert.deepEqual(f.visibleKeys(), keys(3, 4))
    assert.deepEqual(f.focused, ['Bookmark Course 3'])
  }, { catalog: catalogOf(4), snapshot: { mode: 'account', keys: keysOf(4) } }))

test('paging during a pending write returns to the logical next bookmark page after confirmation', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    const pending = f.press(titleOf(2))
    f.pager().props.onPageChange(2)
    assert.deepEqual(f.visibleKeys(), keys(11, 12, 13, 14, 15, 16, 17, 18, 19, 20))
    f.store.settle(); await pending
    assert.equal(f.pager().props.page, 1)
    assert.deepEqual(f.focused, ['Bookmark Course 3'])
    assert.equal(f.focusDocument.activeElement, f.attached.get('key-3').node)
  }))

for (const total of [11, 21]) {
  for (const outcome of ['confirmed', 'failed']) {
    test(`${total} bookmarks: ${outcome} removal restores logical identity after pending pagination`, async () =>
      bookmarks(async f => {
        f.store.release = 'manual'
        f.store.outcome = outcome
        f.tree()
        const original = f.attached.get('key-2').node
        const pending = f.press(titleOf(2))
        f.pager().props.onPageChange(Math.ceil(total / 10))
        assert.equal(f.visibleKeys()[0], `key-${total === 11 ? 11 : 21}`)
        assert.equal(original.isConnected, false, 'the original DOM node is no longer the focus authority')
        assert.equal(f.count(), `${total} courses`, 'no optimistic count change')
        assert.deepEqual(f.focused, [], 'no mutation focus while pending')
        f.store.settle(); await pending
        f.tree()
        const targetKey = outcome === 'confirmed' ? 'key-3' : 'key-2'
        assert.equal(f.pager().props.page, 1)
        assert.equal(f.count(), `${outcome === 'confirmed' ? total - 1 : total} courses`)
        assert.equal(f.feedback(), outcome === 'confirmed' ? 'removed' : 'error')
        assert.deepEqual(f.focused, [outcome === 'confirmed' ? 'Bookmark Course 3' : 'Bookmark Course 2'])
        assert.equal(f.focusDocument.activeElement, f.attached.get(targetKey).node)
        assert.equal(f.focusDocument.activeElement.disabled, false)
        assert.ok(f.toggles().every(toggle => toggle.props.pressed && !toggle.props.busy && !toggle.props.disabled))
        if (outcome === 'failed') assert.notEqual(f.focusDocument.activeElement, original, 'failure uses the new attached ref for the original identity')
      }, { catalog: catalogOf(total), snapshot: { mode: 'account', keys: keysOf(total) } }))
  }
}

test('eleven bookmarks: removing the last-page item focuses its previous identity after pending navigation to page one', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    f.pager().props.onPageChange(2)
    assert.deepEqual(f.visibleKeys(), keys(11))
    const pending = f.press(titleOf(11))
    f.pager().props.onPageChange(1)
    assert.deepEqual(f.visibleKeys(), keys(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
    f.store.settle(); await pending
    assert.deepEqual(f.visibleKeys(), keys(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
    assert.equal(f.pager().props.page, 1)
    assert.equal(f.pager().props.totalPages, 1)
    assert.doesNotMatch(f.html(), /class="student-pagination"/)
    assert.deepEqual(f.focused, ['Bookmark Course 10'])
    assert.equal(f.focusDocument.activeElement, f.attached.get('key-10').node)
  }, { catalog: catalogOf(11), snapshot: { mode: 'account', keys: keysOf(11) } }))

test('eleven bookmarks: page one refills only after confirmed removal', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    const pending = f.press(titleOf(2))
    assert.deepEqual(f.visibleKeys(), keys(1, 2, 3, 4, 5, 6, 7, 8, 9, 10))
    assert.equal(f.count(), '11 courses')
    f.store.settle(); await pending
    assert.deepEqual(f.visibleKeys(), keys(1, 3, 4, 5, 6, 7, 8, 9, 10, 11))
    assert.equal(f.count(), '10 courses')
    assert.deepEqual(f.focused, ['Bookmark Course 3'])
  }, { catalog: catalogOf(11), snapshot: { mode: 'account', keys: keysOf(11) } }))

test('twenty-one bookmarks: a middle page refills and stays active for the logical next identity', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    f.pager().props.onPageChange(2)
    const pending = f.press(titleOf(12))
    f.pager().props.onPageChange(3)
    assert.deepEqual(f.visibleKeys(), keys(21))
    f.store.settle(); await pending
    assert.deepEqual(f.visibleKeys(), keys(11, 13, 14, 15, 16, 17, 18, 19, 20, 21))
    assert.equal(f.pager().props.page, 2)
    assert.deepEqual(f.focused, ['Bookmark Course 13'])
  }, { catalog: catalogOf(21), snapshot: { mode: 'account', keys: keysOf(21) } }))

for (const outcome of ['confirmed', 'failed']) {
  test(`${outcome} removal waits for the intended target ref after changing pages`, async () =>
    bookmarks(async f => {
      f.store.release = 'manual'
      f.store.outcome = outcome
      const pending = f.press(titleOf(2))
      f.pager().props.onPageChange(3)
      f.tree()
      const targetKey = outcome === 'confirmed' ? 'key-3' : 'key-2'
      f.deferredRefs.add(targetKey)
      f.store.settle(); await pending
      assert.equal(f.pager().props.page, 1, 'resolve the target page before consulting its ref')
      assert.equal(f.attached.has(targetKey), false)
      assert.deepEqual(f.focused, [], 'no BODY, heading, visible-first or disconnected-ref fallback')
      f.deferredRefs.delete(targetKey)
      f.tree()
      assert.equal(f.focusDocument.activeElement, f.attached.get(targetKey).node)
      const expected = outcome === 'confirmed' ? 'Bookmark Course 3' : 'Bookmark Course 2'
      assert.deepEqual(f.focused, [expected])
      const focusedAt = f.events.findIndex(event => event.kind === 'focus')
      assert.ok(f.events.slice(0, focusedAt).some(event => event.kind === 'attach' && event.key === targetKey && !event.disabled))
      f.tree(); f.tree()
      assert.deepEqual(f.focused, [expected], 'a successfully focused request clears exactly once')
    }))
}

for (const outcome of ['confirmed', 'failed']) {
  test(`global serialization exposes busy only on the initiating toggle and clears disabled state on ${outcome}`, async () =>
    bookmarks(async f => {
      f.store.release = 'manual'
      f.store.outcome = outcome
      const staleActivate = f.toggles().find(toggle => toggle.props.label === 'Bookmark Course 3').props.onClick
      const pending = f.press(titleOf(2))
      for (const toggle of f.toggles()) {
        const active = toggle.props.label === 'Bookmark Course 2'
        assert.equal(toggle.props.pressed, true)
        assert.equal(toggle.props.busy, active)
        assert.equal(toggle.props.disabled, !active)
        const button = f.BookmarkToggle(toggle.props)
        assert.equal(button.props.disabled, !active)
        assert.equal(button.props['aria-busy'], active ? true : undefined)
        assert.equal(button.props['aria-disabled'], active ? true : undefined)
      }
      assert.equal(f.attached.get('key-2').node.disabled, false, 'the busy toggle stays focusable')
      await f.press(titleOf(3)); await f.press(titleOf(2)); staleActivate()
      assert.deepEqual(f.store.removals, ['key-2'], 'both native disabled semantics and the stale-event guard preserve serialization')
      assert.equal(f.count(), '23 courses')
      f.pager().props.onPageChange(2)
      assert.ok(f.toggles().every(toggle => toggle.props.disabled && !toggle.props.busy), 'newly rendered peers are also truthfully disabled')
      f.store.settle(); await pending
      assert.ok(f.toggles().every(toggle => !toggle.props.disabled && !toggle.props.busy), 'peers re-enable before post-mutation focus')
      assert.equal(f.focusDocument.activeElement.disabled, false)
    }))
}

test('global serialization transfers focus from a peer toggle before disabling that peer', async () =>
  bookmarks(async f => {
    f.store.release = 'manual'
    f.tree()
    const peer = f.attached.get('key-3').node
    const initiating = f.attached.get('key-2').node
    f.focusDocument.activeElement = peer
    const pending = f.press(titleOf(2))
    f.tree()
    assert.equal(peer.disabled, true)
    assert.equal(f.focusDocument.activeElement, initiating)
    assert.equal(initiating.disabled, false)
    f.store.outcome = 'failed'
    f.store.settle(); await pending
    f.tree()
    assert.equal(f.focusDocument.activeElement, initiating)
    assert.equal(peer.disabled, false)
  }))
