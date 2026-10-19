// Presentation density and client-visible identity; domain truth stays in the central model.
import type { StudentCourse } from '@/lib/courses/read-model'
import type { ReactElement } from 'react'

// Six compact register rows per desktop column; stable pages across viewport changes.
export const COURSES_PER_PAGE = 12
export const CATALOGUE_LEDE = 'Search a course code or title, or filter by department, level and semester.'
export const CATALOGUE_CONTEXT = 'Course catalogue'

export type DirectoryItem = Pick<StudentCourse, 'institutionalCourseId' | 'code' | 'title' | 'applicability'> & {
  row: ReactElement
}
