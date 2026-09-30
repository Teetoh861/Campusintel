'use client'

import { useEffect, useRef } from 'react'
import { track } from '@vercel/analytics'
import { courseViewEvent } from '@/lib/analytics/product-events'

const ANALYTICS_READY_POLL_MS = 50
const ANALYTICS_READY_WAIT_MS = 5000

/** Record a canonical course detail after the page commits in the browser. */
export function CourseViewTracker({ courseSlug }: { courseSlug: string }) {
  const lastTracked = useRef<string | null>(null)

  useEffect(() => {
    if (lastTracked.current === courseSlug) return
    // The root Analytics component initializes window.va in its own effect.
    // Its effect can run after this page effect on an initial load.
    const deadline = Date.now() + ANALYTICS_READY_WAIT_MS
    let timer: number | undefined
    const sendWhenReady = () => {
      if (typeof window.va === 'function') {
        lastTracked.current = courseSlug
        const event = courseViewEvent(courseSlug)
        track(event.name, event.properties)
      } else if (Date.now() < deadline) {
        timer = window.setTimeout(sendWhenReady, ANALYTICS_READY_POLL_MS)
      }
    }
    sendWhenReady()
    return () => { if (timer !== undefined) window.clearTimeout(timer) }
  }, [courseSlug])

  return null
}
