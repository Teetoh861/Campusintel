// Root layout — shared navigation, student design tokens, and legacy styles.
import { Hanken_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'

import '../styles/campusintel.css'
import './globals.css'
import '../styles/student-app.css'

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

export const metadata: Metadata = {
  title: 'CampusIntel · The inside track on every paper',
  description:
    'Academic intelligence for the University of Lagos. Past questions, decoded exam patterns and the materials that actually move your grade.',
  openGraph: {
    title: 'CampusIntel · Academic Intelligence',
    description: 'The inside track on every paper.',
    type: 'website',
    locale: 'en_NG',
    siteName: 'CampusIntel',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CampusIntel · Academic Intelligence',
    description: 'The inside track on every paper.',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

/** Share presentation state while keeping route authorization in the existing server boundaries. */
export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): ReactElement {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="flex min-h-dvh flex-col font-sans">
        <NavigationSessionProvider>
          <Nav />
          <main id="top" className="flex-1">{children}</main>
          <Footer year={new Date().getFullYear()} />
        </NavigationSessionProvider>
        <Analytics />
      </body>
    </html>
  )
}
