// app/courses/[slug]/notes/AskCampusBot.tsx — "Ask a question" in a topic's Campus Bot area (CampusBotArea), and the
// chat it opens about the topic being read: a sheet from the bottom on a phone, a panel at the side on a desktop that
// the page makes room for, so the notes stay readable beside it. The chat lives in this page only: closing the sheet
// keeps it, leaving the page ends it. Each message travels with the last few turns and an id of its own, so trying
// again after a lost answer repeats the same message.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { btnGhost, btnNavy } from '@/components/chrome/ui'
import { CampusBotStatus } from '@/components/student/CampusBotStatus'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsDesktop } from '@/components/ui/use-mobile'
import { sendChatMessage } from '@/lib/campus-bot/client'
import { CHAT_LIMITS } from '@/lib/campus-bot/contract'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import type { CampusBotProblem } from '@/lib/campus-bot/contract'
import type { FormEvent, ReactElement } from 'react'

type Props = {
  courseSlug: string
  itemId: string
  topicTitle: string
  continuityToken: string
  signInHref: string
  reloadHref: string
  /** Injected in tests. */
  send?: typeof sendChatMessage
  newId?: () => string
}

export type Turn = { id: string; role: 'student' | 'bot'; text: string; inNotes?: boolean }

/** The chat so far: each turn under its name, the line for an answer from outside the notes, then the wait or the
 *  notice for whatever stopped the last message. */
export function ChatLog({ turns, answering, problem, onRetry, signInHref, reloadHref }: {
  turns: ReadonlyArray<Turn>; answering: boolean; problem: CampusBotProblem | null; onRetry?: () => void
  signInHref: string; reloadHref: string
}): ReactElement {
  return <>
    {turns.map(turn => <div key={turn.id} className="student-ask-turn" data-role={turn.role}>
      <p className="student-ask-who">{turn.role === 'student' ? CAMPUS_BOT_COPY.you : CAMPUS_BOT_COPY.name}</p>
      {turn.role === 'bot' && turn.inNotes === false
        ? <p className="student-ask-outside">{CAMPUS_BOT_COPY.outsideNotes}</p> : null}
      <p className="student-ask-text">{turn.text}</p>
    </div>)}
    {answering ? <p role="status" className="student-practice-help">{CAMPUS_BOT_COPY.answering}</p> : null}
    {problem !== null ? <CampusBotStatus problem={problem} feature="ask" signInHref={signInHref}
      reloadHref={reloadHref} onRetry={onRetry} /> : null}
  </>
}
// The message waiting for its answer, with the id every retry of it carries.
type Pending = { requestId: string; message: string }

const IN_PROGRESS_RETRIES = 6
const IN_PROGRESS_WAIT_MS = 2_500

export function AskCampusBot({ courseSlug, itemId, topicTitle, continuityToken, signInHref, reloadHref,
  send = sendChatMessage, newId = () => crypto.randomUUID() }: Props): ReactElement {
  const desktop = useIsDesktop()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<ReadonlyArray<Turn>>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [answering, setAnswering] = useState(false)
  const [problem, setProblem] = useState<CampusBotProblem | null>(null)
  const run = useRef(0)
  const log = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => () => { run.current += 1 }, [])
  // The newest turn, the wait and any notice stay in view.
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [turns, answering, problem])
  // Beside the notes on a desktop, the page keeps clear of the panel while it is open, so nothing it covers is lost.
  useEffect(() => {
    if (!open || !desktop) return
    const root = document.documentElement
    root.classList.add('student-ask-docked')
    return () => root.classList.remove('student-ask-docked')
  }, [open, desktop])

  const deliver = useCallback(async (message: Pending, earlier: ReadonlyArray<Turn>) => {
    const mine = ++run.current
    setAnswering(true)
    setProblem(null)
    const history = earlier.slice(-CHAT_LIMITS.turns).map(turn => ({ role: turn.role,
      text: turn.text.slice(0, CHAT_LIMITS.turnChars) }))
    for (let attempt = 0; ; attempt += 1) {
      const result = await send({ operation: 'ask', courseSlug, itemId, requestId: message.requestId,
        message: message.message, history }, continuityToken)
      if (run.current !== mine) return
      if (result.status === 'in-progress' && attempt < IN_PROGRESS_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, IN_PROGRESS_WAIT_MS))
        if (run.current !== mine) return
        continue
      }
      setAnswering(false)
      if (result.status === 'answered') {
        setPending(null)
        setTurns(current => [...current, { id: `${message.requestId}-reply`, role: 'bot', text: result.text,
          inNotes: result.inNotes }])
        field.current?.focus()
      } else setProblem(result)
      return
    }
  }, [courseSlug, itemId, continuityToken, send])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = draft.trim()
    // A new message replaces one still waiting for Try again: its turn stays in the chat, unanswered.
    if (message === '' || answering) return
    const next: Pending = { requestId: newId(), message }
    const earlier = turns
    setTurns([...earlier, { id: next.requestId, role: 'student', text: message }])
    setDraft('')
    setPending(next)
    void deliver(next, earlier)
  }
  // Try again repeats the waiting message with its own id: an answer already written comes back at no cost.
  const retry = pending === null ? undefined
    : () => { void deliver(pending, turns.filter(turn => turn.id !== pending.requestId)) }
  // Nothing more can be sent from here until the student has what the notice asks for.
  const closed = problem !== null && ['not-entitled', 'limit', 'locked', 'exam-open', 'signed-out', 'session-changed',
    'disabled'].includes(problem.status)

  return <Sheet open={open} onOpenChange={setOpen} modal={!desktop}>
    <SheetTrigger asChild>
      {/* Ghost, like every button of the Campus Bot area: the topic's own practice stays the main action. */}
      <button type="button" className={studentAction(btnGhost, 'bg-student-surface')}>{CAMPUS_BOT_COPY.ask}</button>
    </SheetTrigger>
    <SheetContent side={desktop ? 'right' : 'bottom'} className="student-ask-sheet z-[70]" data-side={desktop ? 'right' : 'bottom'}
      // Beside the notes on a desktop: reading, scrolling and selecting them never closes the chat.
      onInteractOutside={event => { if (desktop) event.preventDefault() }}
      onOpenAutoFocus={event => { event.preventDefault(); field.current?.focus() }}>
      <SheetHeader className="student-ask-head">
        <SheetTitle className="student-ask-title">{CAMPUS_BOT_COPY.name}</SheetTitle>
        <SheetDescription className="student-ask-topic">{topicTitle}</SheetDescription>
      </SheetHeader>
      <div ref={log} className="student-ask-log" role="log" aria-live="polite" aria-relevant="additions">
        <ChatLog turns={turns} answering={answering} problem={problem} onRetry={retry} signInHref={signInHref}
          reloadHref={reloadHref} />
      </div>
      <form className="student-ask-form" onSubmit={submit}>
        <label htmlFor="student-ask-field" className="sr-only">{CAMPUS_BOT_COPY.askPlaceholder(topicTitle)}</label>
        <input ref={field} id="student-ask-field" type="text" className="student-ask-field student-focus-control"
          value={draft} maxLength={CHAT_LIMITS.messageChars} placeholder={CAMPUS_BOT_COPY.askPlaceholder(topicTitle)}
          autoComplete="off" enterKeyHint="send" disabled={closed} onChange={event => setDraft(event.target.value)} />
        <button type="submit" className={studentAction(btnNavy, studentFocusDark)}
          disabled={closed || answering || draft.trim() === ''}>{CAMPUS_BOT_COPY.send}</button>
      </form>
    </SheetContent>
  </Sheet>
}
