// components/auth/useAuthSubmit.ts — Same-origin form submission without persistent client state.
'use client'
import { notifyStudentChange } from '@/lib/auth/client-events'
import { useRef, useState } from 'react'
import { safeAuthMessage } from '@/lib/auth/errors'
import { parseAuthOutcome } from '@/lib/auth/outcomes'
import { AUTH_API, AUTH_MESSAGES, RECOVERY_FAILURE, EMAIL_CONFIRMATION_REQUIRED, EXISTING_STUDENT_SESSION, AUTH_PATHS } from '@/lib/auth/constants'

export type AuthSubmitFailure = { message: string; code?: (typeof RECOVERY_FAILURE)[keyof typeof RECOVERY_FAILURE] }

type Result = { success?: true; verified?: true; code?: typeof EMAIL_CONFIRMATION_REQUIRED; next?: string; message?: string }

/** Prevent concurrent submits and accept only the minimal application response. */
export function useAuthSubmit() {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(endpoint: (typeof AUTH_API)[keyof typeof AUTH_API], body: object, onFailure?: (failure: AuthSubmitFailure) => void): Promise<Result | null> {
    if (lock.current) return null
    lock.current = true
    setPending(true)
    setError('')
    try {
      // Reject relative or external destinations before the browser resolves against the page URL.
      if (!/^\/api\/auth\/[a-z-]+$/.test(endpoint)) throw new Error('Invalid auth endpoint')
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const value: unknown = await response.json()
      if (!value || typeof value !== 'object') throw new Error('Invalid response')
      if (!response.ok) {
        if (response.status === 409 && 'code' in value && value.code === EXISTING_STUDENT_SESSION && 'next' in value && value.next === AUTH_PATHS.account) {
          window.location.replace(AUTH_PATHS.account)
          return null
        }
        const message = safeAuthMessage('error' in value ? value.error : undefined)
        const code = 'code' in value && (value.code === RECOVERY_FAILURE.invalidCode || value.code === RECOVERY_FAILURE.restart) ? value.code : undefined
        setError(message)
        onFailure?.({ message, code })
        return null
      }
      const result = parseAuthOutcome(endpoint, value)
      // Notify other tabs only after an actual session-changing success.
      if ([AUTH_API.login, AUTH_API.confirm, AUTH_API.reset, AUTH_API.logout].some(path => path === endpoint) &&
          !('code' in value && value.code === EMAIL_CONFIRMATION_REQUIRED)) {
        notifyStudentChange()
      }
      return result
    } catch { setError(AUTH_MESSAGES.unavailable); return null }
    finally { lock.current = false; setPending(false) }
  }
  return { submit, pending, error }
}
