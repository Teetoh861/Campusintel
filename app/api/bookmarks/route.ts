// app/api/bookmarks/route.ts — Private, session-bound account bookmark reads and writes.
import { NextResponse } from 'next/server'
import { AUTH_CONTINUITY_HEADER } from '@/lib/auth/constants'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { bookmarkCommand, getCurrentBookmarks, writeCurrentBookmarks } from '@/lib/bookmarks/server'
import type { BookmarkAccountResult } from '@/lib/bookmarks/contract'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function privateJson(body: BookmarkAccountResult, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer',
  } })
}

function finish(response: NextResponse, result: BookmarkAccountResult): Response {
  const status = result.status === 'signed-out' ? 401
    : result.status === 'session-changed' ? 409
    : result.status === 'invalid-request' ? 400
    : result.status === 'unavailable' ? 503 : 200
  return new Response(JSON.stringify(result), { status, headers: response.headers })
}

/** Return account bookmarks or an explicit signed-out state for local bookmarks. */
export async function GET(): Promise<Response> {
  const response = privateJson({ status: 'unavailable' })
  const result = await getCurrentBookmarks(response)
  return finish(response, result)
}

/** Merge, add or remove one live student's bookmarks. */
export async function POST(request: Request): Promise<Response> {
  let command
  try { command = await readAuthRequest(request, bookmarkCommand) }
  catch (error) {
    const status = error instanceof AuthRequestError ? error.status : 503
    return privateJson({ status: status === 503 ? 'unavailable' : 'invalid-request' }, status)
  }
  const response = privateJson({ status: 'unavailable' })
  return finish(response, await writeCurrentBookmarks(command, response,
    request.headers.get(AUTH_CONTINUITY_HEADER)))
}
