import { BOOKMARK_REQUEST_DEADLINE_MS } from './contract'

export class BookmarkDeadlineError extends Error {}

/** Bound waiting while still observing the original promise, including late rejection.
 * Only read-only callers supply cancellation; a write deadline cannot cancel a commit.
 */
export async function withBookmarkDeadline<T>(work: Promise<T>, onDeadline: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      onDeadline()
      reject(new BookmarkDeadlineError('Bookmark request unavailable'))
    }, BOOKMARK_REQUEST_DEADLINE_MS)
  })
  try { return await Promise.race([work, deadline]) }
  finally { clearTimeout(timer) }
}
