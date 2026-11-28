'use client'
import { useEffect, useState } from 'react'
import { PIN_PATTERN } from '@/lib/orientation/contract'
import { quizButton, quizInput } from './parts'

/** QR fragments stay out of request URLs; storage is optional, bounded and never trusted as admission. */
export function JoinQuiz({ firstName, pending, error, onJoin }: {
  firstName: string | null; pending: boolean; error: string
  onJoin: (pin: string, firstName: string, surname: string) => void
}) {
  const [pin,setPin] = useState(''), [given,setGiven] = useState(firstName ?? ''), [surname,setSurname] = useState('')
  useEffect(() => {
    let next = new URLSearchParams(window.location.hash.slice(1)).get('pin')
    if (next && PIN_PATTERN.test(next)) {
      try { sessionStorage.setItem('orientation-pin',JSON.stringify({ pin: next,until: Date.now() + 30 * 60_000 })) } catch { /* Joining still works without storage. */ }
      window.history.replaceState(window.history.state,'',window.location.pathname)
    } else {
      try {
        const stored: unknown = JSON.parse(sessionStorage.getItem('orientation-pin') ?? 'null')
        if (stored && typeof stored === 'object' && 'pin' in stored && typeof stored.pin === 'string' && PIN_PATTERN.test(stored.pin)
          && 'until' in stored && typeof stored.until === 'number' && stored.until > Date.now() && stored.until <= Date.now() + 30 * 60_000) next = stored.pin
      } catch { /* An unavailable or malformed entry simply leaves the PIN blank. */ }
    }
    if (next && PIN_PATTERN.test(next)) setPin(next)
  },[])
  return <form className="grid gap-4" onSubmit={event => { event.preventDefault(); onJoin(pin,given,surname) }}>
    <h1 className="text-2xl font-bold">Join the quiz</h1>
    <label className="grid gap-2 font-semibold">Game PIN<input className={quizInput} value={pin} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} required autoComplete="off" onChange={event => setPin(event.target.value.replace(/\D/g,''))} disabled={pending} /></label>
    <label className="grid gap-2 font-semibold">First name<input className={quizInput} value={given} required maxLength={80} autoComplete="given-name" onChange={event => setGiven(event.target.value)} disabled={pending} /></label>
    <label className="grid gap-2 font-semibold">Surname<input className={quizInput} value={surname} required maxLength={80} autoComplete="family-name" onChange={event => setSurname(event.target.value)} disabled={pending} /></label>
    <p className="text-sm text-student-text-secondary">Your name will appear on the leaderboard.</p>
    {error && <p role="alert" className="text-student-error">{error}</p>}
    <button className={quizButton} disabled={pending}>{pending ? 'Joining…' : 'Join quiz'}</button>
  </form>
}
