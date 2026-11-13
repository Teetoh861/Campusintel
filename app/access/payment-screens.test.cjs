// app/access/payment-screens.test.cjs — The part 3 client screens driven through their own handlers: the Semester |
// Session switch and the Semester prompt, the free pass modal, Confirm and pay (disabled while submitting, no amount in
// the form), and every return-page state, including two minutes of polling, "still confirming" and Check again.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const ORDER = '3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'
const catalogue = [
  { plan: 'plus_session', tier: 'plus', period: 'session', price_kobo: 1100000 },
  { plan: 'plus_semester', tier: 'plus', period: 'semester', price_kobo: 600000 },
  { plan: 'standard_session', tier: 'standard', period: 'session', price_kobo: 700000 },
  { plan: 'standard_semester', tier: 'standard', period: 'semester', price_kobo: 400000 }]
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

/** Drives one client component with its own hook state: render() calls it, effects run after each render. */
async function drive(file, exportName, props, run, extraMocks = {}) {
  return withTsx(async () => {
    const original = Module._load
    let active = null
    const hooks = {
      useState: init => {
        const owner = active, n = owner.index++
        if (!(n in owner.slots)) owner.slots[n] = { value: typeof init === 'function' ? init() : init }
        const slot = owner.slots[n]
        return [slot.value, next => { slot.value = typeof next === 'function' ? next(slot.value) : next }]
      },
      useRef: init => { const owner = active, n = owner.index++; if (!(n in owner.slots)) owner.slots[n] = { current: init }
        return owner.slots[n] },
      useCallback: fn => { active.index++; return fn },
      useMemo: fn => { active.index++; return fn() },
      useContext: () => null,
      useEffect: (effect, deps) => {
        const owner = active, n = owner.index++, prior = owner.slots[n]
        if (!prior || !deps || deps.some((dep, i) => !Object.is(dep, prior.deps[i]))) {
          owner.effects.push(() => { prior?.cleanup?.(); owner.slots[n] = { deps, cleanup: effect() } })
        }
      },
    }
    const Dialog = ({ open, children }) => open ? React.createElement('dialog-open', null, children) : null
    const pass = tag => ({ children, className }) => React.createElement(tag, { className }, children)
    try {
      Module._load = function(name, ...args) {
        if (name === 'react') return { ...React, ...hooks }
        if (name === 'next/link') return { __esModule: true, default: ({ href, children, className }) =>
          React.createElement('a', { href, className }, children) }
        if (name === '@/components/ui/dialog') return { Dialog, DialogContent: pass('section'), DialogTitle: pass('h2'),
          DialogDescription: pass('p') }
        if (name in extraMocks) return extraMocks[name]
        return original.call(this, name, ...args)
      }
      const Component = require(file)[exportName]
      const instance = { slots: [], effects: [], index: 0 }
      const render = () => {
        instance.index = 0; instance.effects = []; active = instance
        let tree
        try { tree = Component(props) } finally { active = null }
        for (const effect of instance.effects) effect()
        return tree
      }
      const html = () => renderToStaticMarkup(render())
      await run({ render, html })
    } finally { Module._load = original }
  })
}

/** The first element in a rendered tree (through props.children) that matches. */
function find(node, match) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const child of node) { const hit = find(child, match); if (hit) return hit } return null }
  if (!node.props) return null
  if (match(node)) return node
  // Through children and any element-valued prop (an Outcome's actions, a Notice's action).
  for (const value of Object.values(node.props)) {
    if (value !== null && typeof value === 'object') { const hit = find(value, match); if (hit) return hit }
  }
  return null
}
const label = node => text(renderToStaticMarkup(React.createElement(React.Fragment, null, node.props.children)))

test('plans: Semester first; the switch shows Session prices with the saving line; every card line is the approved copy', async () => {
  await drive('./PlanChooser.tsx', 'PlanChooser', { plans: catalogue }, async ({ render, html }) => {
    const semester = text(html())
    assert.match(semester, /Standard · Semester ₦4,000 a semester Your courses this semester: notes, practice, exams and Campus Bot\./)
    assert.match(semester, /Plus · Semester ₦6,000 a semester Everything in Standard, with twice the Campus Bot use\./)
    assert.doesNotMatch(semester, /save|Session ₦/)
    assert.match(html(), /<legend class="sr-only">Billing period<\/legend>/)
    find(render(), node => node.type === 'input' && node.props.value === 'session').props.onChange()
    const session = text(html())
    assert.match(session, /Standard · Session ₦7,000 a session Both semesters · save ₦1,000/)
    assert.match(session, /Plus · Session ₦11,000 a session Both semesters · save ₦1,000/)
    // Session Pay goes straight to Confirm courses.
    assert.match(html(), /href="\/access\/checkout\?plan=standard_session"[^>]*>Pay ₦7,000<\/a>/)
    assert.doesNotMatch(session, /token|\b\d+ sets?\b|limit/i)
  })
})

test('choosing Semester shows the prompt first: Switch to Session or Keep Semester, both to Confirm courses', async () => {
  await drive('./PlanChooser.tsx', 'PlanChooser', { plans: catalogue }, async ({ render, html }) => {
    assert.doesNotMatch(html(), /dialog-open/)
    find(render(), node => node.type === 'button' && /Pay ₦4,000/.test(label(node))).props.onClick()
    const prompt = html().match(/<dialog-open>[\s\S]*<\/dialog-open>/)[0]
    assert.match(text(prompt), /Standard · Session Both semesters for ₦7,000, save ₦1,000\./)
    assert.match(prompt, /href="\/access\/checkout\?plan=standard_semester"[^>]*>Keep Semester<\/a>/)
    assert.match(prompt, /href="\/access\/checkout\?plan=standard_session"[^>]*>Switch to Session<\/a>/)
    find(render(), node => node.type === Object.getPrototypeOf(node).type || typeof node.props.onOpenChange === 'function')
      .props.onOpenChange(false)
    assert.doesNotMatch(html(), /dialog-open/, 'closing the prompt keeps the student on the plans')
  })
})

test('outside a First Semester only Semester plans are sold: no switch and no prompt', async () => {
  const semesterOnly = catalogue.filter(plan => plan.period === 'semester')
  await drive('./PlanChooser.tsx', 'PlanChooser', { plans: semesterOnly }, async ({ html }) => {
    const markup = html()
    assert.doesNotMatch(markup, /Billing period|Session/)
    assert.match(markup, /href="\/access\/checkout\?plan=plus_semester"[^>]*>Pay ₦6,000<\/a>/)
  })
})

test('Confirm and pay posts the plan, revision, request id and token only, and is disabled while submitting', async () => {
  const listeners = new Map(), starts = []
  global.window = { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) }
  try {
    await drive('./checkout/CheckoutForm.tsx', 'CheckoutForm', { plan: 'plus_session', priceKobo: 1100000,
      expectedRevision: 7, requestId: 'b7c6d5e4-0000-4000-8000-000000000001', continuityToken: 'page-token',
      onSubmitStart: () => starts.push(1) },
    async ({ render, html }) => {
      const markup = html()
      assert.match(markup, /<form [^>]*action="\/api\/payments\/checkout" method="post"/)
      const fields = [...markup.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], m[2]])
      assert.deepEqual(fields, [['plan', 'plus_session'], ['expected_profile_revision', '7'],
        ['request_id', 'b7c6d5e4-0000-4000-8000-000000000001'], ['return_path', '/access'], ['continuity', 'page-token']])
      assert.doesNotMatch(markup, /name="(amount|price)/, 'no amount ever comes from the browser')
      assert.match(text(markup), /Confirm and pay ₦11,000/)
      const prevented = []
      const form = () => find(render(), node => node.type === 'form')
      form().props.onSubmit({ preventDefault: () => prevented.push('first') })
      assert.equal(starts.length, 1, 'the confirm screen hears the attempt start')
      const busy = html()
      assert.match(busy, /<button type="submit" disabled="" aria-busy="true"/)
      assert.match(text(busy), /Opening payment…/)
      assert.match(busy, /role="status"[^>]*>Opening payment…/)
      form().props.onSubmit({ preventDefault: () => prevented.push('second') })
      assert.deepEqual(prevented, ['second'], 'a double tap sends one request')
      assert.equal(starts.length, 1, 'and starts one attempt')
      listeners.get('pageshow')({ persisted: true })
      assert.match(html(), /<button type="submit" aria-busy="false"/, 'Back from the payment page lets the student pay again')
    })
  } finally { delete global.window }
})

test('the checkout reason is read in the browser and shows once: never in the first render, out of the address on the next task, gone on Pay or Back', async () => {
  const lines = { 'unavailable': 'We couldn’t open the payment page. Try again in a moment.',
    'checkout-expired': 'That payment page expired. Try again to open a new one.',
    'selection-changed': 'Your courses changed. Check the list below, then try again.',
    'session-changed': 'Your session changed. Try again.', 'invalid-request': 'Something went wrong. Try again.',
    'something-new': 'We couldn’t open the payment page. Try again in a moment.' }
  const line = lines.unavailable
  const CheckoutForm = props => React.createElement('checkout-form', { 'data-plan': props.plan, 'data-price': String(props.priceKobo),
    'data-revision': String(props.expectedRevision), 'data-request': props.requestId, 'data-token': props.continuityToken })
  /** One mount of the screen at `location`; the browser's replace changes that address, as a real one would. */
  async function screen(location, run) {
    const listeners = new Map(), replaced = [], timers = []
    global.window = { location,
      history: { replaceState: (state, unused, url) => { replaced.push([state, url]); location.href = new URL(url, location.href).href } },
      setTimeout: fn => timers.push(fn), clearTimeout: () => {},
      addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) }
    try {
      await drive('./checkout/ConfirmAndPay.tsx', 'ConfirmAndPay', { plan: 'plus_session', priceKobo: 1100000,
        expectedRevision: 7, requestId: 'b7c6d5e4-0000-4000-8000-000000000001', continuityToken: 'page-token',
        children: React.createElement('course-list') },
      ({ render, html }) => run({ render, html, listeners, replaced, timers }), { './CheckoutForm': { CheckoutForm } })
    } finally { delete global.window }
  }
  const at = search => ({ href: `https://campusintell.test/access/checkout${search}` })
  const location = at('?plan=plus_session&status=unavailable')
  await screen(location, async ({ render, html, replaced, timers }) => {
    assert.doesNotMatch(html(), /role="alert"/, 'the first render (the server\'s, and so the router\'s copy) has no reason')
    const first = html()
    assert.match(first, /role="alert"/)
    assert.ok(first.indexOf(line) !== -1 && first.indexOf(line) < first.indexOf('<course-list'), 'the reason, above the courses')
    assert.ok(first.indexOf('<course-list') < first.indexOf('<checkout-form'), 'the form last')
    assert.match(first, /<checkout-form data-plan="plus_session" data-price="1100000" data-revision="7" data-request="b7c6d5e4-0000-4000-8000-000000000001" data-token="page-token"/)
    assert.deepEqual(replaced, [], 'the address waits for the next task, when the router has taken over the history')
    assert.equal(timers.length, 1)
    timers[0]()
    assert.deepEqual(replaced, [[null, '/access/checkout?plan=plus_session']], 'status leaves the address; the plan stays')
    html()
    assert.equal(timers.length, 1, 'once')
    find(render(), node => node.type === CheckoutForm).props.onSubmitStart()
    const paying = html()
    assert.ok(!paying.includes(line), 'paying again hides the last attempt\'s reason')
    assert.doesNotMatch(paying, /role="alert"/)
    assert.match(paying, /<course-list><\/course-list><checkout-form /)
  })
  // Back to this entry after an in-app link mounts the screen again: the address has no reason now, so none shows.
  assert.equal(location.href, 'https://campusintell.test/access/checkout?plan=plus_session')
  await screen(location, async ({ html, replaced, timers }) => {
    html()
    assert.doesNotMatch(html(), /role="alert"/)
    assert.deepEqual(replaced, [])
    assert.equal(timers.length, 0)
  })
  await screen(at('?plan=plus_session&status=unavailable'), async ({ html, listeners }) => {
    html()
    listeners.get('pageshow')({ persisted: false })
    assert.ok(html().includes(line), 'an ordinary load keeps it')
    listeners.get('pageshow')({ persisted: true })
    assert.ok(!html().includes(line), 'Back restores the page from memory without the old reason')
  })
  for (const [status, expected] of Object.entries(lines)) {
    await screen(at(`?plan=plus_session&status=${status}`), async ({ html }) => {
      html()
      const shown = html()
      assert.ok(text(shown).includes(expected), status)
      assert.doesNotMatch(shown, /charged/i, status)
    })
  }
  // A status with no line of its own (already-paid) still leaves the address; a clean address is left alone.
  await screen(at('?plan=plus_session&status=already-paid'), async ({ html, replaced, timers }) => {
    html()
    assert.doesNotMatch(html(), /role="alert"/)
    timers[0]()
    assert.deepEqual(replaced, [[null, '/access/checkout?plan=plus_session']])
  })
  await screen(at('?plan=plus_session'), async ({ html, replaced, timers }) => {
    html()
    assert.match(html(), /<checkout-form /)
    assert.deepEqual(replaced, [])
    assert.equal(timers.length, 0)
  })
})

test('the free pass: Start opens the modal with what it gives and its terms (only there)', async () => {
  const mocks = { 'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/entitlements/client': { postEntitlementCommand: async () => ({ status: 'ok' }) } }
  await drive('./FreePassStart.tsx', 'FreePassStart', { continuityToken: 't', passHours: 72, profileRevision: 4 },
    async ({ render, html }) => {
      assert.equal(text(html()), 'Get your free pass')
      find(render(), node => node.type === 'button' && label(node) === 'Get your free pass').props.onClick()
      const modal = text(html().match(/<dialog-open>[\s\S]*<\/dialog-open>/)[0])
      assert.match(modal, /Start your free pass/)
      assert.match(modal, /A full timed exam from one of your courses/)
      assert.match(modal, /It lasts 3 days from now\. Each student can have one free pass\. Starting it sets your courses for this semester\./)
      assert.match(modal, /Not now Start my free pass/)
      assert.doesNotMatch(modal, /Discovery|72|phone/)
    }, mocks)
})

// ---------------------------------------------------------------------------------------------------------------------
// The return page.

const order = (state, extra = {}) => ({ state, order_id: ORDER, plan: 'standard_semester', tier: 'standard', period: 'semester',
  amount_kobo: 400000, created_at: '2026-11-03T10:00:00+01:00', paid_at: state === 'paid' ? '2026-11-03T10:01:00+01:00' : null,
  ends_at: state === 'paid' ? '2027-03-08T23:59:59+01:00' : null, second_starts_at: null, second_ends_at: null, ...extra })

async function returnPage(initial, run, { courseCount = 6, features = null } = {}) {
  const intervals = [], vibrations = [], assigned = [], fetches = [], refreshes = []
  let now = Date.parse('2026-11-03T10:00:30+01:00')
  const answers = []
  const realNow = Date.now
  global.window = { setInterval: (fn, ms) => { intervals.push({ fn, ms, live: true }); return intervals.length },
    clearInterval: id => { intervals[id - 1].live = false },
    location: { pathname: '/access/checkout/return', search: `?order=${ORDER}`, assign: href => assigned.push(href) } }
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: ms => vibrations.push(ms) }, configurable: true, writable: true })
  global.fetch = async (url, init) => { fetches.push([url, init.cache]); const next = answers.shift()
    return { status: next.status, json: async () => next.body } }
  Date.now = () => now
  try {
    await drive('./checkout/return/ReturnStatus.tsx', 'ReturnStatus', { orderId: ORDER, initial, courseCount, features },
      async ({ render, html }) => {
        const settle = async () => { for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve)) }
        const tick = async ms => { now += ms; for (const interval of intervals) if (interval.live) interval.fn(); await settle() }
        await run({ render, html, tick, settle, answers, intervals, vibrations, assigned, fetches, refreshes })
      }, { 'next/navigation': { useRouter: () => ({ refresh: () => refreshes.push(1) }) } })
  } finally {
    Date.now = realNow; delete global.window; delete global.fetch
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator
  }
}

test('confirming: role="status", polls our order every 3 seconds with no-store, then You\'re subscribed only when paid', async () => {
  await returnPage({ kind: 'order', order: order('confirming') }, async ({ html, tick, answers, intervals, vibrations, fetches,
    refreshes }) => {
    const first = html()
    assert.match(first, /data-return-state="confirming"/)
    assert.match(first, /role="status" aria-live="polite"/)
    assert.match(text(first), /Confirming your payment This usually takes a few seconds\. Plan /, 'one line, nothing about the page')
    assert.match(first, /animate-spin/, 'asking on its own')
    assert.match(text(first), /Plan Standard · Semester Amount ₦4,000 Payment reference 3F2C9A1B7D/)
    assert.doesNotMatch(first, /subscribed/i)
    assert.equal(intervals[0].ms, 3000)
    answers.push({ status: 200, body: order('confirming') })
    await tick(3000); html()
    assert.deepEqual(fetches, [[`/api/payments/orders/${ORDER}`, 'no-store']])
    answers.push({ status: 503, body: null })
    await tick(3000)
    assert.match(html(), /data-return-state="confirming"/, 'a failed check keeps the last answer')
    answers.push({ status: 200, body: order('paid') })
    await tick(3000)
    const paid = html()
    assert.match(paid, /data-return-state="paid"/)
    assert.match(text(paid), /You’re subscribed Standard · Semester keeps your courses open until Mon, 8 Mar 2027\./)
    // The courses were read while still locked: nothing is listed until the page reads them again, once.
    assert.doesNotMatch(text(paid), /Now open in your|Notes by topic|Theory questions/)
    assert.equal(refreshes.length, 1, 'the page reads the now-open courses again')
    assert.match(paid, /href="\/my-courses"[^>]*>Start studying<\/a>/)
    assert.match(paid, new RegExp(`href="/access/receipts/${ORDER}"[^>]*>View receipt</a>`))
    html()
    assert.equal(refreshes.length, 1, 'and only once')
    assert.deepEqual(vibrations, [20], 'one haptic, once')
    assert.equal(intervals.filter(interval => interval.live).length, 0, 'polling stops once paid')
  })
})

test('You\'re subscribed lists only what the student\'s courses have', async () => {
  const has = ['Notes by topic', 'Practice with instant feedback', 'Exam mode']
  await returnPage({ kind: 'order', order: order('paid') }, async ({ html, refreshes }) => {
    const paid = text(html())
    assert.match(paid, /Now open in your 6 courses Notes by topic Practice with instant feedback Exam mode/)
    assert.doesNotMatch(paid, /Theory questions/, 'no course of this student has theory')
    assert.equal(refreshes.length, 0, 'the courses were read open: nothing to read again')
  }, { features: has })
  await returnPage({ kind: 'order', order: order('paid') }, async ({ html }) => {
    assert.match(text(html()), /Now open in your 6 courses Theory questions with suggested answers/)
    assert.doesNotMatch(text(html()), /Notes by topic|Exam mode/)
  }, { features: ['Theory questions with suggested answers'] })
  await returnPage({ kind: 'order', order: order('paid') }, async ({ html }) => {
    assert.doesNotMatch(text(html()), /Now open in your/, 'nothing to list: no list at all')
  }, { features: [] })
})

test('after two minutes: still confirming with Check again; Check again asks once and shows the answer', async () => {
  await returnPage({ kind: 'order', order: order('confirming') }, async ({ render, html, tick, answers, intervals, fetches }) => {
    html()
    for (let n = 0; n < 39; n++) { answers.push({ status: 200, body: order('confirming') }); await tick(3000); html() }
    await tick(3000)
    const still = html()
    assert.match(text(still), /We’re still confirming your payment Bank transfers can take a few minutes\. You can leave this page\. We’ll add your plan as soon as your payment is confirmed\. Plan /)
    assert.doesNotMatch(text(still), /charged/i)
    assert.doesNotMatch(still, /animate-spin/, 'the page has stopped asking: no spinner, as in "couldn’t check"')
    assert.match(still, /role="status"/)
    assert.doesNotMatch(text(still), /Paid but still waiting/, 'the support line waits 30 minutes')
    assert.equal(intervals.filter(interval => interval.live).length, 0, 'no polling after two minutes')
    const polled = fetches.length
    answers.push({ status: 200, body: order('paid') })
    await find(render(), node => node.type === 'button' && label(node) === 'Check again').props.onClick()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(fetches.length, polled + 1)
    assert.match(html(), /data-return-state="paid"/)
  })
})

test('still confirming after 30 minutes offers Message us with the reference', async () => {
  const old = order('confirming', { created_at: '2026-11-03T09:00:00+01:00' })
  await returnPage({ kind: 'order', order: old }, async ({ html, tick, answers }) => {
    html()
    for (let n = 0; n < 41; n++) { answers.push({ status: 200, body: old }); await tick(3000); html() }
    const still = html()
    assert.match(text(still), /Paid but still waiting\? Message us/)
    assert.match(still, /wa\.me[^"]*3F2C9A1B7D/)
  })
})

test('a signed-out answer while polling goes to sign-in and comes back to this order', async () => {
  await returnPage({ kind: 'order', order: order('confirming') }, async ({ html, tick, answers, assigned }) => {
    html()
    answers.push({ status: 401, body: null })
    await tick(3000)
    assert.deepEqual(assigned, [`/login?next=${encodeURIComponent(`/access/checkout/return?order=${ORDER}`)}`])
  })
})

test('each settled state has its own screen; failed never promises no charge', async () => {
  const cases = {
    failed: [/Your payment didn’t go through No plan was added\. If money left your account, message us with the time you paid and we’ll sort it out\./,
      /href="\/access\/checkout\?plan=standard_semester"[^>]*>Try again</],
    cancelled: [/Payment not completed You left checkout before paying\. No plan was added\./, /Try again/],
    'paid-duplicate': [/You’re already subscribed We received two payments for this plan\. We’ll refund the extra one\./, /Go to my courses/],
    'refund-pending': [/Your refund is being processed Your refund of ₦4,000 is being processed\. Your plan has ended\./, /Back to Plan &amp; Access/],
    refunded: [/Your payment was refunded Your plan has ended\. GST courses stay free\./, /Back to Plan &amp; Access/],
    'amount-mismatch': [/Payment didn’t match the plan price We’ll refund the full amount\. You can then pay for your plan again\./,
      /Back to Plan &amp; Access/],
  }
  for (const [state, [line, action]] of Object.entries(cases)) {
    await returnPage({ kind: 'order', order: order(state) }, async ({ html, intervals }) => {
      const markup = html()
      assert.match(text(markup), line, state)
      assert.match(markup, action, state)
      assert.doesNotMatch(markup, /You’re subscribed|haven’t been charged|not been charged/, state)
      assert.equal(intervals.length, 0, `${state}: nothing to poll`)
    })
  }
  // The wrong-amount page shows what was actually received, never the plan price as if it were paid.
  await returnPage({ kind: 'order', order: order('amount-mismatch', { received_kobo: 300000, received_currency: 'NGN' }) },
    async ({ html }) => {
      const words = text(html())
      assert.match(words, /Plan Standard · Semester Amount received ₦3,000 Payment reference 3F2C9A1B7D/)
      assert.doesNotMatch(words, /₦4,000|Amount ₦/, 'no plan price on this page')
    })
  for (const received of [{ received_kobo: 40000, received_currency: 'USD' }, { received_kobo: null, received_currency: null }, {}]) {
    await returnPage({ kind: 'order', order: order('amount-mismatch', received) }, async ({ html }) => {
      const words = text(html())
      assert.match(words, /Plan Standard · Semester Payment reference 3F2C9A1B7D/, JSON.stringify(received))
      assert.doesNotMatch(words, /Amount|₦/, `no amount row without a naira amount received: ${JSON.stringify(received)}`)
    })
  }
  await returnPage({ kind: 'order', order: order('amount-mismatch') }, async ({ html }) => {
    assert.match(html(), /role="alert"/)
    assert.doesNotMatch(html(), /Confirming your payment|role="status"/, 'a wrong amount is never shown as confirming')
    assert.match(html(), /href="https:\/\/wa\.me\/[^"]*3F2C9A1B7D[^"]*"[^>]*>Message us</)
  })
  await returnPage({ kind: 'order', order: order('failed') }, async ({ html }) => {
    assert.match(html(), /role="alert"/)
    assert.match(html(), /href="https:\/\/wa\.me\/[^"]*3F2C9A1B7D[^"]*"[^>]*>Message us</)
  })
})

test('another student\'s order or an unknown id: "We couldn\'t find that payment", no plan details', async () => {
  await returnPage({ kind: 'not-found' }, async ({ html, intervals }) => {
    const markup = html()
    assert.match(markup, /data-return-state="not-found"/)
    assert.match(text(markup), /We couldn’t find that payment Check Plan &amp; Access for your current plan\./)
    assert.doesNotMatch(markup, /₦|Payment reference|subscribed|Check again/i)
    assert.equal(intervals.length, 0, 'nothing to ask again')
  })
})

test('an order that couldn\'t be read is never called missing: "We couldn\'t check your payment right now", and it keeps checking', async () => {
  await returnPage({ kind: 'unavailable' }, async ({ html, tick, answers, intervals, fetches }) => {
    const first = html()
    assert.match(first, /data-return-state="unavailable"/)
    assert.match(first, /role="status" aria-live="polite"/)
    assert.equal(text(first), 'We couldn’t check your payment right now Check again Back to Plan &amp; Access')
    assert.doesNotMatch(first, /couldn’t find|₦|Payment reference|subscribed/i)
    assert.match(first, /href="\/access"[^>]*>Back to Plan &amp; Access<\/a>/)
    assert.match(first, /animate-spin/, 'still asking on its own')
    assert.equal(intervals[0].ms, 3000)
    answers.push({ status: 503, body: null })
    await tick(3000)
    assert.match(html(), /data-return-state="unavailable"/, 'still no answer: still not called missing')
    assert.deepEqual(fetches, [[`/api/payments/orders/${ORDER}`, 'no-store']])
    answers.push({ status: 200, body: order('confirming') })
    await tick(3000)
    const confirming = html()
    assert.match(confirming, /data-return-state="confirming"/)
    assert.match(text(confirming), /Confirming your payment This usually takes a few seconds\./)
    answers.push({ status: 200, body: order('paid') })
    await tick(3000)
    assert.match(html(), /data-return-state="paid"/)
    assert.equal(intervals.filter(interval => interval.live).length, 0, 'polling stops once paid')
  })
  // Only our database's own not-found answer says the payment doesn't exist.
  await returnPage({ kind: 'unavailable' }, async ({ html, tick, answers, intervals }) => {
    html()
    answers.push({ status: 404, body: { state: 'not-found' } })
    await tick(3000)
    assert.match(text(html()), /We couldn’t find that payment/)
    assert.equal(intervals.filter(interval => interval.live).length, 0)
  })
})

test('Check again that gets no answer says "Couldn\'t check. Try again." and clears on the next try', async () => {
  const isCheck = node => node.type === 'button' && /^(Check again|Checking…)$/.test(label(node))
  // After two minutes without an answer the page stops asking on its own; only Check again asks.
  await returnPage({ kind: 'unavailable' }, async ({ render, html, tick, settle, answers, intervals, fetches }) => {
    html()
    for (let n = 0; n < 39; n++) { answers.push({ status: 503, body: null }); await tick(3000); html() }
    await tick(3000)
    const stopped = html()
    assert.match(stopped, /data-return-state="unavailable"/)
    assert.equal(intervals.filter(interval => interval.live).length, 0, 'no polling after two minutes')
    assert.doesNotMatch(stopped, /animate-spin/)
    assert.doesNotMatch(text(stopped), /Couldn’t check/, 'the page\'s own checks fail quietly')
    const polled = fetches.length
    answers.push({ status: 503, body: null })
    find(render(), isCheck).props.onClick()
    await settle()
    const failed = html()
    assert.equal(fetches.length, polled + 1)
    assert.match(failed, /role="alert"[^>]*>Couldn’t check\. Try again\.</)
    assert.equal(text(failed), 'We couldn’t check your payment right now Couldn’t check. Try again. Check again Back to Plan &amp; Access')
    // The next try clears the line while it is in flight, and an answer shows its own screen.
    let release
    global.fetch = () => new Promise(resolve => { release = () => resolve({ status: 200, json: async () => order('paid') }) })
    find(render(), isCheck).props.onClick()
    const during = html()
    assert.match(during, /<button type="button" disabled="" aria-busy="true"[^>]*>Checking…<\/button>/)
    assert.doesNotMatch(text(during), /Couldn’t check/)
    release()
    await settle()
    assert.match(html(), /data-return-state="paid"/)
  })
  // The same line under "still confirming"; a signed-out answer goes to sign-in and comes back to this order.
  await returnPage({ kind: 'order', order: order('confirming') }, async ({ render, html, tick, settle, answers, assigned }) => {
    html()
    for (let n = 0; n < 39; n++) { answers.push({ status: 200, body: order('confirming') }); await tick(3000); html() }
    await tick(3000)
    html()
    answers.push({ status: 503, body: null })
    find(render(), isCheck).props.onClick()
    await settle()
    const failed = html()
    assert.match(failed, /data-return-state="confirming"/, 'the last answer stays')
    assert.match(failed, /role="alert"[^>]*>Couldn’t check\. Try again\.</)
    answers.push({ status: 401, body: null })
    find(render(), isCheck).props.onClick()
    await settle()
    assert.deepEqual(assigned, [`/login?next=${encodeURIComponent(`/access/checkout/return?order=${ORDER}`)}`])
    assert.doesNotMatch(text(html()), /Couldn’t check/)
  })
})
