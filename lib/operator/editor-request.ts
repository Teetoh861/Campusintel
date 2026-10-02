// lib/operator/editor-request.ts — Same-origin, bounded JSON parsing for operator content mutations.
import 'server-only'
import { getAuthOrigin } from '@/lib/auth/config'
import { editorMutation } from './editor-contract'
import type { EditorMutation } from './editor-contract'

const EDITOR_BODY_MAX_BYTES = 280 * 1024

export class EditorRequestError extends Error {
  constructor(public status: number) { super('Invalid operator editor request') }
}

/** Accept only same-origin JSON and validate its complete action shape. */
export async function readEditorMutation(request: Request): Promise<EditorMutation> {
  if (request.headers.get('origin') !== getAuthOrigin() ||
      ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) {
    throw new EditorRequestError(403)
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new EditorRequestError(415)
  }
  const reader = request.body?.getReader()
  if (!reader) throw new EditorRequestError(400)
  let length = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > EDITOR_BODY_MAX_BYTES) {
        await reader.cancel()
        throw new EditorRequestError(413)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    const result = editorMutation.safeParse(parsed)
    if (!result.success) throw new EditorRequestError(400)
    return result.data
  } catch (error) {
    if (error instanceof EditorRequestError) throw error
    throw new EditorRequestError(400)
  } finally { reader.releaseLock() }
}
