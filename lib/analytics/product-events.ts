// Only outcomes implemented in the product belong in this contract.
export const PRODUCT_EVENTS = {
  signupConfirmed: 'signup_confirmed',
  loginSucceeded: 'login_succeeded',
  courseViewed: 'course_viewed',
} as const

/** A course view carries only the canonical, public course slug. */
export function courseViewEvent(courseSlug: string) {
  return { name: PRODUCT_EVENTS.courseViewed, properties: { course_slug: courseSlug } } as const
}
