// app/access/page.tsx — The student's plan: free GST access, the 7-day trial, Early Access and the AI allowance.
import Link from 'next/link'
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { btnGhost } from '@/components/chrome/ui'
import { Notice } from '@/components/student/Notice'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { redirectForStudentState } from '@/components/student/result-state'
import { studentAction } from '@/components/student/ui'
import { readAllowance } from '@/lib/ai-practice/supabase-env'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { ACCESS_SOURCE_LABEL, formatAccessDate } from '@/lib/entitlements/presentation'
import { readEntitlementForVerifiedStudent } from '@/lib/entitlements/server'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { createClient } from '@/lib/supabase/server'
import { TrialActivation } from './TrialActivation'
import type { AllowanceSummary } from '@/lib/ai-practice/upload-contract'
import type { EntitlementSummary } from '@/lib/entitlements/contract'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Plan & Access | CampusIntell', robots: { index: false, follow: false } }

const PATH = STUDENT_DESTINATIONS.access.href
const LEDE = 'GST courses are free for every student. Department courses and AI practice open with a trial or Early Access.'

export default async function AccessPage(): Promise<ReactElement> {
  return <StudentAccessGate returnPath={PATH}>
    {continuityToken => <Access continuityToken={continuityToken} />}
  </StudentAccessGate>
}

async function Access({ continuityToken }: { continuityToken: string }): Promise<ReactElement> {
  const client = await createClient()
  const context = await getStudentSessionContext(undefined, client)
  if (context === null) return redirectForStudentState('signed-out', PATH)
  const [read, allowance] = await Promise.all([readEntitlementForVerifiedStudent(client),
    readAllowance(client).catch(() => null)])
  if (read.status === 'signed-out') return redirectForStudentState('signed-out', PATH)
  const band = <PageBand title="Plan & Access" lede={LEDE} aside={<Link href={STUDENT_DESTINATIONS.account.href}
    prefetch={false} className={studentAction(btnGhost)}>{STUDENT_DESTINATIONS.account.label}</Link>} />
  if (read.status !== 'ok') return <StudentPage band={band}>
    <Notice title="Your plan couldn’t be loaded" action={<a href={PATH} className={studentAction(btnGhost)}>Try again</a>}>
      GST courses stay available. Please try again in a few minutes.
    </Notice>
  </StudentPage>
  const entitlement = read.entitlement
  return <StudentPage band={band}>
    <div className="grid min-w-0 gap-4 tablet:grid-cols-[minmax(0,1.4fr)_minmax(240px,1fr)] desktop:gap-6">
      <div className="grid min-w-0 content-start gap-4">
        <CurrentPlan entitlement={entitlement} />
        <TrialSection entitlement={entitlement} continuityToken={continuityToken} />
      </div>
      <div className="grid min-w-0 content-start gap-4">
        <EarlyAccessSection entitlement={entitlement} />
        <AiSection allowance={allowance} />
      </div>
    </div>
  </StudentPage>
}

function CurrentPlan({ entitlement }: { entitlement: EntitlementSummary }): ReactElement {
  const { access } = entitlement
  return <section aria-labelledby="plan-heading" className="student-surface student-surface-raised" data-plan={entitlement.tier}>
    <h2 id="plan-heading" className="student-section-title">Your plan</h2>
    {access === null
      ? <p className="mt-2 text-student-text-primary"><b>Free</b> · GST courses, always included.</p>
      : <p className="mt-2 text-student-text-primary"><b>{ACCESS_SOURCE_LABEL[access.source]}</b> · every course until {formatAccessDate(access.ends_at)}.</p>}
    <p className="mt-2 text-sm text-student-text-secondary">
      When full access ends your account returns to the free plan automatically. Nothing is deleted, and GST courses stay open.
    </p>
  </section>
}

function TrialSection({ entitlement, continuityToken }: { entitlement: EntitlementSummary; continuityToken: string }):
  ReactElement {
  const { trial, otp } = entitlement
  const body: Record<EntitlementSummary['trial']['status'], ReactElement> = {
    'available': <div className="mt-3"><TrialActivation continuityToken={continuityToken} trialDays={entitlement.trial_days}
      initialChallenge={otp === null ? null : { challengeId: otp.challenge_id, phoneHint: otp.phone_hint,
        resendAt: otp.resend_at }} /></div>,
    'active': <p className="mt-2 text-sm text-student-text-secondary">Your trial is active until
      {trial.ends_at !== null && <> {formatAccessDate(trial.ends_at)}</>}. Every department course stays open for the whole
      trial, even after the AI allowance is used.</p>,
    'ended': <p className="mt-2 text-sm text-student-text-secondary">You have used your free trial
      {trial.ends_at !== null && <> (ended {formatAccessDate(trial.ends_at)})</>}. Each account and phone number can start one
      trial.</p>,
    'after-early-access': <p className="mt-2 text-sm text-student-text-secondary">You already have full access through Early
      Access, so your trial is kept for later. It becomes available
      {trial.available_from !== null && <> on {formatAccessDate(trial.available_from)}</>}, when Early Access ends.</p>,
    'not-offered': <p className="mt-2 text-sm text-student-text-secondary">The free trial is not offered to accounts that have
      had Early Access.</p>,
  }
  return <section aria-labelledby="trial-heading" className="student-surface">
    <h2 id="trial-heading" className="student-section-title">{entitlement.trial_days}-day free trial</h2>
    {body[trial.status]}
  </section>
}

function EarlyAccessSection({ entitlement }: { entitlement: EntitlementSummary }): ReactElement | null {
  const early = entitlement.early_access
  if (early.status === 'not-listed') return null
  const text: Record<Exclude<typeof early.status, 'not-listed'>, ReactElement> = {
    // Never a date: the month starts at the actual public launch, not the planned one.
    'awaiting-launch': <>You’re on the Early Access list. Your free month of full access, with AI practice included, starts
      automatically when CampusIntell launches publicly. There is nothing to claim and no phone check.</>,
    'pending': <>You’re on the Early Access list. Your free month is being set up; refresh this page in a moment.</>,
    'active': <>Active
      {early.ends_at !== null && <> until {formatAccessDate(early.ends_at)}</>}. Every course and AI practice are included.</>,
    'ended': <>Your Early Access month has ended.</>,
    'enrollment-closed': <>Early Access enrollment closed
      {early.enrollment_closes_at !== null && <> on {formatAccessDate(early.enrollment_closes_at)}</>}.</>,
    'unavailable': <>This Early Access place can’t be used by this account. If you think this is a mistake, <Link
      href={STUDENT_DESTINATIONS.contact.href} prefetch={false} className="underline underline-offset-2">contact support</Link>.</>,
    'account-restricted': <>Early Access is not available while this account is scheduled for deletion.</>,
  }
  return <section aria-labelledby="early-access-heading" className="student-surface bg-student-brand-surface">
    <h2 id="early-access-heading" className="student-section-title">Early Access</h2>
    <p className="mt-2 text-sm text-student-text-secondary">{text[early.status]}</p>
  </section>
}

function AiSection({ allowance }: { allowance: AllowanceSummary | null }): ReactElement {
  const line = allowance === null || allowance.state === 'not-entitled'
    ? 'AI practice from your own notes is included with the trial and Early Access.'
    : allowance.state === 'expired' ? 'Your AI practice access has ended.'
      : allowance.total === null ? 'Your AI practice has no set limit during Early Access. Fair-use limits apply.'
        : `${Math.max(0, allowance.total - allowance.used)} of ${allowance.total} AI question sets left. ` +
          'They are shared across the whole trial, not renewed daily. Course access is unaffected when they run out.'
  return <section aria-labelledby="ai-heading" className="student-surface">
    <h2 id="ai-heading" className="student-section-title">AI practice</h2>
    <p className="mt-2 text-sm text-student-text-secondary">{line}</p>
  </section>
}
