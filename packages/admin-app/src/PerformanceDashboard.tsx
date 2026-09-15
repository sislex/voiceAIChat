import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Button, EmptyState, ErrorState, Skeleton } from '@voicechat/ui-kit'
import { UI_PERFORMANCE_POLICY as P, type UiPerformanceQuery, type UiPerformanceReport } from '@shared/uiPerformance'
import { createPerformanceStore } from './store/performanceStore'

export interface PerformanceDashboardProps { load(query: UiPerformanceQuery): Promise<UiPerformanceReport> }
const labels = {
  shell_interactive: 'Shell interactive', chat_ready: 'Chat ready', account_ready: 'Account ready',
  board_ready: 'Board ready', message_first_token: 'Message → first token', message_first_audio: 'Message → first audio'
}
export function PerformanceDashboard({ load }: PerformanceDashboardProps): JSX.Element {
  const store = useMemo(() => createPerformanceStore(load), [load])
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const [hours, setHours] = useState(24)
  const [filters, setFilters] = useState<Partial<UiPerformanceQuery>>({})
  const refresh = () => { const to = Date.now(); void store.load({ ...filters, from: to-hours*3600000, to, buckets: 24 }) }
  useEffect(() => { refresh(); return () => store.dispose() }, [store])
  const [online, setOnline] = useState(() => navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online',update); window.addEventListener('offline',update)
    return () => { window.removeEventListener('online',update); window.removeEventListener('offline',update) }
  }, [])
  const report = state.report
  const duration = (value: number | null) => value === null ? '—' : value.toFixed(1) + ' ms'
  return <section aria-label="UI performance" className="ui-performance">
    <h3>UI performance</h3>
    <form onSubmit={e => { e.preventDefault(); refresh() }} className="ui-performance__filters">
      <label>Period<select aria-label="Period" value={hours} onChange={e => setHours(Number(e.target.value))}>
        <option value={1}>1 hour</option><option value={24}>24 hours</option><option value={168}>7 days</option>
      </select></label>
      {(['metric','platform','lifecycle','route'] as const).map(key => <label key={key}>{key}
        <select aria-label={key} value={filters[key] ?? ''} onChange={e => setFilters({ ...filters, [key]: e.target.value || undefined })}>
          <option value="">All</option>
          {(key === 'metric' ? P.metrics : key === 'platform' ? P.platforms : key === 'lifecycle' ? P.lifecycles : P.routes).map(v => <option key={v}>{v}</option>)}
        </select>
      </label>)}
      <label>Version<input value={filters.version ?? ''} maxLength={40} pattern="unknown|[0-9]+[.][0-9]+[.][0-9]+|[a-f0-9]{7,40}" onChange={e => setFilters({ ...filters, version: e.target.value || undefined })} /></label>
      <Button type="submit">Apply filters</Button>
    </form>
    {!online && <p role="status">Offline — displayed data may be stale.</p>}
    {state.loading && (report ? <p role="status">Updating…</p> : <Skeleton variant="list" count={6} />)}
    {state.error && <ErrorState message="Could not load UI performance. Displayed data may be stale." onRetry={refresh} />}
    {report && <>
      <p>{new Date(report.from).toISOString()} — {new Date(report.to).toISOString()}</p>
      <p>Applied filters: {state.query ? Object.entries(state.query).filter(([k,v]) => !['from','to','buckets'].includes(k) && v !== undefined).map(([k,v]) => k + ': ' + v).join(' · ') || 'All' : 'All'}</p>
      {!report.metrics.some(m => m.count) && <EmptyState title="No observations" description="Use a wider period or return after using the application." />}
      <div className="ui-performance__cards">{report.metrics.map(m => <article key={m.metric}>
        <h4>{labels[m.metric]}</h4><dl><dt>p50</dt><dd>{duration(m.p50)}</dd><dt>p95</dt><dd>{duration(m.p95)}</dd><dt>Sample count</dt><dd>{m.count}</dd></dl>
        <p>{m.state === 'empty' ? 'No data' : m.state === 'insufficient' ? 'Insufficient sample: minimum ' + report.minSamples : 'Sufficient sample'}</p>
      </article>)}</div>
      <details><summary>Trend by time bucket</summary>
        <div className="ui-performance__trend">{report.trend.map(bucket => <article key={bucket.from}>
          <h4>{new Date(bucket.from).toISOString()}</h4>
          {bucket.metrics.map(m => <p key={m.metric}>{labels[m.metric]}: p50 {duration(m.p50)}, p95 {duration(m.p95)}, n={m.count} ({m.state})</p>)}
        </article>)}</div>
      </details>
    </>}
  </section>
}
