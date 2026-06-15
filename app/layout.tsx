// Root layout — wires fonts to the CSS variables that styles/campusintel.css
// expects (--serif / --sans / --mono) and loads the design CSS globally.
import type { Metadata, Viewport } from 'next'
import { Instrument_Serif } from 'next/font/google'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

import '../styles/campusintel.css'
import './globals.css'

import { Nav } from '@/components/chrome/Nav'
import { Footer } from '@/components/chrome/Footer'

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
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
  themeColor: '#FAF8F4',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const fontClass = `${instrumentSerif.variable} ${GeistSans.variable} ${GeistMono.variable}`
  return (
    <html lang="en" className={fontClass}>
      <body>
        <Nav />
        <main id="top">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
