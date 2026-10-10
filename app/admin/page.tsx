// app/admin/page.tsx — Live-operator course and managed-content workspace.
import { notFound, redirect } from 'next/navigation'
import { OperatorWorkspace } from '@/components/admin/OperatorWorkspace'
import { AuthUnavailable } from '@/components/auth/AuthShell'
import { AUTH_PATHS, OPERATOR_HOME_PATH } from '@/lib/auth/constants'
import { getRenderedOperatorAccess } from '@/lib/operator/access'
import { readOperatorCourses } from '@/lib/operator/editor-server'
import type { ReactElement } from 'react'

export const dynamic = 'force-dynamic'

/** Recheck Auth and the server-owned profile role for every operator page request. */
export default async function AdminPage(): Promise<ReactElement> {
  const access = await getRenderedOperatorAccess()
  if (access.status === 'signed-out') redirect(AUTH_PATHS.login + '?next=' + encodeURIComponent(OPERATOR_HOME_PATH))
  if (access.status === 'forbidden') notFound()
  if (access.status !== 'operator') return <AuthUnavailable />
  const courses = await readOperatorCourses(access.client)
  if (courses.status !== 'ok') return <main className="mx-auto max-w-3xl px-4 py-12">
    <h1 className="text-2xl font-semibold text-blue-950">Content operations</h1>
    <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-900">
      The operator workspace is unavailable. Try again when the content service is ready.
    </p>
  </main>

  return (
    <main className="min-h-screen bg-slate-50 py-8 md:py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-blue-900 md:text-4xl">Content operations</h1>
        <p className="mt-2 text-slate-600">Find a course, create and review revisions, then publish deliberately.</p>
        <OperatorWorkspace repositories={courses.data.repositories} institutional={courses.data.institutional}
          continuityToken={access.continuityToken} />
      </div>
    </main>
  )
}
