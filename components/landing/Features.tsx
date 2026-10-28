// components/landing/Features.tsx — What students get, on the navy band.
import Image from 'next/image'
import { landingContent } from '@/lib/landing/content'
import { LandingIcon } from './icons'
import styles from './landing.module.css'
import type { Feature } from '@/lib/landing/content'
import type { ReactElement } from 'react'

const { features, images } = landingContent

function FeatureCard({ item }: { item: Feature }): ReactElement {
  const classes = [styles.fcard, item.highlight && styles.fcardHi, item.campusBot && styles.fcardUp].filter(Boolean).join(' ')
  return (
    <li className={classes}>
      {item.badge && <span className={styles.soon}>{item.badge}</span>}
      {item.campusBot && (
        <div className={styles.dangle} aria-hidden="true">
          <div className={styles.dbot}>
            <span className={styles.face} />
            <Image src={images.campusBot.src} width={images.campusBot.width} height={images.campusBot.height} alt=""
              sizes="92px" className={styles.botImg} />
          </div>
        </div>
      )}
      <div className={styles.fcardIcon}><LandingIcon name={item.icon} size={24} /></div>
      <h3>{item.title}</h3>
      <p>{item.text}</p>
    </li>
  )
}

export function Features(): ReactElement {
  return (
    <section id={features.id} className={`${styles.band} ${styles.sec} ${styles.anchor}`} aria-labelledby="features-title">
      <div className={`app-container ${styles.bandInner}`}>
        <div className={styles.secHead}>
          <span className={styles.eyebrow}>{features.eyebrow}</span>
          <h2 id="features-title">{features.title}</h2>
          <p>{features.text}</p>
        </div>
        <ul className={styles.grid6}>
          {features.items.map(item => <FeatureCard key={item.title} item={item} />)}
        </ul>
      </div>
    </section>
  )
}
