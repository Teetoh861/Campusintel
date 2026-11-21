// BlueCover — the shared Variant B "continuous blue" cover header used by the
// small pages (tutors, contact, become-a-tutor). Gradient navy field flush
// under the blue nav, faint dashed-ring deco, breadcrumb, a calm eyebrow, white
// title and a light-blue lead. Presentational only.
import Link from 'next/link'

const WRAP = 'app-container'

export type Crumb = { label: string; href?: string }

type Props = {
  crumbs: ReadonlyArray<Crumb>
  kicker?: string
  title: string
  lede: string
}

export function BlueCover({ crumbs, kicker, title, lede }: Props) {
  return (
    <header
      className="relative overflow-hidden bg-[linear-gradient(180deg,var(--student-navigation),var(--student-navigation-deep))] text-student-navigation-text"
      data-screen-label="Cover"
    >
      <svg
        className="absolute right-[-60px] top-[-50px] z-0 h-[300px] w-[300px] text-student-navigation-ring opacity-50"
        viewBox="0 0 200 200"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 12" strokeLinecap="round" />
      </svg>
      <div className={`${WRAP} relative z-[1] pb-[42px] pt-[30px] min-[900px]:pb-[52px] min-[900px]:pt-10`}>
        <nav className="mb-[26px] flex flex-wrap items-center gap-[10px] text-[13.5px] font-medium text-student-navigation-text-muted" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-[10px]">
              {i > 0 ? <span className="text-student-navigation-text-muted">/</span> : null}
              {c.href ? (
                <Link href={c.href} className="inline-flex min-h-11 items-center transition-colors hover:text-student-navigation-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-focus-inverse">{c.label}</Link>
              ) : (
                <span className="text-student-navigation-text">{c.label}</span>
              )}
            </span>
          ))}
        </nav>

        {kicker ? (
          <div className="inline-flex items-center gap-[9px] text-[12.5px] font-bold uppercase tracking-[0.14em] text-student-navigation-text-muted">
            <span className="h-[7px] w-[7px] rounded-full bg-student-navigation-text-muted" />
            {kicker}
          </div>
        ) : null}
        <h1 className="mt-3 text-balance text-[clamp(36px,6.5vw,58px)] font-extrabold leading-none tracking-[-0.035em] text-student-navigation-text">
          {title}
        </h1>
        <p className="mt-5 max-w-[54ch] text-[clamp(16px,2.1vw,19px)] leading-[1.5] text-student-navigation-text-muted">{lede}</p>
      </div>
    </header>
  )
}
