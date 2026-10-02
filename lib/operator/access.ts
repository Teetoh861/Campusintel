// lib/operator/access.ts — Live account and profile-role authorization for operator surfaces.
import 'server-only'
import { isStudentAuthEnabled } from '@/lib/auth/config'
import { getStudentSessionUser } from '@/lib/auth/student-state'
import { createClient } from '@/lib/supabase/server'
import type { NextResponse } from 'next/server'

type OperatorClient = Awaited<ReturnType<typeof createClient>>

export type OperatorAccess =
  | { status: 'operator'; client: OperatorClient; userId: string }
  | { status: 'signed-out' | 'forbidden' | 'unavailable' }

/** Use the ordinary HttpOnly Auth session, then read the current server-owned role. */
export async function getOperatorAccess(response?: NextResponse): Promise<OperatorAccess> {
  if (!isStudentAuthEnabled()) return { status: 'unavailable' }
  try {
    const client = await createClient(response)
    const user = await getStudentSessionUser(response, client)
    if (user === null) return { status: 'signed-out' }
    const { data, error } = await client.from('profiles')
      .select('role').eq('id', user.id).maybeSingle()
    if (error || !data || (data.role !== 'student' && data.role !== 'operator')) {
      return { status: 'unavailable' }
    }
    return data.role === 'operator'
      ? { status: 'operator', client, userId: user.id }
      : { status: 'forbidden' }
  } catch {
    return { status: 'unavailable' }
  }
}
