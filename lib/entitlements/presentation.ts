// lib/entitlements/presentation.ts — Plan copy and the one access notice a student sees, from the server summary.
// Every comparison uses the database's `now`, so the notice never depends on the viewer's clock.
import { discoveryOffered } from './contract'
import { DISCOVERY_KINDS } from './discovery-contract'
import type { AccessSource, EntitlementSummary, PaidPlan, PlanKey, PlanOnSale, PlanPeriod, PlanTier, Receipt, TrialPolicy }
  from './contract'
import type { DiscoveryKind } from './discovery-contract'

const HOUR_MS = 3_600_000
// How long after a Discovery Pass ends the "pass has ended" notice keeps showing.
const ENDED_NOTICE_DAYS = 14
const DAY_MS = 24 * HOUR_MS

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hour12: false,
})

/** Lagos time, the timezone every student is in. Server-side only, so client hydration stays deterministic. */
export function formatAccessDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : `${DATE_FORMAT.format(date)} (Lagos)`
}

// The Discovery Pass, as students see it.
export const DISCOVERY_PASS_LABEL = 'Free pass'
/** The pass mid-sentence ("your free pass"). */
export const DISCOVERY_PASS_NOUN = 'free pass'

const DAY_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
})
const TIME_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false })
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'long' })

/** A Lagos calendar day without a time ("Mon 8 Mar 2027"). */
export function formatAccessDay(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : DAY_FORMAT.format(date)
}
/** The last day a semester end covers. Semester ends are stored as the exclusive midnight after the last day (Lagos), so
 *  "until" names the day before that instant: a semester whose last day is 8 March reads "until Mon, 8 Mar 2027". */
export function formatAccessLastDay(iso: string): string {
  const end = Date.parse(iso)
  return Number.isNaN(end) ? '' : formatAccessDay(new Date(end - 1).toISOString())
}
/** A Lagos time of day ("14:00"). */
export function formatAccessTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : TIME_FORMAT.format(date)
}
/** A Lagos weekday ("Tuesday"). */
export function formatAccessWeekday(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : WEEKDAY_FORMAT.format(date)
}

// ---------------------------------------------------------------------------------------------------------------------
// Plans and payment (part 3). Every plan string a student reads lives here so the owner can adjust it in one place.
// No token numbers or itemised limits are ever shown.
// ---------------------------------------------------------------------------------------------------------------------
const NAIRA = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 0 })

/** ₦4,000 from kobo. */
export function naira(kobo: number): string {
  return `₦${NAIRA.format(Math.round(kobo / 100))}`
}

export const PLAN_TIER_NAME: Record<PlanTier, string> = { standard: 'Standard', plus: 'Plus' }
export const PLAN_PERIOD_NAME: Record<PlanPeriod, string> = { semester: 'Semester', session: 'Session' }

/** "Standard · Semester": a plan's name wherever the frames said Semester plan or Session plan. */
export function planName(tier: PlanTier, period: PlanPeriod): string {
  return `${PLAN_TIER_NAME[tier]} · ${PLAN_PERIOD_NAME[period]}`
}

export const PLAN_COPY = {
  heading: 'Choose a plan',
  periodSwitchLabel: 'Billing period',
  cardLine: {
    standard: 'Your courses this semester: notes, practice, exams and Campus Bot.',
    plus: 'Everything in Standard, with twice the Campus Bot use.',
  } satisfies Record<PlanTier, string>,
  perPeriod: { semester: 'a semester', session: 'a session' } satisfies Record<PlanPeriod, string>,
  payment: 'You’ll pay securely by card or bank transfer on our payment partner’s page.',
  refund: 'Full refund within 48 hours of paying, as long as you haven’t used Campus Bot or a large part of your plan.',
  termsLink: 'Payment terms',
  switchToSession: 'Switch to Session',
  keepSemester: 'Keep Semester',
  gstFree: 'GST courses stay free.',
} as const

/** "Both semesters · save ₦1,000" under a Session card. */
export function sessionSavingLine(savingKobo: number): string {
  return `Both semesters · save ${naira(savingKobo)}`
}
/** The prompt after choosing Semester: "Both semesters for ₦7,000, save ₦1,000." */
export function semesterPromptLine(sessionPriceKobo: number, savingKobo: number): string {
  return `Both semesters for ${naira(sessionPriceKobo)}, save ${naira(savingKobo)}.`
}

/** A tier's Semester and Session prices from the catalogue, and what the Session saves. */
export function tierPrices(plans: ReadonlyArray<PlanOnSale>, tier: PlanTier):
  { semester: PlanOnSale | null; session: PlanOnSale | null; savingKobo: number } {
  const semester = plans.find(plan => plan.tier === tier && plan.period === 'semester') ?? null
  const session = plans.find(plan => plan.tier === tier && plan.period === 'session') ?? null
  const savingKobo = semester !== null && session !== null ? Math.max(0, 2 * semester.price_kobo - session.price_kobo) : 0
  return { semester, session, savingKobo }
}

/** A plan key's tier and period. */
export function planOf(plan: PlanKey): { tier: PlanTier; period: PlanPeriod } {
  const [tier, period] = plan.split('_') as [PlanTier, PlanPeriod]
  return { tier, period }
}

/** A receipt's state beside its date, when it is not simply paid. */
export const RECEIPT_STATUS_LINE: Record<Receipt['status'], string | null> = {
  'paid': null, 'paid-duplicate': 'Extra payment, being refunded', 'refund-pending': 'Refund in progress', 'refunded': 'Refunded',
}

/** The student's own paid plan, as Plan & Access names it. */
export function paidPlanName(paid: PaidPlan): string {
  return planName(paid.tier, paid.period)
}

export const CONFIRM_COPY = {
  title: 'Confirm your courses',
  change: 'Change',
  coursesHeading: (count: number) => `Your ${count} ${count === 1 ? 'course' : 'courses'}`,
  setAfterPaying: 'After you pay, your Department, Level and Semester are set until the semester ends.',
  pay: (priceKobo: number) => `Confirm and pay ${naira(priceKobo)}`,
  opening: 'Opening payment…',
  notNow: 'Not now',
  free: 'Free',
  needsSelection: 'Confirm your courses for this semester to choose a plan.',
  confirmMyCourses: 'Confirm my courses',
} as const

/** Why the payment page could not open, by the reason the checkout route sent back (never a promise about charges). */
export const CHECKOUT_PROBLEM: Record<string, string> = {
  'unavailable': 'We couldn’t open the payment page. Try again in a moment.',
  'checkout-expired': 'That payment page expired. Try again to open a new one.',
  'selection-changed': 'Your courses changed. Check the list below, then try again.',
  'needs-selection': 'Confirm your courses for this semester first.',
  'sales-closed': 'Plans aren’t on sale right now.',
  'plan-unavailable': 'That plan isn’t available right now.',
  'account-restricted': 'Plans can’t be bought while this account is scheduled for deletion.',
  'session-changed': 'Your session changed. Try again.',
  'invalid-request': 'Something went wrong. Try again.',
}

export const RETURN_COPY = {
  confirmingTitle: 'Confirming your payment',
  confirmingBody: 'This usually takes a few seconds. You can leave this page. Your plan appears on Plan & Access once it’s confirmed.',
  stillTitle: 'We’re still confirming your payment',
  stillBody: 'Bank transfers can take a few minutes. We’ll add your plan as soon as your payment is confirmed. You won’t be charged twice for this checkout.',
  stillWaiting: 'Paid but still waiting?',
  checkAgain: 'Check again',
  checking: 'Checking…',
  subscribedTitle: 'You’re subscribed',
  failedTitle: 'Your payment didn’t go through',
  failedBody: 'No plan was added. If money left your account, message us with the time you paid and we’ll sort it out.',
  cancelledTitle: 'Payment not completed',
  cancelledBody: 'You left checkout before paying. No plan was added.',
  alreadyTitle: 'You’re already subscribed',
  duplicateBody: 'We received two payments for this plan. We’ll refund the extra one. You don’t need to do anything.',
  refundPendingTitle: 'Your refund is being processed',
  refundedTitle: 'Your payment was refunded',
  notFoundTitle: 'We couldn’t find that payment',
  notFoundBody: 'Check Plan & Access for your current plan.',
  mismatchTitle: 'Payment didn’t match the plan price',
  mismatchBody: 'We’ll refund the full amount. You can then pay for your plan again.',
  nowOpen: (count: number) => count > 0 ? `Now open in your ${count} ${count === 1 ? 'course' : 'courses'}` : 'Now open in your courses',
  setNow: 'Your Department, Level and Semester are now set until the semester ends.',
  startStudying: 'Start studying',
  viewReceipt: 'View receipt',
  tryAgain: 'Try again',
  messageUs: 'Message us',
  backToAccess: 'Back to Plan & Access',
  accessLink: 'Plan & Access',
  plan: 'Plan', amount: 'Amount', reference: 'Payment reference',
} as const

/** What a paid plan opens, in this order; each line only when one of the student's own courses has it. */
const UNLOCKED_FEATURES = [
  { has: 'notes', line: 'Notes by topic' },
  { has: 'cbtPractice', line: 'Practice with instant feedback' },
  { has: 'cbtPractice', line: 'Exam mode' },
  { has: 'theory', line: 'Theory questions with suggested answers' },
] as const
type StudyFlags = { notes: boolean; cbtPractice: boolean; theory: boolean }

/** The lines "You're subscribed" lists for the student's courses, or null while any course is still locked (its
 *  content unread), so nothing is listed that the student's courses may not have. */
export function unlockedFeatures(contents: ReadonlyArray<{ state: string; study?: StudyFlags }>): string[] | null {
  if (contents.some(content => content.state === 'locked' || content.state === 'temporarily-unavailable')) return null
  const studies = contents.flatMap(content => content.study === undefined ? [] : [content.study])
  return UNLOCKED_FEATURES.filter(feature => studies.some(study => study[feature.has])).map(feature => feature.line)
}

/** What the confirmed plan keeps open, in the student's own dates. */
export function subscribedBody(plan: { tier: PlanTier; period: PlanPeriod; ends_at: string | null;
  second_starts_at?: string | null }): string {
  const name = planName(plan.tier, plan.period)
  const until = plan.ends_at === null ? '' : ` until ${formatAccessLastDay(plan.ends_at)}`
  if (plan.period === 'session') {
    return `${name} keeps your First Semester courses open${until}. Second Semester opens when it resumes.`
  }
  return `${name} keeps your courses open${until}.`
}

/** A short payment reference students can quote (the full order id goes in support messages). */
export function paymentReference(orderId: string): string {
  return orderId.replaceAll('-', '').slice(0, 10).toUpperCase()
}

/** The support message with the reference filled in. */
export function paymentSupportMessage(orderId: string): string {
  return `Hello CampusIntell, I need help with my payment. Reference: ${paymentReference(orderId)} (${orderId}).`
}

/** A pass length in whole days (the database fixes it in hours). */
function passDays(hours: number): number {
  return Math.max(1, Math.round(hours / 24))
}

export const FREE_PASS_COPY = {
  heading: DISCOVERY_PASS_LABEL,
  // The offer reads the same everywhere it appears (My Courses, the course page, Plan & Access); what the pass includes
  // and its terms appear only in the modal.
  line: (hours: number) => `Try your department courses free for ${passDays(hours)} days.`,
  start: 'Get your free pass',
  modalTitle: 'Start your free pass',
  gives: ['A full timed exam from one of your courses', 'A complete study guide topic from one of your courses',
    'Campus Bot practice from your own notes'],
  terms: (hours: number) => [`It lasts ${passDays(hours)} days from now.`, 'Each student can have one free pass.',
    'Starting it sets your courses for this semester.'],
  confirm: 'Start my free pass',
  cancel: 'Not now',
  endsAt: (iso: string) => `Ends ${formatAccessDate(iso)}`,
} as const

export const USAGE_COPY = {
  heading: 'Campus Bot',
  session: 'This session',
  week: 'This week',
  sessionResets: (iso: string) => `Resets at ${formatAccessTime(iso)}`,
  weekResets: (iso: string) => `Resets ${formatAccessWeekday(iso)} at ${formatAccessTime(iso)}`,
  notStarted: 'Starts with your next set',
} as const

/** A Campus Bot window in words for its bar: used share (for the bar only) and a phrase, never a number. */
export function usageLevel(window: { limit: number; used: number; inFlight: number }):
  { key: 'plenty' | 'half' | 'low' | 'none'; words: string; usedPercent: number } {
  const used = window.limit <= 0 ? 1 : Math.min(1, Math.max(0, (window.used + window.inFlight) / window.limit))
  const usedPercent = Math.round(used * 100)
  if (used >= 1) return { key: 'none', words: 'Used up', usedPercent }
  if (used >= 0.75) return { key: 'low', words: 'A little left', usedPercent }
  if (used >= 0.4) return { key: 'half', words: 'About half left', usedPercent }
  return { key: 'plenty', words: 'Plenty left', usedPercent }
}

/** The Campus Bot limit states on the AI page. */
export const CAMPUS_BOT_LIMIT_COPY = {
  session: (iso: string | null) => `You’ve reached this session’s Campus Bot limit.${iso ? ` It resets at ${formatAccessTime(iso)}.` : ''}`,
  week: (iso: string | null) => `You’ve reached this week’s Campus Bot limit.${iso
    ? ` It resets ${formatAccessWeekday(iso)} at ${formatAccessTime(iso)}.` : ''}`,
  undelivered: 'Campus Bot couldn’t finish your last few sets. Try again tomorrow.',
} as const

/** The Payment terms page, word for word as the owner approved it (2026-11-05). Prices are the launch catalogue
 *  (20261102190000_payments.sql); a price change needs this table and the catalogue changed together.
 *  Each "message us" in a body line becomes the app's message-us link. */
export const TERMS_COPY = {
  title: 'Payment terms',
  table: {
    columns: ['Semester', 'Session (both semesters)'],
    rows: [{ plan: 'Standard', semesterKobo: 400000, sessionKobo: 700000 }, { plan: 'Plus', semesterKobo: 600000, sessionKobo: 1100000 }],
  },
  intro: 'Both plans include all your department courses for your level, with notes, practice questions and Campus Bot. ' +
    'Plus gives you twice as much Campus Bot. GST courses are always free.',
  sections: [
    { heading: 'Paying', body: 'Pay once by card or bank transfer. Your plan doesn’t renew on its own, so you’re only charged ' +
      'when you buy. Bachs handles payments for us, and we never see your card details.' },
    { heading: 'When your plan starts', body: 'Your plan starts as soon as your payment is confirmed. If it hasn’t started ' +
      '30 minutes after you’ve paid, message us with your payment reference.' },
    { heading: 'How long it lasts', body: 'A Semester plan lasts until the semester ends, and a Session plan until the ' +
      'session ends. With a Session plan, your First Semester courses stay open all session. You’ll find your end date on ' +
      'Plan & Access.' },
    { heading: 'Your courses', body: 'Your plan is for the department, level and semester you confirm before paying. To ' +
      'change them or add a carry-over course, message us.' },
    { heading: 'Campus Bot', body: 'Campus Bot has a 5-hour limit and a weekly limit. Your usage bar shows what’s left and ' +
      'when it resets.' },
    { heading: 'Your account', body: 'Your plan is just for you, and you can be signed in on one device at a time.' },
    { heading: 'Refunds', body: 'Changed your mind? You can get a full refund within 48 hours of paying, as long as you ' +
      'haven’t used Campus Bot or a large part of your plan. Just message us, and please don’t use your plan while we ' +
      'process it. Refunds go back to the card or account you paid with, and your plan ends once the refund is made.' },
    { heading: 'Wrong amount', body: 'Paid too much? Your plan starts and we refund the extra. Paid too little? It’s ' +
      'refunded in full.' },
    { heading: 'Changes', body: 'Prices may change for future plans. A plan you’ve already paid for keeps its price and end date.' },
  ],
} as const

// ---------------------------------------------------------------------------------------------------------------------
// The copy switch (docs/payments-design.md §6): one flag, plans_on_sale. While sales are closed, today's wording stays.
// ---------------------------------------------------------------------------------------------------------------------
export function accessCopy(onSale: boolean) {
  return onSale ? {
    lockedTitle: 'Included when you subscribe',
    lockedBody: 'Department courses open when you subscribe.',
    lockedAction: 'Subscribe',
    studyLocked: 'Included when you subscribe.',
    previewOthers: (code: string) => `The other topics in ${code} are included when you subscribe.`,
    answersLine: 'Answers and explanations are included when you subscribe.',
    aiNotEntitled: 'Campus Bot is included when you subscribe. GST courses stay free.',
    accessLede: 'GST courses are free for every student. Department courses open when you subscribe.',
    aiSection: 'Campus Bot practice from your own notes is included when you subscribe.',
  } as const : {
    lockedTitle: 'Included with full access',
    lockedBody: 'Department courses open fully with Early Access.',
    lockedAction: 'See how to unlock',
    studyLocked: 'Included with full access.',
    previewOthers: (code: string) => `The other topics in ${code} come with full access.`,
    answersLine: 'Answers and explanations are included with full access.',
    aiNotEntitled: 'Campus Bot opens with Early Access. GST courses stay free.',
    accessLede: 'GST courses are free for every student. Department courses open fully with Early Access.',
    aiSection: 'Campus Bot practice from your own notes comes with Early Access.',
  } as const
}

export const ACCESS_SOURCE_LABEL: Record<AccessSource, string> = {
  // A seven-day trial issued before the Discovery Pass replaced it.
  trial: 'Free trial',
  early_access: 'Early Access',
  manual: 'Full access',
  // Named by the plan itself where the summary carries it (paidPlanName).
  paid: 'Paid plan',
}


/** What the student's own trial is called: a Discovery Pass, or the seven-day trial they were issued earlier. */
export function trialLabel(summary: EntitlementSummary): string {
  return summary.trial.policy === 'seven-day' ? 'free trial' : DISCOVERY_PASS_NOUN
}

/**
 * What a surface may say about the student's trial, from their own grant rather than from what the database could
 * issue: `policy` names the grant they actually hold (a Discovery Pass, a seven-day trial issued before the pass, or
 * null when there is none or the plan could not be read), and `passAvailable` says whether a pass can still be
 * started from Plan & Access (the database offers one, this account has not had its trial, and the server's eligibility
 * read said yes). Nothing ever says why a pass is not available.
 */
export type TrialWording = { policy: TrialPolicy | null; passAvailable: boolean }

/** Neutral: no pass is advertised and the grant is called a trial, never a Discovery Pass. */
export const NEUTRAL_TRIAL_WORDING: TrialWording = Object.freeze({ policy: null, passAvailable: false })

export function trialWording(summary: EntitlementSummary | null | undefined): TrialWording {
  if (summary == null) return NEUTRAL_TRIAL_WORDING
  return { policy: summary.trial.policy, passAvailable: passOfferable(summary) }
}

function passOfferable(summary: EntitlementSummary): boolean {
  return discoveryOffered(summary) && summary.trial.status === 'available' && summary.discovery_eligible
}

/** The name of a trial grant in running copy ("your …"): accurate for the grant held, neutral when unknown. */
export function trialGrantName(policy: TrialPolicy | null): string {
  return policy === 'discovery' ? DISCOVERY_PASS_NOUN : policy === 'seven-day' ? 'free trial' : 'trial access'
}

/** The preview names a student sees, in the order the course page offers them. */
export const DISCOVERY_PREVIEW_LABEL: Record<DiscoveryKind, string> = {
  cbt: 'CBT exam',
  study_guide: 'study guide topic',
}

export type AccessNotice = { id: string; tone: 'info' | 'error'; title: string; body: string; action: string }

function msUntil(summary: EntitlementSummary, iso: string | null): number {
  return iso === null ? Number.NaN : Date.parse(iso) - Date.parse(summary.now)
}

/** The previews this pass has not used yet, by their student-facing names. */
export function unusedPreviews(summary: EntitlementSummary): DiscoveryKind[] {
  if (!discoveryOffered(summary)) return []
  const used = new Set(summary.discovery.previews.map(preview => preview.kind))
  return DISCOVERY_KINDS.filter(kind => !used.has(kind))
}

/** The single most useful access message for this student now, or null when there is nothing to say. */
export function accessNotice(summary: EntitlementSummary): AccessNotice | null {
  const { early_access: early, trial, access } = summary
  const noticeWindow = summary.expiry_notice_hours * HOUR_MS
  if (access !== null) {
    const left = msUntil(summary, access.ends_at)
    // A Session plan whose Second Semester is already set does not end with its first half (design §2.3 F).
    const continues = access.source === 'paid' && summary.paid !== null && summary.paid.second_ends_at !== null
    if (left > 0 && left <= noticeWindow && !continues) {
      const name = access.source === 'paid' && summary.paid !== null ? paidPlanName(summary.paid)
        : ACCESS_SOURCE_LABEL[access.source]
      return { id: 'access-ending', tone: 'info', title: access.source === 'paid' ? 'Your plan ends soon' : 'Your full access ends soon',
        body: `Your ${name} ends ${formatAccessDate(access.ends_at)}. ` +
          'Department courses lock after that. GST courses stay free.', action: 'View your plan' }
    }
  }
  if (early.status === 'awaiting-launch') {
    // No date is promised: the month starts when CampusIntell actually launches, never on the planned date.
    return { id: 'early-access-awaiting-launch', tone: 'info', title: 'You’re on the Early Access list',
      body: 'Your free month of full access starts automatically when CampusIntell launches publicly. ' +
        'There is nothing to claim, and a later launch never shortens your month.', action: 'View your plan' }
  }
  if (access !== null) return null
  if (trial.status === 'active' && trial.ends_at !== null) {
    const left = msUntil(summary, trial.ends_at)
    // A pass shows its end time only: no allowances or per-course limits.
    return { id: left <= noticeWindow ? 'discovery-ending' : 'discovery-active', tone: 'info',
      title: left <= noticeWindow ? `Your ${DISCOVERY_PASS_NOUN} ends soon` : `Your ${DISCOVERY_PASS_NOUN} is active`,
      body: `It ends ${formatAccessDate(trial.ends_at)}.`, action: 'View your plan' }
  }
  if (trial.status === 'ended') {
    const since = -msUntil(summary, trial.ends_at)
    if (since >= 0 && since <= ENDED_NOTICE_DAYS * DAY_MS) {
      return { id: 'trial-ended', tone: 'info', title: `Your ${trialLabel(summary)} has ended`,
        body: 'GST courses stay free, and your saved bookmarks and results are kept.', action: 'View your plan' }
    }
    return null
  }
  if (passOfferable(summary) && discoveryOffered(summary)) {
    return { id: 'trial-available', tone: 'info', title: FREE_PASS_COPY.heading,
      body: FREE_PASS_COPY.line(summary.trial_hours), action: FREE_PASS_COPY.start }
  }
  return null
}
