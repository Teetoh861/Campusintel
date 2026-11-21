// components/admin/ContentList.tsx — Current item selection and publication summary for one repository course.
'use client'
import type { ReactElement } from 'react'
import type { ManagedItem } from '@/lib/operator/editor-contract'

const labels: Record<ManagedItem['kind'], string> = {
  course_overview: 'Course overview', note: 'Note', cbt_question: 'CBT question',
  theory_question: 'Theory question', model_answer: 'Model answer', rubric: 'Rubric',
}

type Props = {
  items: ManagedItem[]
  selectedId: string | null
  busy: boolean
  onSelect: (item: ManagedItem) => void
  onNew: () => void
}

function itemTitle(item: ManagedItem): string {
  const value = item.payload.title ?? item.payload.prompt ?? item.payload.body
  return typeof value === 'string' ? value.slice(0, 100) : labels[item.kind]
}

/** Show operator content state using server-owned revision and publication pointers. */
export function ContentList({ items, selectedId, busy, onSelect, onNew }: Props): ReactElement {
  return <section aria-labelledby="content-list-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 id="content-list-heading" className="text-xl font-semibold text-blue-950">Managed content</h3>
      <button type="button" onClick={onNew} disabled={busy}
        className="rounded-md bg-blue-900 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:opacity-60">
        New content
      </button>
    </div>
    {items.length === 0 ? <p className="mt-4 rounded-md bg-slate-50 p-4 text-sm text-slate-700">No managed content yet. Create a draft to begin.</p> :
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">{items.map(item => <li key={item.item_id}>
        <button type="button" disabled={busy} aria-pressed={selectedId === item.item_id} onClick={() => onSelect(item)}
          className="h-full w-full rounded-lg border border-slate-200 p-3 text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-60 aria-pressed:border-blue-700 aria-pressed:bg-blue-50">
          <span className="block text-xs font-semibold uppercase tracking-wide text-blue-900">{labels[item.kind]}</span>
          <span className="mt-1 block break-words font-medium text-slate-900">{itemTitle(item)}</span>
          <span className="mt-2 block text-xs text-slate-600">
            Draft v{item.current_revision} · {item.approved_revision ? `approved v${item.approved_revision}` : 'awaiting approval'} · {item.published_revision ? `published v${item.published_revision}` : 'unpublished'}
          </span>
          {item.published_revision && item.current_revision !== item.published_revision &&
            <span className="mt-1 block text-xs font-medium text-amber-800">Changed since publication</span>}
        </button>
      </li>)}</ul>}
  </section>
}
