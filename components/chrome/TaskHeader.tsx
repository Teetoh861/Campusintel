// components/chrome/TaskHeader.tsx — Compact, aligned headings for authenticated account tasks.
import Link from 'next/link'
import type { ReactElement } from 'react'

type Props = {
  title: string
  description: string
  label: string
  count?: string
  meta?: string
  crumbs?: ReadonlyArray<{ label: string; href?: string }>
}

/** Preserve page identity and context without a promotional-sized task cover. */
export function TaskHeader({ title, description, label, count, meta, crumbs }: Props): ReactElement {
  return <header className="bg-student-navigation text-student-navigation-text" data-screen-label={label}>
    <div className="app-container py-5 tablet:py-6 desktop:py-8">
      {crumbs && <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-student-navigation-text-muted">
        {crumbs.map((crumb, index) => <span key={crumb.label} className="inline-flex items-center gap-2">
          {index > 0 && <span aria-hidden="true">/</span>}
          {crumb.href ? <Link href={crumb.href}
            className="inline-flex min-h-11 items-center rounded-ci-btn-sm hover:text-student-navigation-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus-inverse">
            {crumb.label}
          </Link> : <span aria-current="page">{crumb.label}</span>}
        </span>)}
      </nav>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="student-title text-student-navigation-text">{title}</h1>
        {count && <span className="text-sm font-semibold text-student-navigation-text-muted">{count}</span>}
      </div>
      <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-student-navigation-text-muted tablet:text-base">
        {description}
      </p>
      {meta && <p className="mt-3 text-xs leading-relaxed text-student-navigation-text-muted tablet:text-sm">{meta}</p>}
    </div>
  </header>
}
