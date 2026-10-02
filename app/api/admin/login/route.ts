// app/api/admin/login/route.ts — Retired shared-password login; no credentials are accepted.
import { NextResponse } from 'next/server'

/** A legacy endpoint retained only to reject old clients after the account-role migration. */
export function POST(): NextResponse {
  return NextResponse.json({ error: 'This endpoint is retired.' }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  })
}
