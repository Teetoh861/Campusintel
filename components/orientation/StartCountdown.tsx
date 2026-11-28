'use client'
import { useEffect, useState } from 'react'
import { quizRemaining } from '@/lib/orientation/clock'
/** A database timestamp starts the opening countdown; no question is included before it finishes. */
export function StartCountdown({ startsAt,serverNow,receivedAt,heading = 'h1',compact = false }: { startsAt: string | null; serverNow: string; receivedAt: number | null; heading?: 'h1'|'h2'|'h3'; compact?: boolean }) {
  const [now,setNow] = useState<number | null>(null)
  useEffect(() => { const tick = () => setNow(performance.now()); tick(); const timer = setInterval(tick,100); return () => clearInterval(timer) },[])
  const remaining = startsAt && receivedAt !== null && now !== null ? quizRemaining(serverNow,startsAt,receivedAt,now) : null
  const Heading = heading
  return <section className="grid gap-5 text-center" aria-label="Quiz start countdown">
    <Heading className={compact ? "text-lg font-bold" : "text-2xl font-bold"}>The quiz is starting</Heading>
    <p role="timer" className={compact ? "text-4xl font-bold tabular-nums" : "text-6xl font-bold tabular-nums"}>{remaining === null ? '…' : Math.ceil(remaining / 1000)}</p>
    <p role="status">{remaining === 0 ? 'Question 1 is coming…' : 'Get ready for question 1.'}</p>
  </section>
}
