// app/access/page.test.cjs — Plan & Access rendered against real entitlement summaries: the free pass is offered only to
// an eligible student on a database that offers it (heading, one line and Start; its terms live in the modal); each
// access card (free, free pass, Early Access, paid, refunded); the plans only while sales are open; Campus Bot usage in
// token mode; and today's wording whenever plans are not on sale.
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

// `eligible` is what the server's eligibility read (lib/entitlements/server.ts) decided before render.
// `courses` is get_my_course_selection(); `revision` the profile revision; `current` the student's course list; `usage`
// get_my_campus_bot_usage() as read by lib/ai-practice/campus-bot-usage.ts.
const myCourses = { status: 'ok', courses: [{ isFree: true }, { isFree: false }, { isFree: false }, { isFree: false }] }
async function render(wire, eligible = true, { courses = { state: 'open', locked: false, lastDay: null }, revision = 4,
  current = myCourses, usage = { state: 'units' } } = {}) {
  return withTsx(async () => {
    const original = Module._load
    function StudentAccessGate() { return null }
    function FreePassStart(props) { return React.createElement('button', { 'data-activation': props.passHours,
      'data-revision': String(props.profileRevision) }, 'Get your free pass') }
    function PlanChooser(props) { return React.createElement('plan-chooser', { 'data-plans': props.plans.map(plan =>
      `${plan.plan}:${plan.price_kobo}`).join(',') }) }
    try {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', { href: props.href }, props.children) }
        if (name === '@/lib/supabase/server') return { createClient: async () => ({}) }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => ({ user: { id: 'student' }, sessionId: 's' }) }
        if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async () =>
          ({ status: 'ok', entitlement: { ...entitlementSummarySchema.parse(wire), discovery_eligible: eligible } }) }
        if (name === '@/lib/ai-practice/supabase-env') return { readAllowance: async () => null }
        if (name === '@/lib/ai-practice/campus-bot-usage') return { readCampusBotUsage: async () => {
          if (usage === 'fails') throw new Error('read failed')
          return usage } }
        if (name === '@/lib/courses/read-model') return { getCurrentStudentCoursesForVerifiedStudent: async () => current }
        if (name === '@/lib/profile/course-selection') return { readCourseSelection: async () => courses,
          readProfileRevision: async () => revision,
          formatSemesterDay: original.call(this, '../../lib/profile/course-selection.ts', ...args).formatSemesterDay }
        if (name === './FreePassStart') return { FreePassStart }
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
})

test('an ineligible student sees free GST access: no offer, no button and no reason', async () => {
  const html = await render(discoveryDatabase, false)
  assert.doesNotMatch(html, /Free pass|data-activation|free pass<|72 hours/)
  assert.doesNotMatch(html, /isn’t available|not offered|email|months?\b|years?\b|already had/i)
  assert.match(html, /Free GST courses/)
  assert.doesNotMatch(html, /Your GST courses are open to you/, 'the heading says it; no second line repeats it')
  assert.match(html, /Campus Bot practice from your own notes comes with Early Access\./)
})

test('the free card counts the student\'s other courses, in today\'s wording while plans are not on sale', async () => {
  const text = strip(await render(discoveryDatabase, false))
  assert.match(text, /Your other 3 courses: Included with full access/)
  assert.doesNotMatch(text, /Department courses open/, 'no page lede repeating the card')
  assert.doesNotMatch(text, /subscribe|Choose a plan|₦/i)
  assert.match(strip(await render(discoveryDatabase, false, { current: { status: 'ok', courses: [{ isFree: false }] } })),
    /Your other 1 course: Included/)
  assert.doesNotMatch(strip(await render(discoveryDatabase, false, { current: null })), /Your other/,
    'no count when the course list cannot be read')
})

test('with a database from before the pass, the page shows a neutral plan: no pass, no button, no 72 hours', async () => {
  const html = await render(preDiscoveryDatabase)
  assert.doesNotMatch(html, /Free pass|data-activation|72 hours|CBT exam|study guide topic/)
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
    assert.doesNotMatch(html, /Free pass|data-activation|72 hours|CBT exam|study guide topic|your pass|a pass/i, label)
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
  assert.match(kept, /Campus Bot practice from your own notes comes with Early Access\./)
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

test('Early Access shows its end day; awaiting launch never shows a date', async () => {
  const active = { ...discoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: LATER },
    trial: { ...trial, status: 'not-offered', policy: null },
    early_access: { status: 'active', starts_at: '2026-10-25T00:00:00+00:00', ends_at: LATER, enrollment_closes_at: null } }
  const text = strip(await render(active, false))
  assert.match(text, /Early Access Full access to your courses until Fri, 20 Nov 2026\./)
  const awaiting = strip(await render({ ...discoveryDatabase, early_access: { ...early, status: 'awaiting-launch' } }, false))
  assert.match(awaiting, /Your free month of full access starts automatically when CampusIntell launches publicly\./)
  assert.doesNotMatch(awaiting, /\b20\d\d\b/)
})

test('plans show only while sales are open, with the payment, refund and terms lines', async () => {
  const html = await render(onSale, false)
  assert.match(html, /<h2[^>]*>Choose a plan<\/h2>/)
  assert.match(html, /data-plans="plus_session:1100000,plus_semester:600000,standard_session:700000,standard_semester:400000"/)
  assert.match(html, /You’ll pay securely by card or bank transfer on our payment partner’s page\./)
  assert.match(html, /Full refund within 48 hours of paying, as long as you haven’t used Campus Bot or a large part of your plan\. <a href="\/payment-terms">Payment terms<\/a>/)
  assert.equal((strip(html).match(/GST/g) || []).length, 1, 'GST is named once, in Your access')
  assert.doesNotMatch(strip(html), /Department courses open when you subscribe/)
  assert.match(strip(html), /Your other 3 courses: Included when you subscribe/)
  assert.match(strip(html), /Campus Bot practice from your own notes is included when you subscribe\./)
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
  assert.match(text, /Full refund within 48 hours of paying, as long as you haven’t used Campus Bot or a large part of your plan\. Payment terms/)
  assert.doesNotMatch(text, /when you subscribe|Early Access/, 'a subscribed student is not told how to subscribe')
  assert.doesNotMatch(html, /plan-chooser|data-activation|Free pass/)
  assert.match(html, new RegExp(`href="/access/receipts/${ORDER}"`))
  assert.match(text, /Standard · Session · ₦7,000/)
  assert.match(text, /Ref 3F2C9A1B7D/)
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
  assert.match(strip(section), /This session About half left/)
  assert.match(strip(section), /This week Plenty left/)
  assert.match(strip(section), /Resets at /)
  assert.doesNotMatch(strip(section), /\b(50|100|380|400|20)\b/, 'no counts or limits in the text')
  assert.doesNotMatch(html, /id="ai-heading"/)
  for (const failed of ['fails', null]) {
    const missing = await render(subscribed, false, { usage: failed })
    assert.doesNotMatch(missing, /usage-heading|role="meter"/, 'a failed read shows nothing')
  }
})

const locked = { ...discoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: '2026-11-25T12:00:00+00:00' } }

test('a student whose courses are set sees the semester\'s last day on the plan, once (D9)', async () => {
  const html = await render(locked, false, { courses: { state: 'locked', locked: true, lastDay: '2027-03-08' } })
  assert.match(html, /Your courses are set for this semester, until 8 March 2027\./)
  assert.equal(html.match(/until 8 March 2027/g).length, 1)
})

test('no semester date for an unlocked student, or a locked one whose semester end is not known yet', async () => {
  for (const courses of [{ state: 'open', locked: false, lastDay: null }, { state: 'incomplete', locked: false, lastDay: null },
    { state: 'locked', locked: true, lastDay: null }, null]) {
    const html = await render(discoveryDatabase, true, { courses })
    assert.doesNotMatch(html, /courses are set|March|semester,/, JSON.stringify(courses))
  }
})

test('the pass activation is given the profile revision the page showed (D7)', async () => {
  assert.match(await render(discoveryDatabase, true, { revision: 7 }), /data-revision="7"/)
})

test('when the revision cannot be read, no pass can be started unbound: the student is asked to refresh', async () => {
  const html = await render(discoveryDatabase, true, { revision: null })
  assert.doesNotMatch(html, /data-activation/)
  assert.match(html, /We couldn’t load your courses\. Refresh the page to continue\./)
})
