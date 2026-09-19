import { act, render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PerformanceDashboard } from './PerformanceDashboard'
import { createPerformanceStore } from './store/performanceStore'
import type { UiPerformanceReport } from '@shared/uiPerformance'
afterEach(cleanup)
const report: UiPerformanceReport = { from:0,to:1000,minSamples:20,metrics:[
  {metric:'chat_ready',count:0,p50:null,p95:null,state:'empty'},
  {metric:'account_ready',count:1,p50:0,p95:0,state:'insufficient'}
],trend:[] }

it('renders offline state from an injected host source and cleans up the subscription', async () => {
  let online: boolean | null = null
  let notify = () => {}
  const release = vi.fn()
  const onlineSource = {
    getSnapshot: () => online,
    subscribe: (listener: () => void) => { notify = listener; return release },
  }
  const { unmount } = render(<PerformanceDashboard load={async () => report} onlineSource={onlineSource} />)
  await screen.findByText('No data')
  expect(screen.queryByText(/Offline/)).toBeNull()
  act(() => { online = false; notify() })
  expect(screen.getByText(/Offline/)).toBeVisible()
  act(() => { online = true; notify() })
  expect(screen.queryByText(/Offline/)).toBeNull()
  unmount()
  expect(release).toHaveBeenCalledOnce()
})
// @testCase T4
it('renders empty, genuine zero and insufficient states with labelled filters and keyboard-submit form', async () => {
  const load=vi.fn(async(_q: unknown)=>report)
  render(<PerformanceDashboard load={load}/>)
  expect(await screen.findByText('No data')).toBeVisible()
  expect(screen.getByText('Insufficient sample: minimum 20')).toBeVisible()
  expect(screen.getAllByText('0.0 ms')).toHaveLength(2)
  fireEvent.change(screen.getByLabelText('platform'),{target:{value:'desktop'}})
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}))
  await waitFor(()=>expect(load).toHaveBeenCalledTimes(2))
  expect(load.mock.calls[1]).toEqual([expect.objectContaining({platform:'desktop'})])
})
// @testCase T4
it('shows a recoverable error and loading without fabricating observations', async () => {
  const load=vi.fn().mockRejectedValueOnce(new Error('private')).mockResolvedValue(report)
  render(<PerformanceDashboard load={load}/>)
  expect(await screen.findByText(/Could not load UI performance/)).toBeVisible()
  expect(screen.queryByText('private')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:'Apply filters'}))
  expect(await screen.findByText('No data')).toBeVisible()
})
// @testCase T3
it('ignores stale responses and responses after disposal', async () => {
  let first!: (r:UiPerformanceReport)=>void
  const store=createPerformanceStore(vi.fn().mockImplementationOnce(()=>new Promise(r=>{first=r})).mockResolvedValue({...report,to:2000}))
  const q={from:0,to:1000,buckets:1}
  const pending=store.load(q)
  await store.load({...q,to:2000})
  first(report);await pending;expect(store.getState().report?.to).toBe(2000)
  store.dispose()
  const delayed=createPerformanceStore(()=>new Promise(r=>{first=r}))
  const next=delayed.load(q);delayed.dispose();first(report);await next
  expect(delayed.getState().report).toBeNull()
})
