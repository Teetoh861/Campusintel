// app/access/checkout/server-pages.test.cjs — The server-rendered payment pages against mocked reads: Confirm courses
// (every state and problem, the form it hands over, never an amount from the client), the return page and the receipt
// (another student's order or an unknown id is "We couldn't find that payment"), and the public Payment terms.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')
const { entitlementSummarySchema } = require('../../../lib/entitlements/contract.ts')

const ORDER = '3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'
const NOW = '2026-11-03T12:00:00.000+00:00'
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const catalogue = [
  { plan: 'plus_session', tier: 'plus', period: 'session', price_kobo: 1100000 },
  { plan: 'plus_semester', tier: 'plus', period: 'semester', price_kobo: 600000 },
  { plan: 'standard_session', tier: 'standard', period: 'session', price_kobo: 700000 },
  { plan: 'standard_semester', tier: 'standard', period: 'semester', price_kobo: 400000 }]
const wire = { now: NOW, planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null, trial_hours: 72,
  expiry_notice_hours: 12, tier: 'free', access: null,
  trial: { status: 'not-offered', policy: null, starts_at: null, ends_at: null, available_from: null },
  discovery: { cbt_questions: 50, ai_sets: 1, previews: [] },
  early_access: { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null },
  plans_on_sale: true, plans: catalogue,
  term: { session_label: '2026/2027', period_key: 'first-semester', period_name: 'First Semester', ends_at: '2027-03-08T22:59:59+00:00' } }
const courses = { status: 'ok', courses: [
  { institutionalCourseId: 'c1', title: 'Financial Management', code: 'BUA 216', isFree: false },
  { institutionalCourseId: 'c2', title: 'Use of English', code: 'GST 112', isFree: true }] }
const profile = { status: 'complete', selection: { department: { label: 'Business Administration' },
  academicLevel: { label: '200 Level' }, academicPeriod: { label: 'First Semester' } } }

class Redirect extends Error { constructor(to) { super(to); this.to = to } }

/** Renders one server page with its reads mocked; `state` sets what each read answers. */
async function page(file, args, state = {}) {
  return withTsx(async () => {
    const original = Module._load
    const rpcCalls = []
    function StudentAccessGate() { return null }
    function CheckoutForm(props) { return React.createElement('checkout-form', { 'data-plan': props.plan,
      'data-price': String(props.priceKobo), 'data-revision': String(props.expectedRevision), 'data-request': props.requestId,
      'data-token': props.continuityToken }) }
    function ReturnStatus(props) { return React.createElement('return-status', { 'data-order': props.orderId ?? '',
      'data-read': props.initial.kind === 'order' ? props.initial.order.state : props.initial.kind,
      'data-courses': String(props.courseCount) }) }
    const client = { rpc: async (name, params) => { rpcCalls.push([name, params]); return state.rpc ?? { data: null, error: null } } }
    try {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', { href: props.href }, props.children) }
        if (name === 'next/navigation') return { redirect: to => { throw new Redirect(to) }, notFound: () => { throw new Redirect('404') } }
        if (name === '@/components/student/result-state') return { redirectForStudentState: (kind, here) => { throw new Redirect(`${kind}:${here}`) } }
        if (name === '@/lib/supabase/server') return { createClient: async () => client }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () =>
          state.signedOut ? null : ({ user: { id: 'student' }, sessionId: 's' }) }
        if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async () => state.entitlement === null
          ? { status: 'unavailable' } : ({ status: 'ok', entitlement: { ...entitlementSummarySchema.parse({ ...wire, ...state.entitlement }),
            discovery_eligible: false } }) }
        if (name === '@/lib/courses/read-model') return { getCurrentStudentCoursesForVerifiedStudent: async () =>
          state.courses === undefined ? courses : state.courses }
        if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfileForVerifiedStudent: async () =>
          state.profile === undefined ? profile : state.profile }
        if (name === '@/lib/profile/course-selection') return { readCourseSelection: async () =>
          state.selection === undefined ? { state: 'open', locked: false, lastDay: null } : state.selection,
          readProfileRevision: async () => state.revision === undefined ? 7 : state.revision }
        if (name === './CheckoutForm') return { CheckoutForm }
        if (name === './ReturnStatus') return { ReturnStatus }
        if (name === './PrintReceipt') return { PrintReceipt: () => React.createElement('button', null, 'Save or print') }
        return original.call(this, name, ...args)
      }
      const Page = require(file).default
      let tree
      try { tree = await Page(args) } catch (error) { if (error instanceof Redirect) return { redirect: error.to }; throw error }
      if (tree.type === StudentAccessGate) {
        const child = typeof tree.props.children === 'function' ? tree.props.children('page-token') : tree.props.children
        try { tree = await child.type(child.props) } catch (error) {
          if (error instanceof Redirect) return { redirect: error.to, returnPath: tree.props.returnPath }; throw error }
      }
      return { html: renderToStaticMarkup(tree), rpcCalls }
    } finally { Module._load = original }
  })
}

const confirm = (plan, state, status) => page('./page.tsx', { searchParams: Promise.resolve({ plan, status }) }, state)

test('Confirm courses: the plan, its catalogue price, the study context, the course list and one form with no amount', async () => {
  const { html } = await confirm('standard_semester', {})
  const words = text(html)
  assert.match(words, /Confirm your courses Your plan covers these courses for First Semester 2026\/2027\./)
  assert.match(words, /Standard · Semester · ₦4,000/)
  assert.match(words, /Business Administration · 200 Level · First Semester Change/)
  assert.match(html, /href="\/profile-selection\?return=%2Faccess%2Fcheckout%3Fplan%3Dstandard_semester"/)
  assert.match(words, /Your 2 courses Financial Management BUA 216 Use of English GST 112 Free/)
  assert.match(words, /After you pay, your Department, Level and Semester are set until the semester ends\./)
  const form = html.match(/<checkout-form[^>]*>/)[0]
  assert.match(form, /data-plan="standard_semester" data-price="400000" data-revision="7"/)
  assert.match(form, /data-request="[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"/)
  assert.match(form, /data-token="page-token"/)
  assert.doesNotMatch(words, /token|Campus Bot use|limit/i)
})

test('a Session plan says it also covers the Second Semester; a locked selection has no Change link', async () => {
  const words = text((await confirm('plus_session', { selection: { state: 'locked', locked: true, lastDay: '2027-03-08' } })).html)
  assert.match(words, /for First Semester 2026\/2027, and your Second Semester courses once it resumes\./)
  assert.match(words, /Plus · Session · ₦11,000/)
  assert.doesNotMatch(words, /Change/)
})

test('Early Access continues first: the plan keeps courses open after it', async () => {
  const words = text((await confirm('standard_semester', { entitlement: { tier: 'full',
    access: { source: 'early_access', ends_at: '2026-11-25T12:00:00+00:00' } } })).html)
  assert.match(words, /Your Early Access month continues until Wed, 25 Nov 2026\. Your plan then keeps your courses open until Mon, 8 Mar 2027\./)
})

test('each reason the checkout sent back shows its one line above the form; none promises anything about charges', async () => {
  const lines = { 'unavailable': 'We couldn’t open the payment page. Try again in a moment.',
    'checkout-expired': 'That payment page expired. Try again to open a new one.',
    'selection-changed': 'Your courses changed. Check the list below, then try again.',
    'session-changed': 'Your session changed. Try again.', 'invalid-request': 'Something went wrong. Try again.',
    'something-new': 'We couldn’t open the payment page. Try again in a moment.' }
  for (const [status, line] of Object.entries(lines)) {
    const { html } = await confirm('standard_semester', {}, status)
    assert.ok(text(html).includes(line), status)
    assert.match(html, /<checkout-form/, `${status}: the student can try again from here`)
    assert.doesNotMatch(html, /charged/i)
  }
})

test('needs a confirmed selection first: one Confirm my courses link that comes back here, and no form', async () => {
  for (const state of [{ selection: { state: 'incomplete', locked: false, lastDay: null } }, { revision: null },
    { courses: null }, { profile: { status: 'incomplete' } }]) {
    const { html } = await confirm('plus_semester', state)
    assert.match(text(html), /Confirm your courses for this semester to choose a plan\./)
    assert.match(html, /href="\/profile-selection\?return=%2Faccess%2Fcheckout%3Fplan%3Dplus_semester"[^>]*>Confirm my courses</)
    assert.doesNotMatch(html, /checkout-form/, JSON.stringify(state))
  }
})

test('already paid, plans closed, a plan not sold now, or a failed read: no form', async () => {
  const paid = { plan: 'standard_semester', tier: 'standard', period: 'semester', order_id: ORDER, amount_kobo: 400000,
    paid_at: NOW, first_ends_at: '2027-03-08T22:59:59+00:00', second_starts_at: null, second_ends_at: null,
    term_session_label: '2026/2027' }
  const cases = [
    [{ entitlement: { paid } }, null, /You’re already subscribed Standard · Semester covers your courses until Mon, 8 Mar 2027\./],
    [{ entitlement: { plans_on_sale: false, plans: [] } }, null, /Plans aren’t on sale right now\. GST courses stay free\./],
    [{ entitlement: { plans: catalogue.filter(plan => plan.period === 'semester') } }, null,
      /That plan isn’t available right now\. Choose another plan on Plan &amp; Access\./],
    [{ entitlement: null }, null, /Your plan couldn’t be loaded Please try again in a few minutes\./],
  ]
  for (const [state, status, line] of cases) {
    // A Session plan when only Semester plans are sold (outside a First Semester); otherwise a Semester plan.
    const plan = state.entitlement?.plans?.length === 2 ? 'standard_session' : 'standard_semester'
    const { html } = await confirm(plan, state, status)
    assert.match(text(html), line)
    assert.doesNotMatch(html, /checkout-form|₦4,000 a/)
  }
})

test('status=already-paid in the address without a paid plan on the server shows checkout as normal', async () => {
  const { html } = await confirm('standard_semester', { entitlement: { paid: null } }, 'already-paid')
  assert.match(html, /<checkout-form/, 'the student can still pay')
  assert.doesNotMatch(text(html), /already subscribed|We couldn’t open the payment page/)
})

test('an unknown plan goes back to Plan & Access; signed out goes to sign-in and returns to this plan', async () => {
  assert.deepEqual(await confirm('gold_forever', {}), { redirect: '/access' })
  assert.deepEqual(await confirm(undefined, {}), { redirect: '/access' })
  const out = await confirm('plus_session', { signedOut: true })
  assert.equal(out.redirect, 'signed-out:/access/checkout?plan=plus_session')
  assert.equal(out.returnPath, '/access/checkout?plan=plus_session')
})

const returned = (order, state) => page('./return/page.tsx', { searchParams: Promise.resolve({ order }) }, state)

test('the return page reads our own order only; another student\'s order and unknown ids read as not found', async () => {
  const mine = { state: 'paid', order_id: ORDER, plan: 'standard_semester', tier: 'standard', period: 'semester',
    amount_kobo: 400000, created_at: NOW, paid_at: NOW, ends_at: null, second_starts_at: null, second_ends_at: null }
  const ok = await returned(ORDER.toUpperCase(), { rpc: { data: mine, error: null } })
  assert.deepEqual(ok.rpcCalls, [['get_my_payment_order', { p_order_id: ORDER }]])
  assert.match(ok.html, new RegExp(`data-order="${ORDER}" data-read="paid" data-courses="2"`))
  // get_my_payment_order answers not-found for an order that isn't this student's (no detail leaks).
  const other = await returned(ORDER, { rpc: { data: { state: 'not-found' }, error: null } })
  assert.match(other.html, /data-read="not-found"/)
  for (const bad of ['not-a-uuid', undefined, `${ORDER}' or 1=1`]) {
    const unknown = await returned(bad, {})
    assert.deepEqual(unknown.rpcCalls, [], 'an invalid id is never sent')
    assert.match(unknown.html, /data-order="" data-read="not-found"/)
  }
  assert.match((await returned(ORDER, { rpc: { data: null, error: { code: 'XX000' } } })).html, /data-read="unavailable"/)
  assert.equal((await returned(ORDER, { rpc: { data: null, error: { code: '42501' } } })).redirect,
    `signed-out:/access/checkout/return?order=${ORDER}`)
})

const receipt = (id, state) => page('./../receipts/[id]/page.tsx', { params: Promise.resolve({ id }) }, state)

test('a receipt shows our order\'s plan, amount, date, reference and status; anything else is not found', async () => {
  const paid = { state: 'paid', order_id: ORDER, plan: 'plus_session', tier: 'plus', period: 'session', amount_kobo: 1100000,
    created_at: NOW, paid_at: '2026-11-03T10:01:00+01:00', ends_at: null, second_starts_at: null, second_ends_at: null }
  const words = text((await receipt(ORDER, { rpc: { data: paid, error: null } })).html)
  assert.match(words, /CampusIntell Receipt Plan Plus · Session Amount ₦11,000 Paid Tue, 3 Nov 2026, 10:01 \(Lagos\)/)
  assert.match(words, new RegExp(`Payment reference 3F2C9A1B7D Order ${ORDER} Status Paid Save or print`))
  for (const state of [{ rpc: { data: { ...paid, state: 'confirming', paid_at: null }, error: null } },
    { rpc: { data: { state: 'not-found' }, error: null } }, { rpc: { data: null, error: { code: 'XX000' } } }]) {
    const missing = text((await receipt(ORDER, state)).html)
    assert.match(missing, /We couldn’t find that payment/)
    assert.doesNotMatch(missing, /₦|Save or print/)
  }
  const bad = await receipt('../../etc', {})
  assert.deepEqual(bad.rpcCalls, [])
  assert.match(text(bad.html), /We couldn’t find that payment/)
})

test('Payment terms state the approved terms in plain words', async () => {
  const words = text((await page('../../payment-terms/page.tsx', undefined, {})).html)
  for (const line of [/Standard ₦4,000 ₦7,000 Plus ₦6,000 ₦11,000/,
    /You can get a full refund within 48 hours of paying, as long as you haven’t used Campus Bot or a large part of your plan\./,
    /Refunds go back to the card or account you paid with, and your plan ends once the refund is made\./,
    /Paid too much\? Your plan starts and we refund the extra\. Paid too little\? It’s refunded in full\./,
    /Prices may change for future plans\. A plan you’ve already paid for keeps its price and end date\./]) {
    assert.match(words, line)
  }
  assert.doesNotMatch(words, /token|order_|status/i)
})
