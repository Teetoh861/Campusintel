import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { btnNavy, btnGhost } from '@/components/chrome/ui'
import { studentAction } from '@/components/student/ui'
import { ORIENTATION_PATH } from '@/lib/orientation/contract'
import type { PlayerState } from '@/lib/orientation/contract'

export const quizButton = studentAction(btnNavy,'w-full')
export const quizSecondary = studentAction(btnGhost,'w-full')
export const quizInput = 'min-h-11 w-full rounded-ci-btn border border-student-control-border bg-student-surface px-3 py-2 text-base text-student-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-focus'
/** Small shared result list; no account identifiers or email addresses are rendered. */
export function Leaders({ rows }: { rows: { name: string; position: number; score: number }[] }) {
  return <section className="grid gap-3" aria-labelledby="quiz-leaders"><h2 id="quiz-leaders" className="flex items-center gap-2 text-lg font-bold"><Trophy size={20} aria-hidden="true" />Top 5</h2>
    <ol className="divide-y divide-student-border">{rows.map((row,index) => <li key={index} className="flex items-start gap-3 py-3">
      <span className="min-w-6 font-bold">{row.position}</span><span className="min-w-0 flex-1 break-words">{row.name}</span><span className="font-semibold">{row.score}</span>
    </li>)}</ol></section>
}
/** The requested claim code is visible only in the winning player's private projection. */
export function Claim({ me }: { me: Extract<PlayerState,{ status: 'ok' }>['me'] }) {
  if (!me.claimCode) return null
  return <section className="student-surface grid gap-3 border-student-primary" aria-label="Your prize">
    <h2 className="text-xl font-bold">Position {me.prizePosition ?? me.position}</h2>
    <p className="break-words text-xl font-bold">{me.name}</p>
    <p className="break-words text-lg font-semibold">{me.prize}</p>
    {me.collected && <p role="status" className="font-bold">Collected</p>}
    {!me.collected && <><code className="break-words font-mono text-2xl font-bold leading-relaxed">{me.claimCode.match(/.{1,4}/g)?.join(' ')}</code><p>Collect your prize at the CampusIntell table.</p></>}
  </section>
}
/** Recover through the existing signed-in account flow. */
export function SignedOut() {
  return <div className="grid gap-4"><h1 className="text-2xl font-bold">Sign in to continue</h1>
    <Link className={quizButton} href={'/login?next=' + encodeURIComponent(ORIENTATION_PATH)}>Sign in</Link></div>
}
