// lib/product/student-navigation.ts — Current shared product destinations and chrome groups; not authorization.

export type StudentDestinationId = 'dashboard' | 'myCourses' | 'courses' | 'bookmarks' | 'tutors' | 'contact' | 'account' | 'materials'

export const STUDENT_DESTINATIONS = {
  dashboard: { id: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  myCourses: { id: 'myCourses', href: '/my-courses', label: 'My Courses' },
  courses: { id: 'courses', href: '/courses', label: 'All Courses' },
  bookmarks: { id: 'bookmarks', href: '/bookmarks', label: 'Bookmarks' },
  tutors: { id: 'tutors', href: '/tutors', label: 'Tutors' },
  contact: { id: 'contact', href: '/contact', label: 'Help & Support' },
  account: { id: 'account', href: '/account', label: 'Account' },
  materials: { id: 'materials', href: '/materials', label: 'Request Material' },
} as const satisfies {
  [Id in StudentDestinationId]: { readonly id: Id; readonly href: `/${string}`; readonly label: string }
}

export type StudentDestination = (typeof STUDENT_DESTINATIONS)[StudentDestinationId]

const desktop = [STUDENT_DESTINATIONS.courses, STUDENT_DESTINATIONS.tutors,
  STUDENT_DESTINATIONS.contact, STUDENT_DESTINATIONS.account] as const

export const STUDENT_NAVIGATION_GROUPS = {
  desktop,
  menu: [STUDENT_DESTINATIONS.dashboard, ...desktop],
} as const

export const STUDENT_FOOTER_GROUPS = {
  explore: [
    { destination: STUDENT_DESTINATIONS.myCourses, label: STUDENT_DESTINATIONS.myCourses.label },
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
