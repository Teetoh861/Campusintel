// lib/entitlements/plan-copy.test.cjs — Every part 3 plan string a student reads, from its one home in presentation.ts:
// plan names, prices and the Session saving, the Semester prompt, the payment and refund lines, the copy switch, the
// free pass offer, Campus Bot usage in words, receipts and the return copy (which never promises anything about charges).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const copy = require('./presentation.ts')

const catalogue = [
  { plan: 'plus_session', tier: 'plus', period: 'session', price_kobo: 1100000 },
  { plan: 'plus_semester', tier: 'plus', period: 'semester', price_kobo: 600000 },
  { plan: 'standard_session', tier: 'standard', period: 'session', price_kobo: 700000 },
  { plan: 'standard_semester', tier: 'standard', period: 'semester', price_kobo: 400000 }]

test('plan names, prices and the Session saving come from the catalogue', () => {
  assert.equal(copy.planName('standard', 'semester'), 'Standard · Semester')
  assert.equal(copy.planName('plus', 'session'), 'Plus · Session')
  assert.deepEqual(copy.planOf('plus_semester'), { tier: 'plus', period: 'semester' })
  assert.equal(copy.naira(400000), '₦4,000')
  assert.equal(copy.naira(1100000), '₦11,000')
  const standard = copy.tierPrices(catalogue, 'standard')
  assert.deepEqual([standard.semester.price_kobo, standard.session.price_kobo, standard.savingKobo], [400000, 700000, 100000])
  assert.equal(copy.tierPrices(catalogue, 'plus').savingKobo, 100000)
  assert.equal(copy.sessionSavingLine(100000), 'Both semesters · save ₦1,000')
  assert.equal(copy.semesterPromptLine(700000, 100000), 'Both semesters for ₦7,000, save ₦1,000.')
  const semesterOnly = copy.tierPrices(catalogue.filter(plan => plan.period === 'semester'), 'plus')
  assert.deepEqual([semesterOnly.session, semesterOnly.savingKobo], [null, 0])
})

test('the plan lines are the approved copy, with no token numbers or itemised limits', () => {
  const { PLAN_COPY } = copy
  assert.equal(PLAN_COPY.cardLine.standard, 'Your courses this semester: notes, practice, exams and Campus Bot.')
  assert.equal(PLAN_COPY.cardLine.plus, 'Everything in Standard, with twice the Campus Bot use.')
  assert.equal(PLAN_COPY.payment, 'You’ll pay securely by card or bank transfer on our payment partner’s page.')
  assert.equal(PLAN_COPY.refund, 'Full refund within 48 hours of paying, as long as you haven’t used Campus Bot or a large part of your plan.')
  assert.equal(PLAN_COPY.termsLink, 'Payment terms')
  assert.deepEqual([PLAN_COPY.switchToSession, PLAN_COPY.keepSemester], ['Switch to Session', 'Keep Semester'])
  assert.doesNotMatch(JSON.stringify(PLAN_COPY), /token|\b\d+ (sets?|questions?|messages?)\b|Semester plan|Session plan/i)
})

test('the copy switch: today\'s wording while plans are not on sale, subscribing once they are', () => {
  const closed = copy.accessCopy(false), open = copy.accessCopy(true)
  assert.equal(closed.accessLede, 'GST courses are free for every student. Department courses open fully with Early Access.')
  assert.equal(open.accessLede, 'GST courses are free for every student. Department courses open when you subscribe.')
  assert.equal(closed.answersLine, 'Answers and explanations are included with full access.')
  assert.equal(open.answersLine, 'Answers and explanations are included when you subscribe.')
  const said = (wording, key) => typeof wording[key] === 'function' ? wording[key]('BUA 216') : wording[key]
  for (const key of Object.keys(closed)) {
    assert.doesNotMatch(said(closed, key), /subscribe|\bplans?\b|₦/i, `closed ${key}`)
    assert.doesNotMatch(said(open, key), /Early Access/, `open ${key}`)
  }
})

test('the free pass offer reads the same everywhere; what it includes and its terms live in the modal copy', () => {
  const { FREE_PASS_COPY, DISCOVERY_PASS_LABEL } = copy
  assert.equal(DISCOVERY_PASS_LABEL, 'Free pass')
  assert.equal(FREE_PASS_COPY.heading, 'Free pass')
  assert.equal(FREE_PASS_COPY.line(72), 'Try your department courses free for 3 days.')
  assert.equal(FREE_PASS_COPY.start, 'Get your free pass')
  assert.deepEqual(FREE_PASS_COPY.terms(72), ['It lasts 3 days from now.', 'Each student can have one free pass.',
    'Starting it sets your courses for this semester.'])
  assert.match(FREE_PASS_COPY.endsAt('2026-11-06T09:00:00Z'), /^Ends Fri, 6 Nov 2026, 10:00 \(Lagos\)$/)
})

test('Campus Bot use is said in words, never numbers, and the AI page names each limit', () => {
  const level = (used, limit = 100, inFlight = 0) => copy.usageLevel({ used, limit, inFlight })
  assert.deepEqual([level(0).words, level(39).words, level(40).words, level(75).words, level(100).words],
    ['Plenty left', 'Plenty left', 'About half left', 'A little left', 'Used up'])
  assert.equal(level(30, 100, 20).key, 'half', 'a set being written counts as used')
  assert.equal(level(0, 0).key, 'none', 'no window reads as used up')
  assert.equal(copy.USAGE_COPY.sessionResets('2026-11-03T13:30:00Z'), 'Resets at 14:30')
  assert.equal(copy.USAGE_COPY.weekResets('2026-11-08T23:00:00Z'), 'Resets Monday at 00:00')
  assert.equal(copy.CAMPUS_BOT_LIMIT_COPY.session('2026-11-03T13:30:00Z'),
    'You’ve reached this session’s Campus Bot limit. It resets at 14:30.')
  assert.equal(copy.CAMPUS_BOT_LIMIT_COPY.week('2026-11-08T23:00:00Z'),
    'You’ve reached this week’s Campus Bot limit. It resets Monday at 00:00.')
  assert.equal(copy.CAMPUS_BOT_LIMIT_COPY.undelivered, 'Campus Bot couldn’t finish your last few sets. Try again tomorrow.')
})

test('receipts, references and the return copy; "didn\'t go through" never promises no charge', () => {
  assert.equal(copy.paymentReference('3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'), '3F2C9A1B7D')
  assert.match(copy.paymentSupportMessage('3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'),
    /Reference: 3F2C9A1B7D \(3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab\)/)
  assert.deepEqual(copy.RECEIPT_STATUS_LINE, { 'paid': null, 'paid-duplicate': 'Extra payment, being refunded',
    'refund-pending': 'Refund in progress', 'refunded': 'Refunded' })
  assert.equal(copy.RETURN_COPY.failedBody,
    'No plan was added. If money left your account, message us with the time you paid and we’ll sort it out.')
  assert.doesNotMatch(JSON.stringify([copy.RETURN_COPY, copy.CHECKOUT_PROBLEM]), /haven’t been charged|not been charged|no charge/i)
  assert.equal(copy.subscribedBody({ tier: 'standard', period: 'semester', ends_at: '2027-03-08T22:59:59Z' }),
    'Standard · Semester keeps your courses open until Mon, 8 Mar 2027.')
  assert.equal(copy.subscribedBody({ tier: 'plus', period: 'session', ends_at: null }),
    'Plus · Session keeps your First Semester courses open. Second Semester opens when it resumes.')
  assert.equal(copy.RETURN_COPY.nowOpen(1), 'Now open in your 1 course')
  assert.equal(copy.RETURN_COPY.nowOpen(0), 'Now open in your courses')
})

test('Payment terms read exactly as approved, and the price table matches the seeded catalogue', () => {
  const t = copy.TERMS_COPY
  assert.equal(t.title, 'Payment terms')
  assert.deepEqual(t.table.columns, ['Semester', 'Session (both semesters)'])
  assert.deepEqual(t.table.rows.map(row => [row.plan, copy.naira(row.semesterKobo), copy.naira(row.sessionKobo)]),
    [['Standard', '₦4,000', '₦7,000'], ['Plus', '₦6,000', '₦11,000']])
  const seed = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../supabase/migrations/20261102190000_payments.sql'), 'utf8')
  const seeded = Object.fromEntries([...seed.matchAll(/\('(\w+)', '\w+', '\w+', (\d+), \d+, 'migration:20261102190000'\)/g)]
    .map(([, plan, kobo]) => [plan, Number(kobo)]))
  for (const row of t.table.rows) {
    const tier = row.plan.toLowerCase()
    assert.equal(seeded[`${tier}_semester`], row.semesterKobo, `${tier} semester`)
    assert.equal(seeded[`${tier}_session`], row.sessionKobo, `${tier} session`)
  }
  assert.equal(t.intro, 'Both plans include all your department courses for your level, with notes, practice questions and ' +
    'Campus Bot. Plus gives you twice as much Campus Bot. GST courses are always free.')
  assert.deepEqual(t.sections.map(section => section.heading), ['Paying', 'When your plan starts', 'How long it lasts',
    'Your courses', 'Campus Bot', 'Your account', 'Refunds', 'Wrong amount', 'Changes'])
  assert.equal(t.sections[7].body, 'Paid too much? Your plan starts and we refund the extra. Paid too little? It’s refunded in full.')
  assert.equal(t.sections[6].body, 'Changed your mind? You can get a full refund within 48 hours of paying, as long as you ' +
    'haven’t used Campus Bot or a large part of your plan. Just message us, and please don’t use your plan while we ' +
    'process it. Refunds go back to the card or account you paid with, and your plan ends once the refund is made.')
})

test('a semester end (the exclusive midnight after its last day) reads as that last day', () => {
  assert.equal(copy.formatAccessLastDay('2027-03-08T23:00:00Z'), 'Mon, 8 Mar 2027')
  assert.equal(copy.formatAccessDay('2027-03-08T23:00:00Z'), 'Tue, 9 Mar 2027', 'the raw instant is already the next day in Lagos')
  assert.equal(copy.subscribedBody({ tier: 'standard', period: 'semester', ends_at: '2027-03-08T23:00:00Z' }),
    'Standard · Semester keeps your courses open until Mon, 8 Mar 2027.')
  assert.equal(copy.formatAccessLastDay('nope'), '')
})

test('a wrong amount has its own approved title and body', () => {
  assert.equal(copy.RETURN_COPY.mismatchTitle, 'Payment didn’t match the plan price')
  assert.equal(copy.RETURN_COPY.mismatchBody, 'We’ll refund the full amount. You can then pay for your plan again.')
  assert.equal(copy.RETURN_COPY.amountReceived, 'Amount received')
})

test('"You\'re subscribed" lists a feature only when one of the student\'s courses has it', () => {
  const ready = study => ({ state: 'ready', study: { notes: false, cbtPractice: false, theory: false, overview: false, ...study } })
  assert.deepEqual(copy.unlockedFeatures([ready({ notes: true, cbtPractice: true }), ready({ cbtPractice: true })]),
    ['Notes by topic', 'Practice with instant feedback', 'Exam mode'])
  assert.deepEqual(copy.unlockedFeatures([ready({ theory: true }), { state: 'not-built', reason: 'unlinked' }]),
    ['Theory questions with suggested answers'])
  assert.deepEqual(copy.unlockedFeatures([ready({}), { state: 'not-available' }]), [])
  assert.deepEqual(copy.unlockedFeatures([]), [])
  assert.deepEqual(copy.unlockedFeatures([{ state: 'no-published-learning',
    study: { notes: false, cbtPractice: false, theory: false, overview: true } }]), [], 'an overview alone opens nothing listed')
  assert.equal(copy.unlockedFeatures([ready({ notes: true }), { state: 'locked' }]), null, 'a course still locked: unknown')
  assert.equal(copy.unlockedFeatures([{ state: 'temporarily-unavailable', reason: 'publication-read-failed' }]), null)
})
