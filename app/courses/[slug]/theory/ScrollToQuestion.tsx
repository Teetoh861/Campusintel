'use client'

import { useEffect } from 'react'

/**
 * A guide topic's "Answer this question" link opens its question here, at #question-<id>. A navigation within the app
 * does not scroll to that address, so the opened question is brought into view once the page is shown. A fresh load
 * is already there, and scrolling to it again changes nothing.
 */
export function ScrollToQuestion({ id }: { id: string }) {
  useEffect(() => {
    if (window.location.hash !== `#${id}`) return
    document.getElementById(id)?.scrollIntoView({ block: 'start' })
  }, [id])
  return null
}
