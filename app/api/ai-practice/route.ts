// app/api/ai-practice/route.ts — Student Campus Bot set commands: reserve, process and generate from an upload, and
// write a set from one notes topic ("Quiz me on this topic").
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { runAiPracticeRequest } from '@/lib/ai-practice/supabase-env'
import { isTopicSetCommand } from '@/lib/ai-practice/topic-contract'
import { runTopicSetRequest } from '@/lib/ai-practice/topic-set-server'
import type { AiPracticeResult } from '@/lib/ai-practice/upload-contract'
import type { TopicSetResult } from '@/lib/ai-practice/topic-contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// One generation is bounded by the provider deadline (at most 120 s) plus extraction and database work. A topic set's
// writing and check calls (90 s and 60 s) with admission and settlement end within 195 s.
export const maxDuration = 240
// Commands are small JSON objects; files never pass through this handler.
const COMMAND_MAX_BYTES = 2 * 1024

const HTTP_STATUS: Partial<Record<AiPracticeResult['status'], number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'not-found': 404,
  'not-eligible': 403,
  'not-entitled': 403,
  'disabled': 503,
  'unavailable': 503,
  'busy': 409,
  'capacity': 429,
  'upload-limit': 429,
  'pass-upload-limit': 429,
  'allowance-exhausted': 402,
  'allowance-expired': 402,
  'campus-bot-limit': 429,
}

// Topic sets answer with Campus Bot's shared statuses (lib/ai-practice/topic-contract.ts), coded as /api/campus-bot does.
const TOPIC_HTTP_STATUS: Partial<Record<TopicSetResult['status'], number>> = {
  'signed-out': 401,
  'session-changed': 409,
  'invalid-request': 400,
  'not-found': 404,
  'locked': 403,
  'not-entitled': 403,
  'in-progress': 409,
  'limit': 429,
  'busy': 503,
  'disabled': 503,
  'unavailable': 503,
  'failed': 502,
}

function privateJson(body: unknown, status: number, headers?: Headers): Response {
  const response = new Response(JSON.stringify(body), { status, headers })
  response.headers.set('Content-Type', 'application/json')
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}

/** Identity, course eligibility and allowance are server-owned; the body only names the action. */
export async function POST(request: Request): Promise<Response> {
  let input: unknown
  try { input = await readAuthRequest(request, z.unknown(), { maxBytes: COMMAND_MAX_BYTES }) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  // Session refreshes are written onto this response; its headers carry them to the client.
  const carrier = NextResponse.json({})
  const pageToken = request.headers.get(AUTH_CONTINUITY_HEADER)
  if (isTopicSetCommand(input)) {
    const topic = await runTopicSetRequest(input, carrier, pageToken)
    return privateJson(topic, TOPIC_HTTP_STATUS[topic.status] ?? 200, carrier.headers)
  }
  const result = await runAiPracticeRequest(input, carrier, pageToken)
  return privateJson(result, HTTP_STATUS[result.status] ?? 200, carrier.headers)
}
