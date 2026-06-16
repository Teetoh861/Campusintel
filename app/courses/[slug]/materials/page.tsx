// Course materials (/courses/[slug]/materials) — server-rendered, course-aware.
// Materials aren't hosted in-app for most courses; instead this page routes the
// student to WhatsApp with a pre-filled, course-specific message — either to
// request materials or to contribute their own. Number comes from the shared
// buildWhatsAppUrl helper (env-driven), never hardcoded.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import '../../../../styles/pages.css'
import { courses, getCourseBySlug } from '@/lib/data/courses'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

type PageProps = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return courses.map((c) => ({ slug: c.slug }))
}

export default async function CourseMaterialsPage({ params }: PageProps) {
  const { slug } = await params
  const course = getCourseBySlug(slug)
  if (!course) notFound()

  // Exact messages substitute the real code + title. Encoding is handled by
  // buildWhatsAppUrl (encodeURIComponent), so we pass plain text here.
  const requestUrl = buildWhatsAppUrl(
    `Hi, I'd like to request study materials for ${course.code} — ${course.title}.`,
  )
  const shareUrl = buildWhatsAppUrl(
    `Hi, I'd like to share study materials for ${course.code} — ${course.title}.`,
  )

  return (
    <>
      <header className="course-cover" data-screen-label="Cover">
        <HeroMotif />
        <div className="wrap">
          <nav className="crumb" aria-label="Breadcrumb">
            <Link href="/">Home</Link>
            <span className="sep">/</span>
            <Link href="/courses">Courses</Link>
            <span className="sep">/</span>
            <Link href={`/courses/${course.slug}`}>{course.code}</Link>
            <span className="sep">/</span>
            <span className="cur">Materials</span>
          </nav>

          <div className="cover-code">{course.code}</div>
          <h1 className="cover-title">{course.title}</h1>
          <p className="cover-desc">
            Study materials for this course are shared over WhatsApp. Request
            what you need, or contribute notes and past questions of your own —
            pick an option below.
          </p>
        </div>
      </header>

      <section className="pg-body" data-screen-label="Material options">
        <div className="wrap">
          <div className="contact-list">
            {/* The lone teal accent on this page: the primary "request" action. */}
            <a
              className="contact-row primary"
              href={requestUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Request study materials for ${course.code} on WhatsApp (opens in a new tab)`}
            >
              <div className="cr-main">
                <div className="cr-k">
                  <span className="sig" />Request materials · WhatsApp
                </div>
                <div className="cr-v">
                  Ask for notes, past questions and slides for {course.code}
                </div>
              </div>
              <span className="cr-go" aria-hidden="true">
                &rarr;
              </span>
            </a>

            <a
              className="contact-row"
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Share study materials for ${course.code} on WhatsApp (opens in a new tab)`}
            >
              <div className="cr-main">
                <div className="cr-k">Share materials · WhatsApp</div>
                <div className="cr-v">
                  Have notes or past questions? Send them in to help your set
                </div>
              </div>
              <span className="cr-go" aria-hidden="true">
                &rarr;
              </span>
            </a>
          </div>

          <p className="contact-meta">
            Both options open WhatsApp with a message pre-filled for {course.code}.
            Typical response · within a day · Mon–Sat, 9:00–18:00 WAT
          </p>
        </div>
      </section>
    </>
  )
}
