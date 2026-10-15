// components/student/CourseRow.tsx — Compact course identity and an ordered responsive register.
import Link from 'next/link'
import { ChevronRight, CircleAlert } from 'lucide-react'
import { StatusRail } from './StatusRail'
import { STUDY_COPY } from './study-families'
import { studentFocusRow } from './ui'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

/** Exact identity line for a shelved repository course no institutional course has confirmed. */
export const REPOSITORY_COURSE_LABEL = 'Repository course'

/** Confirmed institutional code, or the honest repository-only mark; never a fabricated code. */
export type CourseRowIdentity = { title: string } & (
  | { code: string; repositoryOnly?: never }
  | { code?: never; repositoryOnly: true }
)

/** Serializable row presentation: what the central adapter derives and any page may compose. */
export type CourseRowPresentation = CourseRowIdentity & (
  | { href: string; learningTypes: ReadonlyArray<string>; unavailable?: never }
  | { href?: never; learningTypes?: never; unavailable: 'missing' | 'temporary' }
)

type CourseRowProps = CourseRowPresentation & {
  // A sibling control beside the course target; never nested inside the link.
  trailingAction?: ReactNode
}

/** Make usable learning one row target; keep unavailable institutional identity inert. */
export function CourseRow(props: CourseRowProps): ReactElement {
  const body = <div className="student-course-row-body">
    {props.repositoryOnly
      ? <p className="student-course-row-code" data-identity="repository">{REPOSITORY_COURSE_LABEL}</p>
      : <p className="student-course-row-code">{props.code}</p>}
    <h3 className="student-course-row-title">{props.title}</h3>
    <div className="student-course-row-meta">
      {props.href !== undefined ? <p>{props.learningTypes.join(' · ')}</p>
        : props.unavailable === 'missing'
          ? <StatusRail status="unavailable">{STUDY_COPY.notYetAvailable}</StatusRail>
          : <p className="student-course-row-error">
            <CircleAlert aria-hidden="true" size={14} strokeWidth={1.75} />
            <span>{STUDY_COPY.temporarilyUnavailable}</span>
          </p>}
    </div>
  </div>

  const target = props.href !== undefined
    ? <Link href={props.href} prefetch={false} className={'student-course-row student-course-row-link ' + studentFocusRow}>
      {body}<ChevronRight aria-hidden="true" size={20} strokeWidth={1.75} className="student-course-row-chevron" />
    </Link>
    : <div className="student-course-row">{body}</div>

  if (props.trailingAction === undefined) return target
  return <div className="student-course-row-shell">
    {target}
    <div className="student-course-row-action">{props.trailingAction}</div>
  </div>
}

/** Keep DOM and keyboard order down the first column, then down the second; `single` keeps one column everywhere. */
export function CourseRegister({ children, label, columns = 'responsive' }: {
  children: ReadonlyArray<ReactElement>
  label: string
  columns?: 'responsive' | 'single'
}): ReactElement {
  const rows = columns === 'single' ? children.length : Math.ceil(children.length / 2)
  const style: CSSProperties & { '--student-register-rows': number } = {
    '--student-register-rows': Math.max(1, rows),
  }
  return <ul className="student-course-register" aria-label={label} style={style}
    data-count={children.length} data-columns={columns}>
    {children.map((row, index) => <li key={row.key ?? index} data-column={index < rows ? 1 : 2}
      data-column-end={index === rows - 1 || index === children.length - 1}>
      {row}
    </li>)}
  </ul>
}
