// lib/ai-practice/topic-source.ts — One notes topic as the source of a Campus Bot set. The passages come from the
// notes-context helper (lib/campus-bot/notes-context.ts) exactly as the database returned them; here they become the
// addressable source the sets' validation checks every quote against (validate.ts), with their own ids (N1, N2, ...).
import 'server-only'
import { createHash } from 'node:crypto'
import type { NotesContext } from '@/lib/campus-bot/notes-context'
import type { PreparedSource, SourcePassage } from './source'

const PASSAGE_SEPARATOR = '\n\n'

const wordsIn = (text: string): number => text.split(/\s+/).filter(Boolean).length

/** The topic's passages, in reading order, as one source whose passages keep the ids the prompt shows. */
export function topicPreparedSource(notes: NotesContext): PreparedSource {
  const passages: SourcePassage[] = []
  let text = ''
  for (const passage of notes.passages) {
    if (text !== '') text += PASSAGE_SEPARATOR
    const start = text.length
    text += passage.text
    passages.push({ id: passage.id, start, end: text.length, text: passage.text })
  }
  return { text, sha256: createHash('sha256').update(text, 'utf8').digest('hex'), charCount: text.length,
    wordCount: wordsIn(text), passages }
}

// Every string a guide's inline text or blocks carry (paragraphs, list items, table cells, preformatted text).
function collectText(value: unknown, into: string[]): void {
  if (Array.isArray(value)) { for (const entry of value) collectText(entry, into); return }
  if (typeof value !== 'object' || value === null) return
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'text' && typeof entry === 'string') into.push(entry)
    else collectText(entry, into)
  }
}

/**
 * How many words a published note gives Campus Bot, counted from the same parts as the database's passages
 * (private.note_passages_of): a guide topic's "What you must know", lessons and recap, never its theory question; any
 * other note's body, points, tip, example and formula. The database's own count is never lower than this one, so a
 * topic this offers a quiz on is one the database accepts.
 */
export function noteWords(note: object): number {
  const payload = note as Record<string, unknown>
  const texts: string[] = []
  if (payload.noteType === 'guide_topic') {
    collectText(payload.mustKnow, texts)
    collectText(payload.introMore, texts)
    if (Array.isArray(payload.lessons)) {
      for (const lesson of payload.lessons) {
        if (typeof lesson === 'object' && lesson !== null) {
          collectText((lesson as Record<string, unknown>).mustKnow, texts)
          collectText((lesson as Record<string, unknown>).explainMore, texts)
        }
      }
    }
    collectText(payload.recap, texts)
  } else {
    for (const key of ['body', 'examTip', 'example', 'formula'] as const) {
      if (typeof payload[key] === 'string') texts.push(payload[key] as string)
    }
    if (Array.isArray(payload.keyPoints)) {
      for (const point of payload.keyPoints) if (typeof point === 'string') texts.push(point)
    }
  }
  return texts.reduce((total, text) => total + wordsIn(text), 0)
}
