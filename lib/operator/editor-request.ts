// lib/operator/editor-request.ts — Same-origin, bounded JSON parsing for operator content mutations.
import 'server-only'
import { AuthRequestError, readAuthRequest } from '@/lib/auth/request'
import { editorMutation } from './editor-contract'
import type { EditorMutation } from './editor-contract'

const EDITOR_BODY_MAX_BYTES = 280 * 1024

export class EditorRequestError extends Error {
  constructor(public status: number) { super('Invalid operator editor request') }
}

/** Accept only same-origin JSON and validate its complete action shape. */
export async function readEditorMutation(request: Request): Promise<EditorMutation> {
  try {
    return await readAuthRequest(request, editorMutation, { maxBytes: EDITOR_BODY_MAX_BYTES })
  } catch (error) {
    if (error instanceof AuthRequestError) throw new EditorRequestError(error.status)
    // Parsing failures are already classified by the shared reader; unexpected/configuration failures stay unavailable.
    throw error
  }
}
