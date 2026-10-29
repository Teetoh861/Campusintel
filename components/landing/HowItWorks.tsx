// components/landing/HowItWorks.tsx — Three steps from choosing courses to closing gaps.
import { landingContent } from '@/lib/landing/content'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { how } = landingContent

export function HowItWorks(): ReactElement {
  return (
    <section id={how.id} className={`${styles.sec} ${styles.anchor}`} aria-labelledby="how-title">
      <div className="app-container">
        <div className={`${styles.secHead} ${styles.center}`}>
          <span className={styles.eyebrow}>{how.eyebrow}</span>
          <h2 id="how-title">{how.title}</h2>
          <p>{how.text}</p>
        </div>
        <ol className={styles.stepsGrid}>
          {how.steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <div className={styles.num} aria-hidden="true">{index + 1}</div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
