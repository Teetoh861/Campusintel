// Run with lib/auth/test-loader.cjs preloaded. A notes topic counts as opened only after 30 seconds on screen in one
// visit (time adds up, a hidden tab does not count), with one background request per topic per visit. On screen: 60% of
// the note in view, or the note filling at least 60% of the screen (long notes on phones).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const SCREEN = 800

function harness() {
  const saved = { window: global.window, document: global.document, fetch: global.fetch,
    IntersectionObserver: global.IntersectionObserver, performance: global.performance }
  const originalLoad = Module._load
  const file = require.resolve('./NoteUseTracker.ts')
  let now = 0
  const timers = new Map()
  let nextTimer = 0
  const sent = []
  const observed = new Set()
  let notify
  const docListeners = {}
  const winListeners = {}
  const frames = []
  // Each note has a height and a top relative to the screen; moving it is scrolling.
  const note = (id, height) => {
    const n = { dataset: { noteItem: id }, top: 5_000, height }
    n.getBoundingClientRect = () => ({ top: n.top, bottom: n.top + n.height, height: n.height })
    return n
  }
  const notes = [note('n1', 300), note('n2', 300), note('long', 3 * SCREEN)]
  const doc = { visibilityState: 'visible',
    querySelectorAll: selector => (assert.equal(selector, '#notes [data-note-item]'), notes),
    addEventListener: (name, fn) => { docListeners[name] = fn }, removeEventListener: name => { delete docListeners[name] } }
  global.window = { innerHeight: SCREEN,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id },
    clearTimeout: id => timers.delete(id),
    // Frames run later, as in a browser: scrollTo flushes them.
    requestAnimationFrame: fn => frames.push(fn), cancelAnimationFrame: () => {},
    addEventListener: (name, fn) => { winListeners[name] = fn }, removeEventListener: name => { delete winListeners[name] } }
  global.document = doc
  global.performance = { now: () => now }
  global.fetch = async (url, init) => { sent.push([url, JSON.parse(init.body), init.headers]); return {} }
  global.IntersectionObserver = class {
    constructor(callback) { notify = callback }
    observe(target) { observed.add(target) }
    unobserve(target) { observed.delete(target) }
    disconnect() { observed.clear() }
  }
  const effects = []
  Module._load = function(name, ...args) {
    if (name === 'react') return { useRef: initial => ({ current: initial }), useEffect: callback => effects.push(callback) }
    return originalLoad.call(this, name, ...args)
  }
  delete require.cache[file]
  const { NoteUseTracker } = require(file)
  NoteUseTracker({ courseSlug: 'bua-201', continuityToken: 'page-token' })
  const cleanup = effects[0]()
  const advance = ms => {
    const end = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0]); now = due[1].at; due[1].fn()
    }
    now = end
  }
  // Place a note at `top` (pixels from the top of the screen), telling the observer whether any of it is in view.
  const place = (target, top) => {
    target.top = top
    notify([{ target, isIntersecting: top < SCREEN && top + target.height > 0 }])
  }
  // Scroll without crossing an observer threshold: only the scroll listener sees it.
  const scrollTo = (target, top) => {
    target.top = top
    winListeners.scroll()
    winListeners.scroll() // several scroll events in one frame are measured once
    assert.equal(frames.length, 1)
    frames.splice(0).forEach(fn => fn())
  }
  const show = (target, visible) => place(target, visible ? 100 : 5_000)
  const restore = () => {
    cleanup()
    Module._load = originalLoad
    delete require.cache[file]
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete global[key]; else global[key] = value }
  }
  return { notes, sent, observed, timers, docListeners, winListeners, doc, advance, place, scrollTo, show, restore }
}

test('scrolling past a topic never counts; 30 seconds on screen counts it once', () => {
  const h = harness()
  try {
    const [first] = h.notes
    h.show(first, true); h.advance(5_000); h.show(first, false)
    h.advance(60_000)
    assert.deepEqual(h.sent, [], 'five seconds in view is scrolling past')
    h.show(first, true); h.advance(24_999)
    assert.deepEqual(h.sent, [], 'the time adds up within the visit: 29.999 s so far')
    h.advance(1)
    assert.equal(h.sent.length, 1)
    assert.deepEqual(h.sent[0].slice(0, 2), ['/api/plan-use', { courseSlug: 'bua-201', itemId: 'n1' }])
    assert.equal(h.sent[0][2]['x-campus-account-continuity'], 'page-token')
    assert.equal(h.observed.has(first), false, 'a counted topic is no longer watched')
    h.show(first, false); h.show(first, true); h.advance(60_000)
    assert.equal(h.sent.length, 1, 'one request per topic per visit')
  } finally { h.restore() }
})

test('a short note only partly in view is not on screen', () => {
  const h = harness()
  try {
    const [first] = h.notes
    h.place(first, SCREEN - 150) // half of a 300 px note
    h.advance(60_000)
    assert.deepEqual(h.sent, [])
    h.scrollTo(first, SCREEN - 200) // two thirds of it
    h.advance(30_000)
    assert.deepEqual(h.sent.map(([, body]) => body.itemId), ['n1'])
  } finally { h.restore() }
})

test('a note taller than the screen counts while it fills at least 60% of the screen', () => {
  const h = harness()
  try {
    const long = h.notes[2]
    h.place(long, SCREEN - 200) // its first 200 px: a quarter of the screen
    h.advance(60_000)
    assert.deepEqual(h.sent, [], 'a long note just peeking in is not on screen')
    h.scrollTo(long, 0) // filling the whole screen, yet only a third of it in view
    h.advance(10_000)
    h.scrollTo(long, -1_000) // reading further down: still filling the screen
    h.advance(10_000)
    h.scrollTo(long, -(3 * SCREEN) + 300) // its last 300 px: under 60% of the screen
    h.advance(60_000)
    assert.deepEqual(h.sent, [], '20 s filling the screen so far')
    h.scrollTo(long, -(3 * SCREEN) + 480) // its last 480 px: exactly 60% of the screen
    h.advance(10_000)
    assert.deepEqual(h.sent.map(([, body]) => body.itemId), ['long'])
  } finally { h.restore() }
})

test('a hidden tab does not count, and each topic is timed on its own', () => {
  const h = harness()
  try {
    const [first, second] = h.notes
    h.show(first, true); h.place(second, 450)
    h.advance(20_000)
    h.doc.visibilityState = 'hidden'; h.docListeners.visibilitychange()
    h.advance(120_000)
    assert.deepEqual(h.sent, [], 'time in a hidden tab is not on screen')
    h.doc.visibilityState = 'visible'; h.docListeners.visibilitychange()
    h.show(second, false)
    h.advance(10_000)
    assert.deepEqual(h.sent.map(([, body]) => body.itemId), ['n1'], 'only the topic still on screen reaches 30 s')
    h.place(second, 450); h.advance(10_000)
    assert.deepEqual(h.sent.map(([, body]) => body.itemId), ['n1', 'n2'])
  } finally { h.restore() }
})

test('leaving the page stops every timer and listener', () => {
  const h = harness()
  const [first] = h.notes
  h.show(first, true)
  assert.equal(h.timers.size, 1)
  h.restore()
  assert.equal(h.timers.size, 0)
  assert.deepEqual(Object.keys(h.winListeners), [])
  assert.deepEqual(Object.keys(h.docListeners), [])
})
