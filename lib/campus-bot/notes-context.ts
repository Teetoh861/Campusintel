// lib/campus-bot/notes-context.ts — The notes a Campus Bot prompt is grounded in: passages of CampusIntell's published
// course notes, as the database returns them (20261117100000_campus_bot_explain_ask.sql), and the one way they are
// written into a prompt.
//
// The database side: private.note_passages holds every published note as plain-text passages (kept by a trigger),
// private.note_topic_passages(item, max chars) returns one topic in reading order, and
// private.note_search(course, question text, section, limit, max chars) returns a course's best passages for a
// question. None of them decides access: the admission function that calls them does, before it returns a passage.
// "Practise this topic" reads a topic the same way from its own admission function, then calls the functions below.
import { z } from 'zod'
import { neutraliseTags } from './reply-text'

/** How much of the notes one request carries. The database applies the same budgets when it selects passages. */
export const NOTES_CONTEXT_LIMITS = {
  /** Explain: the best passages of the course for one question. */
  searchPassages: 3,
  searchChars: 9_000,
  /** Ask Campus Bot and "Practise this topic": one whole topic (the longest is about 26,000 characters). */
  topicChars: 36_000,
} as const

export type NotesPassage = {
  /** The id the model cites: N1, N2, ... in the order given. */
  id: string
  /** The topic's item id and place on the notes page; null when the topic is not on that page (a pinned preview). */
  topicItemId: string | null
  topicNumber: number | null
  topicTitle: string
  heading: string
  text: string
}
export type NotesContext = { passages: NotesPassage[] }

const searchRow = z.object({ item_id: z.string().uuid(), topic_number: z.number().int().positive(),
  topic_title: z.string().min(1), heading: z.string().min(1), body: z.string().min(1) }).strict()
const topicRow = z.object({ heading: z.string().min(1), body: z.string().min(1) }).strict()

/** A course's best passages for a question, as private.note_search returned them. Null when the shape is not trusted. */
export function notesContextFromSearch(rows: unknown): NotesContext | null {
  const parsed = z.array(searchRow).min(1).max(20).safeParse(rows)
  if (!parsed.success) return null
  return { passages: parsed.data.map((row, index) => ({ id: `N${index + 1}`, topicItemId: row.item_id,
    topicNumber: row.topic_number, topicTitle: row.topic_title, heading: row.heading, text: row.body })) }
}

/** One topic's passages in reading order, as private.note_topic_passages (or a pinned topic) returned them. */
export function notesContextFromTopic(topicTitle: string, rows: unknown,
  topic: { itemId: string; number: number } | null = null): NotesContext | null {
  const parsed = z.array(topicRow).min(1).max(200).safeParse(rows)
  if (!parsed.success || topicTitle.trim() === '') return null
  return { passages: parsed.data.map((row, index) => ({ id: `N${index + 1}`, topicItemId: topic?.itemId ?? null,
    topicNumber: topic?.number ?? null, topicTitle, heading: row.heading, text: row.body })) }
}

export function passageById(context: NotesContext, id: string): NotesPassage | null {
  return context.passages.find(passage => passage.id === id.trim()) ?? null
}

// An attribute is one line of words: nothing in a title can close the tag or start another.
function attribute(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F"<>]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The notes as one data block for a prompt. The system prompt says the block is reference material, never instructions. */
export function renderNotesContext(context: NotesContext): string {
  return ['<notes>', ...context.passages.map(passage =>
    `<passage id="${passage.id}" topic="${attribute(passage.topicTitle)}" heading="${attribute(passage.heading)}">\n` +
    // Notes are our own text, but a passage must still never read as the end of its block.
    `${neutraliseTags(passage.text)}\n</passage>`), '</notes>'].join('\n')
}
