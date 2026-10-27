// app/profile-selection/CoursesSetNotice.tsx — What a student whose courses are set for the semester is told, with the
// one way to ask for a change: WhatsApp when a number is configured, otherwise Help & Support.
import Link from 'next/link'
import { btnBase, btnGhost, btnSm, buttonClassName } from '@/components/chrome/ui'
import { studentFocusControl } from '@/components/student/ui'
import { STUDENT_DESTINATIONS } from '@/lib/product/student-navigation'
import { courseChangeContact } from '@/lib/whatsapp'
import type { ReactElement } from 'react'

export const COURSES_SET_MESSAGE = 'Your courses are set for this semester. Need a change?'

export function CoursesSetNotice(): ReactElement {
  const contact = courseChangeContact(STUDENT_DESTINATIONS.contact.href)
  const action = buttonClassName(btnBase, btnSm, btnGhost, studentFocusControl, 'w-full tablet:w-auto')
  return <div role="status" className="grid gap-2 tablet:flex tablet:items-center tablet:gap-3" data-courses-set="">
    <p className="text-student-text-primary">{COURSES_SET_MESSAGE}</p>
    {contact.external
      ? <a href={contact.href} target="_blank" rel="noopener noreferrer" className={action}>Message us</a>
      : <Link href={contact.href} prefetch={false} className={action}>Message us</Link>}
  </div>
}
