// TutorForm — the dossier-styled tutor application. Collects four fields,
// keeps the live character counter on the message, and on submit builds a
// pre-filled WhatsApp message and opens wa.me in a new tab. No HTTP POST,
// no native form submission — the whole flow lives in WhatsApp.
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { buildWhatsAppUrl } from '@/lib/whatsapp'

// Sensible per-field limits. Bumped from the comp's mock 60 / 280 because
// the spec wants ~100 / ~1000 in real use. The counter styling in
// pages.css drives the .over red state once the user crosses the cap.
const NAME_MAX = 100
const EXPERTISE_MAX = 120
const MESSAGE_MAX = 1000

const LEVEL_OPTIONS = [
  '300 Level',
  '400 Level',
  'Postgraduate',
  'Graduate / Alumnus',
] as const

export function TutorForm() {
  const [name, setName] = useState('')
  const [level, setLevel] = useState('')
  const [expertise, setExpertise] = useState('')
  const [message, setMessage] = useState('')

  const messageCounterClass = useMemo(
    () => (message.length > MESSAGE_MAX ? 'counter over' : 'counter'),
    [message.length],
  )

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
      'Hello CampusIntel — I want to apply to tutor.',
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
    <div className="form-wrap ticks">
      <p className="form-intro">
        A short brief is all we need to start. We review applications and pick
        up the conversation directly.
      </p>
      <div className="form-sig">
        <span className="sig" />Routes straight to a real person on WhatsApp
      </div>

      <div className="field">
        <div className="flrow">
          <label htmlFor="f-name">Full name</label>
        </div>
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
        />
      </div>

      <div className="field">
        <div className="flrow">
          <label htmlFor="f-level">Your level</label>
        </div>
        <select
          id="f-level"
          name="level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          required
        >
          <option value="" disabled>Select your level</option>
          {LEVEL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <div className="flrow">
          <label htmlFor="f-expertise">Courses or area of expertise</label>
        </div>
        <input
          id="f-expertise"
          name="expertise"
          type="text"
          maxLength={EXPERTISE_MAX}
          placeholder="e.g. ACC201, BUA221 — Accounting"
          value={expertise}
          onChange={(e) => setExpertise(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <div className="flrow">
          <label htmlFor="f-msg">Short message</label>
          <span className={messageCounterClass} aria-live="polite">
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
        />
      </div>

      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          Send via WhatsApp <span className="arrow">&rarr;</span>
        </button>
        <Link className="btn btn-secondary" href="/tutors">
          Back to tutors
        </Link>
      </div>

      <p className="form-note">
        Opens WhatsApp with your details pre-filled. Nothing is sent until you
        hit send there.
      </p>
    </div>
  )
}
