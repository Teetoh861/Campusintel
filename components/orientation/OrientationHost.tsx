'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { HOST_POLL_MS, GET_READY_MS, hostStateSchema, MESSAGES } from '@/lib/orientation/contract'
import type { HostState } from '@/lib/orientation/contract'
import { quizRequest } from '@/lib/orientation/client'
import { optionLetter, quizRemaining } from '@/lib/orientation/clock'
import { useQuizPoll } from './useQuizPoll'
import { HostQuestions } from './HostQuestions'
import { HostResults } from './HostResults'
import { HostPrizes } from './HostPrizes'
import { HostJoining } from './HostJoining'
import { HostStaff } from './HostStaff'
import { StartCountdown } from './StartCountdown'
import { quizButton, quizInput, quizSecondary } from './parts'

const interval = () => HOST_POLL_MS
type Command = 'lobby'|'start'|'next'|'skip'|'hide'|'end'|'draw'|'collect'|'off'|'prizes'|'staff-add'|'staff-remove'
/** Operator-only controller. Transitions name their round; all authority, times and awards come from SQL. */
export function OrientationHost({ token }: { token: string }) {
  const [eventId,setEventId] = useState<string | null>(null)
  const [pending,setPending] = useState(false), [notice,setNotice] = useState(''), [prizesDirty,setPrizesDirty] = useState(false)
  const [origin,setOrigin] = useState(''), [now,setNow] = useState<number | null>(null)
  const lock = useRef(false)
  const poll = useQuizPoll<HostState>(null,hostStateSchema,'/api/orientation/host' + (eventId ? '?event=' + eventId : ''),interval)
  const data = poll.data
  useEffect(() => { setOrigin(window.location.origin); const timer = setInterval(() => setNow(performance.now()),200); return () => clearInterval(timer) },[])
  useEffect(() => { setPrizesDirty(false) },[data?.eventId])
  useEffect(() => { if (eventId === null && data?.eventId) setEventId(data.eventId) },[eventId,data?.eventId])
  async function command(action: Command, target?: string, extra: { prizes?: string[]; email?: string } = {}): Promise<boolean> {
    if (lock.current || !data?.eventId) return false
    lock.current = true; setPending(true); setNotice('')
    const sentAt = performance.now()
    try {
      const value = await quizRequest('/api/orientation',{ action,eventId: data.eventId,questionId: data.questionId ?? null,target,...extra },token)
      const parsed = hostStateSchema.safeParse(value)
      if (parsed.success) { poll.adopt(parsed.data,sentAt); return true }
      setNotice(value && typeof value === 'object' && 'status' in value && typeof value.status === 'string' ? MESSAGES[value.status] ?? 'The command was not completed. Check the current quiz.' : 'The command was not completed.')
    } catch { setNotice('The command could not be confirmed. Check the current quiz before trying again.') }
    finally { lock.current = false; setPending(false); poll.refresh() }
    return false
  }
  if (poll.signedOut) return <div className="grid gap-4"><h1 className="text-2xl font-bold">Host access required</h1><Link className={quizButton} href="/login?next=/admin">Sign in</Link></div>
  if (!data) return <p role="status">{poll.error || 'Loading the host screen…'}</p>
  const selected = !eventId || data.eventId === eventId
  const disabled = pending || Boolean(poll.error) || !selected
  const remaining = data.serverNow && data.closesAt && poll.sentAt !== null && now !== null ? quizRemaining(data.serverNow,data.closesAt,poll.sentAt,now) : null
  const ready = data.serverNow && data.opensAt && poll.receivedAt !== null && now !== null ? quizRemaining(data.serverNow,data.opensAt,poll.receivedAt,now) : null
  const current = data.questions?.find(question => question.current)
  return <div className="grid gap-6">
    <h1 className="text-3xl font-bold">Orientation quiz host</h1>
    <label className="grid max-w-xl gap-2 font-semibold">Imported quiz<select className={quizInput} value={eventId ?? data.eventId ?? ''} disabled={pending} onChange={event => setEventId(event.target.value)}>
      {data.events.map(event => <option key={event.id} value={event.id}>{event.title} · {event.kind} · {event.phase}</option>)}
    </select></label>
    {poll.error && <p role="alert">{poll.error} Controls are paused.</p>}
    {notice && <p role="status" className="rounded-ci-btn border border-student-border bg-student-brand-surface p-3">{notice}</p>}
    {data.status === 'empty' ? <p>Import a checked question pack with scripts/orientation/import.cjs, then reload this page.</p> : !selected ? <p role="status">Loading the selected quiz…</p> : <>
      <div className="grid items-start gap-6 desktop:grid-cols-2"><div className="grid gap-6"><section className="student-surface grid gap-5">
        <div><h2 className="break-words text-2xl font-bold">{data.title}</h2><p className="mt-2 font-semibold">{data.kind} · {data.phase} · {data.players?.length ?? 0} joined</p></div>
        {data.pin && ['lobby','live'].includes(data.phase ?? '') && <>
          <div><p className="text-lg font-semibold">Game PIN</p><p className="font-mono text-6xl font-bold tracking-wider">{data.pin}</p></div>
        </>}
        {current && data.phase === 'live' && data.serverNow && (ready !== null && ready > GET_READY_MS ? <StartCountdown heading="h2" startsAt={data.startsAt ?? null} serverNow={data.serverNow} receivedAt={poll.receivedAt} /> : <div className="grid gap-2"><p className="font-semibold">Question {data.number} of 15 · {data.answered} answered</p><p className="break-words text-xl font-bold">{current.prompt}</p><ol className="grid gap-2">{current.options.map((text,index) => <li key={index}>{optionLetter(index)}. {text}{index === current.correct && <strong> · Correct</strong>}</li>)}</ol>
          <p role="timer" className="text-lg font-semibold">{ready && ready > 0 ? `Get ready · ${Math.ceil(ready / 1000)} s` : `Time left · ${Math.ceil((remaining ?? 0) / 1000)} s`}</p></div>)}
        <div className="grid gap-3 tablet:grid-cols-2">
          {data.phase === 'draft' && <button className={quizButton} disabled={disabled} onClick={() => { void command('lobby') }}>Open lobby</button>}
          {data.phase === 'lobby' && <button className={quizButton} disabled={disabled || prizesDirty || !data.winnerCount} onClick={() => { void command('start') }}>Start quiz</button>}
          {data.phase === 'live' && <>
            <button className={quizButton} disabled={disabled || remaining === null || remaining > 0 || data.number === 15} onClick={() => { void command('next') }}>Next question</button>
            <button className={quizSecondary} disabled={disabled} onClick={() => { if (window.confirm('Replace this question with an unused spare? This question will not count.')) void command('skip') }}>Skip to a spare</button>
            <button className={quizButton} disabled={disabled || prizesDirty || data.number !== 15 || remaining === null || remaining > 0} onClick={() => { void command('end') }}>End quiz</button>
          </>}
          {data.phase !== 'off' && <button className={quizSecondary} disabled={disabled} onClick={() => { if (window.confirm(data.ties?.needed ? 'The prize draw is still pending. Switch off and cancel the prizes?' : 'Switch off this quiz? Joining and play will stop.')) void command('off') }}>Switch off</button>}
        </div>
      </section><HostResults state={data} pending={disabled} command={(action,target) => { void command(action,target) }} /></div><div className="grid gap-6"><HostPrizes key={data.eventId} state={data} pending={disabled} onDirty={setPrizesDirty} save={prizes => command('prizes',undefined,{ prizes })} />
        <HostStaff key={'staff-' + data.eventId} state={data} pending={disabled} add={email => command('staff-add',undefined,{ email })} remove={id => { void command('staff-remove',id) }} />
        {data.phase !== 'ended' && data.phase !== 'off' && <><HostJoining origin={origin} pin={data.pin} /><HostQuestions state={data} /></>}
      </div></div>
    </>}
  </div>
}
