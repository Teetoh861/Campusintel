// components/landing/LandingHeader.tsx — Landing header: section links, Browse courses and account entry.
import Image from 'next/image'
import Link from 'next/link'
import { btnBase, btnGhost, btnNavy, btnSm, buttonClassName } from '@/components/chrome/ui'
import { landingContent } from '@/lib/landing/content'
import { MobileMenu } from './MobileMenu'
import styles from './landing.module.css'
import type { ReactElement } from 'react'

const { brand, header } = landingContent

/** Sticky landing header; below desktop the section links move into the menu. */
export function LandingHeader(): ReactElement {
  return (
    <header className={styles.header}>
      <div className={`app-container ${styles.headerBar}`}>
        <Link href="#top" aria-label={brand.homeLabel} className={buttonClassName(btnBase, btnSm, btnGhost, 'border-transparent px-1')}>
          <Image src={brand.logo.src} width={brand.logo.width} height={brand.logo.height} alt="" sizes="139px" className={styles.logo} />
        </Link>
        <nav aria-label={header.navLabel} className={styles.headerLinks}>
          {header.links.map(link => (
            <Link key={link.href} href={link.href} prefetch={false}
              className={buttonClassName(btnBase, btnSm, btnGhost, 'border-transparent px-3 text-student-text-primary')}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href={header.login.href} prefetch={false}
            className={buttonClassName(btnBase, btnSm, btnGhost, 'hidden rounded-full min-[521px]:inline-flex')}>
            {header.login.label}
          </Link>
          <Link href={header.register.href} prefetch={false} className={buttonClassName(btnBase, btnSm, btnNavy, 'rounded-full')}>
            {header.register.label}
          </Link>
          <MobileMenu links={header.links} login={header.login} register={header.register} label={header.menuLabel}
            openLabel={header.menuOpen} closeLabel={header.menuClose} />
        </div>
      </div>
    </header>
  )
}
