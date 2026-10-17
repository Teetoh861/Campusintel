import 'server-only'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { matchesAccountContinuityToken } from '@/lib/auth/account-continuity'
import { getStudentSessionContext } from '@/lib/auth/student-state'
import { getCurrentStudentProfileForVerifiedStudent } from '@/lib/profile/student-profile'
import { createClient } from '@/lib/supabase/server'
import { theorySubmission } from './contract'
import { recordTheorySubmission } from './events'
import { getTheoryPracticeForVerifiedStudent } from './published'
import type { NextResponse } from 'next/server'
import type { TheorySubmitResult } from './contract'

/** Reveal current published feedback for an identified question from this page's live session.
 * The request carries no answer text; the strict schema refuses one.
 */
export async function submitTheoryAnswer(
  input: unknown, response: NextResponse, pageToken: string | null,
): Promise<TheorySubmitResult> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const context = await getStudentSessionContext(response, client)
    if (context === null) return { status: 'signed-out' }
    if (!pageToken || !matchesAccountContinuityToken(pageToken, context.user.id, context.sessionId)) {
      return { status: 'session-changed' }
    }
    const parsed = theorySubmission.safeParse(input)
    if (!parsed.success) return { status: 'invalid-request' }
    const profile = await getCurrentStudentProfileForVerifiedStudent(client, context.user)
    if (profile.status !== 'complete') return { status: profile.status === 'signed-out' ? 'signed-out'
      : profile.status === 'incomplete' ? 'incomplete' : 'unavailable' }
    const command = parsed.data
    const published = await getTheoryPracticeForVerifiedStudent(client, command.courseSlug)
    if (published.status !== 'ready') return { status: published.status === 'invariant-failure' ? 'unavailable' : published.status }
    const material = published.materials.find(item => item.question.itemId === command.itemId)
    if (!material?.feedback || material.question.publishedRevision !== command.publishedRevision) {
      return { status: 'content-changed' }
    }
    const live = await getStudentSessionContext(response, client)
    if (live === null) return { status: 'signed-out' }
    if (live.user.id !== context.user.id || live.sessionId !== context.sessionId) return { status: 'session-changed' }
    await recordTheorySubmission(published.course.slug, material.feedback.rubric !== null)
    return { status: 'ready', feedback: material.feedback }
  } catch { return { status: 'unavailable' } }
}
