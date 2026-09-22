// components/auth/AuthFlowSync.tsx — Reconcile a page with the live student session.
'use client'
import { onStudentChange } from '@/lib/auth/client-events'
import { useEffect, useRef } from 'react'
import { AUTH_API, AUTH_CONTINUITY_HEADER, AUTH_PATHS, AUTH_STATUS_EVENT } from '@/lib/auth/constants'

type Props = { signedIn: true; continuityToken: string } | { signedIn?: false; continuityToken?: never }

/** Keep the current page only when remote Auth confirms the same student session. */
export function AuthFlowSync(props: Props) {
  const signedIn = props.signedIn === true
  const incomingToken = props.signedIn ? props.continuityToken : undefined
  // Keep the token from this mounted page. A later RSC payload for another account
  // must not make an existing client draft appear to belong to that account.
  const continuityToken = useRef(incomingToken).current
  useEffect(() => {
    let active = true
    let backgrounded = document.visibilityState === 'hidden'
    let checking = false
    let queued = false
    let navigating = false
    const reset = () => {
      if (navigating) return
      navigating = true
      window.location.reload()
    }
    const check = async () => {
      try {
        const response = await fetch(AUTH_API.session, {
          cache: 'no-store', credentials: 'same-origin',
          ...(continuityToken ? { headers: { [AUTH_CONTINUITY_HEADER]: continuityToken } } : {}),
        })
        if (!response.ok) return
        const state: unknown = await response.json()
        if (!active || navigating) return
        if (state === null || typeof state !== 'object' || !('enabled' in state) || !('signedIn' in state) ||
            typeof state.enabled !== 'boolean' || typeof state.signedIn !== 'boolean') {
          if (signedIn) reset()
          return
        }
        if (state.enabled === false) reset()
        else if (state.enabled === true && signedIn) {
          if (state.signedIn !== true || !('sameAccount' in state) || state.sameAccount !== true) reset()
        } else if (state.enabled === true && state.signedIn === true) {
          navigating = true
          window.location.replace(AUTH_PATHS.account)
        }
      } catch { /* Server guards remain authoritative when status cannot be refreshed. */ }
    }
    const requestCheck = () => {
      if (!active || navigating) return
      if (checking) { queued = true; return }
      checking = true
      void (async () => {
        do {
          queued = false
          await check()
        } while (active && queued && !navigating)
        checking = false
      })()
    }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) reset() }
    const blur = () => { backgrounded = true }
    const focus = () => {
      if (!backgrounded) return
      backgrounded = false
      requestCheck()
    }
    const visible = () => {
      if (document.visibilityState === 'hidden') backgrounded = true
      else if (document.visibilityState === 'visible') focus()
    }
    const unsubscribe = onStudentChange(reset)
    window.addEventListener('pageshow', restored)
    window.addEventListener('blur', blur)
    window.addEventListener('focus', focus)
    window.addEventListener(AUTH_STATUS_EVENT, reset)
    document.addEventListener('visibilitychange', visible)
    requestCheck()
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('pageshow', restored)
      window.removeEventListener('blur', blur)
      window.removeEventListener('focus', focus)
      window.removeEventListener(AUTH_STATUS_EVENT, reset)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [signedIn, continuityToken, incomingToken])
  return null
}
