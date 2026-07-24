'use client'

import { useState } from 'react'
import { courses } from '@/lib/data/courses'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { btnAccent, btnBase, btnNavy, cx } from '@/components/chrome/ui'

const WRAP = 'mx-auto w-full max-w-ci-content px-6 min-[900px]:px-10'

type MaterialAction = 'request' | 'send'

export default function MaterialsPage() {
  const [selectedCourse, setSelectedCourse] = useState('')
  const [typedCourse, setTypedCourse] = useState('')
  const resolvedCourse = typedCourse.trim() || selectedCourse
  const hasCourse = resolvedCourse.length > 0

  const openWhatsApp = (action: MaterialAction) => {
    if (!hasCourse) return

    const message =
      action === 'request'
        ? `Hi, I'd like to request study materials for ${resolvedCourse}.`
        : `Hi, I'd like to share study materials for ${resolvedCourse}.`

    window.open(buildWhatsAppUrl(message), '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <header className="bg-ci-navy text-white" data-screen-label="Materials">
        <div className={cx(WRAP, 'py-14 min-[900px]:py-[72px]')}>
          <h1 className="max-w-[18ch] text-balance text-[clamp(36px,7vw,56px)] font-extrabold leading-none tracking-[-0.035em]">
            Request or send materials
          </h1>
          <p className="mt-5 max-w-[54ch] text-[17px] leading-[1.6] text-ci-blue-200 min-[900px]:text-[19px]">
            Request study materials for any course, or contribute notes and past questions of your own.
          </p>
        </div>
      </header>

      <section className="py-14 min-[900px]:py-[72px]" data-screen-label="Choose a course">
        <div className={WRAP}>
          <div className="max-w-[720px] rounded-[18px] border border-ci-border bg-ci-white p-6 shadow-ci-card min-[680px]:p-8">
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
                value={typedCourse}
                onChange={(event) => setTypedCourse(event.target.value)}
                placeholder="e.g. BUA204 or your course name"
                className="mt-2 min-h-[52px] w-full rounded-[11px] border border-ci-border-2 bg-ci-white px-4 text-[16px] text-ci-navy-900 outline-none transition-[border-color,box-shadow] placeholder:text-ci-gray-400 focus:border-ci-navy focus:ring-2 focus:ring-ci-blue-100"
              />
            </div>

            <div className="mt-8 grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
              <button
                type="button"
                disabled={!hasCourse}
                onClick={() => openWhatsApp('request')}
                className={cx(btnBase, btnAccent, 'w-full disabled:pointer-events-none disabled:opacity-45')}
              >
                Request materials
              </button>
              <button
                type="button"
                disabled={!hasCourse}
                onClick={() => openWhatsApp('send')}
                className={cx(btnBase, btnNavy, 'w-full disabled:pointer-events-none disabled:opacity-45')}
              >
                Send materials
              </button>
            </div>

            <p className="mt-4 text-[13.5px] leading-[1.5] text-ci-gray-500">
              Opens WhatsApp with your request pre-filled.
            </p>
          </div>
        </div>
      </section>
    </>
  )
}
