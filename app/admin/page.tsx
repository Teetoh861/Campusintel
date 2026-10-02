// app/admin/page.tsx — Minimal operator landing page guarded by the live account role.
import { notFound, redirect } from 'next/navigation'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { AUTH_PATHS, OPERATOR_HOME_PATH } from '@/lib/auth/constants'
import { getOperatorAccess } from '@/lib/operator/access'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'

/** Recheck Auth and the server-owned profile role for every operator page request. */
export default async function AdminPage(): Promise<ReactElement> {
  const access = await getOperatorAccess()
  if (access.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(OPERATOR_HOME_PATH))
  if (access.status === 'forbidden') notFound()
  if (access.status !== 'operator') return <AuthUnavailable />

  return (
    <main className="min-h-screen bg-slate-50 py-8 md:py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-blue-900 md:text-4xl">Content operations</h1>
        <p className="mt-2 text-slate-600">Managed learning content is being prepared.</p>
        <div className="mt-8 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-xl font-semibold text-slate-900">Editor coming soon</h2>
          <p className="mt-2 text-slate-600">
            Notes and questions continue to be served from the current course library while the operator workflow is built.
          </p>
        </div>
      </div>
    </main>
  )
}
