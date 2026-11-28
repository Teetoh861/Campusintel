'use client'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { quizRequest, QuizRequestError } from '@/lib/orientation/client'
import { staffClaimSchema } from '@/lib/orientation/contract'
import type { StaffClaim } from '@/lib/orientation/contract'
import { quizButton, quizInput } from './parts'
/** A code lookup discloses only the matched winner, and never enables collection from an obsolete lookup. */
export function StaffCollection({ events,initialEvent,token }: {
  events: { id: string; title: string }[]; initialEvent: string; token: string
}) {
  const [eventId,setEventId] = useState(initialEvent), [code,setCode] = useState('')
  const [result,setResult] = useState<StaffClaim | null>(null), [notice,setNotice] = useState('')
  const [pending,setPending] = useState(false), [signedOut,setSignedOut] = useState(false)
  const lock = useRef(false)
  async function lookup(collect: boolean) {
    if (lock.current) return
    lock.current = true; setPending(true); setNotice(''); setResult(null)
    try { setResult(staffClaimSchema.parse(await quizRequest('/api/orientation/claim',{ eventId,code,collect },token))) }
    catch (error) {
      if (error instanceof QuizRequestError && error.signedOut) setSignedOut(true)
      else if (error instanceof QuizRequestError && error.status === 403) setNotice('Ask the host to check your staff access.')
      else if (error instanceof QuizRequestError && error.status === 409) setNotice('Reload this page to continue.')
      else setNotice(collect ? 'Collection could not be confirmed. Check the code again before handing over the prize.' : 'The code could not be checked. Try again.')
    } finally { lock.current = false; setPending(false) }
  }
  if (signedOut) return <div className="grid gap-4"><h1 className="text-2xl font-bold">Sign in to continue</h1><Link className={quizButton} href="/login?next=/orientation/collect">Sign in</Link></div>
  return <div className="grid gap-6"><h1 className="text-2xl font-bold">Prize collection</h1>
    {events.length > 1 ? <label className="grid gap-2 font-semibold">Quiz<select className={quizInput} value={eventId} disabled={pending} onChange={event => { setEventId(event.target.value); setResult(null); setNotice(''); setCode('') }}>{events.map(event => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label> : <p className="font-semibold">{events[0]?.title}</p>}
    <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void lookup(false) }}>
      <label className="grid gap-2 font-semibold">Claim code<input className={quizInput + ' font-mono uppercase'} value={code} maxLength={80} required autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={pending} onChange={event => { setCode(event.target.value); setResult(null); setNotice('') }} /></label>
      <button className={quizButton} disabled={pending}>{pending ? 'Checking…' : 'Check code'}</button>
    </form>
    {notice && <p role="alert">{notice}</p>}
    {result?.status === 'missing' && <p role="status">No winner with this code.</p>}
    {result?.status === 'ok' && <section className="student-surface grid gap-4"><p className="text-lg font-semibold">Position {result.winner.position}</p><h2 className="break-words text-2xl font-bold">{result.winner.name}</h2><p className="break-words text-xl font-semibold">{result.winner.prize}</p>
      {result.winner.collectedAt ? <p role="status" className="font-bold">Collected</p> : <button className={quizButton} disabled={pending} onClick={() => {
        if (window.confirm(`Have you checked ${result.winner.name}’s name and code on their phone?`)) void lookup(true)
      }}>Mark collected</button>}
    </section>}
  </div>
}
