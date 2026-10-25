// components/auth/NavigationSession.tsx — Shared session presentation for global chrome; never an authorization gate.
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { onStudentChange } from '@/lib/auth/client-events'
import { AUTH_API, AUTH_LOGOUT_CONTEXT_HEADER, AUTH_STATUS_EVENT } from '@/lib/auth/constants'
import type { ChromeState } from '@/lib/auth/chrome-state'
import type { ReactElement, ReactNode } from 'react'

type NavigationSession = { status: ChromeState; signedIn: boolean; version: number; continuityToken: string | null }
const SessionContext = createContext<NavigationSession>({ status: 'unknown', signedIn: false, version: 0, continuityToken: null })

type Answer = { status: Exclude<ChromeState, 'unknown'>; continuityToken: string | null }

/** Read only a complete status answer; anything else is no answer. */
async function lookup(signal: AbortSignal): Promise<Answer | null> {
  const response = await fetch(AUTH_API.session, {
    cache: 'no-store', credentials: 'same-origin', signal,
    headers: { [AUTH_LOGOUT_CONTEXT_HEADER]: 'true' },
  })
  const result: unknown = await response.json()
  if (!response.ok || !result || typeof result !== 'object' ||
      !('enabled' in result) || typeof result.enabled !== 'boolean' ||
      !('signedIn' in result) || typeof result.signedIn !== 'boolean') return null
  const signedIn = result.enabled && result.signedIn
  const continuityToken = 'continuityToken' in result && typeof result.continuityToken === 'string'
    && result.continuityToken ? result.continuityToken : null
  if (signedIn && continuityToken === null) return null
  return { status: signedIn ? 'signed-in' : 'signed-out', continuityToken }
}

/** Start from the proxy's server-verified answer. A pending or failed lookup never replaces a known state;
 * only an unknown first render falls back to public chrome when the lookup cannot answer.
 */
export function NavigationSessionProvider({ initial, children }: { initial: ChromeState; children: ReactNode }): ReactElement {
  const [state, setState] = useState<NavigationSession>(() =>
    ({ status: initial, signedIn: initial === 'signed-in', version: 0, continuityToken: null }))

  useEffect(() => {
    let controller: AbortController | undefined
    let active = true
    // An account change from another document closes open chrome even before the new answer arrives.
    const refresh = async (changed = false): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      const { signal } = controller
      setState(previous => ({ ...previous, continuityToken: null, version: previous.version + (changed ? 1 : 0) }))
      let answer: Answer | null = null
      try { answer = await lookup(signal) } catch { /* Keep the presented state; protected routes keep their server guards. */ }
      if (!active || signal.aborted) return
      setState(previous => {
        if (answer) return { status: answer.status, signedIn: answer.status === 'signed-in', continuityToken: answer.continuityToken,
          version: previous.version + (previous.status === answer.status ? 0 : 1) }
        return previous.status === 'unknown' ? { ...previous, status: 'signed-out', signedIn: false } : previous
      })
    }
    const visible = (): void => { if (document.visibilityState === 'visible') void refresh() }
    const restored = (event: PageTransitionEvent): void => { if (event.persisted) void refresh() }
    const changed = (): void => { void refresh(true) }
    const unsubscribe = onStudentChange(changed)
    void refresh()
    window.addEventListener('focus', visible)
    window.addEventListener('pageshow', restored)
    window.addEventListener(AUTH_STATUS_EVENT, changed)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      unsubscribe()
      controller?.abort()
      window.removeEventListener('focus', visible)
      window.removeEventListener('pageshow', restored)
      window.removeEventListener(AUTH_STATUS_EVENT, changed)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}

/** Read only the chrome presentation, without client identity or account data. */
export function useNavigationSession(): NavigationSession {
  return useContext(SessionContext)
}
