// components/admin/RepeatableFields.tsx — Accessible add, remove, and reorder controls for structured editor rows.
import type { ReactElement, ReactNode } from 'react'

const MAX_ENTRIES = 200

type Props<T> = {
  label: string
  singular: string
  hint: string
  items: ReadonlyArray<T>
  onChange: (items: T[]) => void
  empty: () => T
  renderFields: (item: T, index: number, update: (item: T) => void) => ReactNode
}

/** Keep row actions keyboard accessible and preserve the operator's chosen order. */
export function RepeatableFields<T>({ label, singular, hint, items, onChange, empty, renderFields }: Props<T>): ReactElement {
  function updateAt(index: number, value: T): void {
    onChange(items.map((item, position) => position === index ? value : item))
  }

  function move(index: number, destination: number): void {
    if (destination < 0 || destination >= items.length) return
    const next = [...items]
    const value = next[index]
    const displaced = next[destination]
    if (value === undefined || displaced === undefined) return
    next[index] = displaced
    next[destination] = value
    onChange(next)
  }

  return <fieldset className="space-y-3 rounded-lg border border-slate-200 p-4">
    <legend className="px-1 text-sm font-semibold text-blue-950">{label}</legend>
    <p className="text-xs text-slate-600">{hint}</p>
    {items.length === 0 && <p className="text-sm text-slate-500">No {label.toLowerCase()} added.</p>}
    {items.map((item, index) => <fieldset key={index} className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <legend className="px-1 text-xs font-semibold text-slate-700">{singular} {index + 1}</legend>
      {renderFields(item, index, value => updateAt(index, value))}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={index === 0} onClick={() => move(index, index - 1)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-50">
          Move {singular.toLowerCase()} {index + 1} up
        </button>
        <button type="button" disabled={index === items.length - 1} onClick={() => move(index, index + 1)}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-50">
          Move {singular.toLowerCase()} {index + 1} down
        </button>
        <button type="button" onClick={() => onChange(items.filter((_, position) => position !== index))}
          className="rounded border border-slate-300 px-2 py-1 text-xs text-red-800 focus:outline-none focus:ring-2 focus:ring-red-700">
          Remove {singular.toLowerCase()} {index + 1}
        </button>
      </div>
    </fieldset>)}
    <button type="button" disabled={items.length >= MAX_ENTRIES} onClick={() => onChange([...items, empty()])}
      className="rounded-md border border-blue-300 px-3 py-2 text-sm font-medium text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-700 disabled:opacity-50">
      Add {singular.toLowerCase()}
    </button>
  </fieldset>
}
