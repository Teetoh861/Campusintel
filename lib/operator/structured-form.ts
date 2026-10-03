// lib/operator/structured-form.ts — Preserve validated overview and note fields in editable drafts.
import { courseOverviewContent, noteContent } from './editor-contract'
import type { CourseOverviewPayload, NotePayload } from './editor-contract'

export type OverviewDraft = {
  topics?: CourseOverviewPayload['topics']
  examFocus?: CourseOverviewPayload['examFocus']
  keyTakeaways?: CourseOverviewPayload['keyTakeaways']
  formulaSheet?: CourseOverviewPayload['formulaSheet']
}

export type NoteFormat = 'generic' | 'topic_note' | 'calculator_trick'
export type NoteDraft =
  | { format: 'generic' }
  | { format: 'topic_note'; keyPoints: string[]; examTip: string }
  | { format: 'calculator_trick'; example: string; formula: string }

/** Load every supported overview field, retaining absent and empty collections distinctly. */
export function initialOverviewDraft(payload?: unknown): OverviewDraft | null {
  if (payload === undefined) return {}
  const parsed = courseOverviewContent.safeParse(payload)
  if (!parsed.success) return null
  const value = parsed.data
  return {
    topics: value.topics?.map(entry => ({ ...entry })),
    examFocus: value.examFocus?.slice(),
    keyTakeaways: value.keyTakeaways?.map(entry => ({ ...entry })),
    formulaSheet: value.formulaSheet?.map(entry => ({ ...entry })),
  }
}

/** Select a note subtype explicitly while creating a new note. */
export function emptyNoteDraft(format: NoteFormat): NoteDraft {
  if (format === 'topic_note') return { format, keyPoints: [], examTip: '' }
  if (format === 'calculator_trick') return { format, example: '', formula: '' }
  return { format: 'generic' }
}

/** Load the existing note subtype and all of its supported fields. */
export function initialNoteDraft(payload?: unknown): NoteDraft | null {
  if (payload === undefined) return emptyNoteDraft('generic')
  const parsed = noteContent.safeParse(payload)
  if (!parsed.success) return null
  const value = parsed.data
  if ('noteType' in value && value.noteType === 'topic_note') {
    return { format: 'topic_note', keyPoints: value.keyPoints.slice(), examTip: value.examTip ?? '' }
  }
  if ('noteType' in value && value.noteType === 'calculator_trick') {
    return { format: 'calculator_trick', example: value.example, formula: value.formula ?? '' }
  }
  return emptyNoteDraft('generic')
}

/** Build the exact overview contract without inventing absent optional collections. */
export function overviewPayload(title: string, body: string, draft: OverviewDraft): CourseOverviewPayload {
  return {
    title, body,
    ...(draft.topics === undefined ? {} : { topics: draft.topics }),
    ...(draft.examFocus === undefined ? {} : { examFocus: draft.examFocus }),
    ...(draft.keyTakeaways === undefined ? {} : { keyTakeaways: draft.keyTakeaways }),
    ...(draft.formulaSheet === undefined ? {} : { formulaSheet: draft.formulaSheet }),
  }
}

/** Build only the chosen note subtype; blank optional text is deliberately omitted. */
export function notePayload(title: string, body: string, draft: NoteDraft): NotePayload {
  if (draft.format === 'topic_note') return {
    title, body, noteType: 'topic_note', keyPoints: draft.keyPoints,
    ...(draft.examTip === '' ? {} : { examTip: draft.examTip }),
  }
  if (draft.format === 'calculator_trick') return {
    title, body, noteType: 'calculator_trick', example: draft.example,
    ...(draft.formula === '' ? {} : { formula: draft.formula }),
  }
  return { title, body }
}
