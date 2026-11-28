// app/not-found.tsx — The app-wide page for an address with nothing at it, with one way back.
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { WayBack } from '@/components/student/WayBack'
import type { Metadata } from 'next'
import type { ReactElement } from 'react'

export const metadata: Metadata = { title: 'Page not found | CampusIntell', robots: { index: false, follow: false } }

/** Say plainly that the page isn't there; the header keeps the rest of the app one tap away. */
export default function NotFound(): ReactElement {
  return <StudentPage band={<PageBand title="We can’t find that page." />}>
    <WayBack />
  </StudentPage>
}
