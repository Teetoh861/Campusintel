// components/landing/Showcase.tsx — Notes upload and theory practice, each beside real app screens.
import Image from 'next/image'
import { Check } from 'lucide-react'
import { landingContent } from '@/lib/landing/content'
import { LandingIcon } from './icons'
import styles from './landing.module.css'
import type { ShowcaseRow } from '@/lib/landing/content'
import type { ReactElement } from 'react'

const PHONE_SIZES = '(min-width: 521px) 232px, 44vw'

function Row({ row }: { row: ShowcaseRow }): ReactElement {
  return (
    <div className={`${styles.row} ${row.flip ? styles.flip : ''} ${row.phones.length === 0 ? styles.rowText : ''}`}>
      <div className={styles.copy}>
        <span className={styles.eyebrow}>{row.eyebrow}</span>
        <h2>{row.title}</h2>
        <p className={styles.copyText}>{row.text}</p>
        <ul className={styles.ticks}>
          {row.ticks.map(tick => (
            <li key={tick}><span className={styles.tick}><Check aria-hidden="true" size={14} strokeWidth={3} /></span>{tick}</li>
          ))}
        </ul>
      </div>
      {row.phones.length > 0 && <div className={styles.stage}>
        <div className={styles.blob} />
        {row.phones.map((phone, phoneIndex) => (
          <Image key={phone.src} src={phone.src} width={phone.width} height={phone.height} alt={phone.alt} sizes={PHONE_SIZES}
            className={`${styles.screen} ${phoneIndex === 0 ? styles.screenBack : styles.screenFront}`} />
        ))}
        {row.chip && (
          <div className={`${styles.float} ${styles.s1}`} aria-hidden="true">
            <div className={styles.chip}>
              <span className={`${styles.chipIcon} ${styles.chipBlue}`}><LandingIcon name={row.chip.icon} size={18} /></span>
              {row.chip.label}
            </div>
          </div>
        )}
      </div>}
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
