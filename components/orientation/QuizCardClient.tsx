'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { playerStateSchema, LOBBY_POLL_MS, LIVE_POLL_MS } from '@/lib/orientation/contract'
import type { PlayerState } from '@/lib/orientation/contract'
import { StartCountdown } from './StartCountdown'
import { useQuizPoll } from './useQuizPoll'
import { quizButton, quizInput } from './parts'
const interval = (data: PlayerState | null) => data?.status === 'inactive' || (data?.status === 'ok' && data.phase === 'off') ? null : data?.status === 'ok' && data.phase === 'live' ? LIVE_POLL_MS : LOBBY_POLL_MS
/** A PIN entry or the student's current game; the hall's actual PIN is never disclosed here. */
export function QuizCardClient({ initial }: { initial: PlayerState | null }) {
  const [pin,setPin] = useState('')
  const poll = useQuizPoll(initial,playerStateSchema,'/api/orientation',interval)
  const data = poll.data
  if (!data || poll.signedOut || data.status === 'inactive' || (data.status === 'ok' && data.phase === 'off')) return null
  return <section className="student-surface mb-5 grid gap-4 border-student-primary" aria-labelledby="orientation-card-title">
    <h2 id="orientation-card-title" className="text-xl font-bold">Orientation quiz</h2>
    {data.status === 'join' ? <form className="grid gap-3 tablet:grid-cols-[1fr_auto] tablet:items-end" onSubmit={event => {
      event.preventDefault(); window.location.assign('/orientation#pin=' + pin)
    }}><label className="grid gap-2 font-semibold">Game PIN<input className={quizInput} value={pin} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="off" onChange={event => setPin(event.target.value.replace(/\D/g,''))} /></label>
      <button className={quizButton}>Join quiz</button></form>
      : <>{data.phase === 'live' && !data.question ? <StartCountdown heading="h3" compact startsAt={data.startsAt} serverNow={data.serverNow} receivedAt={poll.receivedAt} /> : <p>{data.phase === 'lobby' ? 'Waiting for the host.' : data.phase === 'ended' ? 'Your final result is ready.' : data.question === null ? 'The quiz is starting.' : 'The quiz is live.'}</p>}
        {data.phase === 'lobby' && <p className="flex items-center gap-2"><Users size={18} aria-hidden="true" />{data.joined} joined</p>}
        <Link className={quizButton} href={'/orientation/' + data.eventId}>Open quiz</Link></>}
  </section>
}
