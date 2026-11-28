'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ZodType } from 'zod'
import { quizRequest, QuizRequestError } from '@/lib/orientation/client'

type Pollable = { status: string; serverNow?: string; phase?: string }
/** One request at a time, randomized cadence, and generation cancellation for obsolete responses. */
export function useQuizPoll<T extends Pollable>(initial: T | null, schema: ZodType<T>, path: string,
  interval: (data: T | null) => number | null) {
  const [reading,setReading] = useState<{ data: T | null; sentAt: number | null; receivedAt: number | null }>({ data: initial,sentAt: null,receivedAt: null })
  const [error,setError] = useState('')
  const [signedOut,setSignedOut] = useState(false)
  const latest = useRef(initial)
  const generation = useRef(0)
  const [revision,setRevision] = useState(0)
  const refresh = useCallback(() => { generation.current++; setRevision(value => value + 1) },[])
  const adopt = useCallback((data: T, sentAt: number) => {
    generation.current++; latest.current = data; setReading({ data,sentAt,receivedAt: performance.now() }); setError(''); setRevision(value => value + 1)
  },[])
  useEffect(() => {
    const version = generation.current
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = latest.current
    const tick = async () => {
      if (document.hidden) { timer = setTimeout(() => { void tick() },1_000); return }
      const sentAt = performance.now()
      try {
        const value = schema.parse(await quizRequest(path,undefined,undefined,controller.signal))
        if (controller.signal.aborted || version !== generation.current) return
        last = value; latest.current = value; setReading({ data: value,sentAt,receivedAt: performance.now() }); setError(''); setSignedOut(false)
      } catch (failure) {
        if (controller.signal.aborted || version !== generation.current) return
        if (failure instanceof QuizRequestError && failure.signedOut) {
          latest.current = null; setReading({ data: null,sentAt: null,receivedAt: null }); setSignedOut(true); return
        }
        setError('Reconnecting…')
      }
      const delay = interval(last)
      if (!controller.signal.aborted && delay !== null) timer = setTimeout(() => { void tick() },delay * (0.9 + Math.random() * 0.2))
    }
    timer = setTimeout(() => { void tick() },Math.random() * 250)
    const resume = () => { if (!document.hidden) { setReading(value => ({ ...value,sentAt: null,receivedAt: null })); refresh() } }
    document.addEventListener('visibilitychange',resume)
    window.addEventListener('online',resume)
    return () => { controller.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange',resume); window.removeEventListener('online',resume) }
    // Initial data seeds the first render; each successful exchange replaces it. Identity changes remount the gated page.
  },[schema,path,interval,revision,refresh,initial])
  return { ...reading,error,signedOut,refresh,adopt }
}
