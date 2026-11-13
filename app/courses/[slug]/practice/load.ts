// app/courses/[slug]/practice/load.ts — A course's practice topics with this student's progress, read the same way for
// the course page's Practice card and the Practise by topic page.
import 'server-only'
import { practicePolicyFor } from '@/lib/practice/server'
import { readPracticeTopics, readTopicProgress, topicRowsOf } from '@/lib/practice/topics'
import type { PracticeTopicRow } from '@/lib/practice/topics'
import type { createClient } from '@/lib/supabase/server'

/** The course's topics in order, each with this student's progress. Null when the topics cannot be read now; progress
 * that cannot be read leaves each topic's count. A course without practice has no topics. */
export async function readTopicRows(client: Awaited<ReturnType<typeof createClient>>, sessionId: string,
  course: { slug: string; repositoryCourseId: string }): Promise<PracticeTopicRow[] | null> {
  try {
    const policy = practicePolicyFor(course.slug)
    if (policy === null) return []
    const [list, progress] = await Promise.all([readPracticeTopics(client, course.repositoryCourseId, policy.sections),
      readTopicProgress(sessionId, course.repositoryCourseId)])
    return list === null ? null : topicRowsOf(list, progress)
  } catch { return null }
}
