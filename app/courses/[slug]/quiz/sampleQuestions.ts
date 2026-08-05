import type { QuizQuestion } from '@/lib/types'

function shuffle<T>(items: ReadonlyArray<T>): T[] {
  const shuffled = [...items]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}

/** Samples an unbiased subset, then groups it in bank section order. */
export function sampleQuestionsBySection(
  bank: ReadonlyArray<QuizQuestion>,
  sections: ReadonlyArray<string>,
  maximum: number,
): ReadonlyArray<QuizQuestion> {
  const sample = shuffle(bank).slice(0, Math.min(maximum, bank.length))
  const grouped = new Map(sections.map((section) => [section, [] as QuizQuestion[]]))
  const unlisted: QuizQuestion[] = []

  for (const question of sample) {
    const group = grouped.get(question.section)
    if (group) group.push(question)
    else unlisted.push(question)
  }

  return sections.flatMap((section) => grouped.get(section) ?? []).concat(unlisted)
}
