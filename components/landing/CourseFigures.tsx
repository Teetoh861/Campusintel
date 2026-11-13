// components/landing/CourseFigures.tsx — One still line of figures: courses ready to practise, questions and departments.
import { landingContent } from '@/lib/landing/content'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { courses } = landingContent

/** The figures come from lib/landing/figures.ts, which the build writes from the repository's content. */
export function CourseFigures(): ReactElement {
  return (
    <section className={styles.figures} aria-label={courses.label}>
      <div className="app-container">
        <ul className={styles.figureList}>
          {courses.figures.map(figure => <li key={figure.label}><b>{figure.value}</b> {figure.label}</li>)}
        </ul>
      </div>
    </section>
  )
}
