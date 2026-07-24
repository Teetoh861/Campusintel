// TutorForm — Variant B tutor application. VISUAL RESKIN ONLY: the four
// fields, the live character counter, validation (canSubmit), and the WhatsApp
// handoff (build a pre-filled message + open wa.me) are unchanged. No HTTP POST,
// no native form submission — the whole flow lives in WhatsApp.
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { buildWhatsAppUrl } from '@/lib/whatsapp'
import { btnAccent, btnBase, btnGhost, cx } from '@/components/chrome/ui'

// Sensible per-field limits. Bumped from the comp's mock 60 / 280 because
// the spec wants ~100 / ~1000 in real use. The counter turns red once the
// user crosses the cap.
const NAME_MAX = 100
const EXPERTISE_MAX = 120
const MESSAGE_MAX = 1000

const LEVEL_OPTIONS = [
  '300 Level',
  '400 Level',
  'Postgraduate',
  'Graduate / Alumnus',
] as const

const fieldClass =
  'w-full rounded-[11px] border border-ci-border-2 bg-ci-white px-4 py-3 text-[15.5px] text-ci-ink outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-ci-gray-400 focus:border-ci-navy focus:shadow-[0_0_0_3px_var(--ci-blue-50)]'
const labelClass = 'block text-[13px] font-semibold text-ci-navy-900'

export function TutorForm() {
  const [name, setName] = useState('')
  const [level, setLevel] = useState('')
  const [expertise, setExpertise] = useState('')
  const [message, setMessage] = useState('')

  const messageOver = useMemo(() => message.length > MESSAGE_MAX, [message.length])

  const canSubmit =
    name.trim().length > 0 &&
    level.length > 0 &&
    expertise.trim().length > 0 &&
    message.length <= MESSAGE_MAX &&
    name.length <= NAME_MAX &&
    expertise.length <= EXPERTISE_MAX

  // Building the message body inside the click handler — not in render —
  // avoids leaking partial state into the URL the user could middle-click.
  const handleSubmit = () => {
    if (!canSubmit) return
    const lines = [
      'Hello CampusIntel, I want to apply to tutor.',
      '',
      `Name: ${name.trim()}`,
      `Level: ${level}`,
      `Expertise: ${expertise.trim()}`,
      '',
      message.trim() || '(no extra message)',
    ]
    const url = buildWhatsAppUrl(lines.join('\n'))
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="mx-auto max-w-[640px] rounded-[20px] border border-ci-border bg-ci-white p-[28px_24px] shadow-ci-card min-[900px]:p-9">
      <p className="text-[16px] leading-[1.6] text-ci-gray-600">
        A short brief is all we need to start. We review applications and pick up the conversation directly.
      </p>
      <div className="mt-3 inline-flex items-center gap-2 text-[13px] text-ci-gray-600">
        <span className="h-[6px] w-[6px] rounded-full bg-ci-blue-400" />
        Routes straight to a real person on WhatsApp
      </div>

      <div className="mt-7 flex flex-col gap-5">
        <div>
          <label htmlFor="f-name" className={labelClass}>Full name</label>
          <input
            id="f-name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={NAME_MAX}
            placeholder="e.g. Adaeze Okafor"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={cx(fieldClass, 'mt-2')}
          />
        </div>

        <div>
          <label htmlFor="f-level" className={labelClass}>Your level</label>
          <select
            id="f-level"
            name="level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            required
            className={cx(fieldClass, 'mt-2', level === '' && 'text-ci-gray-400')}
          >
            <option value="" disabled>Select your level</option>
            {LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt} className="text-ci-ink">{opt}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="f-expertise" className={labelClass}>Courses or area of expertise</label>
          <input
            id="f-expertise"
            name="expertise"
            type="text"
            maxLength={EXPERTISE_MAX}
            placeholder="e.g. ACC201, BUA221, Accounting"
            value={expertise}
            onChange={(e) => setExpertise(e.target.value)}
            required
            className={cx(fieldClass, 'mt-2')}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="f-msg" className={labelClass}>Short message</label>
            <span
              className={cx(
                'text-[12.5px] [font-variant-numeric:tabular-nums]',
                messageOver ? 'font-semibold text-r-600' : 'text-ci-gray-500',
              )}
              aria-live="polite"
            >
              {message.length} / {MESSAGE_MAX}
            </span>
          </div>
          <textarea
            id="f-msg"
            name="message"
            maxLength={MESSAGE_MAX}
            placeholder="Which courses you aced, your results, and why students should learn this from you."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className={cx(fieldClass, 'mt-2 min-h-[140px] resize-y leading-[1.5]')}
          />
        </div>
      </div>

      <div className="mt-7 flex flex-wrap gap-[13px]">
        <button
          type="button"
          className={cx(btnBase, btnAccent, 'disabled:pointer-events-none disabled:opacity-50')}
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          Send via WhatsApp
        </button>
        <Link className={cx(btnBase, btnGhost)} href="/tutors">
          Back to tutors
        </Link>
      </div>

      <p className="mt-5 text-[14px] leading-[1.55] text-ci-gray-600">
        Opens WhatsApp with your details pre-filled. Nothing is sent until you hit send there.
      </p>
    </div>
  )
}
