// Shared Student App search input with one explicit clear action.
'use client'
import { Search, X } from 'lucide-react'
import { useRef } from 'react'
import { FormField } from '@/components/chrome/FormField'
import { btnGhost } from '@/components/chrome/ui'
import { studentAction, studentFocusControl } from './ui'
import type { RefObject } from 'react'

type Props = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputRef?: RefObject<HTMLInputElement | null>
}

/** Keep search clearing local to the query, with a predictable input focus target. */
export function SearchField({ id, label, value, onChange, placeholder, inputRef }: Props) {
  const localRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? localRef
  return <FormField id={id} label={label} value={value} ref={ref}
    type="text" role="searchbox" autoComplete="off" maxLength={100}
    placeholder={placeholder} onChange={event => onChange(event.target.value)}
    className={'student-search-input ' + studentFocusControl}
    trailing={<>
      <Search aria-hidden="true" size={18} strokeWidth={1.75} className="student-search-icon" />
      {value !== '' && <button type="button" aria-label="Clear search"
        className={studentAction(btnGhost, 'student-search-clear')}
        onClick={() => { onChange(''); ref.current?.focus() }}>
        <X aria-hidden="true" size={18} strokeWidth={1.75} />
      </button>}
    </>} />
}
