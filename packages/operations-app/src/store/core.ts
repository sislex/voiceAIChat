export interface Store<S, A> { getState(): Readonly<S>; subscribe(listener: () => void): () => void; actions: A; dispose(): void }
export function createStoreCore<S>(initial: S) {
  let state = initial; let disposed = false
  const listeners = new Set<() => void>(); const cleanups = new Set<() => void>()
  return {
    getState: () => state as Readonly<S>,
    setState(patch: Partial<S> | ((state: Readonly<S>) => Partial<S>)) { if (disposed) return; state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; listeners.forEach((listener) => listener()) },
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => listeners.delete(listener) },
    onDispose(cleanup: () => void) { if (disposed) cleanup(); else cleanups.add(cleanup) },
    isDisposed: () => disposed,
    dispose() { if (disposed) return; disposed = true; cleanups.forEach((cleanup) => cleanup()); cleanups.clear(); listeners.clear() }
  }
}
