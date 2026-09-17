import type { UiPerformanceQuery, UiPerformanceReport } from '@shared/uiPerformance'
export function createPerformanceStore(fetchReport: (q: UiPerformanceQuery) => Promise<UiPerformanceReport>) {
  let state: { report: UiPerformanceReport | null; query: UiPerformanceQuery | null; loading: boolean; error: boolean } = {
    report: null, query: null, loading: false, error: false
  }
  const listeners = new Set<() => void>()
  let revision = 0
  const publish = (next: typeof state) => { state = next; listeners.forEach(fn => fn()) }
  return {
    getState: () => state,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    async load(query: UiPerformanceQuery) {
      const ticket = ++revision
      publish({ ...state, loading: true, error: false })
      try {
        const report = await fetchReport(query)
        if (ticket === revision) publish({ report, query, loading: false, error: false })
      } catch { if (ticket === revision) publish({ ...state, loading: false, error: true }) }
    },
    dispose() { revision++; listeners.clear() }
  }
}
