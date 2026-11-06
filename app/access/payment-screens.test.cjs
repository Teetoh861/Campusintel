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
  const listeners = new Map()
  global.window = { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) }
  try {
    await drive('./checkout/CheckoutForm.tsx', 'CheckoutForm', { plan: 'plus_session', priceKobo: 1100000,
      expectedRevision: 7, requestId: 'b7c6d5e4-0000-4000-8000-000000000001', continuityToken: 'page-token' },
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
      const busy = html()
      assert.match(busy, /<button type="submit" disabled="" aria-busy="true"/)
      assert.match(text(busy), /Opening payment…/)
      assert.match(busy, /role="status"[^>]*>Opening payment…/)
      form().props.onSubmit({ preventDefault: () => prevented.push('second') })
      assert.deepEqual(prevented, ['second'], 'a double tap sends one request')
      listeners.get('pageshow')({ persisted: true })
      assert.match(html(), /<button type="submit" aria-busy="false"/, 'Back from the payment page lets the student pay again')
    })
  } finally { delete global.window }
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

async function returnPage(initial, run, { courseCount = 6 } = {}) {
  const intervals = [], vibrations = [], assigned = [], fetches = []
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
    await drive('./checkout/return/ReturnStatus.tsx', 'ReturnStatus', { orderId: ORDER, initial, courseCount },
      async ({ render, html }) => {
        const settle = async () => { for (let n = 0; n < 10; n++) await new Promise(resolve => setImmediate(resolve)) }
        const tick = async ms => { now += ms; for (const interval of intervals) if (interval.live) interval.fn(); await settle() }
        await run({ render, html, tick, settle, answers, intervals, vibrations, assigned, fetches })
      })
  } finally {
    Date.now = realNow; delete global.window; delete global.fetch
    if (savedNavigator) Object.defineProperty(globalThis, 'navigator', savedNavigator); else delete globalThis.navigator
  }
}

test('confirming: role="status", polls our order every 3 seconds with no-store, then You\'re subscribed only when paid', async () => {
  await returnPage({ kind: 'order', order: order('confirming') }, async ({ html, tick, answers, intervals, vibrations, fetches }) => {
    const first = html()
    assert.match(first, /data-return-state="confirming"/)
    assert.match(first, /role="status" aria-live="polite"/)
    assert.match(text(first), /Confirming your payment This usually takes a few seconds\./)
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
    assert.match(text(paid), /Now open in your 6 courses/)
    assert.match(paid, /href="\/my-courses"[^>]*>Start studying<\/a>/)
    assert.match(paid, new RegExp(`href="/access/receipts/${ORDER}"[^>]*>View receipt</a>`))
    html()
    assert.deepEqual(vibrations, [20], 'one haptic, once')
    assert.equal(intervals.filter(interval => interval.live).length, 0, 'polling stops once paid')
  })
})

test('after two minutes: still confirming with Check again; Check again asks once and shows the answer', async () => {
  await returnPage({ kind: 'order', order: order('confirming') }, async ({ render, html, tick, answers, intervals, fetches }) => {
    html()
    for (let n = 0; n < 39; n++) { answers.push({ status: 200, body: order('confirming') }); await tick(3000); html() }
    await tick(3000)
    const still = html()
    assert.match(text(still), /We’re still confirming your payment Bank transfers can take a few minutes\./)
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
  await returnPage({ kind: 'order', order: order('failed') }, async ({ html }) => {
    assert.match(html(), /role="alert"/)
    assert.match(html(), /href="https:\/\/wa\.me\/[^"]*3F2C9A1B7D[^"]*"[^>]*>Message us</)
  })
})

test('another student\'s order or an unknown id: "We couldn\'t find that payment", no plan details', async () => {
  for (const initial of [{ kind: 'not-found' }, { kind: 'unavailable' }]) {
    await returnPage(initial, async ({ html, intervals }) => {
      const markup = html()
      assert.match(text(markup), /We couldn’t find that payment Check Plan &amp; Access for your current plan\./)
      assert.doesNotMatch(markup, /₦|Payment reference|subscribed/i)
      assert.equal(intervals.length, 0)
    })
  }
})
