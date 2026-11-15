// app/global-error.tsx — The last-resort page when the app's own frame fails; it replaces the root layout, so it brings its own document and styles.
'use client'

import './globals.css'
import '../styles/student-app.css'
import { btnNavy } from '@/components/chrome/ui'
import { PageBand } from '@/components/student/PageBand'
import { StudentPage } from '@/components/student/StudentPage'
import { studentAction, studentFocusDark } from '@/components/student/ui'
import type { ReactElement } from 'react'

/** The same page as app/error.tsx: no error detail, one way back. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }): ReactElement {
  return <html lang="en">
    <body className="flex min-h-dvh flex-col font-sans">
      <title>Something went wrong | CampusIntell</title>
      <main id="top" className="flex-1">
        <StudentPage band={<PageBand title="Something went wrong." />}>
          <button type="button" className={studentAction(btnNavy, studentFocusDark)} onClick={() => retry()}>Try again</button>
        </StudentPage>
      </main>
    </body>
  </html>
}
