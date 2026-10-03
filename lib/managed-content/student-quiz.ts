// lib/managed-content/student-quiz.ts — Server-owned current published quiz bank and policy.
import 'server-only'
import { getCourseBySlug } from '@/lib/data/courses'
import { getQuizConfigurationByCourseSlug } from '@/lib/data/quizzes'
import { getPublishedManagedCourse } from './published'
import { getUsableManagedQuiz } from './quiz'
import { projectStudentLearning } from './student-projection'
import type { NextResponse } from 'next/server'
import type { ManagedQuiz } from './quiz'

export type StudentQuizResult =
  | { status: 'ready'; quiz: ManagedQuiz }
  | { status: 'signed-out' | 'invalid-course' | 'unavailable' }

/** Resolve the current published CBT bank through the repository content key. */
export async function getStudentManagedQuiz(slug: string, response?: NextResponse): Promise<StudentQuizResult> {
  const course = getCourseBySlug(slug)
  if (!course) return { status: 'invalid-course' }
  const published = await getPublishedManagedCourse(course.contentKey, response)
  if (published.status !== 'ok') return published
  const projected = projectStudentLearning(published.content)
  if (projected.status !== 'ok') return projected
  const quiz = getUsableManagedQuiz(slug,
    getQuizConfigurationByCourseSlug(slug), projected.learning.quizQuestions)
  return quiz === null ? { status: 'unavailable' } : { status: 'ready', quiz }
}
