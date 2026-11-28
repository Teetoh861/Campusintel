'use client'
import { useEffect, useState } from 'react'
import { Check, Clock } from 'lucide-react'
import { optionLetter, quizRemaining } from '@/lib/orientation/clock'
import type { Question } from '@/lib/orientation/contract'
import { studentAction } from '@/components/student/ui'
import { btnGhost, btnNavy } from '@/components/chrome/ui'

/** Shared server timestamps drive both phases; options remain disabled without a fresh clock exchange. */
export function PhoneQuestion({ question: q, serverNow, sentAt, receivedAt, selected, busy, uncertain, disconnected, onAnswer }: {
  question: Question; serverNow: string; sentAt: number | null; receivedAt: number | null; selected: number | null; busy: boolean; uncertain: boolean
  disconnected: boolean; onAnswer: (option: number) => void
}) {
  const [now,setNow] = useState<number | null>(null)
  useEffect(() => { const tick = () => setNow(performance.now()); tick(); const timer = setInterval(tick,100); return () => clearInterval(timer) },[])
  const synced = sentAt !== null && receivedAt !== null && now !== null
  // Receipt time gives a lower bound for opening; send time gives an upper bound for closing.
  const ready = synced ? quizRemaining(serverNow,q.opensAt,receivedAt,now) : null
  const remaining = synced ? quizRemaining(serverNow,q.closesAt,sentAt,now) : null
  const preparing = ready !== null && ready > 0
  const open = ready === 0 && remaining !== null && remaining > 0
  return <section className="grid gap-5" aria-labelledby="quiz-question">
    <div className="sticky top-0 z-10 flex min-h-11 items-center justify-between gap-3 rounded-ci-btn bg-student-primary px-4 py-3 font-bold text-student-primary-text">
      <span>Question {q.number} of 15</span><span className="flex items-center gap-2" role="timer" aria-label={preparing ? 'Get ready' : 'Time left'}><Clock size={18} aria-hidden="true" />{!synced ? '…' : Math.ceil((preparing ? ready : remaining ?? 0) / 1000)} s</span>
    </div>
    <h1 id="quiz-question" className="break-words text-xl font-bold leading-relaxed">{q.prompt}</h1>
    {preparing ? <p role="status" className="text-lg font-semibold">Get ready</p> : <div className="grid gap-3">
      {q.options.map((text,index) => <button key={index} type="button" disabled={!open || disconnected || busy || uncertain || selected !== null}
        aria-pressed={selected === index} onClick={() => onAnswer(index)}
        className={studentAction(selected === index ? btnNavy : btnGhost,'min-h-14 w-full justify-start gap-3 px-4 py-4 text-left text-lg leading-6 disabled:opacity-100')}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-current font-bold" aria-hidden="true">{optionLetter(index)}</span>
        <span className="min-w-0 flex-1 break-words">{text}</span>{selected === index && <Check size={22} className="shrink-0" aria-hidden="true" />}
      </button>)}
    </div>}
    {!synced ? <p role="status">Checking the time…</p> : selected !== null ? <p role="status" className="flex items-center gap-2 font-semibold"><Check size={20} aria-hidden="true" />Answer locked in</p>
      : busy ? <p role="status">Checking your answer…</p> : !preparing && !open ? <p role="status" className="font-semibold">Time’s up.</p> : null}
    {uncertain && selected === null && <p role="status">Your answer hasn’t been confirmed.</p>}
    {uncertain && selected === null && open && !disconnected && <button className={studentAction(btnGhost,'min-h-14 text-lg')} onClick={() => onAnswer(-1)}>Try this answer again</button>}
  </section>
}
