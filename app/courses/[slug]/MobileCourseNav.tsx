import Link from 'next/link'
import type { TocItem } from './CourseToc'

type MobileCourseNavProps = {
  items: ReadonlyArray<TocItem>
  materialsHref: string
  quizHref?: string
}

const sectionChip =
  'inline-flex min-h-10 flex-none items-center whitespace-nowrap rounded-full border border-ci-border-2 bg-ci-white px-4 py-2 text-[13.5px] font-semibold text-ci-navy'

const actionChip =
  'inline-flex min-h-10 flex-none items-center whitespace-nowrap rounded-full border border-ci-accent bg-ci-accent px-4 py-2 text-[13.5px] font-bold text-ci-navy-900'

export function MobileCourseNav({ items, materialsHref, quizHref }: MobileCourseNavProps) {
  return (
    <nav
      aria-label="Course sections and actions"
      className="sticky top-[74px] z-50 -mt-8 mb-10 min-[900px]:hidden"
    >
      <div className="border-y border-ci-border bg-ci-paper/[0.94] py-3 pl-6 backdrop-blur-[12px]">
        <div className="overflow-x-auto scroll-smooth pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max gap-2.5">
            {quizHref ? (
              <Link className={actionChip} href={quizHref}>
                Take quiz
              </Link>
            ) : null}
            <Link className={actionChip} href={materialsHref}>
              Request materials
            </Link>
            {items.map((item) => (
              <Link key={item.id} className={sectionChip} href={`#${item.id}`}>
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </nav>
  )
}
