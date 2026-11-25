// app/courses/[slug]/notes/AskCampusBot.tsx — "Ask a question" in a topic's Campus Bot area (CampusBotArea), and the
// chat it opens about the topic being read: a sheet from the bottom on a phone, a panel at the side on a desktop that
// the page makes room for, so the notes stay readable beside it. The chat lives in this page only: closing the sheet
// keeps it, leaving the page ends it. Each message travels with the last few turns and an id of its own, so trying
// again after a lost answer repeats the same message. Under Campus Bot's newest turn sit its buttons (owner decisions
// B5 and B6, mock 8): Explain again and Make flashcards are chat requests of their own, and Quiz me on this topic does
// what the area's button does, with the same request id.
'use client'

import { CircleCheck, CircleX, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { btnGhost } from '@/components/chrome/ui'
import { CampusBotStatus } from '@/components/student/CampusBotStatus'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useIsDesktop } from '@/components/ui/use-mobile'
import { topicSetPath } from '@/lib/ai-practice/topic-contract'
import { sendChatMessage } from '@/lib/campus-bot/client'
import { CHAT_LIMITS } from '@/lib/campus-bot/contract'
import { CAMPUS_BOT_COPY } from '@/lib/campus-bot/copy'
import { boldSpans } from '@/lib/campus-bot/reply-text'
import { ChatFlashcards } from './ChatFlashcards'
import { chatOffers, ChatOffers } from './ChatOffers'
import { DEFAULT_DEPS as DEFAULT_QUIZ_DEPS, runQuiz } from './QuizMe'
import type { ChatOffer, ChatOffersAllowed } from './ChatOffers'
import type { QuizDeps, QuizView } from './QuizMe'
import type { CampusBotCommand, CampusBotProblem, ChatAction, ChatVerdict, Flashcard } from '@/lib/campus-bot/contract'
import type { FormEvent, ReactElement, Ref } from 'react'

type Props = {
  courseSlug: string
  itemId: string
  topicTitle: string
  continuityToken: string
  signInHref: string
  reloadHref: string
  /** The buttons this topic offers under Campus Bot's replies: Make flashcards (enough notes for them) and Quiz me on
   *  this topic (the page's own quiz condition). Explain again needs nothing more than the chat. */
  offers: ChatOffersAllowed
  /** Injected in tests. */
  send?: typeof sendChatMessage
  newId?: () => string
  quizDeps?: QuizDeps
}

/** A turn of the chat. A Campus Bot turn carries how it marked the answer before it, the check question it asks next
 *  and a memory trick; a turn kept from before replies were marked has none of them. A student's turn from a button
 *  names its action; Campus Bot's flashcards are a turn of their own, with the cards and no text. A reply to Explain
 *  again never carries a check question, so a question that was waiting ends with it. */
export type Turn = { id: string; role: 'student' | 'bot'; text: string; inNotes?: boolean; verdict?: ChatVerdict
  check?: string | null; memoryTrick?: string | null; action?: ChatAction; cards?: ReadonlyArray<Flashcard> }

/** The turns sent with a message: never flashcards, nor the turn that asked for them. */
export function chatHistory(turns: ReadonlyArray<Turn>): Extract<CampusBotCommand, { operation: 'ask' }>['history'] {
  return turns.filter(turn => !turn.cards && turn.action !== 'flashcards').slice(-CHAT_LIMITS.turns)
    .map(turn => turn.role === 'bot' && turn.check
      ? { role: 'bot' as const, text: turn.text.slice(0, CHAT_LIMITS.turnChars),
        check: turn.check.slice(0, CHAT_LIMITS.checkChars) }
      : { role: turn.role, text: turn.text.slice(0, CHAT_LIMITS.turnChars) })
}

const VERDICT_BADGE = {
  // The library's icons for a correct and a wrong answer: the icon and the word tell them apart, never the colour.
  correct: { label: CAMPUS_BOT_COPY.correct, Icon: CircleCheck },
  'not-quite': { label: CAMPUS_BOT_COPY.notQuite, Icon: CircleX },
} as const

/** Text with its key words bold: elements built from the parsed spans, never markup from the text. */
export function BoldText({ text }: { text: string }): ReactElement {
  return <>{boldSpans(text).map((span, index) => span.bold
    ? <strong key={index}>{span.text}</strong> : <Fragment key={index}>{span.text}</Fragment>)}</>
}

/** A reply's paragraphs: after Not quite, "The answer is …" is a paragraph of its own (mock 8). */
export function replyParagraphs(text: string, verdict: ChatVerdict | undefined): string[] {
  if (verdict !== 'not-quite') return [text]
  const split = /^((?:\*\*)?The answer is[\s\S]*?[.!?]["’”)]*(?:\*\*)?)\s+(\S[\s\S]*)$/.exec(text)
  // Never between a bold term's markers.
  return split && (split[1]!.split('**').length % 2 === 1) ? [split[1]!, split[2]!] : [text]
}

/** Whether the chat is waiting for the student's answer: the latest Campus Bot reply shows a check question. Flashcards
 *  are not part of the conversation, so a check question shown before them still waits. */
export function awaitingAnswer(turns: ReadonlyArray<Turn>): boolean {
  const lastBot = [...turns].reverse().find(turn => turn.role === 'bot' && !turn.cards)
  return Boolean(lastBot?.check)
}

/** The chat so far (mock 8): Campus Bot's turns as cards, the student's as bubbles on the right, the names for screen
 *  readers only. A Campus Bot card opens with its verdict (an icon and a word in a pill, never colour alone) or, unmarked,
 *  with the line for an answer from outside the notes; then the reply, its memory trick, and its check question in a
 *  card of its own. Flashcards are a Campus Bot card of their own. Then the wait or the notice for whatever stopped the
 *  last message (`action` names a button's request), and the quiz's wait or notice. */
export function ChatLog({ turns, answering, action, problem, onRetry, quiz, onQuizRetry, signInHref, reloadHref }: {
  turns: ReadonlyArray<Turn>; answering: boolean; action?: ChatAction; problem: CampusBotProblem | null
  onRetry?: () => void; quiz?: QuizView; onQuizRetry?: () => void; signInHref: string; reloadHref: string
}): ReactElement {
  const flashcards = action === 'flashcards'
  return <>
    {turns.map(turn => {
      if (turn.role === 'bot' && turn.cards) {
        return <div key={turn.id} className="student-ask-turn" data-role="bot" data-kind="flashcards">
          <p className="student-ask-who sr-only">{CAMPUS_BOT_COPY.name}</p>
          <ChatFlashcards cards={turn.cards} />
        </div>
      }
      const verdict = turn.role === 'bot' && (turn.verdict === 'correct' || turn.verdict === 'not-quite')
        ? turn.verdict : null
      const badge = verdict === null ? null : VERDICT_BADGE[verdict]
      return <Fragment key={turn.id}>
        <div className="student-ask-turn" data-role={turn.role} data-verdict={verdict ?? undefined}>
          <p className="student-ask-who sr-only">{turn.role === 'student' ? CAMPUS_BOT_COPY.you : CAMPUS_BOT_COPY.name}</p>
          {badge !== null && verdict !== null
            ? <p className="student-ask-badge" data-verdict={verdict}>
              <badge.Icon aria-hidden="true" size={16} strokeWidth={1.75} />{badge.label}</p>
            : turn.role === 'bot' && turn.inNotes === false
              ? <p className="student-ask-outside">{CAMPUS_BOT_COPY.outsideNotes}</p> : null}
          {(turn.role === 'bot' ? replyParagraphs(turn.text, turn.verdict) : [turn.text]).map((paragraph, index) =>
            <p key={index} className="student-ask-text">
              {turn.role === 'bot' ? <BoldText text={paragraph} /> : paragraph}</p>)}
          {turn.role === 'bot' && turn.memoryTrick
            ? <p className="student-ask-text">{CAMPUS_BOT_COPY.memoryTrick} <BoldText text={turn.memoryTrick} /></p> : null}
        </div>
        {turn.role === 'bot' && turn.check
          ? <div className="student-ask-turn" data-role="bot" data-kind="check">
            <p className="student-practice-eyebrow student-ask-eyebrow">
              {verdict !== null ? CAMPUS_BOT_COPY.tryAnother : CAMPUS_BOT_COPY.quickCheck}</p>
            <p className="student-ask-text"><BoldText text={turn.check} /></p>
          </div> : null}
      </Fragment>
    })}
    {answering ? <p role="status" className="student-practice-help">
      {flashcards ? CAMPUS_BOT_COPY.flashcards.making : CAMPUS_BOT_COPY.answering}</p> : null}
    {problem !== null ? <CampusBotStatus problem={problem} feature={flashcards ? 'flashcards' : 'ask'}
      signInHref={signInHref} reloadHref={reloadHref} onRetry={onRetry} /> : null}
    {quiz?.writing ? <p role="status" className="student-practice-help">{CAMPUS_BOT_COPY.quiz.writing}</p>
      : quiz?.problem ? <CampusBotStatus problem={quiz.problem} feature="quiz" signInHref={signInHref}
        reloadHref={reloadHref} onRetry={onQuizRetry} /> : null}
  </>
}
/** The field and Send. While a check question waits, the field asks for the answer, and its label for screen readers
 *  says the same. */
export function ChatForm({ turns, topicTitle, draft, closed, answering, fieldRef, onDraft, onSubmit }: {
  turns: ReadonlyArray<Turn>; topicTitle: string; draft: string; closed: boolean; answering: boolean
  fieldRef?: Ref<HTMLInputElement>; onDraft: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void
}): ReactElement {
  const placeholder = awaitingAnswer(turns) ? CAMPUS_BOT_COPY.answerPlaceholder : CAMPUS_BOT_COPY.askPlaceholder(topicTitle)
  return <form className="student-ask-form" onSubmit={onSubmit}>
    <label htmlFor="student-ask-field" className="sr-only">{placeholder}</label>
    <input ref={fieldRef} id="student-ask-field" type="text" className="student-ask-field student-focus-control"
      value={draft} maxLength={CHAT_LIMITS.messageChars} placeholder={placeholder}
      autoComplete="off" enterKeyHint="send" disabled={closed} onChange={event => onDraft(event.target.value)} />
    {/* Mock 8's send button, in our icons and colours: the library's send icon on navy, named Send for screen readers. */}
    <button type="submit" className={`student-ask-send ${studentFocusDark}`} aria-label={CAMPUS_BOT_COPY.send}
      disabled={closed || answering || draft.trim() === ''}><Send aria-hidden="true" size={20} strokeWidth={1.75} /></button>
  </form>
}

// The message waiting for its answer, with the id every retry of it carries, and the button that sent it.
type Pending = { requestId: string; message: string; action?: ChatAction }

const IN_PROGRESS_RETRIES = 6
const IN_PROGRESS_WAIT_MS = 2_500

export function AskCampusBot({ courseSlug, itemId, topicTitle, continuityToken, signInHref, reloadHref, offers,
  send = sendChatMessage, newId = () => crypto.randomUUID(), quizDeps = DEFAULT_QUIZ_DEPS }: Props): ReactElement {
  const desktop = useIsDesktop()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<ReadonlyArray<Turn>>([])
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [answering, setAnswering] = useState(false)
  const [problem, setProblem] = useState<CampusBotProblem | null>(null)
  const [quiz, setQuiz] = useState<QuizView>({ writing: false, problem: null })
  const [quizOff, setQuizOff] = useState(false)
  const run = useRef(0)
  const quizRun = useRef(0)
  const quizPending = useRef(new Map<string, string>())
  const log = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => () => { run.current += 1; quizRun.current += 1 }, [])
  // The newest turn, the wait and any notice stay in view.
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }) }, [turns, answering, problem, quiz])
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
    // Each Campus Bot turn travels with its check question, so the reply to an answer can mark it. Flashcards are
    // written from the notes alone, so nothing of the chat goes with them.
    const history = message.action === 'flashcards' ? [] : chatHistory(earlier)
    for (let attempt = 0; ; attempt += 1) {
      const result = await send({ operation: 'ask', courseSlug, itemId, requestId: message.requestId,
        message: message.message, history, ...(message.action ? { action: message.action } : {}) }, continuityToken)
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
          inNotes: result.inNotes, verdict: result.verdict, check: result.check, memoryTrick: result.memoryTrick }])
        field.current?.focus()
      } else if (result.status === 'flashcards') {
        setPending(null)
        setTurns(current => [...current, { id: `${message.requestId}-reply`, role: 'bot', text: '', cards: result.cards }])
        field.current?.focus()
      } else setProblem(result)
      return
    }
  }, [courseSlug, itemId, continuityToken, send])

  // A new message replaces one still waiting for Try again: its turn stays in the chat, unanswered. A button's turn
  // shows the button's words; the server asks what the button means.
  const ask = (message: string, action?: ChatAction) => {
    const next: Pending = { requestId: newId(), message, ...(action ? { action } : {}) }
    const earlier = turns
    setTurns([...earlier, { id: next.requestId, role: 'student', text: message, ...(action ? { action } : {}) }])
    setPending(next)
    setQuiz({ writing: false, problem: null })
    void deliver(next, earlier)
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = draft.trim()
    if (message === '' || answering || quiz.writing) return
    setDraft('')
    ask(message)
  }
  // Quiz me on this topic, as the area's button does it: the same request id for this topic, so a tap here and one in
  // the area never write two sets. The wait stays on screen until the set's page opens.
  const startQuiz = async () => {
    const mine = ++quizRun.current
    setQuiz({ writing: true, problem: null })
    const result = await runQuiz({ courseSlug, itemId }, continuityToken, quizDeps, () => quizRun.current === mine,
      quizPending.current)
    if (result === null) return
    if (result.status === 'ready') { router.push(topicSetPath(courseSlug, result.setId)); return }
    // Switched off since the page loaded: the quiz is no longer offered here.
    setQuiz({ writing: false, problem: result.status === 'disabled' ? null : result })
    if (result.status === 'disabled') setQuizOff(true)
  }
  const pick = (offer: ChatOffer) => {
    if (offer === 'quiz') { void startQuiz(); return }
    ask(offer === 'flashcards' ? CAMPUS_BOT_COPY.makeFlashcards : CAMPUS_BOT_COPY.explainAgain, offer)
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
      <div ref={log} className="student-ask-log">
        <div className="student-ask-turns" role="log" aria-live="polite" aria-relevant="additions">
          <ChatLog turns={turns} answering={answering} action={pending?.action} problem={problem} onRetry={retry}
            quiz={quiz} onQuizRetry={() => { void startQuiz() }} signInHref={signInHref} reloadHref={reloadHref} />
        </div>
        <ChatOffers offers={chatOffers(turns, { flashcards: offers.flashcards, quiz: offers.quiz && !quizOff },
          answering || problem !== null || quiz.writing || quiz.problem !== null)} onPick={pick} />
      </div>
      <ChatForm turns={turns} topicTitle={topicTitle} draft={draft} closed={closed} answering={answering || quiz.writing}
        fieldRef={field} onDraft={setDraft} onSubmit={submit} />
    </SheetContent>
  </Sheet>
}
