// lib/ai-practice/topic-set-read.ts — One "Quiz me on this topic" set as its page shows it, read on the student's own
// client: row security returns a delivered set to its owner only, through a live session. The stored shape is checked
// again on every read (stored-set.ts); a set from an upload, one still being written, or one past its keeping time is
// not a topic set's page.
import 'server-only'
import { z } from 'zod'
import { toPersonalSetView } from './stored-set'
import type { createClient } from '@/lib/supabase/server'
import type { PersonalSetView } from './upload-contract'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const uuid = z.string().uuid()
const row = z.object({ id: uuid, created_at: z.string(), question_set: z.unknown(), source_course_id: uuid,
  source_item_id: uuid, expires_at: z.string() })

export type TopicSetPage = { view: PersonalSetView & { topic: NonNullable<PersonalSetView['topic']> }
  courseId: string; pinned: boolean }

export async function readTopicSet(client: StudentClient, userId: string, setId: string): Promise<TopicSetPage | null> {
  const { data, error } = await client.from('ai_practice_generations')
    .select('id,created_at,question_set,source_course_id,source_item_id,expires_at')
    .eq('id', setId).eq('user_id', userId).eq('source_kind', 'notes-topic').eq('status', 'generated')
    .gt('expires_at', new Date().toISOString()).maybeSingle()
  const parsed = row.safeParse(data)
  if (error || !parsed.success) return null
  const view = toPersonalSetView(parsed.data.id, parsed.data.created_at, parsed.data.question_set)
  if (view === null || !view.topic || view.topic.itemId !== parsed.data.source_item_id) return null
  const stored = parsed.data.question_set as { source?: { pinned?: unknown } }
  return { view: { ...view, topic: view.topic }, courseId: parsed.data.source_course_id,
    pinned: stored.source?.pinned === true }
}
