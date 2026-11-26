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
  assert.equal(copy.sessionSavingLine(700000, 100000), '₦3,500 a semester · Save ₦1,000')
  assert.equal(copy.sessionUpgradeLine(700000, 100000), 'Pay for the whole session instead: ₦7,000 for both semesters, save ₦1,000.')
  assert.equal(copy.sessionSavingBadge(catalogue), 'Save ₦1,000')
  assert.equal(copy.sessionSavingBadge(catalogue.map(plan => plan.plan === 'plus_session' ? { ...plan, price_kobo: 1050000 } : plan)), 'Save up to ₦1,500')
  assert.equal(copy.sessionSavingBadge([]), null)
  const semesterOnly = copy.tierPrices(catalogue.filter(plan => plan.period === 'semester'), 'plus')
  assert.deepEqual([semesterOnly.session, semesterOnly.savingKobo], [null, 0])
})

test('the plan lines are the approved copy, with no token numbers or itemised limits', () => {
  const { PLAN_COPY } = copy
  assert.equal(PLAN_COPY.cardLine.standard, 'For studying all your courses.')
  assert.equal(PLAN_COPY.cardLine.plus, 'For students who use Campus Bot a lot.')
  assert.deepEqual(PLAN_COPY.courses, { semester: 'All your courses for this semester', session: 'All your courses for both semesters' })
  assert.equal(PLAN_COPY.study, 'Course notes, practice questions and timed exams')
  assert.equal(PLAN_COPY.plusIntro, 'Everything in Standard, plus:')
  assert.equal(PLAN_COPY.plusBenefit, '2× Campus Bot use')
  assert.equal(PLAN_COPY.payment, 'Pay by card or bank transfer.')
  // Owner decision of 23 Nov 2026: a delivered set of flashcards ends the standard refund, as a question set does.
  assert.equal(PLAN_COPY.refund, 'Full refund within 48 hours of paying, as long as you haven’t made a Campus Bot question set or flashcards, or used a large part of your plan.')
  assert.equal(PLAN_COPY.termsLink, 'Payment terms')
  assert.equal(PLAN_COPY.switchToSession, 'Switch to Session')
  assert.equal('keepSemester' in PLAN_COPY, false)
  assert.doesNotMatch(JSON.stringify(PLAN_COPY), /token|\b\d+ (sets?|questions?|messages?)\b|Semester plan|Session plan/i)
})

test('the copy switch: today\'s wording while plans are not on sale, subscribing once they are', () => {
  const closed = copy.accessCopy(false), open = copy.accessCopy(true)
  // Plan & Access names GST once, in Your access; neither wording carries a lede or a Campus Bot line repeating it.
  assert.equal('accessLede' in closed || 'accessLede' in open, false)
  assert.equal(open.aiNotEntitled, 'Campus Bot is included when you subscribe.')
  // Before plans are on sale a locked course is "Included with a plan.", the words its row uses too.
  assert.deepEqual([closed.lockedTitle, closed.studyLocked], ['Included with a plan.', 'Included with a plan.'])
  assert.deepEqual([open.lockedTitle, open.studyLocked], ['Included when you subscribe.', 'Included when you subscribe.'])
  assert.deepEqual([closed.lockedAction, open.lockedAction], ['See how to unlock', 'Subscribe'])
  assert.equal(closed.aiNotEntitled, 'Campus Bot is included with a plan.')
  assert.equal(closed.aiSection, 'Practise from your notes is included with a plan.')
  assert.equal(open.aiSection, 'Practise from your notes is included when you subscribe.')
  assert.equal(closed.answersLine, 'Answers and explanations are included with full access.')
  assert.equal(open.answersLine, 'Answers and explanations are included when you subscribe.')
  const said = (wording, key) => typeof wording[key] === 'function' ? wording[key]('BUA 216') : wording[key]
  for (const key of Object.keys(closed)) {
    assert.doesNotMatch(said(closed, key), /subscribe|₦/i, `closed ${key}: nothing to buy yet`)
    // "Early Access" is our name for free access, and no student reads it in either wording.
    assert.doesNotMatch(said(open, key) + said(closed, key), /Early Access/, key)
  }
})

test('the free pass offer reads the same everywhere; what it includes and its terms live in the modal copy', () => {
  const { FREE_PASS_COPY, DISCOVERY_PASS_LABEL } = copy
  assert.equal(DISCOVERY_PASS_LABEL, 'Free pass')
  assert.equal(FREE_PASS_COPY.heading, 'Free pass')
  assert.equal(FREE_PASS_COPY.line(72), 'Try your department courses free for 3 days.')
  assert.equal(FREE_PASS_COPY.start, 'Get your free pass')
  assert.deepEqual(FREE_PASS_COPY.gives, ['A full exam from one of your courses', 'A complete notes topic from one of your courses',
    'Practise from your notes'])
  assert.deepEqual(copy.DISCOVERY_PREVIEW_LABEL, { cbt: 'CBT exam', study_guide: 'notes topic' })
  assert.deepEqual(FREE_PASS_COPY.terms(72), ['It lasts 3 days from now.', 'Each student can have one free pass.',
    'You can’t change your department, level or semester until the semester ends.'])
  assert.deepEqual([FREE_PASS_COPY.modalTitle, FREE_PASS_COPY.confirm, FREE_PASS_COPY.cancel, FREE_PASS_COPY.starting],
    ['Your free pass', 'Start your free pass', 'Not now', 'Starting…'])
  assert.equal(FREE_PASS_COPY.endsAt('2026-11-06T09:00:00Z'), 'Ends Fri, 6 Nov 2026, 10:00')
})

test('free access reads exactly as approved: "Free until {day}" by name, "your" and never "my", never a month or Early Access', () => {
  const { FREE_MONTH_COPY, ACCESS_SOURCE_LABEL, COURSES_FIXED_LINE, freeUntil } = copy
  // The day is the server's text for the last day covered (formatFreeMonthDay): here the end of 30 December, Lagos.
  const day = '30 December'
  assert.equal('FREE_MONTH_LABEL' in copy, false, 'there is no name without its day')
  assert.equal(freeUntil(day), 'Free until 30 December')
  assert.equal(ACCESS_SOURCE_LABEL.early_access, 'Free access')
  // The offer: the Dashboard card, the plan card and the line above Pay.
  assert.deepEqual([FREE_MONTH_COPY.title(day), FREE_MONTH_COPY.line, FREE_MONTH_COPY.start],
    ['Free until 30 December', 'Full access to your courses and Campus Bot.', 'Get free access'])
  assert.deepEqual([FREE_MONTH_COPY.planName(day), FREE_MONTH_COPY.price], ['Free until 30 December', '₦0'])
  assert.equal(FREE_MONTH_COPY.instead(day), 'You can get free access until 30 December instead.')
  // The confirmation: its title carries the day; then the screen-reader description, the two lists and the buttons.
  assert.equal(FREE_MONTH_COPY.description, 'What free access gives, and its terms.')
  assert.deepEqual(FREE_MONTH_COPY.gives, ['Full access to your courses, notes and practice', 'Campus Bot included'])
  assert.equal(COURSES_FIXED_LINE, 'You can’t change your department, level or semester until the semester ends.')
  assert.deepEqual(FREE_MONTH_COPY.terms(day), ['Starts now', COURSES_FIXED_LINE])
  assert.deepEqual([FREE_MONTH_COPY.confirm, FREE_MONTH_COPY.cancel, FREE_MONTH_COPY.starting],
    ['Start free access', 'Not now', 'Starting…'])
  // After claiming, and when it is over. Checkout names the day with formatAccessLastDay ("Wed, 30 Dec 2026").
  assert.equal(FREE_MONTH_COPY.active(day), 'Free until 30 December')
  assert.equal(FREE_MONTH_COPY.ended, 'Your free access has ended.')
  assert.equal(FREE_MONTH_COPY.continues('Wed, 30 Dec 2026'), 'Your free access continues until Wed, 30 Dec 2026.')
  // A locked course and the Campus Bot page.
  assert.equal(FREE_MONTH_COPY.lockedTitle(day), 'Included free until 30 December.')
  assert.equal(FREE_MONTH_COPY.campusBot(day), 'Campus Bot is included free until 30 December.')
  // Errors.
  assert.equal(FREE_MONTH_COPY.error, 'Couldn’t start your free access. Try again.')
  assert.equal(FREE_MONTH_COPY.offerEnded, 'This offer has ended.')
  assert.equal(FREE_MONTH_COPY.unavailable, 'Free access isn’t available on this account.')
  // Every string, and every string a function makes from the day (JSON.stringify of the object skips the functions).
  for (const [key, value] of Object.entries(FREE_MONTH_COPY)) {
    const text = JSON.stringify(typeof value === 'function' ? value(day) : value)
    assert.doesNotMatch(text, /month|Early Access|\bmy\b|\blist\b|enrol|\(Lagos\)/i, key)
  }
})

test('Campus Bot use is said in words, never numbers, and the AI page names each limit', () => {
  const level = (used, limit = 100, inFlight = 0) => copy.usageLevel({ used, limit, inFlight })
  assert.deepEqual([level(0).words, level(39).words, level(40).words, level(75).words, level(100).words],
    ['Plenty left', 'Plenty left', 'About half left', 'A little left', 'Used up'])
  assert.equal(level(30, 100, 20).key, 'half', 'a set being written counts as used')
  assert.equal(level(0, 0).key, 'none', 'no window reads as used up')
  assert.equal(copy.USAGE_COPY.sessionResets('2026-11-03T13:30:00Z'), 'Resets at 14:30')
  assert.equal(copy.USAGE_COPY.weekResets('2026-11-08T23:00:00Z'), 'Resets Monday at 00:00')
  assert.deepEqual([copy.USAGE_COPY.session, copy.USAGE_COPY.week, copy.USAGE_COPY.notStarted],
    ['5-hour limit', 'Weekly limit', 'Not used yet'])
  // What has run out, then when it comes back.
  const limit = copy.CAMPUS_BOT_LIMIT_COPY
  assert.deepEqual([limit.session.title, limit.session.line('2026-11-03T13:30:00Z')],
    ['You’ve used up Campus Bot for now.', 'It resets at 14:30.'])
  assert.deepEqual([limit.week.title, limit.week.line('2026-11-08T23:00:00Z')],
    ['You’ve used up Campus Bot for this week.', 'It resets Monday at 00:00.'])
  assert.deepEqual([limit.undelivered.title, limit.undelivered.line()],
    ['Campus Bot limit reached.', 'Campus Bot couldn’t finish your last few sets. Try again tomorrow.'])
  assert.deepEqual([limit.session.line(null), limit.week.line(null)], ['', ''], 'no reset time, no second line')
})

test('receipts, references and the return copy; "didn\'t go through" never promises no charge', () => {
  assert.equal(copy.paymentReference('3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'), '3F2C9A1B7D')
  assert.match(copy.paymentSupportMessage('3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab'),
    /Reference: 3F2C9A1B7D \(3f2c9a1b-7d4e-4c2a-9b1f-0123456789ab\)/)
  assert.deepEqual(copy.RECEIPT_STATUS_LINE, { 'paid': null, 'paid-duplicate': 'Paid twice, extra being refunded',
    'refund-pending': 'Refund in progress', 'refunded': 'Refunded' })
  assert.equal(copy.RETURN_COPY.cancelledBody, 'No plan was added.')
  assert.equal(copy.RETURN_COPY.failedBody,
    'No plan was added. If money left your account, message us with the time you paid and we’ll sort it out.')
  assert.doesNotMatch(JSON.stringify([copy.RETURN_COPY, copy.CHECKOUT_PROBLEM]), /haven’t been charged|not been charged|no charge/i)
  // One short line per waiting state, and nothing about how payment works. Only "still confirming" says the student
  // can leave: the page has stopped asking by then.
  assert.equal(copy.RETURN_COPY.confirmingBody, 'This usually takes a few seconds.')
  assert.equal(copy.RETURN_COPY.stillBody, 'Bank transfers can take a few minutes.')
  assert.equal(copy.RETURN_COPY.stillLeave, 'You can leave this page. We’ll add your plan as soon as your payment is confirmed.')
  const { stillLeave, ...waitingCopy } = copy.RETURN_COPY
  assert.equal(copy.RETURN_COPY.unavailableTitle, 'We couldn’t check your payment right now')
  assert.equal(copy.RETURN_COPY.checkFailed, 'Couldn’t check. Try again.')
  assert.doesNotMatch(JSON.stringify([waitingCopy, copy.CHECKOUT_PROBLEM, copy.PLAN_COPY, copy.CONFIRM_COPY]),
    /leave this page|charged twice|payment partner/i)
  assert.doesNotMatch(stillLeave, /charged twice|payment partner/i)
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
    'haven’t started an exam, made a Campus Bot question set or flashcards, answered more than 10 practice questions, ' +
    'opened more than 3 notes topics or had more than 10 Campus Bot replies. GST courses don’t count, and you can get one refund ' +
    'this way. Just message us, and please don’t use your plan while we process it. Refunds go back to the card or ' +
    'account you paid with, and your plan ends once the refund is made. If a problem on our side stops you from ' +
    'using your plan, we’ll refund you.')
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
