import Link from 'next/link'
import { btnBase, buttonClassName, btnGhost, btnSm, cx, focusRingNavy } from '@/components/chrome/ui'
import type { ReactElement, ReactNode } from 'react'

/** Keep the student profile routes in the same bounded workspace as Dashboard. */
export function ProfilePageFrame({ title, description, back, narrow = false, children }: {
  title: string
  description?: string
  back?: { href: string; label: string }
  narrow?: boolean
  children: ReactNode
}): ReactElement {
  return <div className="app-container student-page">
    <div className={cx('mx-auto min-w-0', narrow ? 'max-w-3xl' : 'max-w-5xl')}>
      <header className="mb-4 flex min-w-0 items-start justify-between gap-3 tablet:mb-5">
        <div className="min-w-0">
          <h1 className="student-title">{title}</h1>
          {description && <p className="student-meta mt-1">{description}</p>}
        </div>
        {back && <Link href={back.href} prefetch={false}
          className={buttonClassName(btnBase, btnSm, btnGhost, focusRingNavy, 'shrink-0 !px-3')}>
          {back.label}
        </Link>}
      </header>
      {children}
    </div>
  </div>
}
