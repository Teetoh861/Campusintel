import 'server-only'
import { track } from '@vercel/analytics/server'
import { theoryAnswerSubmittedEvent } from '@/lib/analytics/product-events'

/** Record submission usage through the existing transport, excluding answer text and identity headers. */
export async function recordTheorySubmission(courseSlug: string, hasRubric: boolean): Promise<void> {
  try {
    const event = theoryAnswerSubmittedEvent(courseSlug, hasRubric)
    await track(event.name, event.properties, { headers: { 'user-agent': 'CampusIntel product events' } })
  } catch { /* Analytics availability must not prevent self-assessment. */ }
}
