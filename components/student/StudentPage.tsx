// components/student/StudentPage.tsx — The Student App page root: brand attribute, band slot and bounded workspace.
import { cx } from '@/components/chrome/ui'
import type { ReactElement, ReactNode } from 'react'

/** Pages compose a band (PageBand or an approved identity header) above one bounded workspace. */
export function StudentPage({ band, children, workspaceClassName }: {
  band?: ReactNode
  children: ReactNode
  workspaceClassName?: string
}): ReactElement {
  return <div className="student-page-root" data-student-app>
    {band}
    <div className={cx('student-workspace student-page-workspace', workspaceClassName)}>{children}</div>
  </div>
}
