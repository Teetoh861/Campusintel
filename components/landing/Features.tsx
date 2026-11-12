// components/landing/Features.tsx — What students get, in four cards on the navy band.
import { landingContent } from '@/lib/landing/content'
import { LandingIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { features } = landingContent

export function Features(): ReactElement {
  return (
    <section id={features.id} className={`${styles.band} ${styles.sec} ${styles.anchor}`} aria-labelledby="features-title">
      <div className={`app-container ${styles.bandInner}`}>
        <div className={styles.secHead}>
          <span className={styles.eyebrow}>{features.eyebrow}</span>
          <h2 id="features-title">{features.title}</h2>
        </div>
        <ul className={styles.cards}>
          {features.items.map(item => (
            <li key={item.title} className={`${styles.fcard} ${item.highlight ? styles.fcardHi : ''}`}>
              <div className={styles.fcardIcon}><LandingIcon name={item.icon} size={24} /></div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
