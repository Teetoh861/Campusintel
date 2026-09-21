import { AuthShell } from '@/components/auth/AuthShell'

/** Keep the private page's loading state within the existing form surface. */
export default function Loading() {
  return <AuthShell title="Profile selection"><p role="status" className="text-ci-gray-700">Loading selection…</p></AuthShell>
}
