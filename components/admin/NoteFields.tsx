// components/admin/NoteFields.tsx — Explicit generic, topic, and calculator note controls.
import { RepeatableFields } from './RepeatableFields'
import { emptyNoteDraft } from '@/lib/operator/structured-form'
import type { ReactElement } from 'react'
import type { NoteDraft } from '@/lib/operator/structured-form'

type Props = { value: NoteDraft; editing: boolean; onChange: (value: NoteDraft) => void }
const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900'

/** Keep an existing note's subtype fixed and expose every field of that subtype. */
export function NoteFields({ value, editing, onChange }: Props): ReactElement {
  return <div className="space-y-4">
    <div>
      <label htmlFor="content-note-format" className="block text-sm font-medium text-slate-800">Note format</label>
      <select id="content-note-format" value={value.format} disabled={editing}
        onChange={event => {
          const format = event.target.value
          if (format === 'generic' || format === 'topic_note' || format === 'calculator_trick') {
            onChange(emptyNoteDraft(format))
          }
        }} className={inputClass}>
        <option value="generic">Generic note</option>
        <option value="topic_note">Topic note</option>
        <option value="calculator_trick">Calculator trick</option>
      </select>
      <p className="mt-1 text-xs text-slate-600">{editing
        ? 'The format of an existing note is fixed. Create a new note for a different format.'
        : 'Choose a format before creating the draft. Changing it resets format-specific fields.'}</p>
    </div>
    {value.format === 'generic' && <p className="text-sm text-slate-600">This note uses its title and body only.</p>}
    {value.format === 'topic_note' && <>
      <RepeatableFields label="Key points" singular="Key point" hint="At least one non-empty point is required for a topic note."
        items={value.keyPoints} empty={() => ''}
        onChange={keyPoints => onChange({ ...value, keyPoints })}
        renderFields={(point, index, update) => <div>
          <label htmlFor={`note-key-point-${index}`} className="block text-sm font-medium text-slate-800">Key point {index + 1}</label>
          <textarea id={`note-key-point-${index}`} value={point} required maxLength={10000} rows={2}
            onChange={event => update(event.target.value)} className={inputClass} />
        </div>} />
      <div>
        <label htmlFor="content-note-exam-tip" className="block text-sm font-medium text-slate-800">Exam tip (optional)</label>
        <textarea id="content-note-exam-tip" value={value.examTip} maxLength={10000} rows={3}
          onChange={event => onChange({ ...value, examTip: event.target.value })} className={inputClass} />
      </div>
    </>}
    {value.format === 'calculator_trick' && <>
      <div>
        <label htmlFor="content-note-example" className="block text-sm font-medium text-slate-800">Worked example</label>
        <textarea id="content-note-example" value={value.example} required maxLength={10000} rows={4}
          onChange={event => onChange({ ...value, example: event.target.value })} className={inputClass} />
      </div>
      <div>
        <label htmlFor="content-note-formula" className="block text-sm font-medium text-slate-800">Formula (optional)</label>
        <input id="content-note-formula" value={value.formula} maxLength={10000}
          onChange={event => onChange({ ...value, formula: event.target.value })} className={inputClass} />
      </div>
    </>}
  </div>
}
