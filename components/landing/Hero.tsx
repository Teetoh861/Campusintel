// components/landing/Hero.tsx — Opening promise, primary actions and the hero visual (the page's LCP image).
import Image from 'next/image'
import Link from 'next/link'
import { Check } from 'lucide-react'
import { btnAccent, btnBase, btnGhost, btnSm, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import { LandingIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { hero, images } = landingContent
const CTA = 'rounded-full px-[26px] py-[14px] text-[16px] font-bold'
const CHIP_PLACEMENT = [styles.c1, styles.c3]
const CHIP_TONE = [styles.chipBlue, styles.chipWarm]

/** Early Access renders only when its form link is configured. */
export function Hero({ earlyAccessUrl }: { earlyAccessUrl: string | null }): ReactElement {
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={`app-container ${styles.heroGrid}`}>
        <div>
          <p className={`${styles.tagChip} ${styles.rise}`}><b>{hero.chipStrong}</b> {hero.chipText}</p>
          <p className={`${styles.tagline} ${styles.rise} ${styles.d1}`}>{hero.tagline}</p>
          <h1 id="landing-title" className={`${styles.heroTitle} ${styles.rise} ${styles.d2}`}>
            {hero.titleLead}{' '}
            <span className={styles.emphasis}>{hero.titleEmphasis}</span>
          </h1>
          <p className={`${styles.lead} ${styles.rise} ${styles.d3}`}>{hero.lead}</p>
          <div className={`${styles.ctas} ${styles.rise} ${styles.d4}`}>
            <Link href={hero.primary.href} prefetch={false} className={buttonClassName(btnBase, btnAccent, CTA)}>{hero.primary.label}</Link>
            <Link href={hero.secondary.href} className={buttonClassName(btnBase, btnGhost, CTA, 'bg-student-surface')}>{hero.secondary.label}</Link>
          </div>
          {earlyAccessUrl && (
            <p className={`${styles.earlyAccess} ${styles.rise} ${styles.d4}`}>
              <a href={earlyAccessUrl} target="_blank" rel="noopener noreferrer"
                className={buttonClassName(btnBase, btnSm, 'border-transparent bg-transparent px-0 text-student-link underline underline-offset-4 hover:text-student-primary')}>
                {hero.earlyAccess}<span className="sr-only"> {landingContent.newTab}</span>
              </a>
            </p>
          )}
          <ul className={`${styles.trust} ${styles.rise} ${styles.d5}`}>
            {hero.trust.map(item => <li key={item}><Check aria-hidden="true" size={18} strokeWidth={2.5} />{item}</li>)}
          </ul>
        </div>

        <div className={styles.visual} aria-hidden="true">
          <div className={styles.people}>
            <Image src={images.hero.src} width={images.hero.width} height={images.hero.height} alt=""
              sizes="(min-width: 961px) 540px, 92vw" preload fetchPriority="high" className={styles.peopleImg} />
          </div>
          <div className={styles.bot}>
            <Image src={images.campusBot.src} width={images.campusBot.width} height={images.campusBot.height} alt=""
              sizes="110px" className={styles.botImg} />
          </div>
          {hero.chips.map((chip, index) => (
            <div key={chip.title} className={`${styles.float} ${CHIP_PLACEMENT[index]}`}>
              <div className={styles.chip}>
                <span className={`${styles.chipIcon} ${CHIP_TONE[index]}`}><LandingIcon name={chip.icon} size={20} /></span>
                <span>{chip.title}<small>{chip.note}</small></span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
