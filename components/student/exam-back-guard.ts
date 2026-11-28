// components/student/exam-back-guard.ts — During a timed exam the browser's back never leaves it.
// The phone's back button, the browser's and an iPhone swipe back all go back through the tab's history. While an exam is
// on screen, one entry for the same address sits above the exam's own. Going back off it lands on an entry of this same
// page: the entry is put straight back, the app router never sees that step (so the screen stays exactly as it was, on
// the same question), and the exam asks "End exam?". The entry carries the exam entry's own router state, so even a
// forward step onto it shows this exam. Once the exam has ended the entry is taken away again, so the next back leaves
// the result as usual. A reload keeps the entry (history state survives it), so it is never stacked twice.
import { useCallback, useEffect, useRef } from 'react'

const GUARD = 'ciExamGuard'

type HistoryState = Record<string, unknown>

function stateOf(value: unknown): HistoryState {
  return typeof value === 'object' && value !== null ? value as HistoryState : {}
}

/** Whether a history state is the entry this exam put above its own. */
export function isExamGuard(state: unknown, key: string): boolean {
  return stateOf(state)[GUARD] === key
}

/** The guard entry's state: the exam entry's own state (the app router's included), marked as this exam's guard. */
export function guardStateFor(examState: unknown, key: string): HistoryState {
  return { ...stateOf(examState), [GUARD]: key }
}

/** The exam entry's own state, read from either entry. */
export function examStateFrom(current: unknown, key: string): HistoryState {
  const { [GUARD]: guard, ...rest } = stateOf(current)
  return guard === key ? rest : stateOf(current)
}

/**
 * While `active`, a back step re-arms the guard and calls onBack (which opens "End exam?"); onBack is not called while
 * `quiet` (a hand-in is on its way: the screen already says what is happening). Returns `release`: call it once the exam
 * has ended, before the result replaces it, to take the guard entry away.
 */
export function useExamBackGuard(key: string, active: boolean, quiet: boolean, onBack: () => void): () => void {
  const onBackRef = useRef(onBack)
  const quietRef = useRef(quiet)
  const released = useRef(false)
  useEffect(() => { onBackRef.current = onBack }, [onBack])
  useEffect(() => { quietRef.current = quiet }, [quiet])

  useEffect(() => {
    if (!active) return
    released.current = false
    const { history, location } = window
    let armed: { url: string; examState: HistoryState } | null = null
    // Armed once the page's router has written this entry's state (it does so in its own effect, after this one).
    const arm = () => {
      if (released.current) return
      armed = { url: location.href, examState: examStateFrom(history.state, key) }
      if (!isExamGuard(history.state, key)) history.pushState(guardStateFor(armed.examState, key), '', armed.url)
    }
    const timer = window.setTimeout(arm, 0)
    const back = (event?: Event) => {
      if (released.current || armed === null || isExamGuard(history.state, key)) return
      // This page's own history step: the router never handles it, and the guard comes back on top, with the exam
      // entry's state as it stands now when the step landed on that entry, or as it was armed when it went further back.
      event?.stopImmediatePropagation()
      const examState = location.href === armed.url ? examStateFrom(history.state, key) : armed.examState
      history.pushState(guardStateFor(examState, key), '', armed.url)
      if (!quietRef.current) onBackRef.current()
    }
    // Capturing, so it runs before the app router's own listener on the same window.
    window.addEventListener('popstate', back, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('popstate', back, true)
    }
  }, [key, active])

  return useCallback(() => {
    if (released.current) return
    released.current = true
    if (isExamGuard(window.history.state, key)) window.history.back()
  }, [key])
}
