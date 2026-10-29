// app/page.tsx — Public landing page; verified students are sent to their home before any of it renders.
import { PublicHomeBoundary } from '@/components/auth/PublicHomeBoundary'
import { CourseStrip } from '@/components/landing/CourseStrip'
import { Faq } from '@/components/landing/Faq'
import { Features } from '@/components/landing/Features'
import { FinalCta } from '@/components/landing/FinalCta'
import { Hero } from '@/components/landing/Hero'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { LandingFooter } from '@/components/landing/LandingFooter'
import { LandingHeader } from '@/components/landing/LandingHeader'
import { OtherFaculties } from '@/components/landing/OtherFaculties'
import { Showcase } from '@/components/landing/Showcase'
import { TryQuestion } from '@/components/landing/TryQuestion'
import { WhyCampusIntell } from '@/components/landing/WhyCampusIntell'
import { landingBody, landingDisplay } from '@/components/landing/fonts'
import styles from '@/components/landing/landing.module.css'
import { landingContent } from '@/lib/landing/content'
import { landingLinks } from '@/lib/landing/settings'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'

/** Landing page for signed-out visitors; optional actions hide when their setting is unset. */
export default function HomePage(): ReactElement {
  const links = landingLinks(landingContent.otherFaculties.waitlistMessage)
  return (
    <PublicHomeBoundary>
      <div className={`${styles.landing} ${landingDisplay.variable} ${landingBody.variable}`}>
        <LandingHeader />
        <Hero earlyAccessUrl={links.earlyAccess} />
        <CourseStrip />
        <Features />
        <Showcase />
        <TryQuestion />
        <HowItWorks />
        <WhyCampusIntell />
        <OtherFaculties waitlistUrl={links.waitlist} />
        <Faq />
        <FinalCta communityUrl={links.community} />
        <LandingFooter whatsAppUrl={links.whatsApp} communityUrl={links.community} year={new Date().getFullYear()} />
      </div>
    </PublicHomeBoundary>
  )
}
