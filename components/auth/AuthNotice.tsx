// components/auth/AuthNotice.tsx — Text and icon feedback that does not depend on color.
import { CircleAlert, CircleCheck } from 'lucide-react'

/** Announce errors assertively and status updates politely, with wrapping text. */
export function AuthNotice({ message, error = false }: { message: string; error?: boolean }) {
  const Icon = error ? CircleAlert : CircleCheck
  return <div role={error ? 'alert' : 'status'} className="flex gap-3 rounded-ci-btn bg-ci-blue-50 p-4 text-ci-ink">
    <Icon aria-hidden="true" className="mt-1 h-5 w-5 shrink-0" />
    <p className="min-w-0 break-words">{message}</p>
  </div>
}
