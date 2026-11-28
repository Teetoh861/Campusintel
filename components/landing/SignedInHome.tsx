// components/landing/SignedInHome.tsx — Send a signed-in student home from a landing page the server never saw them open.
'use client'

import { useEffect } from 'react'
import { useNavigationSession } from '@/components/auth/NavigationSession'
import { STUDENT_HOME_PATH } from '@/lib/auth/constants'

/** The proxy redirects a signed-in visit to "/", but a browser can show this page again without asking the server:
 *  the Back button brings back a copy it kept. The shared session check still runs on that copy, and its verified
 *  signed-in answer sends the student home. Any other answer leaves the page alone. */
export function SignedInHome(): null {
  const { signedIn } = useNavigationSession()
  useEffect(() => {
    // A full page load, as after signing in, so nothing kept from the signed-out page is reused.
    if (signedIn) window.location.replace(STUDENT_HOME_PATH)
  }, [signedIn])
  return null
}
