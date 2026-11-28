// Root layout — shared navigation, student design tokens, and legacy styles.
import localFont from 'next/font/local'
import { Analytics } from '@vercel/analytics/next'
import { readStudentChromeState } from '@/lib/auth/server-chrome'

import '../styles/campusintel.css'
import './globals.css'
import '../styles/student-app.css'
import '../styles/ai-practice.css'
import '../styles/instant-practice.css'
import '../styles/campus-bot.css'

import { Nav } from '@/components/chrome/Nav'
import { Footer } from '@/components/chrome/Footer'
import { NavigationSessionProvider } from '@/components/auth/NavigationSession'
import type { Metadata, Viewport } from 'next'
import type { ReactElement, ReactNode } from 'react'

// Latin-only WOFF2 subsets and their OFL licenses live in app/fonts; builds need no font fetch.
const hanken = localFont({
  src: [
    { path: './fonts/HankenGrotesk-Latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/HankenGrotesk-Latin.woff2', weight: '500', style: 'normal' },
    { path: './fonts/HankenGrotesk-Latin.woff2', weight: '600', style: 'normal' },
    { path: './fonts/HankenGrotesk-Latin.woff2', weight: '700', style: 'normal' },
    { path: './fonts/HankenGrotesk-Latin.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-hanken',
})

const SITE_TITLE = 'CampusIntell'
const SITE_DESCRIPTION =
  'Verified past questions, study guides and timed exam practice for UNILAG students.'

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
