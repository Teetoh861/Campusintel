// Only outcomes implemented in the product belong in this contract.
export const PRODUCT_EVENTS = {
  signupConfirmed: 'signup_confirmed',
  loginSucceeded: 'login_succeeded',
  courseViewed: 'course_viewed',
  theoryAnswerSubmitted: 'theory_answer_submitted',
  theorySelfAssessmentCompleted: 'theory_self_assessment_completed',
  trialActivated: 'trial_activated',
} as const

/** A course view carries only the canonical, public course slug. */
export function courseViewEvent(courseSlug: string) {
  return { name: PRODUCT_EVENTS.courseViewed, properties: { course_slug: courseSlug } } as const
}

/** A theory disclosure carries the public course slug and rubric presence; never answer text or identity.
 * Counted once per accepted POST, so a retry or replayed request counts again: it measures disclosures, not students.
 */
export function theoryAnswerSubmittedEvent(courseSlug: string, hasRubric: boolean) {
  return { name: PRODUCT_EVENTS.theoryAnswerSubmitted,
    properties: { course_slug: courseSlug, has_rubric: hasRubric } } as const
}

/** Completion carries only the student's own coverage counts, never answer or reflection text. */
export function theorySelfAssessmentCompletedEvent(courseSlug: string, hasRubric: boolean,
  counts: { covered: number; partly: number; notYet: number }) {
  return { name: PRODUCT_EVENTS.theorySelfAssessmentCompleted, properties: { course_slug: courseSlug,
    has_rubric: hasRubric, covered_points: counts.covered, partly_covered_points: counts.partly,
    revisit_points: counts.notYet } } as const
}
