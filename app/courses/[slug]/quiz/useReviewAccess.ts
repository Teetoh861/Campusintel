'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { postPracticeCommand } from '@/lib/practice/client'
import type { PracticeResult } from '@/lib/practice/contract'
import type { Dispatch, SetStateAction } from 'react'
import type { View } from './QuizClient'
import type { PracticeProblem } from './practice-presentation'

const REVIEW_FAILED: PracticeProblem = { title: "Couldn't open the review. Try again.", body: '', retry: true }

/** Revalidate answer access without letting a transient or stale response navigate the student away. */
export function useReviewAccess(view: View, continuityToken: string, setView: Dispatch<SetStateAction<View>>,
  onClosed: () => void) {
  const current = useRef(view)
  current.current = view
  const request = useRef(0)
  const live = useRef(true)
  const [opening, setOpening] = useState(false)
  const [problem, setProblem] = useState<PracticeProblem | null>(null)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => { setOpening(false); setProblem(null) }, [view])

  const openReview = useCallback(async () => {
    const expected = current.current
    if (expected.screen !== 'results') return
    const sequence = ++request.current
    setOpening(true)
    setProblem(null)
    let fresh: PracticeResult
    try { fresh = await postPracticeCommand({ action: 'attempt', attemptId: expected.attempt.id }, continuityToken) }
    catch { fresh = { status: 'unavailable' } }
    if (!live.current || current.current !== expected || sequence !== request.current) return
    setOpening(false)
    if (fresh.status === 'graded' && fresh.attempt.status !== 'in_progress') {
      if (fresh.attempt.id !== expected.attempt.id) return
      const attempt = fresh.attempt
      onClosed()
      setView(previous => previous !== expected ? previous
        : attempt.mode === 'exam' && attempt.reviewAvailable
          ? { screen: 'review', attempt, unsent: expected.unsent }
          : { screen: 'results', attempt, unsent: expected.unsent })
    } else if (fresh.status === 'not-found' || fresh.status === 'signed-out') {
      onClosed()
      setView(previous => previous === expected ? { screen: 'intro' } : previous)
    } else setProblem(REVIEW_FAILED)
  }, [continuityToken, onClosed, setView])

  useEffect(() => {
    if (view.screen !== 'review') return
    let active = true
    const refresh = () => { void (async () => {
      let fresh: PracticeResult
      try { fresh = await postPracticeCommand({ action: 'attempt', attemptId: view.attempt.id }, continuityToken) }
      catch { return }
      if (!active || !live.current || current.current !== view) return
      if (fresh.status === 'graded' && fresh.attempt.status !== 'in_progress') {
        if (fresh.attempt.id !== view.attempt.id || fresh.attempt.reviewAvailable) return
        onClosed()
        const attempt = fresh.attempt
        setView(previous => previous === view ? { screen: 'results', attempt, unsent: view.unsent } : previous)
      } else if (fresh.status === 'not-found' || fresh.status === 'signed-out') {
        onClosed()
        setView(previous => previous === view ? { screen: 'intro' } : previous)
      }
    })() }
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [view, continuityToken, onClosed, setView])
  return { opening, problem, openReview }
}
