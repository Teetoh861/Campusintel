// components/landing/WhyCampusIntell.tsx — Why the product is different, with the catalogue figures.
import { landingContent } from '@/lib/landing/content'
import { LandingIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { why } = landingContent

export function WhyCampusIntell(): ReactElement {
  return (
    <section className={`${styles.sec} ${styles.secTight}`} aria-labelledby="why-title">
      <div className="app-container">
        <div className={styles.secHead}>
          <span className={styles.eyebrow}>{why.eyebrow}</span>
          <h2 id="why-title">{why.title}</h2>
        </div>
        <ul className={styles.why}>
          {why.cards.map(card => (
            <li key={card.title} className={styles.wcard}>
              <span className={styles.wcardIcon}><LandingIcon name={card.icon} /></span>
              <div><h3>{card.title}</h3><p>{card.text}</p></div>
            </li>
          ))}
        </ul>
        <div className={styles.nums}>
          {why.figures.map(figure => <div key={figure.label}><b>{figure.value}</b><span>{figure.label}</span></div>)}
        </div>
      </div>
    </section>
  )
}
