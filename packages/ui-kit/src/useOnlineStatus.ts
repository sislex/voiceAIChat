import { useSyncExternalStore } from 'react'

/** A browser connectivity hint, not proof that a particular API is reachable. */
export interface OnlineStatusSource {
  subscribe(listener: () => void): () => void
  getSnapshot(): boolean | null
}

const browserSource: OnlineStatusSource = {
  subscribe(listener) {
    if (typeof window === 'undefined') return () => {}
    window.addEventListener('online', listener)
    window.addEventListener('offline', listener)
    return () => {
      window.removeEventListener('online', listener)
      window.removeEventListener('offline', listener)
    }
  },
  getSnapshot: () => typeof navigator === 'undefined' ? null : navigator.onLine,
}

const serverSnapshot = () => null

/** Hosts may inject another source; product panels do not own browser listeners. */
export function useOnlineStatus(source: OnlineStatusSource = browserSource): boolean | null {
  return useSyncExternalStore(source.subscribe, source.getSnapshot, serverSnapshot)
}
