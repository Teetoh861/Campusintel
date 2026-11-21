// app/courses/[slug]/quiz/ExplainPanel.tsx — Explain, under a question the student has finished: the button, the wait,
// and then Campus Bot's explanation with the notes topic it came from, or the one line that says why there is none.
// The browser names only the attempt and the question; the server reads the rest from the student's own attempt.
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { btnGhost } from '@/components/chrome/ui'
import { CampusBotStatus } from '@/components/student/CampusBotStatus'
import { studentAction } from '@/components/student/ui'
import { requestExplanation } from '@/lib/campus-bot/client'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import type { CampusBotProblem, ExplainResult, TopicLink } from '@/lib/campus-bot/contract'
import type { ReactElement } from 'react'

type Props = {
  attemptId: string
  questionId: string
  continuityToken: string
  /** The course's page: a notes topic opens under it. */
  courseHref: string
  signInHref: string
  reloadHref: string
  /** Injected in tests. */
  request?: typeof requestExplanation
}

export type Shown = Extract<ExplainResult, { status: 'explained' | 'not-covered' | 'check-failed' }>
type View = { state: 'idle' } | { state: 'explaining' } | { state: 'shown'; result: Shown }
  | { state: 'problem'; problem: CampusBotProblem }

// Another request is writing this same explanation: ask again shortly, a few times, before saying Campus Bot is busy.
const IN_PROGRESS_RETRIES = 6
const IN_PROGRESS_WAIT_MS = 2_500

function topicHref(courseHref: string, topic: TopicLink): string {
  return `${courseHref}/notes/${topic.number}`
}

/** Campus Bot's block under a question: the explanation and the notes topic it came from, or why there is none. */
export function ExplanationBlock({ result, courseHref }: { result: Shown; courseHref: string }): ReactElement {
  return <section className="student-campus-bot" aria-label={CAMPUS_BOT_COPY.name}>
    <p className="student-campus-bot-name">{CAMPUS_BOT_COPY.name}</p>
    {result.status === 'explained' ? <>
      <p className="student-campus-bot-text">{result.text}</p>
      {result.topic ? <p className="student-campus-bot-source">{CAMPUS_BOT_COPY.fromNotes}{' '}
        <Link href={topicHref(courseHref, result.topic)} prefetch={false} className="student-focus-control">
          {result.topic.title}</Link></p> : null}
    </> : result.status === 'check-failed' && result.topic ? <>
      <p className="student-campus-bot-text">{CAMPUS_BOT_COPY.checkFailed(result.topic.title)}</p>
      <p className="student-campus-bot-source">
        <Link href={topicHref(courseHref, result.topic)} prefetch={false} className="student-focus-control">
          {CAMPUS_BOT_COPY.openNotes}</Link></p>
    </> : <p className="student-campus-bot-text">{CAMPUS_BOT_COPY.notCovered}</p>}
  </section>
}

export function ExplainPanel({ attemptId, questionId, continuityToken, courseHref, signInHref, reloadHref,
  request = requestExplanation }: Props): ReactElement | null {
  const [view, setView] = useState<View>({ state: 'idle' })
  // One answer per tap: a response that arrives after the panel moved on, or was taken down, is dropped.
  const run = useRef(0)
  useEffect(() => () => { run.current += 1 }, [])

  const explain = useCallback(async () => {
    const mine = ++run.current
    setView({ state: 'explaining' })
    for (let attempt = 0; ; attempt += 1) {
      const result = await request({ operation: 'explain', attemptId, questionId }, continuityToken)
      if (run.current !== mine) return
      if (result.status === 'in-progress' && attempt < IN_PROGRESS_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, IN_PROGRESS_WAIT_MS))
        if (run.current !== mine) return
        continue
      }
      if (result.status === 'explained' || result.status === 'not-covered' || result.status === 'check-failed') {
        setView({ state: 'shown', result })
      } else setView({ state: 'problem', problem: result })
      return
    }
  }, [attemptId, questionId, continuityToken, request])

  // Switched off since this page loaded: nothing to offer.
  if (view.state === 'problem' && view.problem.status === 'disabled') return null
  if (view.state === 'shown') return <ExplanationBlock result={view.result} courseHref={courseHref} />
  return <div className="student-campus-bot-ask" aria-live="polite">
    {view.state === 'problem' ? <CampusBotStatus problem={view.problem} feature="explain" signInHref={signInHref}
      reloadHref={reloadHref} onRetry={() => { void explain() }} />
      : <>
        <button type="button" className={studentAction(btnGhost, 'bg-student-surface')}
          disabled={view.state === 'explaining'} onClick={() => { void explain() }}>{CAMPUS_BOT_COPY.explain}</button>
        {view.state === 'explaining' ? <p role="status" className="student-practice-help">
          {CAMPUS_BOT_COPY.explaining}</p> : null}
      </>}
  </div>
}
