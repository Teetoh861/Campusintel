// Root layout — shared navigation, student design tokens, and legacy styles.
import type { Metadata, Viewport } from 'next'
import { Hanken_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'

import '../styles/campusintel.css'
import './globals.css'

import { Nav } from '@/components/chrome/Nav'
import { Footer } from '@/components/chrome/Footer'

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="font-sans">
        <Nav />
        <main id="top">{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  )
}
