// lib/campus-bot/flashcards.ts — Make flashcards in Ask Campus Bot (owner decision B5, mock 8): what the model's cards
// become before a student sees them. Every guard is deterministic, so a card is shown only when it is plain text,
// within its length, says something, is not a repeat, and names something the notes sent with the request contain.
import { FLASHCARD_LIMITS } from './contract'
import { comparable, hasEmoji, plainText, wordForms } from './reply-text'
import type { Flashcard } from './contract'
import type { NotesContext } from './notes-context'

/** Which guard changed or dropped what the model wrote: kept for the human review, never shown, stored or logged. */
export type FlashcardGuard = 'emoji-removed' | 'bold-removed' | 'empty-side' | 'too-long' | 'meaning-repeats-term'
  | 'repeated-term' | 'term-not-in-notes' | 'over-ten-cards' | 'too-few-cards'

/** A card a guard dropped, for the human review only. */
export type DroppedFlashcard = { term: string; meaning: string; guard: FlashcardGuard }

/** A field as one line of plain text: no emoji, no bold or other markdown markers, whitespace collapsed. */
function plainField(value: string): string {
  return plainText(value).replace(/\s+/g, ' ').trim()
}

// A word of a term or of the notes: letters and digits, with a possessive 's taken off ("Porter's" is "porter").
function wordsIn(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu) ?? [])
    .map(word => word.replace(/['’]s$/u, '').replace(/['’]/gu, ''))
}
const letterCount = (word: string): number => (word.match(/\p{L}/gu) ?? []).length

/** The words of the notes sent with a request (each passage's topic, heading and text), in all their simple forms. */
export function notesWords(notes: NotesContext): ReadonlySet<string> {
  return new Set(notes.passages.flatMap(passage => wordsIn(`${passage.topicTitle} ${passage.heading} ${passage.text}`))
    .flatMap(wordForms))
}

// Words that label a card rather than name its subject ("Hypothesis versus theory", "Slope formula").
const LABEL_WORDS = new Set(['versus', 'vs', 'formula', 'rule', 'definition', 'meaning', 'pattern', 'example', 'type', 'types'])

/** Whether a term names only what the notes contain. Its words of 3 or more letters are checked, leaving out words in
 *  brackets and label words, ignoring case, punctuation and a possessive 's, and matching simple endings (s, es,
 *  ies/y, ing, ed, al: "strategy" is "strategies"). A term with 3 or more such words may miss one of them. */
export function termInNotes(term: string, words: ReadonlySet<string>): boolean {
  const checked = wordsIn(term.replace(/\([^)]*\)|\[[^\]]*\]/g, ' '))
    .filter(word => letterCount(word) >= 3 && !LABEL_WORDS.has(word))
  const missing = checked.filter(word => !wordForms(word).some(form => words.has(form))).length
  return missing === 0 || (checked.length >= 3 && missing === 1)
}

/**
 * The flashcards a student may see, or null when the model's answer is not a list of cards at all. `cards` is what
 * survives the guards, in the model's order, at most 10; fewer than 4 left is no set (`cards` empty, guard
 * too-few-cards): the reply is released and not charged. In order, each field becomes plain text (emoji and bold
 * markers removed, whitespace collapsed), then a card is dropped when a side is empty, the term is over 80 characters or
 * the meaning over 200, the meaning only repeats the term, the term repeats an earlier one (any case), or the term names
 * something the notes sent do not contain.
 */
export function readFlashcards(json: unknown, notes: NotesContext):
  { cards: Flashcard[]; guards: FlashcardGuard[]; dropped: DroppedFlashcard[] } | null {
  if (typeof json !== 'object' || json === null) return null
  const raw = (json as Record<string, unknown>).cards
  if (!Array.isArray(raw)) return null
  if (!raw.every(card => typeof card === 'object' && card !== null
      && typeof (card as Record<string, unknown>).term === 'string'
      && typeof (card as Record<string, unknown>).meaning === 'string')) return null
  const guards = new Set<FlashcardGuard>()
  const dropped: DroppedFlashcard[] = []
  const words = notesWords(notes)
  const seen = new Set<string>()
  const kept: Flashcard[] = []
  for (const card of raw as Array<{ term: string; meaning: string }>) {
    if (hasEmoji(card.term) || hasEmoji(card.meaning)) guards.add('emoji-removed')
    if (/\*\*|__/.test(card.term) || /\*\*|__/.test(card.meaning)) guards.add('bold-removed')
    const term = plainField(card.term)
    const meaning = plainField(card.meaning)
    const drop = (guard: FlashcardGuard): void => { guards.add(guard); dropped.push({ term, meaning, guard }) }
    if (term === '' || meaning === '') { drop('empty-side'); continue }
    if (term.length > FLASHCARD_LIMITS.termChars || meaning.length > FLASHCARD_LIMITS.meaningChars) {
      drop('too-long'); continue
    }
    if (comparable(meaning) === comparable(term)) { drop('meaning-repeats-term'); continue }
    const key = comparable(term)
    if (seen.has(key)) { drop('repeated-term'); continue }
    if (!termInNotes(term, words)) { drop('term-not-in-notes'); continue }
    seen.add(key)
    kept.push({ term, meaning })
  }
  if (kept.length > FLASHCARD_LIMITS.maxCards) {
    guards.add('over-ten-cards')
    for (const card of kept.slice(FLASHCARD_LIMITS.maxCards)) dropped.push({ ...card, guard: 'over-ten-cards' })
  }
  const cards = kept.slice(0, FLASHCARD_LIMITS.maxCards)
  if (cards.length < FLASHCARD_LIMITS.minCards) {
    guards.add('too-few-cards')
    return { cards: [], guards: [...guards], dropped }
  }
  return { cards, guards: [...guards], dropped }
}
