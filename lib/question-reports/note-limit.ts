// lib/question-reports/note-limit.ts — The one report-note length contract, counted in Unicode code points on every layer.

export const REPORT_NOTE_MAX_CHARACTERS = 1000

/** Length in Unicode code points, so an emoji counts once on the client exactly as it does in the schema. */
export function noteLength(value: string): number {
  return Array.from(value).length
}

/** Whether a note fits the shared limit. */
export function noteWithinLimit(value: string): boolean {
  return noteLength(value) <= REPORT_NOTE_MAX_CHARACTERS
}

/** Keep the first REPORT_NOTE_MAX_CHARACTERS code points; never splits a surrogate pair. */
export function clampNote(value: string): string {
  const points = Array.from(value)
  return points.length <= REPORT_NOTE_MAX_CHARACTERS ? value : points.slice(0, REPORT_NOTE_MAX_CHARACTERS).join('')
}
