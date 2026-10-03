// app/api/courses/[slug]/quiz-bank/route.ts — Private live bank for fresh quiz starts and retakes.
import { NextResponse } from 'next/server'
import { getCurrentStudentProfile } from '@/lib/profile/student-profile'
import { getStudentManagedQuiz } from '@/lib/managed-content/student-quiz'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Context = { params: Promise<{ slug: string }> }

/** Read the latest published quiz only for an account with a complete profile. */
export async function GET(_request: Request, { params }: Context): Promise<NextResponse> {
  const response = NextResponse.json({ status: 'unavailable' }, {
    headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
  })
  const profile = await getCurrentStudentProfile(response)
  if (profile.status !== 'complete') {
    const status = profile.status === 'signed-out' ? 401 : profile.status === 'incomplete' ? 403 : 503
    return NextResponse.json({ status: profile.status }, { status, headers: response.headers })
  }
  const { slug } = await params
  const result = await getStudentManagedQuiz(slug, response)
  const status = result.status === 'ready' ? 200 : result.status === 'signed-out' ? 401
    : result.status === 'invalid-course' ? 404 : 503
  return NextResponse.json(result, { status, headers: response.headers })
}
