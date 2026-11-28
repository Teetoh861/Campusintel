import { ChevronDown } from 'lucide-react'
import { optionLetter } from '@/lib/orientation/clock'
import type { HostState } from '@/lib/orientation/contract'

/** Progressive host-only preview. The player endpoint never uses this component or projection. */
export function HostQuestions({ state }: { state: HostState }) {
  return <section className="student-surface"><details className="group/preview" open={['draft','lobby'].includes(state.phase ?? '') || undefined}><summary className="flex min-h-11 cursor-pointer items-center gap-2 text-xl font-bold"><ChevronDown size={20} className="shrink-0 group-open/preview:rotate-180" aria-hidden="true" />Question preview</summary>
    <div className="mt-4 grid gap-2">{state.questions?.map(question => <details key={question.id} className="group/question rounded-ci-btn border border-student-border p-3" open={question.current || undefined}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold"><ChevronDown size={20} className="shrink-0 group-open/question:rotate-180" aria-hidden="true" />{question.spare ? 'Spare' : `Question ${question.ordinal}`} · {question.category}{question.used ? ' · Used' : ''}</summary>
      <p className="my-3 break-words text-lg font-semibold">{question.prompt}</p>
      <ol className="grid gap-2">{question.options.map((text,index) => <li key={index} className="break-words">{optionLetter(index)}. {text}{index === question.correct && <strong> · Correct</strong>}</li>)}</ol>
    </details>)}</div>
  </details></section>
}
