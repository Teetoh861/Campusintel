// components/student/PageBand.tsx — Full-width Student App context with a bounded workspace.
import type { ReactElement, ReactNode } from 'react'

/** Present a page's verified context, identity and optional supporting action. */
export function PageBand({ title, lede, context, aside }: {
  title: string
  lede: string
  context?: ReactNode
  aside?: ReactNode
}): ReactElement {
  return <header className="student-page-band">
    <div className="student-workspace student-page-band-inner">
      <div className="student-page-band-body">
        {context && <div className="student-page-band-context">{context}</div>}
        <h1 className="student-page-band-title">{title}</h1>
        <p className="student-page-band-lede">{lede}</p>
      </div>
      {aside && <div className="student-page-band-aside">{aside}</div>}
    </div>
  </header>
}
