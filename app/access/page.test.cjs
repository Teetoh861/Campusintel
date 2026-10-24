// app/access/page.test.cjs — Plan & Access rendered against real entitlement summaries: a database that affirmatively
// offers the Discovery Pass shows the offer and the activation to an eligible student only; an ineligible student sees
// no offer and no reason; a database from before the pass (which would issue a seven-day full-access trial instead)
// shows a neutral plan with no pass and no button.
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
async function render(wire, eligible = true) {
  return withTsx(async () => {
    const original = Module._load
    function StudentAccessGate() { return null }
    function TrialActivation(props) { return React.createElement('button', { 'data-activation': props.passHours }, 'Start my Discovery Pass') }
    try {
      Module._load = function(name, ...args) {
        if (name === '@/components/auth/StudentAccessGate') return { StudentAccessGate }
        if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a', { href: props.href }, props.children) }
        if (name === '@/lib/supabase/server') return { createClient: async () => ({}) }
        if (name === '@/lib/auth/student-state') return { getStudentSessionContext: async () => ({ user: { id: 'student' }, sessionId: 's' }) }
        if (name === '@/lib/entitlements/server') return { readEntitlementForVerifiedStudent: async () =>
          ({ status: 'ok', entitlement: { ...entitlementSummarySchema.parse(wire), discovery_eligible: eligible } }) }
        if (name === '@/lib/ai-practice/supabase-env') return { readAllowance: async () => null }
        // WhileOffered marks the offer text a refusal withdraws (rendered here as <withdrawable>).
        if (name === './TrialActivation') return { TrialActivation, PassOfferScope: props => props.children,
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

test('an eligible student is offered the pass with its activation', async () => {
  const html = await render(discoveryDatabase)
  assert.match(html, /Discovery Pass/)
  assert.match(html, /data-activation="72"/)
  assert.match(html, /50-question CBT exam/)
  assert.match(html.replace(/<\/?withdrawable>/g, ''), /comes with a Discovery Pass or Early Access/)
  assert.doesNotMatch(html, /phone|SMS|per person/i)
})

test('an ineligible student sees normal free GST access: no offer, no button and no reason', async () => {
  const html = await render(discoveryDatabase, false)
  assert.doesNotMatch(html, /Discovery Pass|data-activation|Start my|72 hours|CBT exam|study guide topic/)
  assert.doesNotMatch(html, /isn’t available|not offered|email|months?\b|years?\b|already had/i)
  assert.match(html, /Free<\/b> · GST courses, always included/)
  assert.match(html, /AI practice from your own notes comes with Early Access\./)
})

test('with a database from before the pass, the page shows a neutral plan: no pass, no button, no 72 hours', async () => {
  const html = await render(preDiscoveryDatabase)
  assert.doesNotMatch(html, /Discovery Pass|data-activation|Start my|72 hours|CBT exam|study guide topic/)
  assert.match(html, /Free<\/b> · GST courses, always included/)
  assert.match(html, /Department courses open fully with Early Access\. GST courses stay free for every student\./)
  assert.doesNotMatch(html, /7-day|seven-day|full access for 7/i, 'nor is the seven-day trial that database would issue advertised')
})

test('regression F4: on a database from before the pass, no trial status names a pass or a reserved allowance', async () => {
  const later = '2026-11-20T12:00:00.000+00:00'
  const activeEarly = { status: 'active', starts_at: '2026-10-25T00:00:00+00:00', ends_at: later, enrollment_closes_at: null }
  const cases = {
    'after-early-access': { ...preDiscoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: later },
      trial: { ...trial, status: 'after-early-access', available_from: later }, early_access: activeEarly },
    'not-offered': { ...preDiscoveryDatabase, tier: 'full', access: { source: 'early_access', ends_at: later },
      trial: { ...trial, status: 'not-offered' }, early_access: activeEarly },
    'ended seven-day trial': { ...preDiscoveryDatabase,
      trial: { ...trial, status: 'ended', starts_at: '2026-10-10T12:00:00+00:00', ends_at: '2026-10-17T12:00:00+00:00' } },
  }
  for (const [label, wire] of Object.entries(cases)) {
    const html = await render(wire)
    assert.doesNotMatch(html, /Discovery Pass|data-activation|Start my|72 hours|CBT exam|study guide topic|your pass|a pass/i, label)
  }
  assert.match(await render(cases['ended seven-day trial']), /Free trial/, 'a trial that was issued is still described as what it was')
  // On a database that offers the pass, an account it is not offered to sees no pass and no reason either.
  for (const status of ['not-offered', 'after-early-access']) {
    const html = await render({ ...discoveryDatabase, trial: { ...trial, status, policy: null } })
    assert.doesNotMatch(html, /Discovery Pass|data-activation|not offered|kept for later|becomes available/i, status)
  }
})

test('a refusal can withdraw every piece of offer text: the description, what is included and the AI line', async () => {
  const html = await render(discoveryDatabase)
  const withdrawable = [...html.matchAll(/<withdrawable>([\s\S]*?)<\/withdrawable>/g)].map(match => match[1]).join(' ')
  assert.match(withdrawable, /Try department courses free for 72 hours/)
  assert.match(withdrawable, /50-question CBT exam/)
  assert.match(withdrawable, /a Discovery Pass or /)
  const kept = html.replace(/<withdrawable>[\s\S]*?<\/withdrawable>/g, '')
  assert.doesNotMatch(kept, /Try department|CBT exam|study guide topic|AI upload|a Discovery Pass or/,
    'nothing describing the offer stays outside it')
  assert.match(kept, /AI practice from your own notes comes with Early Access\./)
})
