'use client'
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { HostState } from '@/lib/orientation/contract'
import { quizButton, quizInput, quizSecondary } from './parts'

/** Operator roster and prize collection; public leaderboards are separately redacted by the database. */
export function HostResults({ state, pending, command }: { state: HostState; pending: boolean; command: (action: 'hide'|'draw'|'collect', target?: string) => void }) {
  const [search,setSearch] = useState('')
  return <div className="grid gap-6">
    {state.phase === 'ended' && state.ties?.needed && <section className="student-surface grid gap-3">
      <h2 className="text-xl font-bold">A draw is needed</h2>
      {state.ties.groups.map(group => <div className="grid gap-2" key={group.position}>
        <p className="font-semibold">{group.candidates.length} tied players · positions {group.position}–{group.position + group.candidates.length - 1}</p>
        <details className="group"><summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold"><ChevronDown size={18} className="shrink-0 group-open:rotate-180" aria-hidden="true" />Prizes in this draw</summary><ol className="grid gap-1">{group.prizes.map((prize,index) => <li key={index} className="break-words">{group.position + index}. {prize ?? 'No prize'}</li>)}</ol></details>
      </div>)}
      <button className={quizButton} disabled={pending} onClick={() => { if (window.confirm('Draw for the tied positions and prizes? This draw can only happen once.')) command('draw') }}>Start draw</button>
    </section>}
    {state.draw && <p role="status">Draw completed once at {new Date(state.draw.startedAt).toISOString().slice(11,19)} UTC.</p>}
    {Boolean(state.winners?.length) && <section className="student-surface grid gap-4"><h2 className="text-xl font-bold">Winners</h2>
      {state.winners?.map(winner => <div key={winner.playerId} className="grid gap-3 border-t border-student-border pt-4">
        <p className="break-words text-lg font-bold">{winner.position}. {winner.name}</p>
        <p className="break-words font-semibold">{winner.prize}</p>
        <code className="break-words font-mono text-lg">{winner.code.match(/.{1,4}/g)?.join(' ')}</code>
        <button className={quizButton} disabled={pending || winner.collectedAt !== null} onClick={() => {
          if (window.confirm(`Mark ${winner.name}’s prize as collected?`)) command('collect',winner.playerId)
        }}>{winner.collectedAt ? 'Collected' : 'Mark collected'}</button>
      </div>)}
    </section>}
    <section className="student-surface grid gap-4"><h2 className="text-xl font-bold">Players and ranking</h2>
      <label className="grid gap-2">Find a player<input className={quizInput} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="grid gap-3">{state.players?.filter(player => player.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(player => <div key={player.id} className="grid gap-2 border-t border-student-border pt-3 tablet:grid-cols-[1fr_auto]">
        <div className="min-w-0"><p className="break-words font-semibold">{player.position}. {player.name}</p><p className="text-sm text-student-text-secondary">{player.score} correct · {(player.timeUs / 1_000_000).toFixed(3)} s on correct answers</p></div>
        <button className={quizSecondary} disabled={pending || player.hidden} onClick={() => command('hide',player.id)}>{player.hidden ? 'Name hidden' : 'Hide name'}</button>
      </div>)}</div>
    </section>
  </div>
}
