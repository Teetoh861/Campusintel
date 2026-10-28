// components/landing/FinalCta.tsx — Closing call to action and the optional WhatsApp community link.
import Image from 'next/image'
import Link from 'next/link'
import { btnAccent, btnBase, btnGhostOnBlue, btnSm, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import { BrandIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { finalCta: cta, images } = landingContent
const CTA = 'rounded-full px-[26px] py-[14px] text-[16px] font-bold'

/** The community link renders only when NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL is set. */
export function FinalCta({ communityUrl }: { communityUrl: string | null }): ReactElement {
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
              <a href={communityUrl} target="_blank" rel="noopener noreferrer"
                className={buttonClassName(btnBase, btnSm, btnGhostOnBlue, 'mt-5 border-transparent px-0 hover:border-transparent')}>
                <BrandIcon name="whatsapp-on-navy" />
                {cta.community}<span className="sr-only"> {landingContent.newTab}</span>
              </a>
            )}
          </div>
          <div className={styles.botBig} aria-hidden="true">
            <span className={styles.face} />
            <Image src={images.campusBot.src} width={images.campusBot.width} height={images.campusBot.height} alt=""
              sizes="260px" className={styles.botImg} />
          </div>
        </div>
      </div>
    </section>
  )
}
