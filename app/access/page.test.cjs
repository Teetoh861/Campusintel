// app/access/page.test.cjs — Plan & Access rendered against real entitlement summaries: the free pass is offered only to
// an eligible student on a database that offers it (heading, one line and Start; its terms live in the modal); the free
// month is the first plan card whenever the database says this student can claim it, and never beside the pass; each
// plan card (free, free pass, free month, paid, refunded); the paid plans only while sales are open; Campus Bot usage
// in token mode; and today's wording whenever plans are not on sale.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')
const { entitlementSummarySchema } = require('../../lib/entitlements/contract.ts')

const NOW = '2026-10-30T12:00:00.000+00:00'
const early = { status: 'not-listed', starts_at: null, ends_at: null, enrollment_closes_at: null }
const trial = { status: 'available', starts_at: null, ends_at: null, available_from: null }
// get_my_entitlement() after 20261021100000_discovery_pass.sql.
const discoveryDatabase = { now: NOW, planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null, trial_hours: 72,
  trial_days: 3, expiry_notice_hours: 12, tier: 'free', access: null, trial: { ...trial, policy: null },
  discovery: { cbt_questions: 50, ai_sets: 1, previews: [] }, early_access: early, otp: null }
// get_my_entitlement() before it: trial_days only, no policy, no discovery. Its trial is seven days of full access.
const preDiscoveryDatabase = { now: NOW, planned_launch_at: '2026-10-24T23:00:00+00:00', actual_launch_at: null,
  trial_days: 7, expiry_notice_hours: 48, tier: 'free', access: null, trial, early_access: early, otp: null }

// `eligible` is what the server's pass eligibility read (lib/entitlements/server.ts) decided before render, and
// `freeMonth` its free month read: null, or the day the month would end as the database answered it. `revision` is the
// profile revision; `current` the student's course list; `usage` get_my_campus_bot_usage() as read by
// lib/ai-practice/campus-bot-usage.ts; `reads` collects what the page asked the entitlement read for.
const myCourses = { status: 'ok', courses: [{ isFree: true }, { isFree: false }, { isFree: false }, { isFree: false }] }
const MONTH = { endsAt: '2026-12-16T13:30:00+00:00', closesAt: '2026-11-08T12:00:00+00:00' }
async function render(wire, eligible = true, { revision = 4, current = myCourses, usage = { state: 'units' },
  freeMonth = null, reads = [] } = {}) {
  return withTsx(async () => {
    const original = Module._load
    function StudentAccessGate() { return null }
    function FreePassStart(props) { return React.createElement('button', { 'data-activation': props.passHours,
      'data-revision': String(props.profileRevision) }, 'Get your free pass') }
    // The chooser draws its `first` card before the paid plans; here the plans are named on the element.
    function PlanChooser(props) { return React.createElement('plan-chooser', { 'data-plans': props.plans.map(plan =>
      `${plan.plan}:${plan.price_kobo}`).join(',') }, props.first) }
    function FreeMonthPlanCard(props) { return React.createElement('li', { 'data-plan': 'free-month',
      'data-token': props.continuityToken, 'data-revision': String(props.profileRevision), 'data-ends-on': props.endsOn }) }
    try {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', { href: props.href }, props.children) }
        if (name === '@/lib/supabase/server') return { createClient: async () => ({}) }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => ({ user: { id: 'student' }, sessionId: 's' }) }
        if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async (_client, options) => {
          reads.push(options)
          return { status: 'ok', entitlement: { ...entitlementSummarySchema.parse(wire), discovery_eligible: eligible,
            free_month: freeMonth } }
        } }
        if (name === '@/lib/ai-practice/supabase-env') return { readAllowance: async () => null }
        if (name === '@/lib/ai-practice/campus-bot-usage') return { readCampusBotUsage: async () => {
          if (usage === 'fails') throw new Error('read failed')
          return usage } }
        if (name === '@/lib/courses/read-model') return { getCurrentStudentCoursesForVerifiedStudent: async () => current }
        if (name === '@/lib/profile/course-selection') return { readProfileRevision: async () => revision }
        if (name === './FreePassStart') return { FreePassStart }
        if (name === './FreeMonthOffer') return { FreeMonthPlanCard }
        if (name === './PlanChooser') return { PlanChooser }
        // WhileOffered marks the offer text a refusal withdraws (rendered here as <withdrawable>).
        if (name === './TrialActivation') return { PassOfferScope: props => props.children,
          WhileOffered: props => React.createElement('withdrawable', null, props.children) }
        return original.call(this, name, ...args)
      }
      const page = require('./page.tsx').default
      const gated = await page()
      assert.equal(gated.type, StudentAccessGate)
      const child = gated.props.children('page-token')
      return renderToStaticMarkup(await child.type(child.props))
    } finally { Module._load = original }
  })
}

const LATER = '2026-11-20T12:00:00.000+00:00'
const ORDER = '3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'
const catalogue = [
  { plan: 'plus_session', tier: 'plus', period: 'session', price_kobo: 1100000 },
  { plan: 'plus_semester', tier: 'plus', period: 'semester', price_kobo: 600000 },
  { plan: 'standard_session', tier: 'standard', period: 'session', price_kobo: 700000 },
  { plan: 'standard_semester', tier: 'standard', period: 'semester', price_kobo: 400000 }]
const onSale = { ...discoveryDatabase, plans_on_sale: true, plans: catalogue }
const paid = { plan: 'standard_session', tier: 'standard', period: 'session', order_id: ORDER, amount_kobo: 700000,
  paid_at: '2026-10-30T10:00:00+00:00', first_ends_at: '2027-03-08T22:59:59+00:00', second_starts_at: null,
  second_ends_at: null, term_session_label: '2026/2027' }
const subscribed = { ...onSale, tier: 'full', access: { source: 'paid', ends_at: '2027-03-08T22:59:59+00:00' },
  trial: { ...trial, status: 'not-offered', policy: null }, paid,
  receipts: [{ order_id: ORDER, plan: 'standard_session', amount_kobo: 700000, paid_at: paid.paid_at, status: 'paid' }] }
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

test('an eligible student is offered the free pass: a heading, one line and Get your free pass, with no terms on the page', async () => {
  const html = await render(discoveryDatabase)
  assert.match(html, /<h2[^>]*>Free pass<\/h2>/)
  assert.match(html, /Try your department courses free for 3 days\./)
  assert.match(html, /data-activation="72"/)
  assert.equal((html.match(/Free pass/g) || []).length, 2, 'the heading, and the section name for screen readers')
  // The terms (3 days, one per student, courses set) appear only in the modal.
  assert.doesNotMatch(strip(html), /days from now|one free pass|sets your courses|per course|50-question|72 hours/i)
  assert.doesNotMatch(html, /Discovery Pass|phone|SMS|per person/i)
  assert.doesNotMatch(html, /data-plan="free-month"|free month/i, 'no free month unless the database offers one')
})

test('an ineligible student sees free GST access: no offer, no button and no reason', async () => {
  const html = await render(discoveryDatabase, false)
  assert.doesNotMatch(html, /Free pass|data-activation|free pass<|72 hours/)
  assert.doesNotMatch(html, /isn’t available|not offered|email|months?\b|years?\b|already had/i)
  assert.match(html, /Free GST courses/)
  assert.doesNotMatch(html, /Your GST courses are open to you/, 'the heading says it; no second line repeats it')
  assert.match(html, /Practise from your notes is included with a plan\./)
  assert.doesNotMatch(html, /Early Access/)
})

test('the free card counts the student\'s other courses, in today\'s wording while plans are not on sale', async () => {
  const text = strip(await render(discoveryDatabase, false))
  assert.match(text, /Your other 3 courses: Included with a plan/)
  assert.doesNotMatch(text, /Department courses open/, 'no page lede repeating the card')
  assert.doesNotMatch(text, /subscribe|Choose a plan|₦/i)
  assert.match(strip(await render(discoveryDatabase, false, { current: { status: 'ok', courses: [{ isFree: false }] } })),
    /Your other 1 course: Included/)
  assert.doesNotMatch(strip(await render(discoveryDatabase, false, { current: null })), /Your other/,
    'no count when the course list cannot be read')
})

test('with a database from before the pass, the page shows a neutral plan: no pass, no button, no 72 hours', async () => {
  const html = await render(preDiscoveryDatabase)
  assert.doesNotMatch(html, /Free pass|data-activation|72 hours|CBT exam|notes topic/)
  assert.match(html, /Free GST courses/)
  assert.doesNotMatch(html, /7-day|seven-day|full access for 7/i, 'nor is the seven-day trial that database would issue advertised')
})

test('regression F4: on a database from before the pass, no trial status names a pass or a reserved allowance', async () => {
  const activeEarly = { status: 'active', starts_at: '2026-10-25T00:00:00+00:00', ends_at: LATER, enrollment_closes_at: null }
  const cases = {
    'after-early-access': { ...preDiscoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: LATER },
      trial: { ...trial, status: 'after-early-access', available_from: LATER }, early_access: activeEarly },
    'not-offered': { ...preDiscoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: LATER },
      trial: { ...trial, status: 'not-offered' }, early_access: activeEarly },
    'ended seven-day trial': { ...preDiscoveryDatabase,
      trial: { ...trial, status: 'ended', starts_at: '2026-10-10T12:00:00+00:00', ends_at: '2026-10-17T12:00:00+00:00' } },
  }
  for (const [label, wire] of Object.entries(cases)) {
    const html = await render(wire)
    assert.doesNotMatch(html, /Free pass|data-activation|72 hours|CBT exam|notes topic|your pass|a pass/i, label)
  }
  assert.match(await render(cases['ended seven-day trial']), /Your free trial has ended\./,
    'a trial that was issued is still described as what it was')
  for (const status of ['not-offered', 'after-early-access']) {
    const html = await render({ ...discoveryDatabase, trial: { ...trial, status, policy: null } })
    assert.doesNotMatch(html, /Free pass|data-activation|not offered|kept for later|becomes available/i, status)
  }
})

test('a refusal can withdraw every piece of offer text; the AI line stays', async () => {
  const html = await render(discoveryDatabase)
  const withdrawable = [...html.matchAll(/<withdrawable>([\s\S]*?)<\/withdrawable>/g)].map(match => match[1]).join(' ')
  assert.match(withdrawable, /Free pass/)
  assert.match(withdrawable, /Try your department courses free/)
  const kept = html.replace(/<withdrawable>[\s\S]*?<\/withdrawable>/g, '')
  assert.doesNotMatch(strip(kept), /Free pass|Try your department/, 'nothing describing the offer stays outside it')
  assert.match(kept, /Practise from your notes is included with a plan\./)
})

test('an active free pass shows its end time only: no per-course limits or allowances', async () => {
  const wire = { ...discoveryDatabase, trial: { ...trial, status: 'active', policy: 'discovery',
    starts_at: '2026-10-30T09:00:00+00:00', ends_at: '2026-11-02T09:00:00+00:00' } }
  const html = await render(wire)
  assert.match(html, /data-access="free-pass"/)
  const card = strip(html.match(/data-access="free-pass"[\s\S]*?<\/div><\/div><\/div>/)[0])
  assert.match(card, /Free pass/)
  assert.match(card, /Ends /)
  assert.doesNotMatch(card, /\b\d+ (questions?|sets?|topics?)\b|left|used/i)
  assert.doesNotMatch(html, /data-activation/, 'no second Start while a pass is active')
})

const monthRunning = { ...discoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: LATER },
  trial: { ...trial, status: 'not-offered', policy: null },
  early_access: { status: 'active', starts_at: '2026-10-25T00:00:00+00:00', ends_at: LATER, enrollment_closes_at: null } }

test('a running free month is the plan card: "Free month · Ends {day}", the database\'s day, and nothing more', async () => {
  const html = await render(monthRunning, false)
  const card = html.match(/<div class="student-surface" data-access="free-month">[\s\S]*?<\/h3><\/div><\/div>/)[0]
  assert.equal(strip(card).trim(), 'Free month · Ends 20 November')
  assert.doesNotMatch(html, /Early Access|data-plan="free-month"|data-activation/, 'never the internal name, or a second offer')
  // The month ends late on its last day in Lagos: the day shown is the Lagos day, not the UTC one.
  const lateNight = { ...monthRunning, access: { source: 'early_access', ends_at: '2026-11-20T23:30:00+00:00' } }
  assert.match(strip(await render(lateNight, false)), /Free month · Ends 21 November/)
})

test('an ended free month says so once, above the free card; the paid plans show again and no pass is offered', async () => {
  const ended = { ...onSale, trial: { ...trial, status: 'not-offered', policy: null },
    early_access: { status: 'ended', starts_at: '2026-09-25T00:00:00+00:00', ends_at: '2026-10-25T00:00:00+00:00',
      enrollment_closes_at: null } }
  const html = await render(ended, false)
  const text = strip(html)
  assert.match(text, /Your plan Your free month has ended\. Free GST courses/)
  assert.equal(text.match(/free month/gi).length, 1)
  assert.match(html, /<plan-chooser data-plans="plus_session:1100000,plus_semester:600000,standard_session:700000,standard_semester:400000"><\/plan-chooser>/)
  assert.doesNotMatch(html, /data-activation|Free pass|data-plan="free-month"|Early Access/)
})

test('a database from before this change that still reports a list place promises nothing', async () => {
  for (const status of ['awaiting-launch', 'pending', 'enrollment-closed', 'unavailable']) {
    const text = strip(await render({ ...discoveryDatabase, early_access: { ...early, status } }, false))
    assert.match(text, /Your plan Free GST courses/, status)
    assert.doesNotMatch(text, /free month|Early Access|launch|list\b|enrol/i, status)
  }
})

test('a student who can claim the free month sees it as the first plan card, beside the paid plans', async () => {
  const reads = []
  const html = await render(onSale, false, { freeMonth: MONTH, revision: 7, reads })
  assert.deepEqual(reads, [{ freeMonth: true }], 'the page asks the server whether this student can claim now')
  assert.match(html, /<h2[^>]*>Choose a plan<\/h2>/)
  assert.match(html, new RegExp('<plan-chooser data-plans="plus_session:1100000,plus_semester:600000,standard_session:700000,' +
    'standard_semester:400000"><li data-plan="free-month" data-token="page-token" data-revision="7" ' +
    'data-ends-on="16 December"></li></plan-chooser>'), 'the card is the chooser\'s first, with the end day the database gave')
  assert.match(html, /<p>Pay by card or bank transfer\.<\/p>/, 'the paid plans keep their payment and refund lines')
  assert.equal(html.match(/data-plan="free-month"/g).length, 1, 'offered once on this page')
  assert.doesNotMatch(strip(html), /Early Access|free month/i, 'the page itself adds no second description of the offer')
})

test('with the paid plans not on sale, the free month is the only plan card and no payment line shows', async () => {
  const html = await render(discoveryDatabase, false, { freeMonth: MONTH })
  assert.match(html, /<h2[^>]*>Choose a plan<\/h2>/)
  assert.match(html, /<plan-chooser data-plans=""><li data-plan="free-month" data-token="page-token" data-revision="4" data-ends-on="16 December"><\/li><\/plan-chooser>/)
  assert.doesNotMatch(html, /Pay by card|Payment terms|Full refund/)
})

test('the free pass is never shown beside the free month', async () => {
  const html = await render(discoveryDatabase, true, { freeMonth: MONTH })
  assert.match(html, /data-plan="free-month"/)
  assert.doesNotMatch(html, /data-activation|Free pass|Try your department/)
})

test('no free month card when the database offers none, or when the revision cannot be read', async () => {
  const none = await render(onSale, false)
  assert.match(none, /<plan-chooser data-plans="[^"]+"><\/plan-chooser>/)
  assert.doesNotMatch(none, /data-plan="free-month"/)
  // Without the revision the month could set courses the student did not see (D7): nothing is offered, pass included.
  const unbound = await render(discoveryDatabase, true, { freeMonth: MONTH, revision: null })
  assert.doesNotMatch(unbound, /data-plan="free-month"|plan-chooser|Choose a plan|data-activation|Free pass/)
  // A paid student has no plans section at all (the server never asks the database about a month for them).
  assert.doesNotMatch(await render(subscribed, false), /data-plan="free-month"|plan-chooser/)
})

test('plans show only while sales are open, with the payment, refund and terms lines', async () => {
  const html = await render(onSale, false)
  assert.match(html, /<h2[^>]*>Choose a plan<\/h2>/)
  assert.match(html, /data-plans="plus_session:1100000,plus_semester:600000,standard_session:700000,standard_semester:400000"/)
  assert.match(html, /<p>Pay by card or bank transfer\.<\/p>/)
  assert.doesNotMatch(html, /payment partner/)
  assert.match(html, /Full refund within 48 hours of paying, as long as you haven’t made a Campus Bot question set or used a large part of your plan\. <a href="\/payment-terms">Payment terms<\/a>/)
  assert.equal((strip(html).match(/GST/g) || []).length, 1, 'GST is named once, in Your plan')
  assert.doesNotMatch(strip(html), /Department courses open when you subscribe/)
  assert.match(strip(html), /Your other 3 courses: Included when you subscribe/)
  assert.match(strip(html), /Practise from your notes is included when you subscribe\./)
  for (const closed of [discoveryDatabase, { ...discoveryDatabase, plans: catalogue }, { ...onSale, plans: [] }]) {
    assert.doesNotMatch(await render(closed, false), /plan-chooser|Choose a plan|Payment terms/)
  }
  assert.doesNotMatch(strip(html), /token|\b\d+ sets?\b|limit/i, 'no token numbers or itemised limits')
})

test('a paid plan is the access card: plan name, dates, refund line; no plans offered and no pass', async () => {
  const html = await render(subscribed, true)
  const text = strip(html)
  assert.match(html, /data-access="paid"/)
  assert.match(text, /Subscribed · 2026\/2027 Standard · Session/)
  assert.match(text, /First Semester Until Mon, 8 Mar 2027/)
  assert.match(text, /Second Semester Opens when it resumes/)
  assert.match(text, /View your courses Need to change your courses\? Message us \./)
  assert.match(text, /Full refund within 48 hours of paying, as long as you haven’t made a Campus Bot question set or used a large part of your plan\. Payment terms/)
  assert.doesNotMatch(text, /when you subscribe|Early Access|free month/i, 'a subscribed student is not told how to subscribe')
  assert.doesNotMatch(text, /are set until|Department, Level and Semester/, 'the rule is not repeated after paying')
  assert.doesNotMatch(html, /plan-chooser|data-activation|Free pass/)
  assert.match(html, new RegExp(`href="/access/receipts/${ORDER}"`))
  assert.match(text, /Standard · Session · ₦7,000/)
  assert.match(text, /Ref 3F2C9A1B7D/)
})

test('the refund rule shows for the 48 hours it applies, by the database\'s clock; after that the terms link alone', async () => {
  // Paid at 10:00 on 30 October: the last second of the 48 hours, then the first second after them.
  const within = strip(await render({ ...subscribed, now: '2026-11-01T09:59:59+00:00' }))
  assert.match(within, /Full refund within 48 hours of paying/)
  const after = strip(await render({ ...subscribed, now: '2026-11-01T10:00:00+00:00' }))
  assert.doesNotMatch(after, /Full refund|48 hours/)
  assert.match(after, /Message us \. Payment terms/, 'the terms link stays')
})

test('a plan whose semester dates are not set yet says "Dates to follow"', async () => {
  const text = strip(await render({ ...subscribed, paid: { ...paid, first_ends_at: null } }))
  assert.match(text, /First Semester Dates to follow/)
})

test('a semester plan shows no Second Semester row; a second half that is set shows its dates', async () => {
  const semester = { ...subscribed, paid: { ...paid, plan: 'plus_semester', tier: 'plus', period: 'semester' } }
  assert.doesNotMatch(strip(await render(semester)), /Second Semester/)
  const set = { ...subscribed, paid: { ...paid, second_starts_at: '2027-04-12T00:00:00+01:00',
    second_ends_at: '2027-08-20T22:59:59+00:00' } }
  assert.match(strip(await render(set)), /Second Semester Mon, 12 Apr 2027 to Fri, 20 Aug 2027/)
})

test('a Semester plan bought for the Second Semester is labelled with that semester, not the First', async () => {
  const second = { ...subscribed, paid: { ...paid, plan: 'plus_semester', tier: 'plus', period: 'semester',
    period_key: 'second-semester', period_name: 'Second Semester', first_ends_at: '2027-08-20T22:59:59+00:00' } }
  const text = strip(await render(second))
  assert.match(text, /Second Semester Until Fri, 20 Aug 2027/)
  assert.doesNotMatch(text, /First Semester/)
  const first = { ...subscribed, paid: { ...paid, plan: 'plus_semester', tier: 'plus', period: 'semester',
    period_key: 'first-semester', period_name: 'First Semester' } }
  assert.match(strip(await render(first)), /First Semester Until Mon, 8 Mar 2027/)
})

test('after a refund the free card says so, and the receipt is marked; never "subscribed"', async () => {
  const refunding = { ...onSale, receipts: [{ order_id: ORDER, plan: 'plus_semester', amount_kobo: 600000,
    paid_at: '2026-10-29T10:00:00+00:00', status: 'refund-pending' }] }
  const text = strip(await render(refunding, false))
  assert.match(text, /Your refund of ₦6,000 is being processed\. Your plan has ended\./)
  assert.doesNotMatch(text, /Subscribed|You’re subscribed/)
  const refunded = { ...refunding, receipts: [{ ...refunding.receipts[0], status: 'refunded' }] }
  assert.match(strip(await render(refunded, false)), /Your payment was refunded\. Your plan has ended\./)
})

test('Campus Bot usage replaces the AI line in token mode: two bars with reset times, no numbers', async () => {
  const usage = { state: 'tokens', tier: 'standard', nextSetMax: 1, canStart: true,
    session: { limit: 100, used: 50, inFlight: 0, left: 50, resetsAt: '2026-10-30T15:00:00+00:00' },
    week: { limit: 400, used: 20, inFlight: 0, left: 380, resetsAt: '2026-11-02T00:00:00+00:00' } }
  const html = await render(subscribed, false, { usage })
  const section = html.match(/<section aria-labelledby="usage-heading"[\s\S]*?<\/section>/)[0]
  assert.equal(section.match(/role="meter"/g).length, 2)
  assert.match(strip(section), /5-hour limit About half left/)
  assert.match(strip(section), /Weekly limit Plenty left/)
  assert.doesNotMatch(strip(section), /This session|This week/)
  assert.match(strip(section), /Resets at /)
  assert.doesNotMatch(strip(section), /\b(50|100|380|400|20)\b/, 'no counts or limits in the text')
  assert.doesNotMatch(html, /id="ai-heading"/)
  for (const failed of ['fails', null]) {
    const missing = await render(subscribed, false, { usage: failed })
    assert.doesNotMatch(missing, /usage-heading|role="meter"/, 'a failed read shows nothing')
  }
})

test('the page does not repeat that the courses are fixed: that is said before each commitment, not here', async () => {
  for (const wire of [monthRunning, subscribed, discoveryDatabase]) {
    assert.doesNotMatch(strip(await render(wire, false)), /courses are set|can’t change your department|until the semester ends/)
  }
})

test('the pass activation is given the profile revision the page showed (D7)', async () => {
  assert.match(await render(discoveryDatabase, true, { revision: 7 }), /data-revision="7"/)
})

test('when the revision cannot be read, no pass can be started unbound: the student is asked to refresh', async () => {
  const html = await render(discoveryDatabase, true, { revision: null })
  assert.doesNotMatch(html, /data-activation/)
  assert.match(html, /We couldn’t load your courses\. Reload the page\./)
})
