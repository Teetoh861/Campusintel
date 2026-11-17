'use client'
// app/courses/[slug]/notes/QuizMe.tsx — "Quiz me on this topic" in a topic's Campus Bot area: the button, then Campus
// Bot writing a new set of questions from this topic's notes, then the set on its own page. Whatever stops it shows
// under the buttons with its one way on, as Ask Campus Bot shows it (CampusBotStatus). A set still being written for
// this request, after a reload or a second tap, is waited for, never written or charged twice.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { btnGhost } from '@/components/chrome/ui'
import { CampusBotStatus } from '@/components/student/CampusBotStatus'
import { studentAction } from '@/components/student/ui'
import { requestTopicSet, settleTopicRequest, topicRequestId } from '@/lib/ai-practice/topic-client'
import { topicSetPath } from '@/lib/ai-practice/topic-contract'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import type { RequestIdStore } from '@/lib/ai-practice/topic-client'
import type { TopicSetProblem, TopicSetResult } from '@/lib/ai-practice/topic-contract'
import type { ReactElement } from 'react'

// A set being written answers in-progress: ask again until it is done, for longer than one request can take.
const IN_PROGRESS_WAIT_MS = 3_000
const IN_PROGRESS_RETRIES = 70

export type QuizDeps = {
  send: typeof requestTopicSet
  newId: () => string
  /** The tab's request ids; undefined is sessionStorage, null keeps none. */
  store?: RequestIdStore | null
  wait: (ms: number) => Promise<void>
}

const DEFAULT_DEPS: QuizDeps = {
  send: requestTopicSet,
  newId: () => crypto.randomUUID(),
  wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
}

/** Ask for a set until it is ready or something stops it. Null when the page no longer wants the answer. */
export async function runQuiz(topic: { courseSlug: string; itemId: string }, pageToken: string, deps: QuizDeps,
  stillWanted: () => boolean): Promise<TopicSetResult | null> {
  const requestId = topicRequestId(topic.itemId, deps.newId, deps.store)
  for (let attempt = 0; ; attempt += 1) {
    const result = await deps.send({ operation: 'generate-topic', courseSlug: topic.courseSlug, itemId: topic.itemId,
      requestId }, pageToken)
    if (!stillWanted()) return null
    settleTopicRequest(topic.itemId, result, deps.store)
    if (result.status !== 'in-progress' || attempt >= IN_PROGRESS_RETRIES) return result
    await deps.wait(IN_PROGRESS_WAIT_MS)
    if (!stillWanted()) return null
  }
}

export type QuizView = { writing: boolean; problem: TopicSetProblem | null }

/** The quiz's part of the Campus Bot area: its button, then the wait, a problem, or the free pass line. */
export function QuizMeView({ view, passLine, onStart, signInHref, reloadHref }: {
  view: QuizView; passLine: string | null; onStart: () => void; signInHref: string; reloadHref: string
}): ReactElement {
  return <>
    <button type="button" className={studentAction(btnGhost, 'bg-student-surface')} disabled={view.writing}
      onClick={onStart}>{CAMPUS_BOT_COPY.quiz.start}</button>
    {view.writing ? <p role="status" className="student-campus-bot-wide student-practice-help">
      {CAMPUS_BOT_COPY.quiz.writing}</p>
      : view.problem !== null ? <div className="student-campus-bot-wide">
        <CampusBotStatus problem={view.problem} feature="quiz" onRetry={onStart} signInHref={signInHref}
          reloadHref={reloadHref} />
      </div>
        : passLine !== null ? <p className="student-campus-bot-wide student-meta">{passLine}</p> : null}
  </>
}

type Props = {
  courseSlug: string
  itemId: string
  /** "1 of 1 Campus Bot set left on your free pass.", for a free pass with its set unused; otherwise null. */
  passLine: string | null
  continuityToken: string
  signInHref: string
  reloadHref: string
  /** Injected in tests. */
  deps?: QuizDeps
}

export function QuizMe({ courseSlug, itemId, passLine, continuityToken, signInHref, reloadHref, deps = DEFAULT_DEPS }:
  Props): ReactElement | null {
  const router = useRouter()
  const [view, setView] = useState<QuizView>({ writing: false, problem: null })
  const [off, setOff] = useState(false)
  const run = useRef(0)
  useEffect(() => () => { run.current += 1 }, [])

  async function start(): Promise<void> {
    const mine = ++run.current
    setView({ writing: true, problem: null })
    const result = await runQuiz({ courseSlug, itemId }, continuityToken, deps, () => run.current === mine)
    if (result === null) return
    if (result.status === 'ready') {
      // The wait stays on screen until the set's page opens.
      router.push(topicSetPath(courseSlug, result.setId))
      return
    }
    // Switched off since the page loaded: the quiz is no longer offered here.
    if (result.status === 'disabled') { setOff(true); return }
    setView({ writing: false, problem: result })
  }

  if (off) return null
  return <QuizMeView view={view} passLine={passLine} onStart={() => { void start() }} signInHref={signInHref}
    reloadHref={reloadHref} />
}
