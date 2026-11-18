// lib/campus-bot/reply-text.ts — What Campus Bot's words and a student's words become before they are used: a reply is
// plain text within its length, and a student's message carries no contact details and cannot close a data block.

/** Length of a reply in words: what the prompt asks for, and the most a page ever shows (owner's caps, with slack). */
export const REPLY_WORDS = {
  explain: { target: 120, ceiling: 150 },
  chat: { target: 150, ceiling: 190 },
} as const

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/)
  return words.length === 1 && words[0] === '' ? 0 : words.length
}

/** A reply as plain text: no control characters, no leftover markdown markers, tidy spacing. Never HTML: pages render
 *  it as text, so a tag would only ever show as its own characters. */
export function plainText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\t/g, ' ')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[ ]*#{1,6}[ ]+/gm, '')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim()
}

/** Keep a reply within its ceiling by ending it at a sentence, never mid-sentence unless one sentence is the whole of it. */
export function capWords(text: string, ceiling: number): string {
  if (wordCount(text) <= ceiling) return text
  // Sentences and the spacing between them, alternately: a figure such as 3.5 is never taken for a sentence end.
  const parts = text.split(/(?<=[.!?]["’”)]*)(\s+)/)
  let kept = ''
  for (let index = 0; index < parts.length; index += 2) {
    const next = kept + (index === 0 ? '' : parts[index - 1] ?? ' ') + (parts[index] ?? '')
    if (wordCount(next) > ceiling) break
    kept = next
  }
  if (kept.trim() !== '') return kept.trim()
  return `${text.trim().split(/\s+/).slice(0, ceiling).join(' ')}…`
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi
// Nigerian mobile numbers, with or without the country code and separators. Sums and figures are left alone.
const PHONE = /(?:\+?234[\s-]?|\b0)[789][01](?:[\s-]?\d){8}\b/g

/** Remove contact details from what a student typed before it is sent anywhere. */
export function redactPersonal(text: string): string {
  return text.replace(EMAIL, '[removed]').replace(PHONE, '[removed]')
}

/** Text placed inside a block of a prompt can never read as a tag: not the end of its own block, not the start of
 *  another. A space after the bracket is all it takes, and "x<y" in a sum still reads as it did. */
export function neutraliseTags(value: string): string {
  return value.replace(/<(\/?)(?=[a-z_!])/gi, '<$1 ')
}

/** A student's words as data for a prompt: no control characters, no contact details, nothing that reads as a tag. */
export function studentText(value: string, maxChars: number): string {
  return neutraliseTags(redactPersonal(value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')))
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, maxChars)
}

const LETTERS = 'ABCDEFGH'
export function optionLetter(index: number): string {
  return LETTERS[index] ?? '?'
}

/** A safety net, not a proof: an explanation that states a different option is the correct one, or says the official
 *  one is not, is never shown. Matched in any case ("Correct answer is b."), letters compared in capitals. */
export function namesAnotherOption(text: string, correctOption: number, optionCount: number): boolean {
  const correct = optionLetter(correctOption)
  const letters = LETTERS.slice(0, Math.max(0, Math.min(optionCount, LETTERS.length)))
  if (letters === '') return false
  const option = `(?:option\\s+|choice\\s+|answer\\s+)?\\(?([${letters}])\\b\\)?`
  // Only a bare lowercase "a" before a word is an article: uppercase A, "option a" and "(a)" are option claims.
  const isArticle = (match: RegExpMatchArray): boolean => match[1] === 'a'
    && /\b(?:is|be|not)\s+a$/i.test(match[0])
    && /^\s+\w/.test(text.slice((match.index ?? 0) + match[0].length))
  const claims = [
    // "The correct answer is B", "the right option should be (b)".
    new RegExp(`\\b(?:correct|right)\\s+(?:answer|option|choice)\\s+(?:is|should\\s+be|would\\s+be)\\s+${option}`, 'gi'),
    // "B is the correct answer", "option b is actually right".
    new RegExp(`\\b${option}\\s+is\\s+(?:actually\\s+|really\\s+)?(?:the\\s+)?(?:correct|right)\\b`, 'gi'),
  ]
  if (claims.some(pattern => [...text.matchAll(pattern)].some(match => !isArticle(match)
      && match[1].toUpperCase() !== correct))) return true
  // The official answer denied: "A is not correct", "option A is wrong", "the answer is not A".
  const official = `(?:option\\s+|choice\\s+|answer\\s+)?\\(?(${correct})\\b\\)?`
  const qualifiers = `(?:(?:actually|really|entirely)\\s+)*`
  const denials = [
    new RegExp(`\\b${official}\\s+(?:(?:is|was)\\s+(?:not|never)|(?:isn|wasn)['’]t)\\s+${qualifiers}(?:the\\s+)?(?:correct|right|answer)\\b`, 'gi'),
    new RegExp(`\\b${official}\\s+(?:is|was)\\s+${qualifiers}(?:wrong|incorrect|false)\\b`, 'gi'),
    new RegExp(`\\b(?:correct|right)?\\s*(?:answer|option|choice)\\s+(?:is|was)\\s+not\\s+${official}`, 'gi'),
  ]
  return denials.some(pattern => [...text.matchAll(pattern)].some(match => !isArticle(match)))
}
