'use client'
import { useRef } from 'react'
import { useAuthSubmit } from '@/components/auth/useAuthSubmit'
import { Feedback } from '@/components/chrome/Feedback'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { AUTH_API, AUTH_PATHS } from '@/lib/auth/constants'

/** Neither mounting nor login is consent: restoration requires this explicit POST. */
export function DeletionDecision({ requestId, continuityToken }: { requestId: string; continuityToken: string }) {
  const rendered = useRef({ requestId, continuityToken }).current
  const { submit, pending, error } = useAuthSubmit()
  async function decide(keep: boolean) {
    const result = await submit(keep ? AUTH_API.cancelDeletion : AUTH_API.logout,
      keep ? { requestId: rendered.requestId } : {},
      failure => { if (failure.status === 'session-changed') window.location.reload() },
      { continuityToken: rendered.continuityToken })
    if (result) window.location.replace(result.next ?? AUTH_PATHS.login)
  }
  return <div className="mt-5 grid gap-3">
    {error && <Feedback tone="error" message={error} />}
    <button type="button" disabled={pending} aria-busy={pending} onClick={() => decide(true)} className={studentAction(btnNavy)}>Yes, keep my account</button>
    <button type="button" disabled={pending} aria-busy={pending} onClick={() => decide(false)} className={studentAction(btnGhost)}>No, continue with deletion</button>
  </div>
}
