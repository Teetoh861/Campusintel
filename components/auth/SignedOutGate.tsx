// components/auth/SignedOutGate.tsx — Server authorization for student identity-entry pages.
import { redirect } from 'next/navigation'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { hasStudentSession } from '@/lib/auth/student-state'
import { AUTH_MESSAGES, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { Feedback } from '@/components/chrome/Feedback'
import { AuthFlowSync } from './AuthFlowSync'
import type { ReactNode } from 'react'

/** Keep disabled browsing intact and never render an entry flow over an existing identity. */
export async function SignedOutGate({ children }: { children: ReactNode }) {
  if (!isStudentAuthEnabled()) return children
  let signedIn: boolean
  try { signedIn = await hasStudentSession() }
  catch { return <Feedback message={AUTH_MESSAGES.unavailable} tone="error" /> }
  if (signedIn) redirect(STUDENT_HOME_PATH)
  return <><AuthFlowSync />{children}</>
}
