// app/reset-password/page.tsx — The password is changed inside Forgot password, which holds the email and the
// verified code. A direct visit has neither, so it goes there.
import { redirect } from 'next/navigation'
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AUTH_PATHS } from '@/lib/auth/constants'

export const dynamic = 'force-dynamic'

/** A reset cannot start here: only the Forgot password flow can authorize one. */
function ToForgotPassword(): never {
  redirect(AUTH_PATHS.forgot)
}

/** Apply the server session guard first: a signed-in student goes to their own home, not through Forgot password. */
export default function Page() {
  return <SignedOutGate><ToForgotPassword /></SignedOutGate>
}
