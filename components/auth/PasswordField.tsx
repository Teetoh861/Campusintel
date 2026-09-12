// components/auth/PasswordField.tsx — Accessible password entry and reveal control.
'use client'
import { forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { FormField, AUTH_FOCUS } from '@/components/chrome/FormField'
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/auth/constants'
import type { ComponentProps } from 'react'

/** Keep reveal state local; never transform or persist the password. */
export const PasswordField = forwardRef<HTMLInputElement, ComponentProps<typeof FormField>>(function PasswordField(props, ref) {
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOff : Eye
  return <FormField {...props} ref={ref} type={visible ? 'text' : 'password'}
    minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH}
    trailing={<button type="button" disabled={props.disabled} aria-controls={props.id}
      aria-label={visible ? 'Hide ' + props.label.toLowerCase() : 'Show ' + props.label.toLowerCase()}
      aria-pressed={visible} onClick={() => setVisible(value => !value)}
      className={'absolute right-1 top-1 flex min-h-11 min-w-11 items-center justify-center rounded-ci-btn text-ci-navy ' + AUTH_FOCUS}>
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>} />
})
