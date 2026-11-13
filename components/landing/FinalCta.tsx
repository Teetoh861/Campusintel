// components/landing/FinalCta.tsx — Closing call to action, the optional community link and the waitlist line.
import Link from 'next/link'
import { btnAccent, btnBase, btnGhostOnBlue, btnSm, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import { BrandIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { finalCta: cta } = landingContent
const CTA = 'rounded-full px-[26px] py-[14px] text-[16px] font-bold'
const TEXT_LINK = buttonClassName(btnBase, btnSm, btnGhostOnBlue, 'border-transparent px-0 hover:border-transparent')

/** The community link renders only when NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL is set, and the waitlist line only when a
 *  WhatsApp number is configured. */
export function FinalCta({ communityUrl, waitlistUrl }: { communityUrl: string | null; waitlistUrl: string | null }): ReactElement {
  return (
    <section aria-labelledby="final-cta-title">
      <div className="app-container">
        <div className={styles.cta}>
          <div>
            <h2 id="final-cta-title">{cta.title}</h2>
            <p className={styles.ctaText}>{cta.text}</p>
            <div className={styles.ctas}>
              <Link href={cta.primary.href} prefetch={false} className={buttonClassName(btnBase, btnAccent, CTA)}>{cta.primary.label}</Link>
              <Link href={cta.secondary.href} prefetch={false} className={buttonClassName(btnBase, btnGhostOnBlue, CTA)}>{cta.secondary.label}</Link>
            </div>
            {communityUrl && (
              <a href={communityUrl} target="_blank" rel="noopener noreferrer" className={`${TEXT_LINK} mt-5`}>
                <BrandIcon name="whatsapp" />
                {cta.community}<span className="sr-only"> {landingContent.newTab}</span>
              </a>
            )}
            {waitlistUrl && (
              <p className={styles.faculty}>
                {cta.facultyLead}{' '}
                <a href={waitlistUrl} target="_blank" rel="noopener noreferrer" className={`${TEXT_LINK} underline underline-offset-4`}>
                  {cta.waitlist}<span className="sr-only"> {landingContent.newTab}</span>
                </a>
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
