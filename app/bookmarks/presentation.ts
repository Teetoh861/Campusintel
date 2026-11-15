// app/bookmarks/presentation.ts — Locked Bookmarks copy and density; course truth stays in the central model.

export const BOOKMARKS_LEDE = 'Courses you’ve bookmarked to come back to.'
export const BOOKMARKS_LOADING_MESSAGE = 'Loading your bookmarks.'
export const BOOKMARKS_COPY = {
  unavailable: 'We couldn’t load your bookmarks.',
  // Shown on the one bookmark whose removal failed; the rest of the list stays as it was.
  removeFailed: 'We couldn’t remove this bookmark.',
} as const
// Ten logical bookmarks per page at every viewport width; never varied by breakpoint.
export const BOOKMARKS_PER_PAGE = 10
