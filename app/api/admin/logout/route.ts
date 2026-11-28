// app/api/admin/logout/route.ts — Retired admin-cookie logout; account logout uses /api/auth/logout.
import { NextResponse } from 'next/server'

/** A legacy endpoint retained only to reject old clients after the account-role migration. */
export function POST(): NextResponse {
  return NextResponse.json({ error: 'This endpoint is retired.' }, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  })
}
