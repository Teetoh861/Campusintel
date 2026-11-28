import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PlayerPage } from '@/components/orientation/PlayerPage'
export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orientation quiz | CampusIntell', robots: { index: false, follow: false } }
export default async function EventPage({ params }: { params: Promise<{ event: string }> }) {
  const { event } = await params
  if (!z.string().uuid().safeParse(event).success) notFound()
  return <PlayerPage eventId={event} />
}
