// Root layout — Variant B ("continuous blue"). Loads Hanken Grotesk via
// next/font (exposed as --font-hanken, the var tailwind's font-sans points at)
// and loads the design CSS globally. Instrument Serif / Geist are gone.
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
  themeColor: '#003E7E',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="font-sans bg-ci-paper text-ci-ink">
        <Nav />
        <main id="top">{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  )
}
