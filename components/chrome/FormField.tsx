// components/chrome/FormField.tsx — CampusIntell labels, inputs and accessible field feedback.
import { cx, focusRingNavy } from './ui'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'

export const AUTH_SUBMIT = 'h-12 min-h-12 py-3 w-full whitespace-normal disabled:cursor-wait disabled:opacity-60 ' + focusRingNavy

type Props = InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; error?: string; help?: string; trailing?: ReactNode; ref?: Ref<HTMLInputElement> }

/** Associate each label, hint and error with its input, including invalid/disabled states. */
export function FormField(
  { id, label, error, help, trailing, className, ref, ...props }: Props,
) {
  const description = [help && !error && id + '-help', error && id + '-error'].filter(Boolean).join(' ') || undefined
  return <div className="space-y-1">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0">
      <label htmlFor={id} className="block font-semibold text-ci-ink">{label}</label>
      {help && !error && <span id={id + '-help'} className="text-sm text-ci-gray-700">{help}</span>}
    </div>
    <div className="relative">
      <input {...props} id={id} ref={ref} aria-invalid={!!error} aria-describedby={description}
        className={cx('h-12 w-full rounded-ci-btn border border-ci-gray-600 bg-ci-white px-3 py-2 text-base text-ci-ink disabled:cursor-not-allowed disabled:opacity-60', focusRingNavy, !!trailing && 'pr-16', error && 'border-ci-navy', className)} />
      {trailing}
    </div>
    {error && <p id={id + '-error'} className="text-sm leading-5 font-semibold text-ci-ink">{error}</p>}
  </div>
}
