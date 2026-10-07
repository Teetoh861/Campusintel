// lib/product/student-navigation.ts — Current shared product destinations and chrome groups; not authorization.

export type StudentDestinationId = 'dashboard' | 'courses' | 'bookmarks' | 'tutors' | 'contact' | 'account'

export const STUDENT_DESTINATIONS = {
  dashboard: { id: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  courses: { id: 'courses', href: '/courses', label: 'Courses' },
  bookmarks: { id: 'bookmarks', href: '/bookmarks', label: 'Bookmarks' },
  tutors: { id: 'tutors', href: '/tutors', label: 'Tutors' },
  contact: { id: 'contact', href: '/contact', label: 'Contact' },
  account: { id: 'account', href: '/account', label: 'Account' },
} as const satisfies {
  [Id in StudentDestinationId]: { readonly id: Id; readonly href: `/${string}`; readonly label: string }
}

export type StudentDestination = (typeof STUDENT_DESTINATIONS)[StudentDestinationId]

const study = [STUDENT_DESTINATIONS.courses, STUDENT_DESTINATIONS.bookmarks] as const
const utility = [STUDENT_DESTINATIONS.tutors, STUDENT_DESTINATIONS.contact] as const

export const STUDENT_NAVIGATION_GROUPS = {
  study,
  utility,
  desktop: [...study, ...utility],
  account: [STUDENT_DESTINATIONS.dashboard, STUDENT_DESTINATIONS.account],
} as const

export const STUDENT_FOOTER_GROUPS = {
  explore: [
    { destination: STUDENT_DESTINATIONS.courses, label: STUDENT_DESTINATIONS.courses.label },
    { destination: STUDENT_DESTINATIONS.tutors, label: 'Tutoring' },
    { destination: STUDENT_DESTINATIONS.bookmarks, label: STUDENT_DESTINATIONS.bookmarks.label },
  ],
  support: [STUDENT_DESTINATIONS.contact],
} as const

/** Preserve exact destination matching and the existing nested course-route highlight. */
export function isStudentDestinationActive(pathname: string, destination: StudentDestination): boolean {
  return pathname === destination.href ||
    (destination.id === 'courses' && pathname.startsWith(`${destination.href}/`))
}
