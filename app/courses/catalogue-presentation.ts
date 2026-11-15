// Presentation density and client-visible identity; domain truth stays in the central model.
import type { StudentCourse } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

// Six compact register rows per desktop column; stable pages across viewport changes.
export const COURSES_PER_PAGE = 12
export const CATALOGUE_CONTEXT = 'Course catalogue'

/** What an empty result says: the search term the student typed, and whether filters narrowed it too. */
export function noMatchMessage(term: string, filtered: boolean): string {
  if (term === '') return 'No courses match these filters.'
  return filtered ? `No courses match “${term}” with these filters.` : `No courses match “${term}”.`
}

export type DirectoryItem = Pick<StudentCourse, 'institutionalCourseId' | 'code' | 'title' | 'applicability'> & {
  row: ReactElement
}
