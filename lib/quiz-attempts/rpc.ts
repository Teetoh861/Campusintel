import 'server-only'
import { z } from 'zod'
import { getAuthSecretKey, getSupabaseConfig } from '@/lib/auth/config'
import { attemptResultSchema } from './input'
import type { AttemptWriteResult } from './input'

export type CanonicalAnswer = {
  question_id: string
  ordinal: number
  option_index: number
  is_correct: boolean
  section_label: string
}
export type AttemptWriteCommand = {
  p_session_id: string
  p_attempt_id: string
  p_course_id: string
  p_question_count: number
  p_operation: 'start' | 'record' | 'finish'
  p_expected_revision: number | null
  p_status: 'in_progress' | 'submitted' | 'timed_out'
  p_answers: CanonicalAnswer[]
}
const RPC_TIMEOUT_MS = 5000

/** Execute this one private RPC; no privileged client or table interface escapes.
 * The key grants a server capability, not student identity. The session ID must
 * come from live cookie-bound Auth validation; SQL resolves its account itself.
 */
export async function writeAttemptCommand(command: AttemptWriteCommand): Promise<AttemptWriteResult> {
  const { url } = getSupabaseConfig()
  const key = getAuthSecretKey()
  const response = await fetch(`${url}/rest/v1/rpc/write_quiz_attempt`, {
    method: 'POST', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    headers: {
      apikey: key, 'Content-Type': 'application/json',
      // Modern secret keys authenticate at the gateway; legacy local JWT keys
      // additionally use Bearer authorization, as in the established Auth RPCs.
      ...(!key.startsWith('sb_secret_') ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify(command),
  })
  if (!response.ok) {
    const error = z.object({ code: z.string() }).safeParse(await response.json())
    if (error.success && error.data.code === '22023') return { status: 'invalid-request' }
    if (error.success && error.data.code === '28000') return { status: 'signed-out' }
    throw new Error('Attempt store unavailable')
  }
  return attemptResultSchema.parse(await response.json())
}
