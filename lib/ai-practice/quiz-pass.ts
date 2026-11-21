// lib/ai-practice/quiz-pass.ts — The free pass line "Quiz me on this topic" shows on a notes page, read without the
// upload journey's modules: the student's allowance as get_my_ai_allowance reports it, filtered to the grant sources
// this deployment accepts (the same read as supabase-env.ts readAllowance), then quizPassLine. A read that fails shows
// no line.
import 'server-only'
import { z } from 'zod'
import { acceptedGrantSources, effectiveAllowance } from './entitlement'
import { quizPassLine } from './topic-presentation'
import type { createClient } from '@/lib/supabase/server'

type StudentClient = Awaited<ReturnType<typeof createClient>>

const allowanceRow = z.object({ state: z.enum(['not-entitled', 'active', 'expired']),
  source: z.enum(['trial', 'early_access', 'paid', 'test']).optional(), total: z.number().int().nullable(),
  used: z.number().int(), ends_at: z.string().optional(), source_char_limit: z.number().int().positive().nullish() })

export async function readQuizPassLine(client: StudentClient): Promise<string | null> {
  try {
    const { data, error } = await client.rpc('get_my_ai_allowance')
    const parsed = allowanceRow.safeParse(data)
    if (error || !parsed.success) return null
    return quizPassLine(effectiveAllowance({ state: parsed.data.state, source: parsed.data.source ?? null,
      total: parsed.data.total, used: parsed.data.used, endsAt: parsed.data.ends_at ?? null,
      ...(parsed.data.source_char_limit ? { sourceCharLimit: parsed.data.source_char_limit } : {}) },
    acceptedGrantSources()))
  } catch {
    return null
  }
}
