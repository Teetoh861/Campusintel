import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import './globals.css'
import { MobileNav } from '@/components/navigation/MobileNav'
import { Footer } from '@/components/common/Footer'

const _geist = Geist({ subsets: ['latin'] })
const _geistMono = Geist_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'CampusIntel - Academic Resource Hub | UNILAG Business Administration',
  description:
    'Your Academic Intelligence Hub for Department of Business Administration at University of Lagos. Access course materials, textbooks, quizzes, exam resources, and connect with peer tutors.',
  generator: 'v0.app',
  keywords: ['UNILAG', 'University of Lagos', 'Business Administration', 'study materials', 'past questions', 'quizzes', 'peer tutoring', 'BUA203', 'BUA210', 'ACC201'],
  authors: [{ name: 'CampusIntel' }],
  openGraph: {
    title: 'CampusIntel - Your Academic Intelligence Hub',
    description: 'Access course materials, quizzes, and connect with peer tutors for UNILAG Business Administration.',
    type: 'website',
    locale: 'en_NG',
    siteName: 'CampusIntel',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CampusIntel - Academic Resource Hub',
    description: 'Your Academic Intelligence Hub for UNILAG Business Administration students.',
  },
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
