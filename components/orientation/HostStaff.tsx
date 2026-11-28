'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { HostState } from '@/lib/orientation/contract'
import { quizButton, quizInput, quizSecondary } from './parts'
/** Access is attached to a confirmed account for this event; account roles are never changed. */
export function HostStaff({ state,pending,add,remove }: {
  state: HostState; pending: boolean; add: (email: string) => Promise<boolean>; remove: (id: string) => void
}) {
  const [email,setEmail] = useState('')
  return <section className="student-surface"><details className="group" open={!state.staff?.length && ['draft','lobby'].includes(state.phase ?? '') || undefined}>
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xl font-bold"><ChevronDown size={20} className="shrink-0 group-open:rotate-180" aria-hidden="true" />Prize collection staff ({state.staff?.length ?? 0})</summary><div className="mt-4 grid gap-4">
    <Link className={quizSecondary} href={'/orientation/collect?event=' + state.eventId}>Open staff collection page</Link>
    <form className="grid gap-3" onSubmit={async event => { event.preventDefault(); if (await add(email)) setEmail('') }}>
      <label className="grid gap-2 font-semibold">Staff account email<input className={quizInput} type="email" value={email} maxLength={254} required autoComplete="off" disabled={pending} onChange={event => setEmail(event.target.value)} /></label>
      <button className={quizButton} disabled={pending}>Add staff</button>
    </form>
    <p className="text-sm text-student-text-secondary">Staff need a confirmed account. They can check and collect this quiz’s codes.</p>
    {state.staff?.map(person => <div key={person.userId} className="flex items-center gap-3 border-t border-student-border pt-3"><p className="min-w-0 flex-1 break-all">{person.email}</p><button className={quizSecondary + ' !w-auto'} disabled={pending} onClick={() => remove(person.userId)}>Remove</button></div>)}
  </div></details></section>
}
