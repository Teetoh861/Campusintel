// app/materials/MaterialsClient.tsx — General material request form; page.tsx owns the account boundary.
'use client'

import { useState } from 'react'
import { TaskHeader } from '@/components/chrome/TaskHeader'
import { courses } from '@/lib/data/courses'
import {
  buildMaterialRequestEmailUrl,
  buildMaterialShareEmailUrl,
} from '@/lib/material-email'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'
import type { ReactElement } from 'react'

const WRAP = 'app-container'
const MAX_COURSE_LENGTH = 120

/** Course picker that builds private material request/share email handoffs. */
export function MaterialsClient(): ReactElement {
  const [selectedCourse, setSelectedCourse] = useState('')
  const [typedCourse, setTypedCourse] = useState('')
  const resolvedCourse = typedCourse.trim() || selectedCourse
  const hasCourse = resolvedCourse.length > 0
  const requestHref = hasCourse
    ? buildMaterialRequestEmailUrl(resolvedCourse)
    : undefined
  const shareHref = hasCourse
    ? buildMaterialShareEmailUrl(resolvedCourse)
    : undefined

  return (
    <>
      <TaskHeader label="Materials" title="Request or send materials"
        description="Request study material privately for any course, or email notes and past questions of your own." />

      <section className="student-page" data-screen-label="Choose a course">
        <div className={WRAP}>
          <div className="student-surface student-reading">
            <div>
              <label htmlFor="materials-course" className="text-[14px] font-bold text-ci-navy-900">
                Select a course
              </label>
              <select
                id="materials-course"
                value={selectedCourse}
                onChange={(event) => setSelectedCourse(event.target.value)}
                className="mt-2 min-h-[52px] w-full rounded-[11px] border border-ci-border-2 bg-ci-white px-4 text-[16px] text-ci-navy-900 outline-none transition-[border-color,box-shadow] focus:border-ci-navy focus:ring-2 focus:ring-ci-blue-100"
              >
                <option value="">Select a course</option>
                {courses.map((course) => {
                  const value = `${course.code} — ${course.title}`
                  return (
                    <option key={course.id} value={value}>
                      {value}
                    </option>
                  )
                })}
              </select>
            </div>

            <div className="mt-7">
              <label htmlFor="typed-course" className="text-[14px] font-bold text-ci-navy-900">
                Or type your course
              </label>
              <input
                id="typed-course"
                type="text"
                maxLength={MAX_COURSE_LENGTH}
                value={typedCourse}
                onChange={(event) => setTypedCourse(event.target.value)}
                placeholder="e.g. BUA204 or your course name"
                className="mt-2 min-h-[52px] w-full rounded-[11px] border border-ci-border-2 bg-ci-white px-4 text-[16px] text-ci-navy-900 outline-none transition-[border-color,box-shadow] placeholder:text-ci-gray-400 focus:border-ci-navy focus:ring-2 focus:ring-ci-blue-100"
              />
            </div>

            <div className="mt-8 grid grid-cols-1 gap-3 tablet:grid-cols-2">
              <a
                href={requestHref}
                aria-disabled={!hasCourse}
                className={cx(btnBase, btnAccent, 'w-full', !hasCourse && 'pointer-events-none opacity-45')}
              >
                Request material privately
              </a>
              <a
                href={shareHref}
                aria-disabled={!hasCourse}
                className={cx(btnBase, btnNavy, 'w-full', !hasCourse && 'pointer-events-none opacity-45')}
              >
                Send materials
              </a>
            </div>

            <p className="mt-4 text-[13.5px] leading-[1.5] text-ci-gray-500">
              Opens your email app with the course details pre-filled.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
