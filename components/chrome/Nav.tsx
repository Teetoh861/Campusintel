// Nav — global sticky header. Ports _design/bundle/nav.bundle.html into a
// client component (the mobile drawer toggle owns the only piece of state).
// Aperture-C mark and wordmark are kept identical to the comp.
'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

const WHATSAPP_URL = buildWhatsAppUrl('Hello, I need help with CampusIntel')

const NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: '/courses', label: 'Courses' },
  { href: '/bookmarks', label: 'Bookmarks' },
  { href: '/tutors', label: 'Tutors' },
  { href: '/contact', label: 'Contact' },
]

export function Nav() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <nav className="site-nav" data-screen-label="Nav">
      <div className="wrap">
        <div className="bar">
          <Link href="/" className="brand" aria-label="CampusIntel home" onClick={close}>
            <ApertureMark size={25} />
            <Wordmark />
          </Link>
          <span className="nav-tag">University of Lagos</span>
          <span className="nav-spacer" />
          <div className="nav-links">
            {NAV_LINKS.map((link, i) => (
              <Fragment key={link.href}>
                <Link href={link.href}>{link.label}</Link>
                {i < NAV_LINKS.length - 1 ? <span className="sep">·</span> : null}
              </Fragment>
            ))}
          </div>
          <div className="nav-actions">
            <Link className="btn btn-primary btn-sm" href="/courses">
              Browse courses
            </Link>
          </div>
          <button
            type="button"
            className="nav-menu"
            aria-label="Menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="ln" />
            <span className="ln" />
            <span className="ln" />
          </button>
        </div>
      </div>
      <div className={`nav-drawer${open ? ' open' : ''}`}>
        <div className="wrap">
          <div className="dr-inner">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="dl" onClick={close}>
                <span>{link.label}</span>
              </Link>
            ))}
            <div className="dr-cta">
              <Link className="btn btn-primary" href="/courses" onClick={close}>
                Browse courses <span className="arrow">&rarr;</span>
              </Link>
              <a
                className="btn btn-secondary"
                href={WHATSAPP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                Message on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}

function ApertureMark({ size }: { size: number }) {
  return (
    <svg
      className="ap"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path
        d="M 76.2 68.35 A 32 32 0 1 1 76.2 31.65"
        fill="none"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <circle cx="84.5" cy="50" r="7.5" fill="#0E9180" />
    </svg>
  )
}

function Wordmark() {
  return (
    <span className="wordmark">
      <span className="campus">Campus</span>
      <span className="i-wrap">
        {'ı'}
        <span className="tdot" />
      </span>
      <span className="campus">ntel</span>
    </span>
  )
}
