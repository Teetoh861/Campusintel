// components/auth/StudentAccessGate.tsx — Server authorization for student learning surfaces.
import { redirect } from 'next/navigation'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { Feedback } from '@/components/chrome/Feedback'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { issueAccountContinuityToken } from '@/lib/auth/account-continuity'
import { AUTH_MESSAGES, AUTH_PATHS } from '@/lib/auth/constants'
import { getSafeReturnPath } from '@/lib/auth/redirect'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { PROFILE_SELECTION_PATH } from '@/lib/profile/paths'
import { AuthFlowSync } from './AuthFlowSync'
import type { ReactElement, ReactNode } from 'react'

/** Render children only for a live student with a completed selection; every failure is closed. */
export async function StudentAccessGate({ returnPath, children }: {
  returnPath: string
  children: ReactNode | ((continuityToken: string) => ReactNode)
}): Promise<ReactElement> {
  if (!isStudentAuthEnabled()) return <AuthUnavailable />
  const login = AUTH_PATHS.login + '?next=' + encodeURIComponent(getSafeReturnPath(returnPath))
  let continuityToken: string | undefined
  try {
    const context = await getStudentSessionContext()
    if (context !== null) continuityToken = issueAccountContinuityToken(context.user.id, context.sessionId)
  } catch { return <Feedback message={AUTH_MESSAGES.unavailable} tone="error" /> }
  if (!continuityToken) redirect(login)
  const profile = await getCurrentStudentProfile()
  if (profile.status === 'signed-out') redirect(login)
  if (profile.status === 'incomplete') redirect(PROFILE_SELECTION_PATH)
  if (profile.status !== 'complete') return <Feedback message={AUTH_MESSAGES.unavailable} tone="error" />
  return <><AuthFlowSync signedIn continuityToken={continuityToken} />
    {typeof children === 'function' ? children(continuityToken) : children}
  </>
}
