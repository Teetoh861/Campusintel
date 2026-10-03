// components/admin/OverviewFields.tsx — Structured course overview controls over the existing payload contract.
import { RepeatableFields } from './RepeatableFields'
import type { ReactElement } from 'react'
import type { OverviewDraft } from '@/lib/operator/structured-form'

type Props = { value: OverviewDraft; onChange: (value: OverviewDraft) => void }
type FormulaEntry = NonNullable<OverviewDraft['formulaSheet']>[number]
const inputClass = 'mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900'

/** Edit every supported overview collection while preserving untouched values. */
export function OverviewFields({ value, onChange }: Props): ReactElement {
  return <div className="space-y-4" aria-label="Structured course overview">
    <RepeatableFields label="Topics" singular="Topic" hint="Syllabus chapters and their descriptions, in study order."
      items={value.topics ?? []} empty={() => ({ chapter: '', description: '' })}
      onChange={topics => onChange({ ...value, topics })}
      renderFields={(topic, index, update) => <>
        <div>
          <label htmlFor={`overview-topic-${index}-chapter`} className="block text-sm font-medium text-slate-800">Topic {index + 1} chapter</label>
          <input id={`overview-topic-${index}-chapter`} value={topic.chapter} required maxLength={10000}
            onChange={event => update({ ...topic, chapter: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`overview-topic-${index}-description`} className="block text-sm font-medium text-slate-800">Topic {index + 1} description</label>
          <textarea id={`overview-topic-${index}-description`} value={topic.description} required maxLength={10000} rows={3}
            onChange={event => update({ ...topic, description: event.target.value })} className={inputClass} />
        </div>
      </>} />
    <RepeatableFields label="Exam focus" singular="Exam focus" hint="Areas students should prioritize for the exam."
      items={value.examFocus ?? []} empty={() => ''}
      onChange={examFocus => onChange({ ...value, examFocus })}
      renderFields={(entry, index, update) => <div>
        <label htmlFor={`overview-exam-${index}`} className="block text-sm font-medium text-slate-800">Exam focus {index + 1}</label>
        <textarea id={`overview-exam-${index}`} value={entry} required maxLength={10000} rows={2}
          onChange={event => update(event.target.value)} className={inputClass} />
      </div>} />
    <RepeatableFields label="Key takeaways" singular="Key takeaway" hint="A short principle and its explanation."
      items={value.keyTakeaways ?? []} empty={() => ({ title: '', description: '' })}
      onChange={keyTakeaways => onChange({ ...value, keyTakeaways })}
      renderFields={(entry, index, update) => <>
        <div>
          <label htmlFor={`overview-takeaway-${index}-title`} className="block text-sm font-medium text-slate-800">Key takeaway {index + 1} title</label>
          <input id={`overview-takeaway-${index}-title`} value={entry.title} required maxLength={10000}
            onChange={event => update({ ...entry, title: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`overview-takeaway-${index}-description`} className="block text-sm font-medium text-slate-800">Key takeaway {index + 1} description</label>
          <textarea id={`overview-takeaway-${index}-description`} value={entry.description} required maxLength={10000} rows={3}
            onChange={event => update({ ...entry, description: event.target.value })} className={inputClass} />
        </div>
      </>} />
    <RepeatableFields<FormulaEntry> label="Formula sheet" singular="Formula" hint="Plain-text formulas and worked examples; example is optional."
      items={value.formulaSheet ?? []} empty={() => ({ name: '', formula: '', explanation: '' })}
      onChange={formulaSheet => onChange({ ...value, formulaSheet })}
      renderFields={(entry, index, update) => <>
        <div>
          <label htmlFor={`overview-formula-${index}-name`} className="block text-sm font-medium text-slate-800">Formula {index + 1} name</label>
          <input id={`overview-formula-${index}-name`} value={entry.name} required maxLength={10000}
            onChange={event => update({ ...entry, name: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`overview-formula-${index}-formula`} className="block text-sm font-medium text-slate-800">Formula {index + 1} expression</label>
          <input id={`overview-formula-${index}-formula`} value={entry.formula} required maxLength={10000}
            onChange={event => update({ ...entry, formula: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`overview-formula-${index}-explanation`} className="block text-sm font-medium text-slate-800">Formula {index + 1} explanation</label>
          <textarea id={`overview-formula-${index}-explanation`} value={entry.explanation} required maxLength={10000} rows={3}
            onChange={event => update({ ...entry, explanation: event.target.value })} className={inputClass} />
        </div>
        <div>
          <label htmlFor={`overview-formula-${index}-example`} className="block text-sm font-medium text-slate-800">Formula {index + 1} example (optional)</label>
          <textarea id={`overview-formula-${index}-example`} value={entry.example ?? ''} maxLength={10000} rows={2}
            onChange={event => {
              const example = event.target.value
              if (example !== '') update({ ...entry, example })
              else update({ name: entry.name, formula: entry.formula, explanation: entry.explanation })
            }} className={inputClass} />
        </div>
      </>} />
  </div>
}
