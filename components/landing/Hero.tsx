// components/landing/Hero.tsx — Opening promise, the two primary actions and the hero photograph.
import Image from 'next/image'
import Link from 'next/link'
import { btnAccent, btnBase, btnGhost, btnSm, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { hero, images } = landingContent
const CTA = 'rounded-full px-[26px] py-[14px] text-[16px] font-bold'

/** The text is in the first frame: nothing fades or slides in. Early Access renders only when its form link is configured. */
export function Hero({ earlyAccessUrl }: { earlyAccessUrl: string | null }): ReactElement {
  return (
    <section className={styles.hero} aria-labelledby="landing-title">
      <div className={`app-container ${styles.heroGrid}`}>
        <div>
          <h1 id="landing-title" className={styles.heroTitle}>
            {hero.titleLead}{' '}
            <span className={styles.emphasis}>{hero.titleEmphasis}</span>
          </h1>
          <p className={styles.lead}>{hero.lead}</p>
          <div className={styles.ctas}>
            <Link href={hero.primary.href} prefetch={false} className={buttonClassName(btnBase, btnAccent, CTA)}>{hero.primary.label}</Link>
            <Link href={hero.secondary.href} prefetch={false} className={buttonClassName(btnBase, btnGhost, CTA, 'bg-student-surface')}>{hero.secondary.label}</Link>
          </div>
          {earlyAccessUrl && (
            <p className={styles.earlyAccess}>
              <a href={earlyAccessUrl} target="_blank" rel="noopener noreferrer"
                className={buttonClassName(btnBase, btnSm, 'border-transparent bg-transparent px-0 text-student-link underline underline-offset-4 hover:text-student-primary')}>
                {hero.earlyAccess}<span className="sr-only"> {landingContent.newTab}</span>
              </a>
            </p>
          )}
        </div>
        {/* The frame has the photograph's own shape, so the picture covers all of it. The photograph loads with the page
            but is not preloaded: React adds no preload hint for an image inside <picture>, so it never jumps ahead of
            the text, the styles or the fonts. */}
        <picture className={styles.heroFrame}>
          <Image src={images.hero.src} width={images.hero.width} height={images.hero.height} alt={images.hero.alt}
            sizes="(min-width: 961px) 540px, (min-width: 700px) 42vw, (min-width: 472px) 440px, calc(100vw - 32px)" loading="eager" className={styles.heroImage} />
        </picture>
      </div>
    </section>
  )
}
