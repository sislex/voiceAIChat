export interface Controller { reset(): void; dispose(): void }
export function createController(): Controller & { guard(): number; current(token: number): boolean; own(cleanup: () => void): void } {
  let generation = 0; let disposed = false; const cleanups = new Set<() => void>()
  const clear = () => { generation += 1; cleanups.forEach((cleanup) => cleanup()); cleanups.clear() }
  return { guard: () => ++generation, current: (token) => !disposed && token === generation, own: (cleanup) => { if (disposed) cleanup(); else cleanups.add(cleanup) }, reset: clear, dispose: () => { if (disposed) return; disposed = true; clear() } }
}
