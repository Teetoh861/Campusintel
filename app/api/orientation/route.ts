import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { readAuthRequest, AuthRequestError } from '@/lib/auth/request'
import { getAuthenticatedMutationContext } from '@/lib/auth/mutation-context'
import { mutationSchema, ORIENTATION_BODY_MAX_BYTES } from '@/lib/orientation/contract'
import { orientationPoll } from '@/lib/orientation/poll-server'
import { quizJson } from '@/lib/orientation/response'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
/** Poll with one database call. No Auth network operation occurs on this path. */
export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get('event')
  if (value !== null && !z.string().uuid().safeParse(value).success) return quizJson({ message: 'The quiz could not be opened.' },400)
  const result = await orientationPoll(false,value)
  return quizJson(result.value,result.status)
}
/** Reuse existing same-origin, live-session and rendered-account mutation guards. */
export async function POST(request: Request) {
  const carrier = NextResponse.json({})
  try {
    const command = await readAuthRequest(request,mutationSchema,{ maxBytes: ORIENTATION_BODY_MAX_BYTES })
    const access = await getAuthenticatedMutationContext(carrier,request.headers.get(AUTH_CONTINUITY_HEADER))
    if (access.status !== 'ready') return quizJson({ message: access.status === 'signed-out' ? 'Sign in to continue.' : 'Reload this page to continue.' },access.status === 'signed-out' ? 401 : 409,carrier.headers)
    let result
    if (command.action === 'join') result = await access.context.client.rpc('orientation_join',{
      p_pin: command.pin,p_first_name: command.firstName,p_surname: command.surname })
    else if (command.action === 'answer') result = await access.context.client.rpc('orientation_answer',{
      p_event: command.eventId,p_question: command.questionId,p_option: command.option })
    else result = await access.context.client.rpc('orientation_host_command',{
      p_event: command.eventId,p_action: command.action,p_question: command.questionId,
      p_target: command.target ?? null,p_prizes: command.prizes ?? null,p_email: command.email ?? null })
    if (result.error) return quizJson({ message: 'The quiz could not be updated. Try again.' },result.error.code === '42501' ? 403 : 503,carrier.headers)
    return quizJson(result.data,200,carrier.headers)
  } catch (error) {
    return quizJson({ message: 'Check your details and try again.' },error instanceof AuthRequestError ? error.status : 503,carrier.headers)
  }
}
