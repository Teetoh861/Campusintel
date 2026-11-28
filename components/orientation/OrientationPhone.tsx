'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { playerPollInterval, MESSAGES, ORIENTATION_PATH, playerStateSchema } from '@/lib/orientation/contract'
import type { PlayerState } from '@/lib/orientation/contract'
import { quizRequest, QuizRequestError } from '@/lib/orientation/client'
import { optionLetter } from '@/lib/orientation/clock'
import { useQuizPoll } from './useQuizPoll'
import { JoinQuiz } from './JoinQuiz'
import { StartCountdown } from './StartCountdown'
import { PhoneQuestion } from './PhoneQuestion'
import { Leaders, Claim, SignedOut, quizButton, quizSecondary } from './parts'

/** Phone-complete game. Only validated private projections are adopted; receipts stay bound to their round. */
export function OrientationPhone({ initial, eventId: initialEvent, token }: { initial: PlayerState | null; eventId: string | null; token: string }) {
  const [eventId,setEventId] = useState(initialEvent)
  const [pending,setPending] = useState(false), [notice,setNotice] = useState('')
  const [authLost,setAuthLost] = useState(false)
  const [receipt,setReceipt] = useState<{ questionId: string; option: number } | null>(null)
  const [choice,setChoice] = useState<{ questionId: string; option: number; uncertain: boolean } | null>(null)
  const lock = useRef(false)
  const path = '/api/orientation' + (eventId ? '?event=' + eventId : '')
  const poll = useQuizPoll(initial,playerStateSchema,path,playerPollInterval)
  const currentQuestion = poll.data?.status === 'ok' ? poll.data.question?.id : null
  const current = useRef(currentQuestion); current.current = currentQuestion
  useEffect(() => { setNotice(''); setChoice(null); setReceipt(null) },[currentQuestion])
  const join = useCallback(async (pin: string, firstName: string, surname: string) => {
    if (lock.current) return
    lock.current = true; setPending(true); setNotice('')
    const sentAt = performance.now()
    try {
      const value = await quizRequest('/api/orientation',{ action: 'join',pin,firstName,surname },token)
      const parsed = playerStateSchema.safeParse(value)
      if (parsed.success && parsed.data.status === 'inactive') { poll.adopt(parsed.data,sentAt) }
      else if (parsed.success && parsed.data.status === 'ok') {
        setEventId(parsed.data.eventId); poll.adopt(parsed.data,sentAt)
        window.history.replaceState(window.history.state,'',ORIENTATION_PATH + '/' + parsed.data.eventId)
        try { sessionStorage.removeItem('orientation-pin') } catch { /* Storage is optional. */ }
      } else setNotice(value && typeof value === 'object' && 'status' in value && typeof value.status === 'string' ? MESSAGES[value.status] ?? 'We couldn’t join the quiz. Try again.' : 'We couldn’t join the quiz. Try again.')
    } catch (failure) { if (failure instanceof QuizRequestError && failure.signedOut) setAuthLost(true); else setNotice('We couldn’t join the quiz. Try again.') }
    finally { lock.current = false; setPending(false) }
  },[token,poll.adopt])
  async function answer(option: number) {
    if (lock.current || poll.data?.status !== 'ok' || !poll.data.question) return
    const q = poll.data.question, nextOption = option < 0 ? choice?.option : option
    if (nextOption === undefined) return
    lock.current = true; setPending(true); setNotice(''); setChoice({ questionId: q.id,option: nextOption,uncertain: false })
    try {
      const value = await quizRequest('/api/orientation',{ action: 'answer',eventId: poll.data.eventId,questionId: q.id,option: nextOption },token)
      if (current.current !== q.id) return
      if (value && typeof value === 'object' && 'status' in value && value.status === 'locked' && 'selected' in value && typeof value.selected === 'number') {
        setReceipt({ questionId: q.id,option: value.selected }); setChoice(null)
      } else { setChoice(null); setNotice('Time’s up.') }
    } catch (failure) {
      if (failure instanceof QuizRequestError && failure.signedOut) setAuthLost(true)
      else if (current.current === q.id) setChoice({ questionId: q.id,option: nextOption,uncertain: true })
    } finally { lock.current = false; setPending(false); poll.refresh() }
  }
  if (authLost || poll.signedOut) return <SignedOut />
  const data = poll.data
  if (data === null) return <div className="grid gap-4"><p role="status">{poll.error || 'Loading the quiz…'}</p><button className={quizButton} onClick={poll.refresh}>Try again</button></div>
  if (data.status === 'inactive') return <div className="grid gap-4"><h1 className="text-2xl font-bold">The quiz isn’t open</h1><Link className={quizSecondary} href="/dashboard">Dashboard</Link></div>
  if (data.status === 'join') return <JoinQuiz firstName={data.firstName} pending={pending} error={notice || poll.error} onJoin={(...args) => { void join(...args) }} />
  const q = data.question
  const selected = q ? receipt?.questionId === q.id ? receipt.option : q.selected : null
  const result = q && q.correct !== null
  return <div className="grid gap-6">
    {poll.error && <p role="status" className="rounded-ci-btn border border-student-border bg-student-brand-surface p-3">{poll.error}</p>}
    {data.kind === 'practice' && <p className="text-sm font-semibold text-student-text-secondary">Practice quiz</p>}
    {data.phase === 'ended' || data.phase === 'off' ? <>
      <h1 className="text-2xl font-bold">{data.phase === 'off' ? 'The quiz has ended' : 'Your final position'}</h1>
      <p className="text-xl font-semibold">{data.me.claimCode ? `${data.me.score} correct` : `Position ${data.me.position} · ${data.me.score} correct`}</p>
      {data.drawPending && <p role="status">The host is drawing for the prizes.</p>}
      <Claim me={data.me} /><Leaders rows={data.top} />
      {data.drawPending && <button className={quizButton} onClick={poll.refresh}>Check prizes</button>}
      <Link className={quizSecondary} href="/dashboard">Dashboard</Link>
    </> : data.phase === 'live' && !q ? <StartCountdown startsAt={data.startsAt} serverNow={data.serverNow} receivedAt={poll.receivedAt} /> : data.phase === 'lobby' || !q ? <>
      <h1 className="text-2xl font-bold">You’re in</h1><p className="break-words text-lg font-semibold">{data.me.name}</p>
      <p>Waiting for the host.</p><p className="flex items-center gap-2 text-student-text-secondary"><Users size={20} aria-hidden="true" />{data.joined} joined</p>
    </> : result ? <>
      <p className="font-semibold text-student-text-secondary">Question {q.number} of 15</p>
      <h1 className="text-2xl font-bold">{q.gotIt ? 'Correct' : q.selected === null ? 'No answer' : 'Not this time'}</h1>
      <p className="break-words text-lg font-semibold">{optionLetter(q.correct!)}. {q.options[q.correct!]}</p>
      <p className="text-lg">{data.me.score} correct · Position {data.me.position}</p>
      <Leaders rows={data.top} /><p className="text-student-text-secondary">Waiting for the host.</p>
    </> : <PhoneQuestion key={q.id} question={q} serverNow={data.serverNow} sentAt={poll.sentAt} receivedAt={poll.receivedAt} selected={selected}
      busy={pending || (choice?.questionId === q.id && !choice.uncertain)} uncertain={choice?.questionId === q.id && choice.uncertain}
      disconnected={Boolean(poll.error)} onAnswer={option => { void answer(option) }} />}
    {notice && data.status === 'ok' && !result && <p role="status">{notice}</p>}
  </div>
}
