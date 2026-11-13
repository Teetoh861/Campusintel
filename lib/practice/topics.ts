// lib/practice/topics.ts — A course's practice topics for the course page's Practice card, the Practise by topic page
// and the instant-feedback end screen (20261029150000_practice_by_topic.sql). The list and each topic's count come from
// published_cbt_topics on the student's own client (the course content boundary); the student's progress per topic from
// practice_topic_progress, keyed by the verified session. Counts and scores only: no question ever leaves the database
// here.
import 'server-only'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'
import type { createClient } from '@/lib/supabase/server'

type AccountClient = Awaited<ReturnType<typeof createClient>>

export type PracticeTopic = { topic: string; bankSize: number }
export type TopicProgress = { practised: number; lastScore: { score: number; total: number } | null }
// `practised`: the row shows the student's progress, not the topic's count.
export type PracticeTopicRow = PracticeTopic & { number: number; line: string; practised: boolean }

const count = z.number().int().nonnegative()
const topicRow = z.object({ ordinal: z.number().int().positive(), topic: z.string().min(1), bank_size: z.number().int().positive() })
  .strict()
const dbProgress = z.discriminatedUnion('state', [
  z.object({ state: z.literal('ok'), topics: z.array(z.object({ topic: z.string().min(1), practised: count,
    score: count.nullable(), total: z.number().int().positive().nullable() }).strict()) }).strict(),
  z.object({ state: z.literal('signed-out') }).strict(),
])

/** The database's topic list, in its order; anything malformed is null (the page then shows no topic list). */
export function practiceTopicsFrom(data: unknown): PracticeTopic[] | null {
  const parsed = topicRow.array().safeParse(data)
  if (!parsed.success) return null
  const rows = [...parsed.data].sort((a, b) => a.ordinal - b.ordinal)
  if (new Set(rows.map(row => row.topic)).size !== rows.length) return null
  return rows.map(row => ({ topic: row.topic, bankSize: row.bank_size }))
}

/** The student's progress keyed by topic; null when it cannot be read (rows then show their counts only). */
export function topicProgressFrom(data: unknown): ReadonlyMap<string, TopicProgress> | null {
  const parsed = dbProgress.safeParse(data)
  if (!parsed.success || parsed.data.state !== 'ok') return null
  const progress = new Map<string, TopicProgress>()
  for (const row of parsed.data.topics) {
    const { score, total } = row
    if (progress.has(row.topic) || (score === null) !== (total === null) || (score !== null && total !== null && score > total)) {
      return null
    }
    progress.set(row.topic, { practised: row.practised,
      lastScore: score === null || total === null ? null : { score, total } })
  }
  return progress
}

const questions = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`

/** The student has practised a topic once any of its questions is recorded, in a topic run or an exam. */
const hasPractised = (progress: TopicProgress | undefined): progress is TopicProgress =>
  progress !== undefined && (progress.practised > 0 || progress.lastScore !== null)

/** One line per topic: its size before any practice, its progress after, never both. */
export function topicLine(bankSize: number, progress: TopicProgress | undefined): string {
  if (!hasPractised(progress)) return questions(bankSize)
  const done = `${progress.practised} of ${questions(bankSize)} practised`
  return progress.lastScore === null ? done : `${done} · Last score ${progress.lastScore.score}/${progress.lastScore.total}`
}

export function topicRowsOf(topics: ReadonlyArray<PracticeTopic>, progress: ReadonlyMap<string, TopicProgress> | null):
  PracticeTopicRow[] {
  return topics.map((topic, index) => {
    const own = progress?.get(topic.topic)
    return { ...topic, number: index + 1, line: topicLine(topic.bankSize, own), practised: hasPractised(own) }
  })
}

/** The Practice card's one line: how many topics the course has, or how many of them the student has practised. Only
 * what the topic rows already show is counted. */
export function topicsLine(rows: ReadonlyArray<Pick<PracticeTopicRow, 'practised'>>): string {
  const topics = `${rows.length} ${rows.length === 1 ? 'topic' : 'topics'}`
  const done = rows.filter(row => row.practised).length
  return done === 0 ? topics : `${done} of ${topics} practised`
}

/** The topic after this one in the course's order; null after the last (or for a topic no longer listed). */
export function nextTopicAfter(topics: ReadonlyArray<PracticeTopic>, topic: string): string | null {
  const index = topics.findIndex(entry => entry.topic === topic)
  return index === -1 ? null : topics[index + 1]?.topic ?? null
}

/** The course's topics on the student's own client: null when they cannot be read now (locked, signed out, offline). */
export async function readPracticeTopics(client: AccountClient, courseId: string, sections: ReadonlyArray<string>):
  Promise<PracticeTopic[] | null> {
  try {
    const { data, error } = await client.rpc('published_cbt_topics', { p_course_id: courseId, p_sections: [...sections] })
    return error ? null : practiceTopicsFrom(data)
  } catch {
    return null
  }
}

export type TopicProgressEnv = { progress(courseId: string): Promise<{ data: unknown; error: unknown }> }

function createSupabaseTopicProgressEnv(sessionId: string): TopicProgressEnv {
  // Server-only client, created per request (never shared between students); mirrors lib/practice/progress.ts.
  const service = createServiceClient(getSupabaseConfig().url, getAuthSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { progress: async courseId => await service.rpc('practice_topic_progress', { p_session_id: sessionId,
    p_course_id: courseId }) }
}

/** The verified session's progress per topic in one course. */
export async function readTopicProgress(sessionId: string, courseId: string, env?: TopicProgressEnv):
  Promise<ReadonlyMap<string, TopicProgress> | null> {
  try {
    const { data, error } = await (env ?? createSupabaseTopicProgressEnv(sessionId)).progress(courseId)
    return error ? null : topicProgressFrom(data)
  } catch {
    return null
  }
}
