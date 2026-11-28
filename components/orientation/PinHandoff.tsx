'use client'
import { useEffect } from 'react'
import { PIN_PATTERN } from '@/lib/orientation/contract'
/** Preserve a QR's non-authentication PIN before the normal sign-in journey, without changing that journey. */
export function PinHandoff() {
  useEffect(() => {
    const pin = new URLSearchParams(window.location.hash.slice(1)).get('pin')
    if (!pin || !PIN_PATTERN.test(pin)) return
    try { sessionStorage.setItem('orientation-pin',JSON.stringify({ pin,until: Date.now() + 30 * 60_000 })) } catch { /* Re-entering the hall PIN remains available. */ }
    window.history.replaceState(window.history.state,'',window.location.pathname)
  },[])
  return null
}
