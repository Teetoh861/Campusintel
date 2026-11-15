// Student App roles and readable wrapping shared by the theory drafting and comparison screens, and a question's address.
export const theoryTextarea = 'block w-full min-w-0 resize-y rounded-ci-btn-sm border border-student-control-border bg-student-surface px-3 py-3 text-base leading-relaxed text-student-text-primary disabled:opacity-60'
export const theoryProse = 'whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]'

/** One question's address on the theory page. A study guide links to its own question with it, Previous and Next keep
 * it current, and signing in again returns to it (lib/auth/redirect.ts allows exactly this form). */
export function theoryQuestionHref(courseHref: string, itemId: string): string {
  return `${courseHref}/theory?question=${encodeURIComponent(itemId)}`
}
