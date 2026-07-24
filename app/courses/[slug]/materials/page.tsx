// Course materials (/courses/[slug]/materials) — server-rendered, course-aware.
// Materials aren't hosted in-app for most courses; instead this page routes the
// student to WhatsApp with a pre-filled, course-specific message — either to
// request materials or to contribute their own. Number comes from the shared
// buildWhatsAppUrl helper (env-driven), never hardcoded.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { courses, getCourseBySlug } from '@/lib/data/courses'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

type PageProps = { params: Promise<{ slug: string }> }

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

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
      <header className="bg-ci-navy text-white" data-screen-label="Materials">
        <div className={cx(WRAP, 'py-14 min-[900px]:py-[72px]')}>
          <nav
            className="mb-9 flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-ci-blue-200"
            aria-label="Breadcrumb"
          >
            <Link href="/" className="transition-colors hover:text-white">Home</Link>
            <span className="text-white/35">/</span>
            <Link href="/courses" className="transition-colors hover:text-white">Courses</Link>
            <span className="text-white/35">/</span>
            <Link
              href={`/courses/${course.slug}`}
              className="transition-colors hover:text-white"
            >
              {course.code}
            </Link>
            <span className="text-white/35">/</span>
            <span className="text-white">Materials</span>
          </nav>

          <div className="text-[13px] font-bold uppercase tracking-[0.14em] text-ci-accent">
            {course.code}
          </div>
          <h1 className="mt-3 max-w-[20ch] text-balance text-[clamp(36px,7vw,56px)] font-extrabold leading-none tracking-[-0.035em]">
            {course.title}
          </h1>
          <p className="mt-5 max-w-[54ch] text-[17px] leading-[1.6] text-ci-blue-200 min-[900px]:text-[19px]">
            Request study materials for this course, or contribute notes and past questions of your own.
          </p>
        </div>
      </header>

      <section className="py-14 min-[900px]:py-[72px]" data-screen-label="Material options">
        <div className={WRAP}>
          <div className="mx-auto max-w-[720px] rounded-[18px] border border-ci-border bg-ci-white p-6 shadow-ci-card min-[680px]:p-8">
            <div className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
              <a
                className={cx(btnBase, btnAccent, 'w-full')}
                href={requestUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Request study materials for ${course.code} on WhatsApp (opens in a new tab)`}
              >
                Request materials
              </a>
              <a
                className={cx(btnBase, btnNavy, 'w-full')}
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Share study materials for ${course.code} on WhatsApp (opens in a new tab)`}
              >
                Send materials
              </a>
            </div>

            <p className="mt-4 text-[13.5px] leading-[1.5] text-ci-gray-500">
              Opens WhatsApp with your request pre-filled for {course.code}.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
