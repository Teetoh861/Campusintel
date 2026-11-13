// app/page.tsx — Public landing page; verified students are sent to their home before any of it renders.
import { PublicHomeBoundary } from '@/components/auth/PublicHomeBoundary'
import { CourseFigures } from '@/components/landing/CourseFigures'
import { Faq } from '@/components/landing/Faq'
import { Features } from '@/components/landing/Features'
import { FinalCta } from '@/components/landing/FinalCta'
import { Hero } from '@/components/landing/Hero'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { Showcase } from '@/components/landing/Showcase'
import { TryQuestion } from '@/components/landing/TryQuestion'
import { landingDisplay } from '@/components/landing/fonts'
import styles from '@/components/landing/landing.module.css'
import { landingContent } from '@/lib/landing/content'
import { landingLinks } from '@/lib/landing/settings'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'

/** Landing page for signed-out visitors; optional actions hide when their setting is unset. */
export default function HomePage(): ReactElement {
  const links = landingLinks(landingContent.finalCta.waitlistMessage)
  return (
    <PublicHomeBoundary>
      <div className={`${styles.landing} ${landingDisplay.variable}`}>
        <LandingHeader />
        <Hero earlyAccessUrl={links.earlyAccess} />
        <TryQuestion />
        <Features />
        <Showcase />
        <CourseFigures />
        <Faq />
        <FinalCta communityUrl={links.community} waitlistUrl={links.waitlist} />
        <LandingFooter whatsAppUrl={links.whatsApp} communityUrl={links.community} year={new Date().getFullYear()} />
      </div>
    </PublicHomeBoundary>
  )
}
