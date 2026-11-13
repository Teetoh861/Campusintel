// components/landing/LandingHeader.tsx — Landing header: logo, two section links from tablet up, and account entry.
import Image from 'next/image'
import Link from 'next/link'
import { btnBase, btnGhost, btnNavy, btnSm, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { brand, header } = landingContent

/** Sticky landing header with no menu: phones show the logo, Log in and Create account; tablets add the two links. */
export function LandingHeader(): ReactElement {
  return (
    <header className={styles.header}>
      <div className={`app-container ${styles.headerBar}`}>
        <Link href="#top" prefetch={false} aria-label={brand.homeLabel}
          className={buttonClassName(btnBase, btnSm, btnGhost, 'shrink-0 border-transparent px-1')}>
          {/* The first thing on the page: loaded at once, never lazily. */}
          <Image src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt=""
            sizes="(min-width: 521px) 139px, 111px" loading="eager" className={styles.logo} />
        </Link>
        <nav aria-label={header.navLabel} className={styles.headerLinks}>
          {header.links.map(link => (
            <Link key={link.href} href={link.href} prefetch={false}
              className={buttonClassName(btnBase, btnSm, btnGhost, 'border-transparent px-3 text-student-text-primary')}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <Link href={header.login.href} prefetch={false}
            className={buttonClassName(btnBase, btnSm, btnGhost, 'whitespace-nowrap rounded-full')}>
            {header.login.label}
          </Link>
          <Link href={header.register.href} prefetch={false}
            className={buttonClassName(btnBase, btnSm, btnNavy, 'whitespace-nowrap rounded-full')}>
            {header.register.label}
          </Link>
        </div>
      </div>
    </header>
  )
}
