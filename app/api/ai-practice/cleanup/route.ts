// app/api/ai-practice/cleanup/route.ts — Scheduled retention sweep for AI practice uploads and sets.
// Invoke with `Authorization: Bearer $CRON_SECRET` (the Vercel Cron convention). See lib/ai-practice/README.md.
import { isAuthorizedCleanupRequest, runAiPracticeCleanup } from '@/lib/ai-practice/cleanup'
import type { CleanupClient } from '@/lib/ai-practice/cleanup'
import { createAiPracticeServiceClient } from '@/lib/ai-practice/supabase-env'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorizedCleanupRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return json({ status: 'unauthorized' }, 401)
  }
  try {
    const report = await runAiPracticeCleanup(createAiPracticeServiceClient() as unknown as CleanupClient)
    // 202: the run succeeded but hit its batch limit or kept rows whose files remain; the next run continues.
    return json(report, !report.ok ? 503 : report.complete ? 200 : 202)
  } catch (error) {
    console.error('ai-practice cleanup failed', error instanceof Error ? error.name : 'unknown')
    return json({ ok: false }, 503)
  }
}
