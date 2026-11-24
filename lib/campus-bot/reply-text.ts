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
export function plainText(value: string, { keepBold = false }: { keepBold?: boolean } = {}): string {
  return stripEmoji(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\t/g, ' ')
    .replace(keepBold ? /__|`/g : /\*\*|__|`/g, '')
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

// A verdict word or phrase at the start of a marked reply. The page shows the verdict as its own badge, so a reply that
// opened with one could only repeat it or, worse, contradict it ("Yes" on a wrong answer). Each is removed only when
// punctuation follows it (or nothing does), so "No two firms…" or "Right-angled…" are left alone; "Yes"/"Yeah"/"Yep"
// and "Nope" also go when a plain space follows, since no sentence about a topic starts with them.
const VERDICT_PHRASES = [
  "that(?:'|’)?s (?:not )?(?:quite )?(?:right|correct|wrong|it)", 'that is (?:not )?(?:quite )?(?:right|correct|wrong|it)',
  "you(?:'|’)?re (?:not )?(?:quite )?(?:right|correct|wrong)", 'you are (?:not )?(?:quite )?(?:right|correct|wrong)',
  "you(?:'|’)?ve got it", 'you got it', 'not quite(?: right)?', 'not exactly', 'not really', 'well done', 'good job',
  'great job', 'nice work', 'spot on', 'close but not quite', 'almost', 'close', 'exactly', 'precisely', 'absolutely',
  'perfect', 'great', 'good', 'correct', 'incorrect', 'right', 'wrong', 'true', 'false', 'yes', 'yeah', 'yep', 'no',
  'nope', 'sorry',
]
const LEADING_VERDICT = new RegExp(
  `^(?:(?:${VERDICT_PHRASES.join('|')})(?:\\s*[,.!:;?…—–]+|\\s+-(?=\\s)|\\s*$)|(?:yes|yeah|yep|nope)\\s)\\s*`, 'i')

// A short opening phrase that starts with a praise or verdict word and ends with punctuation: "Right answer for the
// right reason:", "Spot on!", "Great job,", "Well done.". Up to five more words before a colon, comma, semicolon, dash or
// exclamation mark; at most two before a full stop, so a short sentence of the reply ("Correct pricing needs data.")
// is left alone. "No" and "Not" start ordinary sentences too often to open a phrase here; their own phrases are above.
const PRAISE_WORDS = ['yes', 'yeah', 'yep', 'correct', 'incorrect', 'right', 'wrong', 'exactly', 'precisely', 'absolutely',
  'perfect', 'great', 'good', 'nice', 'well', 'excellent', 'brilliant', 'spot', 'bravo', 'awesome', 'fantastic', 'superb',
  'lovely', 'almost', 'close', 'nearly', 'sorry', 'oops']
const PHRASE_WORD = '[^\\s,.!:;?…—–]+'
const PRAISE_OPENER = new RegExp(`^(?:${PRAISE_WORDS.join('|')})\\b(?:[ ]+${PHRASE_WORD}){0,5}[ ]*(?:[,!:;?…—–]+|[ ]-(?=\\s))\\s*`, 'i')
const PRAISE_SENTENCE = new RegExp(`^(?:${PRAISE_WORDS.join('|')})\\b(?:[ ]+${PHRASE_WORD}){0,2}[ ]*\\.+(?=\\s|$)\\s*`, 'i')

/** A marked reply without the verdict words or praise phrase it opened with, first letter in capitals. Several in a row
 *  ("Yes, correct!", "Spot on! Well done.") all go. A reply that was nothing but a verdict comes back empty. */
export function stripLeadingVerdict(text: string): { text: string; stripped: boolean } {
  let rest = text.trimStart()
  let stripped = false
  for (;;) {
    const match = [LEADING_VERDICT, PRAISE_OPENER, PRAISE_SENTENCE].map(pattern => pattern.exec(rest))
      .find(found => found !== null && found[0] !== '')
    if (!match) break
    rest = rest.slice(match[0].length)
    stripped = true
  }
  return { text: stripped ? rest.charAt(0).toUpperCase() + rest.slice(1) : text, stripped }
}

// Emoji (owner rule: none, ever): characters shown as emoji by default, a pictograph made one by U+FE0F, joiners, skin
// tones, keycaps and flags. Text symbols the notes use (→ ≠ ≡ ¶ ₦ ✓, and © or ™ without U+FE0F) are kept.
const EMOJI = /\p{Extended_Pictographic}\uFE0F|\p{Emoji_Presentation}|[\u{1F3FB}-\u{1F3FF}\u200D\uFE0F\u20E3]/gu

/** Whether text holds an emoji. */
export function hasEmoji(text: string): boolean {
  return new RegExp(EMOJI.source, 'u').test(text)
}

/** Text without emoji, and without the spacing they left. */
export function stripEmoji(text: string): string {
  return hasEmoji(text) ? text.replace(EMOJI, '').replace(/[ ]{2,}/g, ' ').replace(/[ ]+([.,!?;:])/g, '$1') : text
}

/** Bold key words in an Ask reply, each marked with double asterisks: at most 3 spans in the reply or the check
 *  question, and 4 in a memory trick, so a pair of first-letter matches shows as mock 8 draws it ("**S**tatistic goes
 *  with **S**ample, **P**arameter goes with **P**opulation"). */
export const BOLD_MAX = 3
export const BOLD_MAX_MEMORY_TRICK = 4
const BOLD_TERM_CHARS = 80

/**
 * A field's text without its bold markers, and the terms they marked in order. `terms` is null when the markers are
 * unusable (unpaired, more than `max`, empty, too long or across lines): the field is then shown without any.
 */
export function boldTerms(text: string, max: number = BOLD_MAX): { plain: string; terms: string[] | null } {
  const parts = text.split('**')
  const plain = parts.join('')
  if (parts.length === 1) return { plain, terms: [] }
  const terms = parts.filter((_, index) => index % 2 === 1)
  const usable = parts.length % 2 === 1 && terms.length <= max
    && terms.every(term => term.trim() !== '' && term === term.trim() && term.length <= BOLD_TERM_CHARS && !term.includes('\n'))
  return { plain, terms: usable ? terms : null }
}

/** Mark the terms again in text the guards have finished with: each at its next occurrence, in order. A term the
 *  guards removed is left unmarked. */
export function markTerms(text: string, terms: ReadonlyArray<string>): string {
  let out = ''
  let from = 0
  for (const term of terms) {
    const at = text.indexOf(term, from)
    if (at < 0) continue
    out += `${text.slice(from, at)}**${term}**`
    from = at + term.length
  }
  return out + text.slice(from)
}

/** Text in spans, bold or not, for a page to render as elements. Unpaired markers are shown as plain text. */
export function boldSpans(text: string): Array<{ text: string; bold: boolean }> {
  const parts = text.split('**')
  if (parts.length === 1 || parts.length % 2 === 0) return [{ text: parts.join(''), bold: false }]
  return parts.map((part, index) => ({ text: part, bold: index % 2 === 1 })).filter(span => span.text !== '')
}

// Words a check question's answer can share with anything; they say nothing about the answer itself.
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or'])

/** The words of a text, lower case, for whole-word comparison. Phonetic notation such as /h/ or [h] is one word. */
export function wordsOf(text: string): string[] {
  return text.toLowerCase().split(/\s+/).flatMap(chunk => {
    const notation = /^[^\p{L}\p{N}/[\]]*([/[][\p{L}\p{N}ː:.]+[/\]])[^\p{L}\p{N}]*$/u.exec(chunk)
    return notation ? [notation[1]!] : chunk.match(/[\p{L}\p{N}]+/gu) ?? []
  })
}

/** The words of a check question's answer worth comparing: not in the question already, not a stop word, and at least
 *  3 characters unless they hold a digit (phonetic notation always counts). */
export function answerWords(answer: string, question: string): string[] {
  const asked = new Set(wordsOf(question))
  return [...new Set(wordsOf(answer))].filter(word => !asked.has(word) && !STOP_WORDS.has(word)
    && (word.length >= 3 || /\d/.test(word) || /^[/[]/.test(word)))
}

/** Where a check question's answer is given away: in the reply (all its words there), only in the memory trick, or
 *  nowhere. A question that holds the whole answer (one offering options) gives nothing away. Whole words, any case. */
export function answerLeak(answer: string, question: string, reply: string, memoryTrick: string): 'none' | 'reply' | 'memory-trick' {
  const words = answerWords(answer, question)
  if (words.length === 0) return 'none'
  const all = (text: string) => { const have = new Set(wordsOf(text)); return words.every(word => have.has(word)) }
  return all(reply) ? 'reply' : all(memoryTrick) ? 'memory-trick' : 'none'
}

// A standard English stopword list (NLTK's, with would, could, might, must and shall): words a question shares with any
// reply, which say nothing about what it asks.
const ENGLISH_STOPWORDS = new Set(('i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her '
  + 'hers herself it its itself they them their theirs themselves what which who whom this that these those am is are was were be '
  + 'been being have has had having do does did doing a an the and but if or because as until while of at by for with about '
  + 'against between into through during before after above below to from up down in out on off over under again further then '
  + 'once here there when where why how all any both each few more most other some such no nor not only own same so than too '
  + 'very s t can will just don should now would could might must shall also its').split(' '))

/** The options a question offers, in groups: "voiced or voiceless", "physical, physiological or psychological", or a
 *  stem's "Is 31 a parameter or a statistic?" (the left option as long as the right one). A group set off by punctuation
 *  on both sides comes first; a stem's group after it. Bold markers are ignored. */
export function questionOptions(question: string): string[][] {
  const plain = question.replace(/\*\*/g, '')
  // The question's segments, with the punctuation that ends each one (a comma, a colon, the question mark).
  const pieces = plain.split(/(\s*[,;:?!()]\s*|\.\s+)/)
  const segments = pieces.filter((_, at) => at % 2 === 0).map(segment => segment.trim())
  const ending = pieces.filter((_, at) => at % 2 === 1).map(mark => mark.trim())
  const articleAt = (words: string[]) =>
    words.findLastIndex((word, at) => at >= words.length - 4 && /^(?:a|an|the)$/i.test(word))
  const pure: string[][] = []
  const stems: string[][] = []
  segments.forEach((segment, index) => {
    const parts = segment.split(/\s+or\s+/i)
    if (parts.length !== 2 || !parts[0] || !parts[1]) return
    const fullRight = parts[1].trim().replace(/^["'“‘]+|["'”’.]+$/g, '').split(/\s+/)
    // "a receptive or a productive skill": an option that starts with an article starts the left one at its own article.
    const article = /^(?:a|an|the)$/i.test(fullRight[0]!)
    // "receptive or productive skill in this course": past four words, a phrase both options share follows the second
    // one, so the options are the words either side of "or".
    const rightWords = fullRight.length <= 4 ? fullRight : fullRight.slice(0, article ? 2 : 1)
    const right = rightWords.join(' ')
    const size = rightWords.length
    const leftWords = parts[0].trim().split(/\s+/)
    const left = article && articleAt(leftWords) >= 0 ? leftWords.slice(articleAt(leftWords)) : leftWords.slice(-size)
    const group = [left.join(' ').replace(/^["'“‘]+|["'”’]+$/g, ''), right]
    // A list: earlier comma-separated items as long as the last one ("physical, physiological or psychological"). When
    // the list ends the question, its first item may follow the stem ("Is 31 a parameter, a statistic or a sample?").
    const endsQuestion = segments.slice(index + 1).every(rest => rest === '') && [undefined, '?'].includes(ending[index])
    for (let before = index - 1; before >= 0 && leftWords.length === left.length; before -= 1) {
      const itemWords = segments[before]!.split(/\s+/).filter(Boolean)
      if (ending[before] !== ',' || itemWords.length === 0) break
      if (itemWords.length === size) { group.unshift(itemWords.join(' ')); continue }
      const first = article ? articleAt(itemWords) : itemWords.length - size
      if (endsQuestion && first > 0) group.unshift(itemWords.slice(first).join(' '))
      break
    }
    ;(leftWords.length === left.length ? pure : stems).push(group)
  })
  return [...pure, ...stems]
}

/** A check question's final instruction, such as "Answer with a single word." or "Give the one word for …", removed: the
 *  question itself asks for the answer. Only a sentence after the question mark goes. */
export function stripCheckInstruction(text: string): { text: string; stripped: boolean } {
  const match = /^([\s\S]*\?)\s+((?:answer|give|reply|respond|write|use|type|name|state|just|in one|one word)\b[^?]*)$/i.exec(text.trim())
  return match ? { text: match[1]!.trim(), stripped: true } : { text: text.trim(), stripped: false }
}

/** The sentences of a text. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?]["’”)]*)\s+(?=\S)/).filter(sentence => sentence.trim() !== '')
}

/**
 * Where a question that offers its own answer gives it away anyway: a sentence of the reply (or, failing that, of the
 * memory trick) holds the answer and one of the question's other key words, so the question only echoes what was just
 * said ("/s/ is voiceless" then "Is /s/ voiced or voiceless?"). Key words: 4 letters or more, numbers or phonetic notation;
 * not an option, not a stopword, not the answer. 'none' for a question that does not contain its answer.
 */
export function echoLeak(answer: string, question: string, reply: string, memoryTrick: string): 'none' | 'reply' | 'memory-trick' {
  const answerSet = new Set(wordsOf(answer).filter(word => !ENGLISH_STOPWORDS.has(word)))
  const asked = new Set(wordsOf(question))
  if (answerSet.size === 0 || ![...answerSet].every(word => asked.has(word))) return 'none'
  const options = new Set(questionOptions(question).flat().flatMap(option => wordsOf(option)))
  const keys = [...asked].filter(word => !answerSet.has(word) && !options.has(word) && !ENGLISH_STOPWORDS.has(word)
    && (word.length >= 4 || /\d/.test(word) || /^[/[]/.test(word)))
  if (keys.length === 0) return 'none'
  const echoes = (text: string) => sentences(text).some(sentence => {
    const have = new Set(wordsOf(sentence))
    return [...answerSet].every(word => have.has(word)) && keys.some(word => have.has(word))
  })
  return echoes(reply) ? 'reply' : echoes(memoryTrick) ? 'memory-trick' : 'none'
}

// A reply that only introduces a question ("Here's one.", "Sure, here's a quick question:"). Matched as a whole, so a
// short reply of another kind ("You're welcome.", "Here it is.") is never taken for one.
const LEAD_IN = new RegExp([
  '^(?:(?:sure|okay|ok|of course|alright|all right|good idea|great)[,.!]?\\s+)?(?:',
  "here(?:'s|’s| is)(?: (?:a|an|one|another|your))?(?: (?:quick|short|new|next|simple|practice))?",
  '(?: (?:one|question|check|quiz question|test question))?(?: for you)?(?: to (?:check|test|try|answer)[^.!?:]{0,40})?',
  '|try (?:this|another)(?: one| question)?',
  "|(?:let's|let’s|let us|let me) (?:test|check|quiz)(?: you| that| this| your understanding| what you know)?",
  '|answer this(?: one| question)?',
  ')\\s*[.!:…]*$',
].join(''), 'i')

/** Whether a reply is nothing but a lead-in to a question ("Here's one."): with no check question after it, the student
 *  has nothing to answer. Bold markers are ignored. */
export function isLeadIn(text: string): boolean {
  return LEAD_IN.test(text.replace(/\*\*/g, '').trim())
}

/** A memory trick's bold first letters match only when each letter is bolded at least twice (**S**tatistic, **S**ample). */
export function trickLettersMatch(terms: ReadonlyArray<string>): boolean {
  const letters = terms.filter(term => /^\p{L}$/u.test(term)).map(term => term.toLowerCase())
  return letters.every(letter => letters.filter(other => other === letter).length >= 2)
}

/** Text compared as a reader sees it: any case, any spacing, no punctuation around it. */
export function comparable(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().replace(/^[\s"'“”‘’.,!?:;()\[\]-]+|[\s"'“”‘’.,!?:;()\[\]-]+$/g, '')
}

// A label the model put on its own check question: the page adds its own ("Quick check", "Try another").
const CHECK_LABEL = /^(?:quick[ ]check|try[ ]another(?:[ ]one)?|check(?:[ ]question)?|question(?:[ ]\d+)?|q\d*)[ ]*[:.)\-–—]+\s*/i

/** A check question without the labels it opened with. */
export function stripCheckLabel(text: string): { text: string; stripped: boolean } {
  let rest = text.trim()
  let stripped = false
  for (let match = CHECK_LABEL.exec(rest); match !== null && match[0] !== ''; match = CHECK_LABEL.exec(rest)) {
    rest = rest.slice(match[0].length)
    stripped = true
  }
  return { text: stripped ? rest.charAt(0).toUpperCase() + rest.slice(1) : text.trim(), stripped }
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
