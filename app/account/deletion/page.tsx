import { authUnavailableMessage, createAuthDiagnostic } from '@/lib/auth/unavailable'
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
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Account deletion | CampusIntell', robots: { index: false, follow: false } }

/** This is the only student page available to an authenticated scheduled account. */
export default async function AccountDeletionPage() {
  const diagnostic = createAuthDiagnostic('/account/deletion')
  if (!isStudentAuthEnabled()) return <StudentPage><Feedback message={AUTH_MESSAGES.comingSoon} /></StudentPage>
  let state
  try {
    const client = await createClient()
    const context = await getStudentSessionContext(undefined, client, { allowRestricted: true })
    state = context ? { lifecycle: await readAccountLifecycle(client),
      token: issueAccountContinuityToken(context.user.id, context.sessionId) } : null
  } catch (error) { return <StudentPage><Feedback tone="error" message={authUnavailableMessage('/account/deletion', error, diagnostic)} /></StudentPage> }
  if (!state || state.lifecycle.status === 'signed-out') redirect(AUTH_PATHS.login)
  if (state.lifecycle.status === 'active') redirect(AUTH_PATHS.account)
  const { lifecycle, token } = state
  // Lagos time, the timezone every student is in, written like every other date a student reads.
  const deadline = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(lifecycle.deadline))
  return <><AuthFlowSync signedIn continuityToken={token} />
    <StudentPage band={<PageBand title="Your account is set to be deleted" />}>
      <section className="student-surface mx-auto max-w-xl" aria-labelledby="deletion-decision-heading">
        {lifecycle.status === 'scheduled' ? <>
          <h2 id="deletion-decision-heading" className="student-section-title">Keep your account?</h2>
          <p className="mt-3 text-sm text-student-text-secondary">It will be deleted on <time dateTime={lifecycle.deadline}>{deadline}</time>.</p>
          <DeletionDecision requestId={lifecycle.requestId} continuityToken={token} />
        </> : <>
          <h2 id="deletion-decision-heading" className="student-section-title">This account can’t be restored</h2>
          <p className="my-4 text-sm text-student-text-secondary">The deadline to keep it has passed.</p>
          <LogoutButton continuityToken={token} />
        </>}
      </section>
    </StudentPage>
  </>
}
