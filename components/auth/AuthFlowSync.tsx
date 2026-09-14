// components/auth/AuthFlowSync.tsx — Discard ephemeral entry flows after another tab changes identity.
'use client'
import { onStudentChange } from '@/lib/auth/client-events'
import { useEffect } from 'react'
import { AUTH_API, AUTH_PATHS, AUTH_STATUS_EVENT } from '@/lib/auth/constants'

/** Recheck on return to a tab; notifications carry no identity or credentials. */
export function AuthFlowSync({ signedIn = false }: { signedIn?: boolean }) {
  useEffect(() => {
    let active = true
    const check = async () => {
      try {
        const response = await fetch(AUTH_API.session, { cache: 'no-store', credentials: 'same-origin' })
        if (!response.ok) return
        const state = await response.json()
        if (!active) return
        if (state.enabled === true && state.signedIn === true && !signedIn) window.location.replace(AUTH_PATHS.account)
        else if (state.enabled === true && state.signedIn === false && signedIn) window.location.reload()
        else if (state.enabled === false) window.location.reload()
      } catch { /* Server guards remain authoritative when status cannot be refreshed. */ }
    }
    const reset = () => window.location.reload()
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reset() }
    const focus = () => { if (signedIn) reset(); else void check() }
    const visible = () => { if (document.visibilityState === 'visible') focus() }
    const unsubscribe = onStudentChange(reset)
    window.addEventListener('pageshow', restored)
    window.addEventListener('focus', focus)
    window.addEventListener(AUTH_STATUS_EVENT, reset)
    document.addEventListener('visibilitychange', visible)
    void check()
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('pageshow', restored)
      window.removeEventListener('focus', focus)
      window.removeEventListener(AUTH_STATUS_EVENT, reset)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [signedIn])
  return null
}
