// components/landing/LandingFooter.tsx — Landing footer: product anchors, contact and social links.
import Image from 'next/image'
import Link from 'next/link'
import { btnBase, btnGhost, btnSm, buttonClassName } from '@/components/chrome/ui'
import { CONTACT_EMAIL, INSTAGRAM_URL, X_URL } from '@/lib/contact'
import { landingContent } from '@/lib/landing/content'
import { fillTemplate } from '@/lib/landing/format'
import { BrandIcon } from './icons'
import styles from './landing.module.css'
import type { BrandName } from './icons'
import type { ReactElement, ReactNode } from 'react'

const { brand, footer } = landingContent
const LINK = buttonClassName(btnBase, btnSm, btnGhost,
  'min-w-11 max-w-full justify-start border-transparent px-0 text-[16px] font-normal text-student-text-secondary hover:border-transparent hover:bg-transparent hover:text-ci-blue-600 [overflow-wrap:anywhere]')

function External({ href, brand, children }: { href: string; brand?: BrandName; children: ReactNode }): ReactElement {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK}>
      {brand && <BrandIcon name={brand} />}{children}<span className="sr-only"> {landingContent.newTab}</span>
    </a>
  )
}

/** "WhatsApp us" renders only when a WhatsApp number is configured. */
export function LandingFooter({ whatsAppUrl, year }: { whatsAppUrl: string | null; year: number }): ReactElement {
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
            {whatsAppUrl && <li><External href={whatsAppUrl} brand="whatsapp">{footer.whatsApp}</External></li>}
            <li><a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>{CONTACT_EMAIL}</a></li>
            <li><External href={footer.website.href}>{footer.website.label}</External></li>
          </ul>
        </div>
        <div>
          <h2>{footer.followHeading}</h2>
          <ul>
            <li><External href={INSTAGRAM_URL} brand="instagram">{footer.instagram}</External></li>
            <li><External href={X_URL} brand="x">{footer.x}</External></li>
          </ul>
        </div>
      </div>
      <div className={`app-container ${styles.copyLine}`}>
        <span>{fillTemplate(footer.copyright, { year })}</span>
        <span>{brand.tagline}</span>
      </div>
    </footer>
  )
}
