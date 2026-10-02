// app/api/admin/editor/route.ts — Per-request live operator authorization for the authoring workspace.
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getOperatorAccess } from '@/lib/operator/access'
import { readEditorMutation, EditorRequestError } from '@/lib/operator/editor-request'
import { readOperatorCourses, readOperatorHistory, readOperatorItems, writeOperatorContent } from '@/lib/operator/editor-server'
import type { EditorResult } from '@/lib/operator/editor-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const uuid = z.string().uuid()

function responseFor(body: Record<string, unknown>, status: number, base: NextResponse): Response {
  return new Response(JSON.stringify(body), { status, headers: base.headers })
}

function resultResponse<T>(result: EditorResult<T>, base: NextResponse): Response {
  const status = result.status === 'ok' ? 200 : result.status === 'invalid' ? 422
    : result.status === 'conflict' ? 409 : result.status === 'forbidden' ? 403 : 503
  return responseFor(result, status, base)
}

async function authorize(base: NextResponse): Promise<Awaited<ReturnType<typeof getOperatorAccess>>> {
  return getOperatorAccess(base)
}

/** Read courses, course items, or one item's immutable history for a live operator. */
export async function GET(request: Request): Promise<Response> {
  const base = NextResponse.json({}, { headers: { 'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer' } })
  const access = await authorize(base)
  if (access.status !== 'operator') return responseFor({ status: access.status },
    access.status === 'signed-out' ? 401 : access.status === 'forbidden' ? 403 : 503, base)
  const url = new URL(request.url)
  const view = url.searchParams.get('view')
  if (view === 'courses' && url.searchParams.size === 1) {
    return resultResponse(await readOperatorCourses(access.client), base)
  }
  if (view === 'items' && url.searchParams.size === 2) {
    const courseId = url.searchParams.get('courseId')
    if (courseId && uuid.safeParse(courseId).success) {
      return resultResponse(await readOperatorItems(access.client, courseId), base)
    }
  }
  if (view === 'history' && url.searchParams.size === 2) {
    const itemId = url.searchParams.get('itemId')
    if (itemId && uuid.safeParse(itemId).success) {
      return resultResponse(await readOperatorHistory(access.client, itemId), base)
    }
  }
  return responseFor({ status: 'invalid', message: 'Invalid editor request.' }, 400, base)
}

/** Validate and execute one authoring, review, publication, or provisioning action. */
export async function POST(request: Request): Promise<Response> {
  const base = NextResponse.json({}, { headers: { 'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer' } })
  const access = await authorize(base)
  if (access.status !== 'operator') return responseFor({ status: access.status },
    access.status === 'signed-out' ? 401 : access.status === 'forbidden' ? 403 : 503, base)
  try {
    const input = await readEditorMutation(request)
    return resultResponse(await writeOperatorContent(access.client, input), base)
  } catch (error) {
    const status = error instanceof EditorRequestError ? error.status : 503
    return responseFor({ status: status === 503 ? 'unavailable' : 'invalid',
      message: status === 503 ? 'The editor is unavailable.' : 'The editor request is invalid.' }, status, base)
  }
}
