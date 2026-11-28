// app/access/page.tsx — The student's plan: what they have now (free GST, a free pass, a free month or a paid plan), the
// plans on offer (the free month first while the student can claim it, then the two paid plans while sales are open),
// Campus Bot use, and receipts. Every price comes from the catalogue; nothing here says paid unless our own order does.
// Every date shown is the database's, and whether an offer shows is the database's answer for this student.
import Link from 'next/link'
import { CalendarCheck, Lock, ReceiptText, Ticket } from 'lucide-react'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction, studentFocusRow } from '@/components/student/ui'
import { readCampusBotUsage } from '@/lib/ai-practice/campus-bot-usage'
import { readAllowance } from '@/lib/ai-practice/supabase-env'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/courses/read-model'
import { discoveryOffered } from '@/lib/entitlements/contract'
import { ACCESS_SOURCE_LABEL, DISCOVERY_PASS_LABEL, FREE_MONTH_COPY, FREE_PASS_COPY, PLAN_COPY, RECEIPT_STATUS_LINE,
  accessCopy, formatAccessDay, formatAccessLastDay, formatFreeMonthDay, freeMonthClaim, naira, paidPlanName, paymentReference, planName,
  planOf, trialWording } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { PAYMENT_TERMS_PATH, RECEIPTS_PATH } from '@/lib/payments/paths'
import { readProfileRevision } from '@/lib/profile/course-selection'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { buildWhatsAppUrl, COURSE_CHANGE_MESSAGE } from '@/lib/whatsapp'
import { FreeMonthPlanCard } from './FreeMonthOffer'
import { FreePassStart } from './FreePassStart'
import { PlanChooser } from './PlanChooser'
import { PassOfferScope, WhileOffered } from './TrialActivation'
import { UsageBars } from './UsageBars'
import type { AllowanceSummary } from '@/lib/ai-practice/upload-contract'
import type { EntitlementSummary, PaidPlan, Receipt } from '@/lib/entitlements/contract'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Plan & Access | CampusIntell', robots: { index: false, follow: false } }

const PATH = STUDENT_DESTINATIONS.access.href
const LINK = 'inline-flex min-h-11 items-center font-semibold text-student-primary underline underline-offset-2'
// How long after paying the refund rule is shown beside the plan (the rule itself is on Payment terms).
const REFUND_WINDOW_MS = 48 * 60 * 60 * 1000

export default async function AccessPage(): Promise<ReactElement> {
  return <StudentAccessGate returnPath={PATH}>
    {continuityToken => <Access continuityToken={continuityToken} />}
  </StudentAccessGate>
}

async function Access({ continuityToken }: { continuityToken: string }): Promise<ReactElement> {
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', PATH)
  const [read, allowance, profileRevision, usage, current] = await Promise.all([
    readEntitlementForVerifiedStudent(client, { freeMonth: true }), readAllowance(client).catch(() => null),
    readProfileRevision(client, context.user.id), readCampusBotUsage(client).catch(() => null),
    getCurrentStudentCoursesForVerifiedStudent(client, context.user).catch(() => null)])
  if (read.status === 'signed-out') return redirectForStudentState('signed-out', PATH)
  const onSale = read.status === 'ok' && read.entitlement.plans_on_sale
  // GST courses are named once, in Your plan, where they are the student's own.
  const band = <PageBand title="Plan & Access" aside={<Link
    href={STUDENT_DESTINATIONS.account.href} prefetch={false} className={studentAction(btnGhost)}>
    {STUDENT_DESTINATIONS.account.label}</Link>} />
  if (read.status !== 'ok') return <StudentPage band={band}>
    <Notice title="We couldn’t load your plan." action={<a href={PATH} className={studentAction(btnGhost)}>Try again</a>} />
  </StudentPage>
  const entitlement = read.entitlement
  const courses = current?.status === 'ok' ? current.courses : null
  const lockedCount = courses === null ? null : courses.filter(course => !course.isFree).length
  const showPlans = onSale && entitlement.paid === null && entitlement.plans.length > 0
  // The free month, only when the database says this student can claim it now. Without the revision the month could
  // set courses the student did not see (D7), so nothing is offered.
  const freeMonth = freeMonthClaim(entitlement, continuityToken, profileRevision)
  // The database offers no pass while the month can be claimed; the page never shows the two together either.
  const passOffered = entitlement.free_month === null && trialWording(entitlement).passAvailable && discoveryOffered(entitlement)
  return <StudentPage band={band}><PassOfferScope>
    <div className="grid min-w-0 gap-6 desktop:grid-cols-12">
      <section aria-labelledby="access-heading"
        className={'min-w-0 ' + (entitlement.paid ? 'desktop:col-span-7' : 'desktop:col-span-4')}>
        <h2 id="access-heading" className="student-section-title">Your plan</h2>
        <div className="mt-3">{yourPlanCard(entitlement, lockedCount, onSale)}</div>
      </section>
      {(showPlans || freeMonth !== null) && <section aria-labelledby="plans-heading" className="min-w-0 desktop:col-span-8">
        <h2 id="plans-heading" className="student-section-title">{PLAN_COPY.heading}</h2>
        {/* The free month is the first plan card; the Semester | Session switch sits with the paid plans it changes. */}
        <div className="mt-3"><PlanChooser plans={showPlans ? entitlement.plans : []}
          first={freeMonth !== null ? <FreeMonthPlanCard {...freeMonth} /> : undefined} /></div>
        {showPlans && <div className="mt-4 grid gap-1.5 text-sm text-student-text-secondary">
          <p>{PLAN_COPY.payment}</p>
          <p>{PLAN_COPY.refund} <Link href={PAYMENT_TERMS_PATH} prefetch={false} className={LINK}>{PLAN_COPY.termsLink}</Link></p>
        </div>}
      </section>}
      {entitlement.receipts.length > 0 && <Receipts receipts={entitlement.receipts} />}
      {usage?.state === 'tokens' && <section aria-labelledby="usage-heading" className="min-w-0 desktop:col-span-5">
        <UsageBars usage={usage} />
      </section>}
      {passOffered && <section aria-label={FREE_PASS_COPY.heading} className="student-surface min-w-0 desktop:col-span-5">
        {/* A refusal withdraws the offer text; the refusal's own message stays below. */}
        <WhileOffered><h2 id="pass-heading" className="student-section-title">{FREE_PASS_COPY.heading}</h2>
          <p className="mt-2 text-sm text-student-text-secondary">{FREE_PASS_COPY.line(entitlement.trial_hours)}</p></WhileOffered>
        <div className="mt-3">{profileRevision === null
          // Without the revision the pass could set courses the student did not see (D7): nothing is started unbound.
          ? <p className="text-sm text-student-text-secondary" role="status">We couldn’t load your courses. Reload the page.</p>
          : <FreePassStart continuityToken={continuityToken} passHours={entitlement.trial_hours}
            profileRevision={profileRevision} />}</div>
      </section>}
      {/* A paid plan's Campus Bot use is the bars above; if they cannot be read, nothing is shown in their place. */}
      {usage?.state !== 'tokens' && entitlement.paid === null && <AiSection allowance={allowance} onSale={onSale} />}
    </div>
  </PassOfferScope></StudentPage>
}

/** The student's plan now: one card (paid, free month, other full access, free pass, free). */
function yourPlanCard(entitlement: EntitlementSummary, lockedCount: number | null, onSale: boolean): ReactElement {
  const { access, trial, paid, early_access: early } = entitlement
  if (paid !== null) return <Subscribed paid={paid} now={entitlement.now} />
  // Free access and the last day it covers, from the end the database holds.
  if (access !== null && access.source === 'early_access') return <div className="student-surface" data-access="free-month">
    <div className="flex items-start gap-3">
      <CalendarCheck aria-hidden="true" size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-student-primary" />
      <h3 className="min-w-0 font-bold text-student-text-primary">{FREE_MONTH_COPY.active(formatFreeMonthDay(access.ends_at))}</h3>
    </div>
  </div>
  if (access !== null) return <div className="student-surface" data-access={access.source}>
    <h3 className="font-bold text-student-text-primary">{ACCESS_SOURCE_LABEL[access.source]}</h3>
    <p className="mt-1 text-sm text-student-text-secondary">Full access to your courses until {formatAccessDay(access.ends_at)}.</p>
  </div>
  if (trial.status === 'active' && trial.policy === 'discovery' && trial.ends_at !== null) {
    return <div className="student-surface" data-access="free-pass">
      <div className="flex items-start gap-3">
        <Ticket aria-hidden="true" size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-student-primary" />
        <div className="min-w-0">
          <h3 className="font-bold text-student-text-primary">{DISCOVERY_PASS_LABEL}</h3>
          <p className="mt-1 text-sm text-student-text-secondary">{FREE_PASS_COPY.endsAt(trial.ends_at)}</p>
        </div>
      </div>
    </div>
  }
  const refund = entitlement.receipts.find(receipt => receipt.status === 'refund-pending' || receipt.status === 'refunded')
  const ended = trial.status === 'ended' && trial.policy === 'seven-day'
  return <div className="student-surface" data-access="free">
    {ended && <p className="mb-2 text-sm text-student-text-secondary">Your free trial has ended.</p>}
    {early.status === 'ended' && <p className="mb-2 text-sm text-student-text-secondary" data-free-month="ended">
      {FREE_MONTH_COPY.ended}</p>}
    <h3 className="font-bold text-student-text-primary">Free GST courses</h3>
    {refund && <p className="mt-2 text-sm text-student-text-secondary" data-refund={refund.status}>
      {refund.status === 'refund-pending' ? `Your refund of ${naira(refund.amount_kobo)} is being processed. Your plan has ended.`
        : 'Your payment was refunded. Your plan has ended.'}</p>}
    {lockedCount !== null && lockedCount > 0 && <p className="mt-3 flex items-start gap-2 border-t border-student-border pt-3
      text-sm font-semibold text-student-text-primary">
      <Lock aria-hidden="true" size={20} strokeWidth={1.75} className="shrink-0" />
      <span>Your other {lockedCount} {lockedCount === 1 ? 'course' : 'courses'}: {accessCopy(onSale).studyLocked.replace(/\.$/, '')}</span>
    </p>}
  </div>
}

/** The plan as the student's academic file: each semester it covers, with its dates. */
function Subscribed({ paid, now }: { paid: PaidPlan; /** The database's clock at this read. */ now: string }): ReactElement {
  const first = paid.first_ends_at === null ? 'Dates to follow' : `Until ${formatAccessLastDay(paid.first_ends_at)}`
  // The refund rule matters for the 48 hours it applies; after that the terms link alone.
  const refundable = Date.parse(now) - Date.parse(paid.paid_at) < REFUND_WINDOW_MS
  const second = paid.second_ends_at !== null && paid.second_starts_at !== null
    ? `${formatAccessDay(paid.second_starts_at)} to ${formatAccessLastDay(paid.second_ends_at)}` : 'Opens when it resumes'
  return <div className="grid gap-4">
    <div className="student-surface student-surface-raised" data-access="paid">
      <p className="text-xs font-bold uppercase tracking-[0.08em] text-student-text-secondary">
        Subscribed · {paid.term_session_label}</p>
      <h3 className="mt-1 text-xl font-bold text-student-text-primary">{paidPlanName(paid)}</h3>
      <dl className="mt-3 grid border-t border-student-border text-sm">
        <div className="flex justify-between gap-3 border-b border-student-border py-3 last:border-b-0">
          <dt className="text-student-text-secondary">{paid.period === 'session' ? 'First Semester' : paid.period_name ?? 'This semester'}</dt>
          <dd className="text-right font-semibold text-student-text-primary">{first}</dd>
        </div>
        {paid.period === 'session' && <div className="flex justify-between gap-3 py-3">
          <dt className="text-student-text-secondary">Second Semester</dt>
          <dd className="text-right font-semibold text-student-text-primary">{second}</dd>
        </div>}
      </dl>
    </div>
    <Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
      className={LINK}>View your courses</Link>
    <p className="text-sm text-student-text-secondary">Need to change your courses?{' '}
      <a href={buildWhatsAppUrl(COURSE_CHANGE_MESSAGE)} target="_blank" rel="noopener noreferrer"
        className={LINK}>Message us</a>.</p>
    <p className="text-sm text-student-text-secondary">{refundable && <>{PLAN_COPY.refund} </>}<Link href={PAYMENT_TERMS_PATH}
      prefetch={false} className={LINK}>{PLAN_COPY.termsLink}</Link></p>
  </div>
}

function Receipts({ receipts }: { receipts: Receipt[] }): ReactElement {
  return <section aria-labelledby="receipts-heading" className="min-w-0 desktop:col-span-5">
    <h2 id="receipts-heading" className="student-section-title">Receipts</h2>
    <ul className="mt-3 overflow-hidden rounded-lg border border-student-border bg-student-surface">
      {receipts.map(receipt => {
        const { tier, period } = planOf(receipt.plan)
        const status = RECEIPT_STATUS_LINE[receipt.status]
        return <li key={receipt.order_id} className="border-b border-student-border last:border-b-0">
          <Link href={`${RECEIPTS_PATH}/${receipt.order_id}`} prefetch={false}
            className={'flex min-h-16 items-center gap-3 px-4 py-3 ' + studentFocusRow}>
            <ReceiptText aria-hidden="true" size={20} strokeWidth={1.75} className="shrink-0 text-student-primary" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-student-text-primary">{planName(tier, period)} · {naira(receipt.amount_kobo)}</span>
              <span className="block text-sm text-student-text-secondary">{formatAccessDay(receipt.paid_at)} · Ref {
                paymentReference(receipt.order_id)}{status !== null && <> · {status}</>}</span>
            </span>
          </Link>
        </li>
      })}
    </ul>
  </section>
}

/** Counted AI sets (a free pass or an older trial); token-funded plans show Campus Bot use instead. */
function AiSection({ allowance, onSale }: { allowance: AllowanceSummary | null; onSale: boolean }): ReactElement {
  const line = allowance === null || allowance.state === 'not-entitled' ? accessCopy(onSale).aiSection
    : allowance.state === 'expired' ? 'Your Campus Bot access has ended.'
      : allowance.total === null ? 'Practise from your notes is included.'
        : `${Math.max(0, allowance.total - allowance.used)} of ${allowance.total} Campus Bot ` +
          `${allowance.total === 1 ? 'set' : 'sets'} left.`
  return <section aria-labelledby="ai-heading" className="student-surface min-w-0 desktop:col-span-5">
    <h2 id="ai-heading" className="student-section-title">Campus Bot</h2>
    <p className="mt-2 text-sm text-student-text-secondary">{line}</p>
  </section>
}
