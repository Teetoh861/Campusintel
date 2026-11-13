// app/confirm-email/page.tsx — A code is entered inside Create account or Sign in, which hold the email it belongs
// to. A direct visit has neither, so it goes to Sign in.
import { redirect } from 'next/navigation'
import { SignedOutGate } from '@/components/auth/SignedOutGate'
import { AUTH_PATHS } from '@/lib/auth/constants'

export const dynamic = 'force-dynamic'

/** No email arrives in the address, so there is nothing to confirm here. */
function ToSignIn(): never {
  redirect(AUTH_PATHS.login)
}

/** Apply the server session guard first: a signed-in student goes to their own home, not through Sign in. */
export default function Page() {
  return <SignedOutGate><ToSignIn /></SignedOutGate>
}
