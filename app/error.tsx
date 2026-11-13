// app/error.tsx — The app-wide page for an unexpected failure on any page, with one way back: try the page again.
'use client'

import { btnNavy } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import type { ReactElement } from 'react'

/** No error detail reaches the student; `retry` fetches and renders the failed page again. */
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }): ReactElement {
  return <StudentPage band={<PageBand title="Something went wrong." />}>
    <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={() => retry()}>Try again</button>
  </StudentPage>
}
