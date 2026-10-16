// lib/ai-practice/practice-boundary.ts — How personal AI sets meet the existing CBT practice experience.
// Client-safe: no server imports. Personal items reuse the quiz screens' presentation field names
// but carry no questionId, itemId or publishedRevision, so the official attempt API cannot accept,
// score or record them; personal scoring stays local to the student.
import type { PersonalPracticeQuestion, PersonalPracticeSet } from './contract'

/** Presentation shape aligned with ManagedQuizQuestion's display fields, minus official identity. */
export type PersonalPracticeItem = {
  origin: 'ai-personal-unverified'
  id: string
  question: string
  options: string[]
  correctAnswer: number
  section: string
  explanation: string
  sourceQuote: string
}

export type PersonalAttemptScore = {
  total: number
  answered: number
  correct: number
  results: { id: string; selected: number | null; correct: boolean }[]
}

/** The `cbt_question` editor payload an operator would review if a student flags a set for promotion. */
export type PromotionCandidatePayload = {
  prompt: string
  options: string[]
  correctOption: number
  section: string
  explanation: string
}

export function toPersonalPracticeItems(set: PersonalPracticeSet): PersonalPracticeItem[] {
  return set.questions.map(question => ({
    origin: 'ai-personal-unverified',
    id: question.id,
    question: question.prompt,
    options: [...question.options],
    correctAnswer: question.correctOption,
    section: question.section,
    explanation: question.explanation,
    sourceQuote: question.grounding.quote,
  }))
}

/** Score a personal run locally. Never sent to /api/quiz-attempts and never mixed with official results. */
export function scorePersonalAttempt(
  items: ReadonlyArray<PersonalPracticeItem>, answers: Readonly<Record<string, number>>,
): PersonalAttemptScore {
  const results = items.map(item => {
    const raw = Object.prototype.hasOwnProperty.call(answers, item.id) ? answers[item.id] : undefined
    const selected = Number.isInteger(raw) && raw! >= 0 && raw! < item.options.length ? raw! : null
    return { id: item.id, selected, correct: selected !== null && selected === item.correctAnswer }
  })
  return {
    total: items.length,
    answered: results.filter(result => result.selected !== null).length,
    correct: results.filter(result => result.correct).length,
    results,
  }
}

/**
 * Operator-review input only (PRD 4.7). Producing this payload publishes nothing: promotion must
 * go through the managed-content edit, review and publish functions like any other draft.
 */
export function toPromotionCandidatePayload(question: PersonalPracticeQuestion): PromotionCandidatePayload {
  return {
    prompt: question.prompt,
    options: [...question.options],
    correctOption: question.correctOption,
    section: question.section,
    explanation: question.explanation,
  }
}
