// Same-origin forms keep server authority, bounded waits and cross-document cookie ordering.
'use client'
import { notifyStudentChange } from '@/lib/auth/client-events'
import { isStudentAuthTransition, runAuthTransition } from '@/lib/auth/client-transition'
import { AuthClientFailure, authMessageReference, fetchAuthReply } from '@/lib/auth/client-request'
import { useRef, useState } from 'react'
import { safeAuthMessage } from '@/lib/auth/errors'
import { parseAuthOutcome } from '@/lib/auth/outcomes'
import { AUTH_API, AUTH_CONTINUITY_HEADER, AUTH_MESSAGES, RECOVERY_FAILURE, EMAIL_CONFIRMATION_REQUIRED, EXISTING_STUDENT_SESSION, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { ACCOUNT_DELETION_PATH } from '@/lib/account/constants'

export type AuthSubmitFailure = { message: string; code?: (typeof RECOVERY_FAILURE)[keyof typeof RECOVERY_FAILURE]; status?: 'session-changed' }
type Endpoint = (typeof AUTH_API)[keyof typeof AUTH_API]
type Result = { success?: true; verified?: true; code?: typeof EMAIL_CONFIRMATION_REQUIRED; next?: string; message?: string }

/** A lost reply is not permission to replay an OTP or password. Check only the live session, under the same lock. */
async function reconcileTimeout(endpoint: Endpoint): Promise<Result | null> {
  if (endpoint !== AUTH_API.confirm && endpoint !== AUTH_API.reset) return null
  try {
    const { response, value } = await fetchAuthReply(AUTH_API.session,
      { method: 'GET', credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok || !value || typeof value !== 'object' || !('enabled' in value) || value.enabled !== true ||
        !('signedIn' in value) || typeof value.signedIn !== 'boolean') return null
    // Signed-out does not prove a password changed. A reset always needs a recorded result or a fresh recovery flow.
    if (endpoint === AUTH_API.confirm && value.signedIn) return { next: STUDENT_HOME_PATH }
  } catch { /* The outcome remains unknown; never replay the original mutation. */ }
  return null
}

/** Prevent concurrent submits; the lock includes response validation, reconciliation and notification. */
export function useAuthSubmit() {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(endpoint: Endpoint, body: object,
    onFailure?: (failure: AuthSubmitFailure) => void, options: { continuityToken?: string } = {},
  ): Promise<Result | null> {
    if (lock.current) return null
    lock.current = true
    setPending(true)
    setError('')
    let reference: unknown
    try {
      if (!/^\/api\/auth\/[a-z-]+$/.test(endpoint)) throw new Error('Invalid auth endpoint')
      return await runAuthTransition(endpoint, async () => {
        let reply: Awaited<ReturnType<typeof fetchAuthReply>>
        try {
          reply = await fetchAuthReply(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json',
              ...(options.continuityToken ? { [AUTH_CONTINUITY_HEADER]: options.continuityToken } : {}) }, body: JSON.stringify(body) })
        } catch (failure) {
          const timedOut = failure instanceof AuthClientFailure && failure.kind === 'timeout'
          if (timedOut) {
            const recovered = await reconcileTimeout(endpoint)
            if (recovered) { notifyStudentChange(); return recovered }
          }
          const message = authMessageReference(failure instanceof AuthClientFailure && failure.kind === 'connection'
            ? AUTH_MESSAGES.connection : AUTH_MESSAGES.unavailable, failure instanceof AuthClientFailure ? failure.reference : undefined)
          setError(message)
          if (timedOut && (endpoint === AUTH_API.reset || endpoint === AUTH_API.verifyRecovery)) {
            onFailure?.({ message, code: RECOVERY_FAILURE.restart })
          }
          return null
        }
        const { response, value } = reply
        reference = value && typeof value === 'object' && 'reference' in value
          ? value.reference : response.headers?.get('X-CampusIntell-Auth-Reference')
        if (!value || typeof value !== 'object') throw new Error('Invalid response')
        if (!response.ok) {
          if (response.status === 409 && 'status' in value && value.status === 'session-changed') {
            setError(AUTH_MESSAGES.sessionChanged)
            onFailure?.({ message: AUTH_MESSAGES.sessionChanged, status: 'session-changed' })
            return null
          }
          if (response.status === 409 && 'code' in value && value.code === EXISTING_STUDENT_SESSION && 'next' in value &&
            (value.next === STUDENT_HOME_PATH || value.next === ACCOUNT_DELETION_PATH)) {
            window.location.replace(value.next)
            return null
          }
          const timedOut = 'status' in value && value.status === 'timeout'
          if (timedOut) {
            const recovered = await reconcileTimeout(endpoint)
            if (recovered) { notifyStudentChange(); return recovered }
          }
          const supplied = 'error' in value ? value.error : undefined
          const outcomeInstruction = endpoint === AUTH_API.confirm && supplied === AUTH_MESSAGES.confirmationSignIn ||
            (endpoint === AUTH_API.reset || endpoint === AUTH_API.verifyRecovery) && supplied === AUTH_MESSAGES.recoveryRestart
          const text = response.status === 503 && !outcomeInstruction && supplied !== AUTH_MESSAGES.comingSoon
            ? AUTH_MESSAGES.unavailable : safeAuthMessage(supplied)
          const message = authMessageReference(text, reference, response.status === 503)
          const code = timedOut && endpoint === AUTH_API.reset ? RECOVERY_FAILURE.restart :
            'code' in value && (value.code === RECOVERY_FAILURE.invalidCode || value.code === RECOVERY_FAILURE.restart ||
              value.code === RECOVERY_FAILURE.password) ? value.code : undefined
          setError(message)
          onFailure?.({ message, code })
          return null
        }
        const result = parseAuthOutcome(endpoint, value)
        if (isStudentAuthTransition(endpoint) && !('code' in value && value.code === EMAIL_CONFIRMATION_REQUIRED)) {
          notifyStudentChange()
        }
        return result
      })
    } catch (failure) {
      setError(failure instanceof AuthClientFailure && failure.kind === 'unsupported' ? AUTH_MESSAGES.browser : authMessageReference(AUTH_MESSAGES.unavailable, reference))
      return null
    } finally { lock.current = false; setPending(false) }
  }
  const clearError = () => setError('')
  return { submit, pending, error, clearError }
}
