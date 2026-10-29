// components/landing/LandingFooter.tsx — Landing footer: product anchors, contact, social links and the community.
import Image from 'next/image'
import Link from 'next/link'
import { btnBase, btnGhost, btnNavy, btnSm, buttonClassName } from '@/components/chrome/ui'
import { CONTACT_EMAIL, INSTAGRAM_URL, X_URL } from '@/lib/contact'
import { landingContent } from '@/lib/landing/content'
import { fillTemplate } from '@/lib/landing/format'
import { BrandIcon } from './icons'
import styles from './landing.module.css'
import type { ReactElement, ReactNode } from 'react'

const { brand, finalCta, footer } = landingContent
const LINK = buttonClassName(btnBase, btnSm, btnGhost,
  'min-w-11 max-w-full justify-start border-transparent px-0 text-[16px] font-normal text-student-text-secondary hover:border-transparent hover:bg-transparent hover:text-ci-blue-600 [overflow-wrap:anywhere]')
// The footer's one button: a white brand mark only appears inside a Navy button on the white footer.
const COMMUNITY_BUTTON = buttonClassName(btnBase, btnSm, btnNavy, 'my-1 justify-start rounded-full text-left')

function External({ href, className = LINK, children }: { href: string; className?: string; children: ReactNode }): ReactElement {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}<span className="sr-only"> {landingContent.newTab}</span>
    </a>
  )
}

/** "WhatsApp us" and the community button render only when their settings are configured. */
export function LandingFooter({ whatsAppUrl, communityUrl, year }: {
  whatsAppUrl: string | null; communityUrl: string | null; year: number
}): ReactElement {
  return (
    <footer className={styles.footer}>
      <div className={`app-container ${styles.footerGrid}`}>
        <div>
          <Image src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt={brand.logo.alt}
            sizes="132px" className={styles.footerLogo} />
          <p className={styles.footerText}>{footer.text}</p>
        </div>
        <nav aria-labelledby="footer-product">
          <h2 id="footer-product">{footer.productHeading}</h2>
          <ul>{footer.product.map(link => <li key={link.href}><Link href={link.href} className={LINK}>{link.label}</Link></li>)}</ul>
        </nav>
        <div>
          <h2>{footer.contactHeading}</h2>
          <ul>
            {whatsAppUrl && <li><External href={whatsAppUrl}>{footer.whatsApp}</External></li>}
            <li><a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>{CONTACT_EMAIL}</a></li>
          </ul>
        </div>
        <div>
          <h2>{footer.followHeading}</h2>
          <ul>
            <li><External href={INSTAGRAM_URL}>{footer.instagram}</External></li>
            <li><External href={X_URL}>{footer.x}</External></li>
          </ul>
        </div>
        <div>
          <h2>{footer.communityHeading}</h2>
          {communityUrl && <External href={communityUrl} className={COMMUNITY_BUTTON}>
            <BrandIcon name="whatsapp" />{finalCta.community}
          </External>}
          <p className={styles.footerText}>{footer.newsletter}</p>
        </div>
      </div>
      <div className={`app-container ${styles.copyLine}`}>
        <span>{fillTemplate(footer.copyright, { year })}</span>
        <span>{brand.tagline}</span>
      </div>
    </footer>
  )
}
