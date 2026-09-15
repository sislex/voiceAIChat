import React from 'react'
import { createRoot } from 'react-dom/client'
import { PerformanceDashboard } from '../src/PerformanceDashboard'
import { UI_PERFORMANCE_POLICY as P } from '../../shared/src/uiPerformance'
import '../src/styles.css'
const params = new URLSearchParams(location.search)
const mode = params.get('state') ?? 'ready'
const delay = Number(params.get('delay') ?? 0)
let loads = 0
const load = async (q: import('../../shared/src/uiPerformance').UiPerformanceQuery) => {
  loads++
  if (mode === 'loading') await new Promise(() => {})
  if (mode === 'updating' && loads > 1) await new Promise(r => setTimeout(r, 5000))
  if (mode === 'stale' && loads > 1) throw new Error('fixture')
  await new Promise(r => setTimeout(r, 25 + delay))
  if (mode === 'error') throw new Error('fixture')
  const state = mode === 'empty' ? 'empty' : mode === 'insufficient' ? 'insufficient' : 'ready'
  const metrics = P.metrics.map(metric => ({ metric, p50: state === 'empty' ? null : 0, p95: state === 'empty' ? null : 40, count: state === 'empty' ? 0 : state === 'insufficient' ? 3 : 50, state }))
  return { from:q.from,to:q.to,minSamples:20,metrics,trend:[{from:q.from,to:q.to,metrics}] }
}
document.documentElement.dataset.theme = params.get('theme') ?? 'light'
createRoot(document.getElementById('root')!).render(<PerformanceDashboard load={load}/>)
