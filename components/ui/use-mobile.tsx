// components/ui/use-mobile.tsx — The one browser breakpoint owner: synchronous media-query snapshots for client renders.
import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
export const DESKTOP_BREAKPOINT = 1200
export const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_BREAKPOINT}px)`
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

type MediaQueryStore = {
  subscribe: (onChange: () => void) => () => void
  getSnapshot: () => boolean
  getServerSnapshot: () => boolean
}

/** One external store per query: the live matchMedia answer on the client, a stable false on the server. */
export function createMediaQueryStore(query: string): MediaQueryStore {
  let list: MediaQueryList | null = null
  const resolve = () => list ?? (list = window.matchMedia(query))
  return {
    subscribe(onChange) {
      const current = resolve()
      current.addEventListener('change', onChange)
      return () => current.removeEventListener('change', onChange)
    },
    getSnapshot: () => resolve().matches,
    getServerSnapshot: () => false,
  }
}

const desktopStore = createMediaQueryStore(DESKTOP_MEDIA_QUERY)
const mobileStore = createMediaQueryStore(MOBILE_MEDIA_QUERY)

function useMediaQueryStore(store: MediaQueryStore): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
}

/** True below the mobile breakpoint; false during server render. */
export function useIsMobile(): boolean {
  return useMediaQueryStore(mobileStore)
}

/** True from the Student App desktop breakpoint on the first client render; false during server render and below it. */
export function useIsDesktop(): boolean {
  return useMediaQueryStore(desktopStore)
}
