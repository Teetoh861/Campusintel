// app/access/free-month-offer.test.cjs — The free access offer driven through its own handlers: the button, the
// confirmation and its exact words, one request however often Start is tapped, what each answer does to the offer
// (free access starts, the offer has ended, an error the student can retry), and the three places built around the
// button (the Dashboard card, the plan card, the line above Pay), each of which goes when the offer is over.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')
// The one sentence every screen shows when the page belongs to an earlier sign-in.
const { SIGNED_IN_ON_ANOTHER_TAB } = require('../../lib/auth/constants.ts')
// How the server writes the day a database end covers, for the offer's `endsOn`.
const { formatFreeMonthDay } = require('../../lib/entitlements/presentation.ts')

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const CLAIM = { continuityToken: 'page-token', profileRevision: 7, endsOn: '16 December', closesInMs: 3_600_000 }
const ENDS = '2026-12-16T13:30:00+00:00'
// The offer as the database makes it from the launch: every claim ends at the end of 30 December in Lagos (the instant
// 31 December begins there, an exclusive end), and the claim closes at that same instant. Read at 09:00 Lagos on
// 1 December, with the day written out by the server's own formatter.
const DECEMBER_END = '2026-12-30T23:00:00.000Z'
const DECEMBER = { ...CLAIM, endsOn: formatFreeMonthDay(DECEMBER_END),
  closesInMs: Date.parse(DECEMBER_END) - Date.parse('2026-12-01T08:00:00.000Z') }

/**
 * Drives one client component with its own hook state: render() calls it, and components nested inside it render with
 * React's own hooks (their first state), so the whole screen can be read. `posts` records every command sent and
 * `refreshes` every time the page was asked to load again; `answer` is what the server says to the next command.
 */
async function drive(exportName, props, run, { answers = [] } = {}) {
  return withTsx(async () => {
    const original = Module._load
    const posts = [], refreshes = []
    // The browser around the component: timers it sets, and the page events it listens to.
    const timers = [], listeners = []
    const savedWindow = global.window, savedDocument = global.document
    const target = name => ({
      addEventListener: (type, handler) => listeners.push({ on: name, type, handler }),
      removeEventListener: (type, handler) => {
        const at = listeners.findIndex(item => item.on === name && item.type === type && item.handler === handler)
        if (at >= 0) listeners.splice(at, 1)
      } })
    global.window = { ...target('window'), setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length },
      clearTimeout: id => { if (timers[id - 1]) timers[id - 1].live = false } }
    global.document = { ...target('document'), visibilityState: 'visible' }
    const fire = (on, type, event = {}) => listeners.filter(item => item.on === on && item.type === type)
      .forEach(item => item.handler(event))
    const router = { refresh: () => refreshes.push('refresh') }
    let active = null
    const emulated = {
      useState: init => {
        const owner = active, n = owner.index++
        if (!(n in owner.slots)) owner.slots[n] = { value: typeof init === 'function' ? init() : init }
        const slot = owner.slots[n]
        return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
      },
      useRef: init => { const owner = active, n = owner.index++; if (!(n in owner.slots)) owner.slots[n] = { current: init }
        return owner.slots[n] },
      // Effects run after the render, again only when a dependency changed, and their cleanup runs first.
      useEffect: (effect, deps) => {
        const owner = active, n = owner.index++, prior = owner.slots[n]
        if (!prior || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
          owner.effects.push(() => { prior?.cleanup?.(); owner.slots[n] = { deps, cleanup: effect() } })
        }
      },
    }
    // The driven component uses the emulated hooks; anything React renders below it uses React's.
    const hooks = Object.fromEntries(Object.entries(emulated).map(([name, hook]) =>
      [name, (...args) => active ? hook(...args) : React[name](...args)]))
    const Dialog = ({ open, children }) => open ? React.createElement('dialog-open', null, children) : null
    const pass = tag => ({ children, className }) => React.createElement(tag, { className }, children)
    try {
      Module._load = function(name, ...args) {
        if (name === 'react') return { ...React, ...hooks }
        if (name === 'next/navigation') return { useRouter: () => router }
        if (name === '@/components/ui/dialog') return { Dialog, DialogContent: pass('section'), DialogTitle: pass('h2'),
          DialogDescription: pass('p') }
        if (name === '@/lib/entitlements/client') return { postEntitlementCommand: async (command, token) => {
          posts.push({ command, token })
          const next = answers.shift()
          return typeof next === 'function' ? next() : next ?? { status: 'month-started', endsAt: ENDS }
        } }
        return original.call(this, name, ...args)
      }
      const Component = require('./FreeMonthOffer.tsx')[exportName]
      const instance = { slots: [], index: 0, effects: [] }
      const render = () => {
        instance.index = 0; instance.effects = []; active = instance
        let tree
        try { tree = Component(props) } finally { active = null }
        for (const effect of instance.effects) effect()
        return tree
      }
      const html = () => renderToStaticMarkup(render())
      const unmount = () => instance.slots.forEach(slot => slot?.cleanup?.())
      await run({ render, html, posts, refreshes, timers, listeners, fire, unmount })
    } finally {
      Module._load = original
      if (savedWindow === undefined) delete global.window; else global.window = savedWindow
      if (savedDocument === undefined) delete global.document; else global.document = savedDocument
    }
  })
}

/** The first element in a rendered tree (through children and element-valued props) that matches. */
function find(node, match) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const child of node) { const hit = find(child, match); if (hit) return hit } return null }
  if (!node.props) return null
  if (match(node)) return node
  for (const value of Object.values(node.props)) {
    if (value !== null && typeof value === 'object') { const hit = find(value, match); if (hit) return hit }
  }
  return null
}
const label = node => text(renderToStaticMarkup(React.createElement(React.Fragment, null, node.props.children)))
const button = (tree, name) => find(tree, node => node.type === 'button' && label(node) === name)
const confirmation = tree => find(tree, node => typeof node.type === 'function' && node.type.name === 'OfferConfirm')
/** What the confirmation draws: its dialog, with the real buttons and the dialog's own dismiss handler. */
const shown = tree => { const offer = confirmation(tree); return offer.type(offer.props) }
const dialog = html => text(html.match(/<dialog-open>[\s\S]*<\/dialog-open>/)?.[0] ?? '')
/** Everything the last tap started has run as far as it can. */
const settled = () => new Promise(resolve => setImmediate(resolve))
const tapStart = async render => { button(shown(render()), 'Start free access').props.onClick(); await settled() }

test('the button opens the confirmation with the approved words, and nothing is sent until Start', async () => {
  await drive('FreeMonthStart', CLAIM, async ({ render, html, posts }) => {
    assert.equal(text(html()), 'Get free access', 'only the button until it is tapped')
    button(render(), 'Get free access').props.onClick()
    // The title carries the day the page was given, so the terms only say when it starts.
    assert.equal(dialog(html()), 'Free until 16 December What free access gives, and its terms. ' +
      'Full access to your courses, study guides and practice Campus Bot included ' +
      'Starts now You can’t change your department, level or semester until the semester ends. ' +
      'Not now Start free access')
    assert.deepEqual(posts, [], 'opening the confirmation claims nothing')
    // Not now closes it, and still nothing was sent.
    button(shown(render()), 'Not now').props.onClick()
    assert.equal(text(html()), 'Get free access')
    assert.deepEqual(posts, [])
  })
})

test('free access to the end of 30 December reads "30 December" wherever it is offered: never 31, never a month', async () => {
  assert.equal(DECEMBER.endsOn, '30 December', 'the last day the end covers, not the day the end instant falls on')
  const seen = []
  await drive('FreeMonthStart', DECEMBER, async ({ render, html }) => {
    button(render(), 'Get free access').props.onClick()
    seen.push(dialog(html()))
    assert.match(seen[0], /^Free until 30 December What free access gives, and its terms\. .* Starts now You can’t change /)
  })
  for (const [name, words] of [
    ['FreeMonthCard', 'Free until 30 December Full access to your courses and Campus Bot. Get free access'],
    ['FreeMonthPlanCard', 'Free until 30 December ₦0 Full access to your courses and Campus Bot. Get free access'],
    ['FreeMonthInstead', 'You can get free access until 30 December instead. Get free access']]) {
    await drive(name, DECEMBER, async ({ html }) => {
      seen.push(text(html()))
      assert.equal(seen.at(-1), words, name)
    })
  }
  for (const words of seen) assert.doesNotMatch(words, /\b31\b|month/i, words)
})

test('Start sends the action and the profile revision on the page, once, however often it is tapped', async () => {
  let release
  const held = new Promise(resolve => { release = resolve })
  await drive('FreeMonthStart', CLAIM, async ({ render, html, posts, refreshes }) => {
    button(render(), 'Get free access').props.onClick()
    // Three taps on the button as first drawn: the second and third land before it could be drawn disabled.
    const tap = button(shown(render()), 'Start free access').props.onClick
    tap(); tap(); tap()
    assert.deepEqual(posts, [{ command: { action: 'claim-free-month', profileRevision: 7 }, token: 'page-token' }],
      'one request: the action and the revision, with the page token, and no date or time')
    assert.match(dialog(html()), /Not now Starting…$/, 'while it is in flight the button says so')
    assert.match(html(), /<button type="button" disabled="" aria-busy="true"/, 'and is disabled')
    assert.equal(button(shown(render()), 'Not now').props.disabled, true, 'Not now is disabled as well')
    // Escape, or a tap outside the dialog.
    shown(render()).props.onOpenChange(false)
    assert.match(html(), /<dialog-open>/, 'the confirmation cannot be dismissed while the request is in flight')
    release({ status: 'month-started', endsAt: ENDS })
    await settled()
    assert.equal(html(), '', 'free access has started: the offer is gone')
    assert.deepEqual(refreshes, ['refresh'], 'and the page is read again, to show free access and its last day')
    assert.equal(posts.length, 1)
  }, { answers: [() => held] })
})

test('an error keeps the confirmation open with the approved line, and the student can try again', async () => {
  for (const failure of [{ status: 'unavailable' }, { status: 'invalid-request' }, { status: 'capacity' }]) {
    await drive('FreeMonthStart', CLAIM, async ({ render, html, posts, refreshes }) => {
      button(render(), 'Get free access').props.onClick()
      await tapStart(render)
      assert.match(dialog(html()), failure.status === 'invalid-request'
        ? /That didn’t go through\. Refresh the page and try again\. Not now Start free access$/
        : /Couldn’t start your free access\. Try again\. Not now Start free access$/, failure.status)
      assert.match(html(), /role="alert"/)
      assert.deepEqual(refreshes, [])
      // The second try succeeds.
      await tapStart(render)
      assert.equal(posts.length, 2)
      assert.equal(html(), '')
      assert.deepEqual(refreshes, ['refresh'])
    }, { answers: [failure, { status: 'month-started', endsAt: ENDS }] })
  }
})

test('too many attempts says to wait; a changed sign-in or changed courses reload the page', async () => {
  await drive('FreeMonthStart', CLAIM, async ({ render, html, refreshes }) => {
    button(render(), 'Get free access').props.onClick()
    await tapStart(render)
    assert.match(dialog(html()), /Too many attempts\. Please wait a few minutes and try again\./)
    assert.deepEqual(refreshes, [])
  }, { answers: [{ status: 'rate-limited' }] })
  for (const [answer, line] of [[{ status: 'selection-changed' }, 'Your courses were just updated.'],
    [{ status: 'signed-out' }, 'You’ve been signed out.'], [{ status: 'session-changed' }, SIGNED_IN_ON_ANOTHER_TAB]]) {
    await drive('FreeMonthStart', CLAIM, async ({ render, html, refreshes }) => {
      button(render(), 'Get free access').props.onClick()
      await tapStart(render)
      assert.ok(dialog(html()).includes(line), `${answer.status}: ${dialog(html())}`)
      assert.deepEqual(refreshes, ['refresh'], `${answer.status}: the page loads again`)
    }, { answers: [answer] })
  }
})

test('the claim closed meanwhile: the button gives way to "This offer has ended." and nothing can be sent again', async () => {
  await drive('FreeMonthStart', CLAIM, async ({ render, html, posts, refreshes }) => {
    button(render(), 'Get free access').props.onClick()
    await tapStart(render)
    assert.equal(text(html()), 'This offer has ended.')
    assert.equal(button(render(), 'Get free access'), null)
    assert.equal(posts.length, 1)
    assert.deepEqual(refreshes, [], 'the message stays where the offer was')
  }, { answers: [{ status: 'offer-ended' }] })
  await drive('FreeMonthStart', CLAIM, async ({ render, html }) => {
    button(render(), 'Get free access').props.onClick()
    await tapStart(render)
    assert.equal(text(html()), 'Free access isn’t available on this account.', 'never a reason')
  }, { answers: [{ status: 'offer-unavailable' }] })
})

const start = tree => find(tree, node => typeof node.type === 'function' && node.type.name === 'FreeMonthStart')

test('the Dashboard card: title, one line and the button; it goes when free access starts and leaves the message when the offer ends', async () => {
  await drive('FreeMonthCard', CLAIM, async ({ render, html }) => {
    assert.equal(text(html()), 'Free until 16 December Full access to your courses and Campus Bot. Get free access')
    assert.match(html(), /<section aria-labelledby="free-month-title" class="dashboard-offer[^"]*" data-free-month="offer">/)
    assert.deepEqual({ token: start(render()).props.continuityToken, revision: start(render()).props.profileRevision,
      endsOn: start(render()).props.endsOn }, { token: 'page-token', revision: 7, endsOn: '16 December' })
    start(render()).props.onOver(null)
    assert.equal(html(), '', 'free access started: the card disappears')
  })
  await drive('FreeMonthCard', CLAIM, async ({ render, html }) => {
    start(render()).props.onOver({ tone: 'info', text: 'This offer has ended.' })
    assert.equal(text(html()), 'This offer has ended.', 'the card disappears and the message is left in its place')
    assert.doesNotMatch(html(), /Free until|free access|data-free-month/i)
  })
})

test('the plan card: the name, ₦0, the line and the button, as a list item beside the paid plans', async () => {
  await drive('FreeMonthPlanCard', CLAIM, async ({ render, html }) => {
    assert.equal(text(html()), 'Free until 16 December ₦0 Full access to your courses and Campus Bot. Get free access')
    assert.match(html(), /^<li class="student-surface flex h-full flex-col" data-plan="free-month">/)
    assert.equal(start(render()).props.wide, true, 'its button fills the card, as the paid cards’ buttons do')
    start(render()).props.onOver({ tone: 'info', text: 'This offer has ended.' })
    assert.equal(text(html()), 'This offer has ended.')
    assert.doesNotMatch(html(), /₦0/)
  })
  await drive('FreeMonthPlanCard', CLAIM, async ({ render, html }) => {
    start(render()).props.onOver(null)
    assert.equal(html(), '')
  })
})

test('the line above Pay: one sentence and a quiet button, gone once the offer is over', async () => {
  await drive('FreeMonthInstead', CLAIM, async ({ render, html }) => {
    assert.equal(text(html()), 'You can get free access until 16 December instead. Get free access')
    assert.equal(start(render()).props.quiet, true, 'Pay stays the main action')
    start(render()).props.onOver(null)
    assert.equal(html(), '')
  })
})

test('an open offer is read again when the claim closes, using the delay the server worked out', async () => {
  await drive('FreeMonthStart', CLAIM, async ({ render, refreshes, timers, unmount, listeners }) => {
    render()
    assert.deepEqual(timers.filter(timer => timer.live).map(timer => timer.ms), [3_600_000], 'one timer, at the closing instant')
    render()
    assert.equal(timers.length, 1, 'drawing the page again sets no second timer')
    timers[0].fn()
    assert.deepEqual(refreshes, ['refresh'], 'when the claim closes the page is read again, so the offer goes')
    unmount()
    assert.equal(timers[0].live, false, 'leaving the page clears the timer')
    assert.equal(listeners.length, 0, 'and stops listening')
  })
  // A claim that stays open longer than a timer can wait is read again when the student next comes back instead.
  await drive('FreeMonthStart', { ...CLAIM, closesInMs: 30 * 24 * 3_600_000 }, async ({ render, timers }) => {
    render()
    assert.equal(timers.length, 0)
  })
  // Read at 09:00 Lagos on 1 December, the claim stays open to the end of 30 December: further off than a timer can
  // wait, so none is set.
  assert.equal(DECEMBER.closesInMs, 2_559_600_000)
  await drive('FreeMonthStart', DECEMBER, async ({ render, timers }) => {
    render()
    assert.equal(timers.length, 0, 'no timer')
  })
  // Read once less is left than that, one timer at exactly the delay the server gave.
  await drive('FreeMonthStart', { ...DECEMBER, closesInMs: 2_000_000_000 }, async ({ render, refreshes, timers }) => {
    render()
    assert.deepEqual(timers.map(timer => timer.ms), [2_000_000_000], 'one timer, at the closing instant')
    timers[0].fn()
    assert.deepEqual(refreshes, ['refresh'])
  })
})

test('coming back to the page reads it again: switching back to the tab, or returning with Back', async () => {
  await drive('FreeMonthStart', CLAIM, async ({ render, refreshes, fire }) => {
    render()
    global.document.visibilityState = 'hidden'
    fire('document', 'visibilitychange')
    assert.deepEqual(refreshes, [], 'leaving the tab does nothing')
    global.document.visibilityState = 'visible'
    fire('document', 'visibilitychange')
    assert.deepEqual(refreshes, ['refresh'], 'coming back to it reads the page again')
    fire('window', 'pageshow', { persisted: false })
    fire('window', 'pageshow', { persisted: true })
    assert.deepEqual(refreshes, ['refresh', 'refresh'], 'and so does a page restored by Back, not a fresh load')
  })
})

test('after "This offer has ended." the page is read again once the line has been read', async () => {
  await drive('FreeMonthStart', CLAIM, async ({ render, html, refreshes, timers }) => {
    button(render(), 'Get free access').props.onClick()
    await tapStart(render)
    assert.equal(text(html()), 'This offer has ended.')
    assert.deepEqual(refreshes, [], 'the line shows first')
    const pause = timers.find(timer => timer.ms === 5_000)
    assert.ok(pause, 'a refresh is set five seconds on')
    pause.fn()
    assert.deepEqual(refreshes, ['refresh'], 'then the page catches up, and the free pass can return')
  }, { answers: [{ status: 'offer-ended' }] })
  // Other refusals stay as they are: nothing about the claim changed.
  await drive('FreeMonthStart', CLAIM, async ({ render, timers }) => {
    button(render(), 'Get free access').props.onClick()
    await tapStart(render)
    assert.equal(timers.filter(timer => timer.ms === 5_000).length, 0)
  }, { answers: [{ status: 'offer-unavailable' }] })
})
