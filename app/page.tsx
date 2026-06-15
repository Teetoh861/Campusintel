// Homepage — server-rendered. Layout, copy and section numbering follow
// _design/home.html. Real course data flows in from lib/data/courses.ts;
// stat figures are derived from that data where possible.
import Link from 'next/link'
import { courses } from '@/lib/data/courses'
import type { Course } from '@/lib/types'
import { quizzes } from '@/lib/data/quizzes'
import { Card, type CardProps } from '@/components/chrome/Card'
import { HeroMotif } from '@/components/chrome/HeroMotif'
import type { DifficultyLevel } from '@/components/chrome/SignalBar'

const WHATSAPP_URL =
  'https://wa.me/2349018750976?text=Hello%2C%20I%20need%20help%20with%20CampusIntel'

const intelIndex = (i: number) => `Intel ${String(i + 1).padStart(2, '0')}`

const toLevel = (d: Course['difficulty']): DifficultyLevel =>
  d === 'Easy' ? 'easy' : d === 'Hard' ? 'hard' : 'medium'

// Hard cap on the curated set the homepage surfaces. Even if more courses are
// flagged featured later, only the first three reach this section; the rest
// belong to /courses.
const HOMEPAGE_FEATURED_COUNT = 3

function cardPropsFor(course: Course, index: number): CardProps {
  const quiz = quizzes[course.slug]
  const critical = course.examCritical === true
  return {
    intelIndex: intelIndex(index),
    code: course.code,
    title: course.title,
    flag: critical
      ? { kind: 'critical', label: 'Exam-critical' }
      : { kind: 'tracked', label: 'Tracked' },
    level: String(course.level),
    credits: `${course.credits} CR`,
    questions: quiz ? String(quiz.totalQuestions) : '—',
    timeLimit: quiz ? `${quiz.quizDurationMinutes} MIN` : '—',
    difficulty: toLevel(course.difficulty),
    cta: critical
      ? {
          label: 'Start quiz',
          href: `/courses/${course.slug}/quiz`,
          variant: 'primary',
          withArrow: true,
        }
      : {
          label: 'View course',
          href: `/courses/${course.slug}`,
          variant: 'secondary',
        },
  }
}

function pickFeatured(all: ReadonlyArray<Course>): ReadonlyArray<Course> {
  const flagged = all.filter((c) => c.featured).slice(0, HOMEPAGE_FEATURED_COUNT)
  // Fallback: if nothing is flagged, never render an empty section.
  return flagged.length > 0 ? flagged : all.slice(0, HOMEPAGE_FEATURED_COUNT)
}

export default function HomePage() {
  const courseCount = courses.length
  const textbookCount = courses.reduce((sum, c) => sum + c.textbooks.length, 0)
  const courseCountLabel = String(courseCount).padStart(2, '0')
  // Source order is preserved by pickFeatured. The render order then pulls
  // examCritical to the front so the lone teal moment leads the grid, matching
  // the comp. Array.prototype.sort is stable in modern engines, so the rest
  // keep their relative source order. courses.ts itself is untouched.
  const featured = [...pickFeatured(courses)].sort(
    // Coerce undefined→0 so the comparator is well-defined for unflagged
    // courses (Number(undefined) is NaN, which would leave the sort unstable).
    (a, b) => Number(b.examCritical === true) - Number(a.examCritical === true),
  )

  return (
    <>
      <header className="hero" data-screen-label="Hero">
        <HeroMotif />
        <div className="wrap">
          <span className="hero-stamp">
            <ApertureStamp />
            University of Lagos · Academic Intelligence
          </span>
          <h1>Know what&apos;s coming.</h1>
          <p className="hero-lead">
            Intelligence on your courses: past questions, decoded exam patterns,
            and the materials that actually move your grade.
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary" href="/courses">
              Browse courses <span className="arrow">&rarr;</span>
            </Link>
            <a
              className="btn btn-secondary"
              href={WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Message on WhatsApp
            </a>
          </div>
        </div>
      </header>

      <section className="stats-band" aria-label="At a glance">
        <div className="wrap">
          <div className="stats ticks">
            <div className="stat">
              <div className="v"><span className="num">{courseCountLabel}</span></div>
              <div className="k">Courses decoded</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="num">{textbookCount}</span>
                <span className="u">+</span>
              </div>
              <div className="k">Recommended textbooks</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="num">50</span>
                <span className="u">+</span>
              </div>
              <div className="k">Questions / course</div>
            </div>
            <div className="stat">
              <div className="v soon"><span className="soon-txt">Coming soon</span></div>
              <div className="k">Peer tutors</div>
            </div>
          </div>
          <p className="coverage">
            <span className="cov-k">Now covering</span>
            {' '}<span className="cov-sep">·</span>{' '}Business Administration
            {' '}<span className="cov-sep">·</span>{' '}200 Level
            {' '}<span className="cov-sep">·</span>{' '}First Semester
          </p>
        </div>
      </section>

      <section className="sec" id="courses" data-screen-label="Course intel">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="sk"><span className="n">01 /</span> Course intel</div>
              <h2>The intel on your courses</h2>
            </div>
            <p className="note">
              Every course is a dossier: the codes, the question bank, the time
              pressure, the difficulty. Read it before you sit it.
            </p>
          </div>

          <div className="course-grid">
            {featured.map((course, i) => (
              <Card key={course.id} {...cardPropsFor(course, i)} />
            ))}
          </div>

          <div className="viewall">
            <Link className="glink" href="/courses">
              View all {courseCount} courses <span className="arrow">&rarr;</span>
            </Link>
          </div>
        </div>
      </section>

      <section className="sec" id="bookmarks" data-screen-label="What you get">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="sk"><span className="n">02 /</span> The dossier</div>
              <h2>What&apos;s inside every file</h2>
            </div>
            <p className="note">
              Four kinds of intelligence per course, decoded down to what the
              exam actually rewards.
            </p>
          </div>

          <div className="index">
            <DossierItem
              n="Intel 01"
              title="Study notes, topic by topic"
              tag="Per topic"
              body="Decoded summaries for every topic on the syllabus: the signal pulled out of the 400-page textbook."
            />
            <DossierItem
              n="Intel 02"
              title="Timed practice quizzes"
              tag="Timed"
              body="50+ questions per course, run under real exam time pressure so the clock never surprises you."
            />
            <DossierItem
              n="Intel 03"
              title="Curated exam-focus areas"
              tag="Exam-weighted"
              body="The topics that actually recur, flagged from years of past papers, ranked by how often they're tested."
            />
            <DossierItem
              n="Intel 04"
              title="Theory questions"
              tag="Long-answer"
              body="Model long-answer questions with the structure examiners reward: not just the right point, the right shape."
            />
          </div>
        </div>
      </section>

      <section className="sec" id="tutors" data-screen-label="Academic support">
        <div className="wrap">
          <div className="sec-head">
            <div>
              <div className="sk"><span className="n">03 /</span> Support</div>
              <h2>Backup, when you need a person</h2>
            </div>
            <p className="note">
              Self-serve intel covers most of it. Peer tutoring is the human
              layer, rolling out next.
            </p>
          </div>

          <div className="support ticks">
            <div className="sup-head">
              <span className="sup-label">Support // Peer tutoring</span>
              <span className="sup-soon">Coming soon</span>
            </div>
            <div className="sup-body">
              <div>
                <h3>One-on-one help from students who&apos;ve aced the paper.</h3>
                <p>
                  Pair with a senior who has already decoded the course. Sessions
                  open next semester. If you&apos;re 300L or above, you can be on
                  the other side of the table.
                </p>
              </div>
              <div className="sup-links">
                <div className="sl-row">
                  <Link className="glink" href="/tutors">
                    Join the waitlist <span className="arrow">&rarr;</span>
                  </Link>
                  <span className="sl-note">Get notified when tutoring opens</span>
                </div>
                <div className="sl-row">
                  <Link className="glink" href="/become-a-tutor">
                    Apply to tutor <span className="arrow">&rarr;</span>
                  </Link>
                  <span className="sl-note">300L+ students · earn while you help</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sec" id="contact" data-screen-label="Closing CTA">
        <div className="wrap">
          <div className="closing">
            <ClosingMotif />
            <div className="cl-inner">
              <span className="cl-kicker">File 001 · University of Lagos</span>
              <h2>Walk in already knowing.</h2>
              <p>
                Pull the intel on your courses before the hall does. Start with
                the question bank that matters.
              </p>
              <div className="cl-cta">
                <Link className="btn btn-primary" href="/courses">
                  Browse courses <span className="arrow">&rarr;</span>
                </Link>
                <a
                  className="btn btn-secondary"
                  href={WHATSAPP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Message on WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function ClosingMotif() {
  // The closing CTA sits the motif centered behind the headline, scaled up
  // and even fainter (--n-100). Distinct enough from .hero-motif that it
  // gets its own inline render rather than reusing HeroMotif.
  return (
    <svg className="cl-motif" viewBox="0 0 100 100" aria-hidden="true">
      <path
        d="M 76.2 68.35 A 32 32 0 1 1 76.2 31.65"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="84.5" cy="50" r="3.1" fill="currentColor" />
    </svg>
  )
}

function ApertureStamp() {
  return (
    <svg className="ap" viewBox="0 0 100 100" width={13} height={13} aria-hidden="true">
      <path
        d="M 76.2 68.35 A 32 32 0 1 1 76.2 31.65"
        fill="none"
        stroke="currentColor"
        strokeWidth={13}
        strokeLinecap="round"
      />
      <circle cx="84.5" cy="50" r={9} fill="#0E9180" />
    </svg>
  )
}

type DossierItemProps = { n: string; title: string; tag: string; body: string }

function DossierItem({ n, title, tag, body }: DossierItemProps) {
  return (
    <div className="ix">
      <div className="ix-row-idx"><span className="ix-idx">{n}</span></div>
      <div className="ix-top">
        <h3>{title}</h3>
        <span className="ix-tag">{tag}</span>
      </div>
      <p>{body}</p>
    </div>
  )
}
