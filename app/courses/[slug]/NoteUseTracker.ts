'use client'

import { useEffect, useRef } from 'react'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'

// A note is on screen when this share of it is in view, or when it fills this share of the screen: a note taller than
// about 1.7 screens can never be 60% in view, and most topics are that tall on a phone.
const ON_SCREEN_SHARE = 0.6
// A topic counts as opened after this long on screen in one visit. Time adds up while the student stays on the page,
// and a hidden tab does not count, so scrolling past never counts.
export const OPENED_AFTER_MS = 30_000

function isOnScreen(note: HTMLElement): boolean {
  const rect = note.getBoundingClientRect()
  const screen = window.innerHeight
  const visible = Math.max(0, Math.min(rect.bottom, screen) - Math.max(rect.top, 0))
  return rect.height > 0 && (visible >= ON_SCREEN_SHARE * rect.height || visible >= ON_SCREEN_SHARE * screen)
}

/**
 * Tell the server, once per note per visit, that a notes topic was opened: plan use the refund rules count. A
 * background request only: nothing on the page waits for it, and a failure changes nothing the student sees.
 */
export function NoteUseTracker({ courseSlug, continuityToken }: { courseSlug: string; continuityToken: string }) {
  const sent = useRef(new Set<string>())

  useEffect(() => {
    const notes = document.querySelectorAll<HTMLElement>('#notes [data-note-item]')
    if (notes.length === 0 || typeof IntersectionObserver === 'undefined') return
    // Notes with any part in view; whether each is on screen is measured from its position.
    const near = new Set<HTMLElement>()
    const shownSince = new Map<HTMLElement, number>()
    const shownMs = new Map<HTMLElement, number>()
    const timers = new Map<HTMLElement, number>()
    let frame: number | null = null

    const pause = (note: HTMLElement) => {
      const since = shownSince.get(note)
      if (since === undefined) return
      shownMs.set(note, (shownMs.get(note) ?? 0) + performance.now() - since)
      shownSince.delete(note)
      window.clearTimeout(timers.get(note))
      timers.delete(note)
    }
    const send = (note: HTMLElement) => {
      pause(note)
      near.delete(note)
      observer.unobserve(note)
      const itemId = note.dataset.noteItem
      if (itemId === undefined || sent.current.has(itemId)) return
      sent.current.add(itemId)
      void fetch('/api/plan-use', { method: 'POST', cache: 'no-store', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json', [AUTH_CONTINUITY_HEADER]: continuityToken },
        body: JSON.stringify({ courseSlug, itemId }) }).catch(() => undefined)
    }
    const resume = (note: HTMLElement) => {
      if (shownSince.has(note)) return
      shownSince.set(note, performance.now())
      timers.set(note, window.setTimeout(() => send(note), Math.max(0, OPENED_AFTER_MS - (shownMs.get(note) ?? 0))))
    }
    const update = (note: HTMLElement) => {
      if (near.has(note) && document.visibilityState === 'visible' && isOnScreen(note)) resume(note)
      else pause(note)
    }
    const updateAll = () => near.forEach(update)
    // Scrolling within a note taller than the screen changes how much of the screen it fills without crossing an
    // observer threshold, so positions are measured again on scroll and resize (once per frame).
    const onMove = () => {
      if (frame !== null) return
      frame = window.requestAnimationFrame(() => { frame = null; updateAll() })
    }

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const note = entry.target as HTMLElement
        if (entry.isIntersecting) near.add(note); else near.delete(note)
        update(note)
      }
    }, { threshold: [0, 0.25, ON_SCREEN_SHARE, 1] })

    notes.forEach(note => { if (!sent.current.has(note.dataset.noteItem ?? '')) observer.observe(note) })
    document.addEventListener('visibilitychange', updateAll)
    window.addEventListener('scroll', onMove, { passive: true })
    window.addEventListener('resize', onMove)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', updateAll)
      window.removeEventListener('scroll', onMove)
      window.removeEventListener('resize', onMove)
      if (frame !== null) window.cancelAnimationFrame(frame)
      timers.forEach(timer => window.clearTimeout(timer))
    }
  }, [courseSlug, continuityToken])

  return null
}
