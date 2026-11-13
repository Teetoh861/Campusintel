// Root layout — shared navigation, student design tokens, and legacy styles.
import { Hanken_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { readStudentChromeState } from '@/lib/auth/server-chrome'

import '../styles/campusintel.css'
import './globals.css'
import '../styles/student-app.css'
import '../styles/ai-practice.css'
import '../styles/instant-practice.css'

import { Nav } from '@/components/chrome/Nav'
import { Footer } from '@/components/chrome/Footer'
import { NavigationSessionProvider } from '@/components/auth/NavigationSession'
import type { Metadata, Viewport } from 'next'
import type { ReactElement, ReactNode } from 'react'

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-hanken',
})

const SITE_TITLE = 'CampusIntell · Past questions and exam practice for UNILAG'
const SITE_DESCRIPTION =
  'Verified past questions, study guides and timed exam practice for Management Sciences courses at the University of Lagos.'

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    type: 'website',
    locale: 'en_NG',
    siteName: 'CampusIntell',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/** Share presentation state while keeping route authorization in the existing server boundaries.
 * The first render shares verified identity and lifecycle with the gate and page.
 */
export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): Promise<ReactElement> {
  const chrome = await readStudentChromeState()
  return (
    <html lang="en" className={hanken.variable}>
      <body className="flex min-h-dvh flex-col font-sans">
        <NavigationSessionProvider initial={chrome}>
          <Nav />
          <main id="top" className="flex-1">{children}</main>
          <Footer year={new Date().getFullYear()} />
        </NavigationSessionProvider>
        <Analytics />
      </body>
    </html>
  )
}
