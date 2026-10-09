// components/student/CourseRow.tsx — Compact course identity and an ordered responsive register.
import Link from 'next/link'
import { ChevronRight, CircleAlert } from 'lucide-react'
import { StatusRail } from './StatusRail'
import { studentFocusRow } from './ui'
import type { CSSProperties, ReactElement } from 'react'

type CourseRowProps = { code: string; title: string } & (
  | { href: string; learningTypes: ReadonlyArray<string>; unavailable?: never }
  | { href?: never; learningTypes?: never; unavailable: 'missing' | 'temporary' }
)

/** Make usable learning one row target; keep unavailable institutional identity inert. */
export function CourseRow(props: CourseRowProps): ReactElement {
  const body = <div className="student-course-row-body">
    <p className="student-course-row-code">{props.code}</p>
    <h3 className="student-course-row-title">{props.title}</h3>
    <div className="student-course-row-meta">
      {props.href !== undefined ? <p>{props.learningTypes.join(' · ')}</p>
        : props.unavailable === 'missing'
          ? <StatusRail status="unavailable">Study content not yet available</StatusRail>
          : <p className="student-course-row-error">
            <CircleAlert aria-hidden="true" size={14} strokeWidth={1.75} />
            <span>Content temporarily unavailable</span>
          </p>}
    </div>
  </div>

  return props.href !== undefined
    ? <Link href={props.href} prefetch={false} className={'student-course-row student-course-row-link ' + studentFocusRow}>
      {body}<ChevronRight aria-hidden="true" size={20} strokeWidth={1.75} className="student-course-row-chevron" />
    </Link>
    : <div className="student-course-row">{body}</div>
}

/** Keep DOM and keyboard order down the first column, then down the second. */
export function CourseRegister({ children, label }: {
  children: ReadonlyArray<ReactElement>
  label: string
}): ReactElement {
  const rows = Math.ceil(children.length / 2)
  const style: CSSProperties & { '--student-register-rows': number } = {
    '--student-register-rows': Math.max(1, rows),
  }
  return <ul className="student-course-register" aria-label={label} style={style} data-count={children.length}>
    {children.map((row, index) => <li key={row.key ?? index} data-column={index < rows ? 1 : 2}
      data-column-end={index === rows - 1 || index === children.length - 1}>
      {row}
    </li>)}
  </ul>
}
