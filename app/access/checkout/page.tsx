// app/access/checkout/page.tsx — Confirm your courses: every Pay comes here first. The plan and its catalogue price, the
// student's study context and course list, then one form that posts to /api/payments/checkout. No amount ever comes
// from the browser; the server copies the price onto the order. A reason the checkout route sent back (?status=) is
// never rendered here: ConfirmAndPay reads it in the browser, shows it once and takes it out of the address.
import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentCoursesForVerifiedStudent } from '@/lib/courses/read-model'
import { CHECKOUT_PROBLEM, CONFIRM_COPY, FREE_MONTH_COPY, RETURN_COPY, formatAccessDay, formatAccessLastDay, formatFreeMonthDay,
  naira, paidPlanName, planName, planOf }
  from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { CHECKOUT_PATH } from '@/lib/payments/paths'
import { readCourseSelection, readProfileRevision } from '@/lib/profile/course-selection'
import { profileSelectionHref } from '@/lib/profile/paths'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { FreeMonthInstead } from '../FreeMonthOffer'
import { ConfirmAndPay } from './ConfirmAndPay'
import type { PlanKey } from '@/lib/entitlements/contract'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Confirm your courses | CampusIntell', robots: { index: false, follow: false } }

const PLANS: ReadonlySet<string> = new Set(['standard_semester', 'standard_session', 'plus_semester', 'plus_session'])
type Search = { plan?: string }

export default async function ConfirmCoursesPage({ searchParams }: { searchParams: Promise<Search> }): Promise<ReactElement> {
  const { plan } = await searchParams
  if (typeof plan !== 'string' || !PLANS.has(plan)) redirect(STUDENT_DESTINATIONS.access.href)
  const here = `${CHECKOUT_PATH}?plan=${plan}`
  return <StudentAccessGate returnPath={here}>
    {continuityToken => <ConfirmCourses plan={plan as PlanKey} continuityToken={continuityToken} here={here} />}
  </StudentAccessGate>
}

async function ConfirmCourses({ plan, continuityToken, here }: { plan: PlanKey; continuityToken: string; here: string }):
  Promise<ReactElement> {
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', here)
  const [read, current, profile, selection, revision] = await Promise.all([
    readEntitlementForVerifiedStudent(client, { discoveryEligibility: false, freeMonth: true }),
    getCurrentStudentCoursesForVerifiedStudent(client, context.user).catch(() => null),
    getCurrentStudentProfileForVerifiedStudent(client, context.user).catch(() => null),
    readCourseSelection(client), readProfileRevision(client, context.user.id)])
  if (read.status === 'signed-out') return redirectForStudentState('signed-out', here)
  const { tier, period } = planOf(plan)
  const back = <Link href={STUDENT_DESTINATIONS.access.href} prefetch={false}
    className={studentAction(btnGhost, 'bg-student-surface')}>{RETURN_COPY.backToAccess}</Link>
  const entitlement = read.status === 'ok' ? read.entitlement : null
  const onSale = entitlement?.plans.find(item => item.plan === plan) ?? null
  const band = (lede?: string) => <PageBand title={CONFIRM_COPY.title} lede={lede}
    context={onSale !== null ? <p>{planName(tier, period)} · {naira(onSale.price_kobo)}</p> : <p>{planName(tier, period)}</p>} />

  if (entitlement === null) return <StudentPage band={band()}>
    <Notice title="We couldn’t load your plan." action={<a href={here} className={studentAction(btnGhost)}>Try again</a>} />
  </StudentPage>
  // Only the server's paid summary decides this. A stale status=already-paid in the address shows checkout as normal.
  if (entitlement.paid !== null) return <StudentPage band={band()}>
    <Notice tone="info" title={RETURN_COPY.alreadyTitle} action={<Link href={STUDENT_DESTINATIONS.myCourses.href} prefetch={false}
      className={studentAction(btnNavy, studentFocusDark)}>Go to your courses</Link>}>
      {`${paidPlanName(entitlement.paid)} covers your courses${entitlement.paid.first_ends_at
        ? ` until ${formatAccessLastDay(entitlement.paid.first_ends_at)}` : ''}.`}
    </Notice>
  </StudentPage>
  if (onSale === null) return <StudentPage band={band()}>
    <Notice tone="info" title={entitlement.plans_on_sale ? CHECKOUT_PROBLEM['plan-unavailable']! : CHECKOUT_PROBLEM['sales-closed']!}
      action={back}>{entitlement.plans_on_sale ? null : 'GST courses stay free.'}</Notice>
  </StudentPage>

  const term = entitlement.term
  const termName = term === null ? 'this semester' : `${term.period_name} ${term.session_label}`
  const lede = period === 'session'
    ? `Your plan covers these courses for ${termName}, and your Second Semester courses once it resumes.`
    : `Your plan covers these courses for ${termName}.`
  const courses = current?.status === 'ok' ? current.courses : null
  const ready = selection !== null && (selection.state === 'open' || selection.state === 'locked')
  const studyContext = profile?.status === 'complete'
    ? `${profile.selection.department.label} · ${profile.selection.academicLevel.label} · ${profile.selection.academicPeriod.label}`
    : null
  // No line at the top here: there is no course list yet for it to describe.
  if (!ready || courses === null || revision === null || studyContext === null) return <StudentPage band={band()}>
    <Notice tone="info" title={CONFIRM_COPY.needsSelection} action={<>
      <Link href={profileSelectionHref(here)} prefetch={false} className={studentAction(btnNavy, studentFocusDark)}>
        {CONFIRM_COPY.confirmCourses}</Link>{back}</>}>
      Your plan covers the courses for your department, level and semester.
    </Notice>
  </StudentPage>
  // A free month already running, by the day the database says it ends.
  const early = entitlement.access?.source === 'early_access' ? entitlement.access.ends_at : null
  // A free month this student could claim instead of paying, only when the database says so now.
  const freeMonth = entitlement.free_month === null ? null
    : { continuityToken, profileRevision: revision, endsOn: formatFreeMonthDay(entitlement.free_month.endsAt) }
  return <StudentPage band={band(lede)}>
    <div className="mx-auto grid w-full max-w-[680px] gap-6">
      <ConfirmAndPay plan={plan} priceKobo={onSale.price_kobo} expectedRevision={revision}
        requestId={randomUUID()} continuityToken={continuityToken}>
        <div className="student-surface flex items-center justify-between gap-3 bg-student-brand-surface py-2">
          <p className="min-w-0 font-semibold text-student-text-primary">{studyContext}</p>
          {selection.state === 'open' && <Link href={profileSelectionHref(here)} prefetch={false}
            className={studentAction(btnGhost, 'bg-student-surface')}>{CONFIRM_COPY.change}</Link>}
        </div>
        <section aria-labelledby="courses-heading">
          <h2 id="courses-heading" className="student-section-title">{CONFIRM_COPY.coursesHeading(courses.length)}</h2>
          <ul className="mt-3 overflow-hidden rounded-lg border border-student-border bg-student-surface">
            {courses.map(course => <li key={course.institutionalCourseId}
              className="flex min-h-[60px] items-center justify-between gap-3 border-b border-student-border px-4 py-3 last:border-b-0">
              <span className="min-w-0">
                <span className="block font-semibold text-student-text-primary">{course.title}</span>
                <span className="block text-sm text-student-text-secondary">{course.code}</span>
              </span>
              {course.isFree && <span className="shrink-0 text-sm font-semibold text-student-text-secondary">{CONFIRM_COPY.free}</span>}
            </li>)}
          </ul>
        </section>
        <Notice tone="info" title={CONFIRM_COPY.setAfterPaying}>
          {early !== null ? `${FREE_MONTH_COPY.continues(formatAccessDay(early))} Your plan then keeps your ` +
            `courses open${term === null ? '' : ` until ${formatAccessLastDay(term.ends_at)}`}.` : null}
        </Notice>
        {/* The last thing above Pay. Paying stays possible. */}
        {freeMonth !== null && <FreeMonthInstead {...freeMonth} />}
      </ConfirmAndPay>
    </div>
  </StudentPage>
}
