// app/page.tsx — Public landing page, prerendered when the site is built. The proxy sends a signed-in student to their
// home before this page is served (lib/supabase/proxy.ts), so nothing here reads the session on the server.
import { CourseFigures } from '@/components/landing/CourseFigures'
import { Faq } from '@/components/landing/Faq'
import { Features } from '@/components/landing/Features'
import { FinalCta } from '@/components/landing/FinalCta'
import { Hero } from '@/components/landing/Hero'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { Showcase } from '@/components/landing/Showcase'
import { SignedInHome } from '@/components/landing/SignedInHome'
import { TryQuestion } from '@/components/landing/TryQuestion'
import { landingDisplay } from '@/components/landing/fonts'
import styles from '@/components/landing/landing.module.css'
import { landingContent } from '@/lib/landing/content'
import { landingLinks } from '@/lib/landing/settings'
import type { ReactElement } from 'react'

// One page for every visitor, built once. `force-static` also hands the shared root layout empty request data for this
// route, so its session read answers "unknown" without asking Auth or the database.
export const dynamic = 'force-static'

/** Landing page; optional actions hide when their setting is unset. The copyright year is the year of the build. */
export default function HomePage(): ReactElement {
  const links = landingLinks(landingContent.finalCta.waitlistMessage)
  return (
    <div className={`${styles.landing} ${landingDisplay.variable}`}>
      <SignedInHome />
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
  )
}
