// Shared native Student App filter; null means no reference restriction.
'use client'
import { ChevronDown } from 'lucide-react'
import { studentFocusControl } from './ui'
import type { Ref } from 'react'

export type FilterOption = { id: string; label: string }
type Props = {
  id: string
  label: string
  value: string | null
  options: ReadonlyArray<FilterOption>
  onChange: (value: string | null) => void
  selectRef?: Ref<HTMLSelectElement>
}

/** Preserve real reference identities and native keyboard/select behavior. */
export function FilterSelect({ id, label, value, options, onChange, selectRef }: Props) {
  return <div className="student-filter">
    <label htmlFor={id} className="student-filter-label">{label}</label>
    <div className="student-filter-control">
      <select id={id} ref={selectRef} value={value ?? ''}
        className={'student-filter-select ' + studentFocusControl}
        onChange={event => {
          const next = event.target.value
          if (next === '') onChange(null)
          else if (options.some(option => option.id === next)) onChange(next)
        }}>
        <option value="">All</option>
        {value !== null && !options.some(option => option.id === value) &&
          <option value={value} disabled>Selection no longer available</option>}
        {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" size={18} strokeWidth={1.75} />
    </div>
  </div>
}
