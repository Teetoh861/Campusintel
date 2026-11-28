import { z } from 'zod'
import { quizJson } from '@/lib/orientation/response'
import { orientationPoll } from '@/lib/orientation/poll-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** The RPC independently checks live operator authority on every host poll. */
export async function GET(request: Request) {
  const event = new URL(request.url).searchParams.get('event')
  if (event !== null && !z.string().uuid().safeParse(event).success) return quizJson({ message: 'Choose an imported quiz.' },400)
  const result = await orientationPoll(true,event)
  return quizJson(result.value,result.status)
}
