import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { MobileNav } from '@/components/navigation/MobileNav'
import { Footer } from '@/components/common/Footer'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CampusIntel - Academic Resource Hub',
  description:
    'Your Academic Intelligence Hub for Department of Business Administration at University of Lagos. Access course materials, textbooks, quizzes, and exam resources.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1e3a8a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="bg-white">
      <body className="font-sans antialiased bg-white text-slate-900">
        <MobileNav />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
