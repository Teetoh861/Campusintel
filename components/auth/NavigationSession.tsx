// components/auth/NavigationSession.tsx — Shared session presentation for global chrome; never an authorization gate.
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { onStudentChange } from '@/lib/auth/client-events'
import { AUTH_API, AUTH_LOGOUT_CONTEXT_HEADER, AUTH_STATUS_EVENT } from '@/lib/auth/constants'
import type { ReactElement, ReactNode } from 'react'

type NavigationSession = { signedIn: boolean; version: number; continuityToken: string | null }
const SessionContext = createContext<NavigationSession>({ signedIn: false, version: 0, continuityToken: null })

/** Reuse the server-verified status endpoint; pending and failed lookups show public chrome. */
export function NavigationSessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [state, setState] = useState<NavigationSession>({ signedIn: false, version: 0, continuityToken: null })

  useEffect(() => {
    let controller: AbortController | undefined
    let active = true
    const refresh = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      const { signal } = controller
      setState(previous => ({ signedIn: false, version: previous.version + 1, continuityToken: null }))
      try {
        const response = await fetch(AUTH_API.session, {
          cache: 'no-store', credentials: 'same-origin', signal,
          headers: { [AUTH_LOGOUT_CONTEXT_HEADER]: 'true' },
        })
        const result: unknown = await response.json()
        if (!response.ok || !result || typeof result !== 'object' ||
            !('enabled' in result) || typeof result.enabled !== 'boolean' ||
            !('signedIn' in result) || typeof result.signedIn !== 'boolean') return
        const signedIn = result.enabled && result.signedIn
        const continuityToken = 'continuityToken' in result && typeof result.continuityToken === 'string'
          && result.continuityToken ? result.continuityToken : null
        if (signedIn && continuityToken === null) return
        if (active && !signal.aborted) setState(previous => ({ ...previous, signedIn, continuityToken }))
      } catch { /* Public chrome remains visible; protected routes keep their server guards. */ }
    }
    const visible = (): void => { if (document.visibilityState === 'visible') void refresh() }
    const restored = (event: PageTransitionEvent): void => { if (event.persisted) void refresh() }
    const unsubscribe = onStudentChange(refresh)
    void refresh()
    window.addEventListener('focus', visible)
    window.addEventListener('pageshow', restored)
    window.addEventListener(AUTH_STATUS_EVENT, visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      unsubscribe()
      controller?.abort()
      window.removeEventListener('focus', visible)
      window.removeEventListener('pageshow', restored)
      window.removeEventListener(AUTH_STATUS_EVENT, visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}

/** Read only the chrome presentation, without client identity or account data. */
export function useNavigationSession(): NavigationSession {
  return useContext(SessionContext)
}
