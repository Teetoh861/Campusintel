import { redirect } from 'next/navigation'
import { StudentPage } from '@/components/student/StudentPage'
import { PageBand } from '@/components/student/PageBand'
import { Feedback } from '@/components/chrome/Feedback'
import { AuthFlowSync } from '@/components/auth/AuthFlowSync'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { DeletionDecision } from '@/components/account/DeletionDecision'
import { AUTH_MESSAGES, AUTH_PATHS } from '@/lib/auth/constants'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { readAccountLifecycle } from '@/lib/account/lifecycle'
import { ACCOUNT_MESSAGES } from '@/lib/account/constants'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account deletion | CampusIntell', robots: { index: false, follow: false } }

/** This is the only student page available to an authenticated scheduled account. */
export default async function AccountDeletionPage() {
  if (!isStudentAuthEnabled()) return <StudentPage><Feedback message={AUTH_MESSAGES.comingSoon} /></StudentPage>
  let state
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client, { allowRestricted: true })
    state = context ? { lifecycle: await readAccountLifecycle(client),
      token: issueAccountContinuityToken(context.user.id, context.sessionId) } : null
  } catch { return <StudentPage><Feedback tone="error" message={AUTH_MESSAGES.unavailable} /></StudentPage> }
  if (!state || state.lifecycle.status === 'signed-out') redirect(AUTH_PATHS.login)
  if (state.lifecycle.status === 'active') redirect(AUTH_PATHS.account)
  const { lifecycle, token } = state
  const deadline = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(lifecycle.deadline)) + ' UTC'
  return <><AuthFlowSync signedIn continuityToken={token} />
    <StudentPage band={<PageBand title="Account deletion" lede="Your account has a pending deletion request." />}>
      <section className="student-surface mx-auto max-w-xl" aria-labelledby="deletion-decision-heading">
        {lifecycle.status === 'scheduled' ? <>
          <h2 id="deletion-decision-heading" className="student-section-title">Would you like to keep your account?</h2>
          <p className="mt-3 text-sm text-student-text-secondary">Your deadline is <time dateTime={lifecycle.deadline}>{deadline}</time>. Signing in has not cancelled deletion. Choose below to continue.</p>
          <DeletionDecision requestId={lifecycle.requestId} continuityToken={token} />
        </> : <>
          <h2 id="deletion-decision-heading" className="student-section-title">Recovery is no longer available</h2>
          <p className="my-4 text-sm text-student-text-secondary">{ACCOUNT_MESSAGES.expired}</p>
          <LogoutButton continuityToken={token} />
        </>}
      </section>
    </StudentPage>
  </>
}
