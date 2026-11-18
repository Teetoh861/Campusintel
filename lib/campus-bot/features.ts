// lib/campus-bot/features.ts — Which Campus Bot features a page offers: the team's switches for Explain, Ask Campus
// Bot and topic sets (private.campus_bot_settings, read through get_campus_bot_features on the student's own client),
// and only while a reply could be written at all. A read that fails, or an answer that cannot be read, offers none.
import 'server-only'
import { z } from 'zod'
import { campusBotProvider } from './provider'
import type { QuestionGenerationProvider } from '@/lib/ai-practice/provider'
import type { createClient } from '@/lib/supabase/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const features = z.object({ explain: z.boolean(), ask: z.boolean(), topic_sets: z.boolean() }).strict()
/** `topicSets` is "Quiz me on this topic" (sets written from one notes topic). */
export type CampusBotFeatures = { explain: boolean; ask: boolean; topicSets: boolean }
const FEATURES_OFF: CampusBotFeatures = Object.freeze({ explain: false, ask: false, topicSets: false })

export async function readCampusBotFeatures(client: StudentClient,
  provider: QuestionGenerationProvider | null = campusBotProvider()): Promise<CampusBotFeatures> {
  if (provider === null) return FEATURES_OFF
  try {
    const { data, error } = await client.rpc('get_campus_bot_features')
    const parsed = features.safeParse(data)
    return error || !parsed.success ? FEATURES_OFF
      : { explain: parsed.data.explain, ask: parsed.data.ask, topicSets: parsed.data.topic_sets }
  } catch { return FEATURES_OFF }
}
