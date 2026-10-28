// components/landing/CourseStrip.tsx — Scrolling strip of faculty course codes; GST courses are marked free.
import { landingContent } from '@/lib/landing/content'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { strip } = landingContent

function CourseList({ hidden }: { hidden?: boolean }): ReactElement {
  return (
    <ul aria-hidden={hidden || undefined}>
      {strip.courses.map(code => {
        const free = code.startsWith('GST')
        return <li key={code} className={free ? styles.free : undefined}>{free ? `${code} · ${strip.freeSuffix}` : code}</li>
      })}
    </ul>
  )
}

/** The list repeats once, hidden from assistive technology, so the loop is seamless. */
export function CourseStrip(): ReactElement {
  return (
    <section className={styles.strip} aria-label={strip.label}>
      <p>{strip.heading}</p>
      <div className={styles.marquee}>
        <div className={styles.track}>
          <CourseList />
          <CourseList hidden />
        </div>
      </div>
    </section>
  )
}
