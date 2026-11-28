'use client'
import { useEffect, useState } from 'react'
import { Plus, Trash2, ChevronDown } from 'lucide-react'
import type { HostState } from '@/lib/orientation/contract'
import { quizButton, quizInput, quizSecondary } from './parts'
/** Prize names remain a local draft until explicitly saved; End freezes their database snapshot. */
export function HostPrizes({ state,pending,onDirty,save }: {
  state: HostState; pending: boolean; onDirty: (value: boolean) => void; save: (prizes: string[]) => Promise<boolean>
}) {
  const [prizes,setPrizes] = useState(state.prizes ?? []), [dirty,setDirty] = useState(false)
  const frozen = state.phase === 'ended' || state.phase === 'off'
  useEffect(() => { if (!dirty) setPrizes(state.prizes ?? []) },[state.prizes,dirty])
  function change(next: string[]) { setPrizes(next); setDirty(true); onDirty(true) }
  const count = frozen ? state.prizes?.length ?? 0 : prizes.length
  return <section className="student-surface"><details className="group" open={['draft','lobby'].includes(state.phase ?? '') || undefined}>
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xl font-bold"><ChevronDown size={20} className="shrink-0 group-open:rotate-180" aria-hidden="true" />Prizes · {count} {count === 1 ? 'winner' : 'winners'}{dirty && !frozen ? ' · Unsaved' : ''}</summary><div className="mt-4 grid gap-4">
    {frozen ? <ol className="grid gap-3">{state.prizes?.map((prize,index) => <li className="break-words" key={index}>Position {index + 1} · {prize}</li>)}</ol> : <>
      {prizes.map((prize,index) => <div key={index} className="flex items-end gap-3"><label className="grid min-w-0 flex-1 gap-2 font-semibold">Position {index + 1}<input className={quizInput} value={prize} maxLength={160} disabled={pending} onChange={event => change(prizes.map((text,i) => i === index ? event.target.value : text))} /></label>
        <button className={quizSecondary + ' !w-11 shrink-0'} disabled={pending} aria-label={`Remove prize ${index + 1}`} onClick={() => change(prizes.filter((_,i) => i !== index))}><Trash2 size={18} aria-hidden="true" /></button></div>)}
      <button className={quizSecondary} disabled={pending || prizes.length >= 300} onClick={() => change([...prizes,''])}><Plus size={18} aria-hidden="true" />Add prize</button>
      <button className={quizButton} disabled={pending || !dirty || prizes.some(prize => !prize.trim())} onClick={async () => {
        if (await save(prizes)) { setDirty(false); onDirty(false) }
      }}>Save prizes</button>
    </>}
  </div></details></section>
}
