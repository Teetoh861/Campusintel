// lib/ai-practice/routes.ts — The one route to personal AI practice for an institutional course.

/** Canonical path of the upload-to-practice page; course identity is the institutional course id. */
export function aiPracticePath(courseId: string): string {
  return `/courses/ai-practice/${encodeURIComponent(courseId)}`
}
