// components/landing/Showcase.tsx — Campus Bot practice from notes and theory practice, each beside real app screens.
import Image from 'next/image'
import { Check } from 'lucide-react'
import { landingContent } from '@/lib/landing/content'
import styles from './landing.module.css'
import type { ShowcaseRow } from '@/lib/landing/content'
import type { ReactElement } from 'react'

// A screen is shown at its own 350 CSS px, or the phone's width when that is narrower.
const SHOT_SIZES = '(min-width: 600px) 350px, calc(100vw - 32px)'

function Row({ row }: { row: ShowcaseRow }): ReactElement {
  const pair = row.shots.length > 1
  return (
    <div className={`${styles.row} ${pair ? styles.rowPair : styles.rowSingle} ${row.flip ? styles.flip : ''}`}>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{row.eyebrow}</span>
        <h2>{row.title}</h2>
        <p className={styles.copyText}>{row.text}</p>
        {row.ticks.length > 0 && (
          <ul className={styles.ticks}>
            {row.ticks.map(tick => (
              <li key={tick}><span className={styles.tick}><Check aria-hidden="true" size={14} strokeWidth={3} /></span>{tick}</li>
            ))}
          </ul>
        )}
      </div>
      <div className={`${styles.shots} ${pair ? styles.shotsPair : ''}`}>
        {/* Each picture is its own frame: the screenshot's shape, with no added border or rounding. */}
        {row.shots.map(shot => (
          <Image key={shot.src} src={shot.src} width={shot.width} height={shot.height} alt={shot.alt} sizes={SHOT_SIZES}
            className={styles.shot} />
        ))}
      </div>
    </div>
  )
}

export function Showcase(): ReactElement {
  return (
    <section className={styles.sec}>
      <div className="app-container">
        {landingContent.showcase.map(row => <Row key={row.title} row={row} />)}
      </div>
    </section>
  )
}
