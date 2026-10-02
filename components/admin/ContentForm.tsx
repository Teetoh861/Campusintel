// components/admin/ContentForm.tsx — Plain-text authoring form for all six managed-content families.
'use client'
import { useState } from 'react'
import { contentKind, parseContentPayload } from '@/lib/operator/editor-contract'
import type { FormEvent, ReactElement } from 'react'
import type { ContentKind, ContentMutation, ManagedItem } from '@/lib/operator/editor-contract'

const labels: Record<ContentKind, string> = {
  course_overview: 'Course overview', note: 'Note', cbt_question: 'CBT question',
  theory_question: 'Theory question', model_answer: 'Model answer', rubric: 'Rubric',
}
const kinds: ContentKind[] = [
  'course_overview', 'note', 'cbt_question', 'theory_question', 'model_answer', 'rubric',
]

type Props = {
  courseId: string
  item: ManagedItem | null
  allItems: ManagedItem[]
  busy: boolean
  onSave: (input: ContentMutation) => Promise<void>
}

function stringField(payload: Record<string, unknown> | undefined, key: string): string {
  return typeof payload?.[key] === 'string' ? payload[key] : ''
}

/** Create a new draft or append an immutable revision to the selected item. */
export function ContentForm({ courseId, item, allItems, busy, onSave }: Props): ReactElement {
  const [kind, setKind] = useState<ContentKind>(item?.kind ?? 'note')
  const [title, setTitle] = useState(stringField(item?.payload, 'title'))
  const [body, setBody] = useState(stringField(item?.payload, 'body'))
  const [prompt, setPrompt] = useState(stringField(item?.payload, 'prompt'))
  const [section, setSection] = useState(stringField(item?.payload, 'section'))
  const [explanation, setExplanation] = useState(stringField(item?.payload, 'explanation'))
  const [examTip, setExamTip] = useState(stringField(item?.payload, 'examTip'))
  const [options, setOptions] = useState(Array.isArray(item?.payload.options)
    ? item.payload.options.filter((option): option is string => typeof option === 'string').join('\n') : '')
  const [correctOption, setCorrectOption] = useState(typeof item?.payload.correctOption === 'number'
    ? String(item.payload.correctOption) : '0')
  const [parentItemId, setParentItemId] = useState(item?.parent_item_id ?? '')
  const [validation, setValidation] = useState('')
  const dependent = kind === 'model_answer' || kind === 'rubric'
  const theoryOptions = allItems.filter(candidate => candidate.kind === 'theory_question' &&
    (item || !allItems.some(existing => existing.kind === kind && existing.parent_item_id === candidate.item_id)))
  const availableKinds = kinds.filter(candidate => candidate !== 'course_overview' ||
    !allItems.some(existing => existing.kind === 'course_overview'))

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setValidation('')
    let payload: Record<string, unknown>
    if (kind === 'course_overview' || kind === 'note') payload = { ...(item?.payload ?? {}), title, body }
    else if (kind === 'cbt_question') {
      payload = { prompt, options: options.split('\n').map(value => value.trim()),
        correctOption: Number(correctOption) }
      if (section.trim()) payload.section = section
      if (explanation.trim()) payload.explanation = explanation
    } else if (kind === 'theory_question') {
      payload = { prompt }
      if (examTip.trim()) payload.examTip = examTip
    } else payload = { body }
    const parsed = parseContentPayload(kind, payload)
    if (!parsed || (dependent && !item && !parentItemId)) {
      setValidation('Complete all required fields. CBT questions need 2–8 non-empty options and a valid correct option.')
      return
    }
    if (item) await onSave({ action: 'revise', itemId: item.item_id,
      expectedLockVersion: item.lock_version, payload: parsed })
    else await onSave({ action: 'create', courseId, kind, payload: parsed,
      ...(dependent ? { parentItemId } : {}) })
  }

  return (
    <section aria-labelledby="content-form-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 id="content-form-heading" className="text-xl font-semibold text-blue-950">{item ? `Edit ${labels[kind]}` : 'Create content'}</h3>
      <p className="mt-1 text-sm text-slate-600">Saving creates a draft revision. Review and publication are separate actions.</p>
      <form onSubmit={event => { void submit(event) }} className="mt-5 space-y-4">
        <div>
          <label htmlFor="content-kind" className="block text-sm font-medium text-slate-800">Content family</label>
          <select id="content-kind" value={kind} disabled={Boolean(item) || busy}
            onChange={event => {
              const next = contentKind.safeParse(event.target.value)
              if (next.success) { setKind(next.data); setParentItemId(''); setValidation('') }
            }}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900">
            {(item ? [item.kind] : availableKinds).map(candidate => <option key={candidate} value={candidate}>{labels[candidate]}</option>)}
          </select>
        </div>
        {dependent && !item && <div>
          <label htmlFor="content-parent" className="block text-sm font-medium text-slate-800">Theory question</label>
          <select id="content-parent" value={parentItemId} required onChange={event => setParentItemId(event.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900">
            <option value="">Select a theory question</option>
            {theoryOptions.map(candidate => <option key={candidate.item_id} value={candidate.item_id}>
              {stringField(candidate.payload, 'prompt').slice(0, 100) || `Theory revision ${candidate.current_revision}`}
            </option>)}
          </select>
          {theoryOptions.length === 0 && <p className="mt-1 text-sm text-amber-800">Create a theory question first, or edit its existing {labels[kind].toLowerCase()}.</p>}
        </div>}
        {(kind === 'course_overview' || kind === 'note') && <div>
          <label htmlFor="content-title" className="block text-sm font-medium text-slate-800">Title</label>
          <input id="content-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={240}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
        </div>}
        {(kind === 'cbt_question' || kind === 'theory_question') && <div>
          <label htmlFor="content-prompt" className="block text-sm font-medium text-slate-800">Question wording</label>
          <textarea id="content-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} required rows={5}
            maxLength={kind === 'cbt_question' ? 10000 : 20000}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
        </div>}
        {kind === 'cbt_question' && <>
          <div><label htmlFor="content-options" className="block text-sm font-medium text-slate-800">Options, one per line</label>
            <textarea id="content-options" value={options} onChange={event => setOptions(event.target.value)} required rows={5}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" /></div>
          <div><label htmlFor="content-correct" className="block text-sm font-medium text-slate-800">Correct option</label>
            <select id="content-correct" value={correctOption} onChange={event => setCorrectOption(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900">
              {Array.from({ length: 8 }, (_, index) => <option key={index} value={index}>Option {index + 1}</option>)}
            </select></div>
          <div><label htmlFor="content-section" className="block text-sm font-medium text-slate-800">Section (optional)</label>
            <input id="content-section" value={section} onChange={event => setSection(event.target.value)} maxLength={240}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" /></div>
          <div><label htmlFor="content-explanation" className="block text-sm font-medium text-slate-800">Explanation (optional)</label>
            <textarea id="content-explanation" value={explanation} onChange={event => setExplanation(event.target.value)} rows={3} maxLength={10000}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" /></div>
          {item && <p className="text-xs text-slate-600">This edit keeps the question’s permanent attempt-history identity.</p>}
        </>}
        {kind === 'theory_question' && <div>
          <label htmlFor="content-exam-tip" className="block text-sm font-medium text-slate-800">Exam tip (optional)</label>
          <textarea id="content-exam-tip" value={examTip} onChange={event => setExamTip(event.target.value)} rows={3} maxLength={10000}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
        </div>}
        {(kind === 'course_overview' || kind === 'note' || dependent) && <div>
          <label htmlFor="content-body" className="block text-sm font-medium text-slate-800">{dependent ? 'Content' : 'Body'}</label>
          <textarea id="content-body" value={body} onChange={event => setBody(event.target.value)} required rows={10} maxLength={200000}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
        </div>}
        {item && (kind === 'course_overview' || kind === 'note') &&
          Object.keys(item.payload).some(key => key !== 'title' && key !== 'body') &&
          <p className="text-xs text-slate-600">Structured study fields in this item are preserved when you save its title or body.</p>}
        {validation && <p role="alert" className="text-sm text-red-700">{validation}</p>}
        <button type="submit" disabled={busy || (dependent && !item && theoryOptions.length === 0)}
          className="rounded-md bg-blue-900 px-4 py-2 font-medium text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-700 focus:ring-offset-2 disabled:opacity-60">
          {busy ? 'Saving…' : item ? 'Save new revision' : 'Create draft'}
        </button>
      </form>
    </section>
  )
}
