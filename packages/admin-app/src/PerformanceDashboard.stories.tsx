import type { Meta, StoryObj } from '@storybook/react'
import { PerformanceDashboard } from './PerformanceDashboard'
import { UI_PERFORMANCE_POLICY as P, type UiPerformanceQuery, type UiPerformanceReport } from '@shared/uiPerformance'
function fixture(state: 'ready'|'empty'|'insufficient') {
  return async (q:UiPerformanceQuery):Promise<UiPerformanceReport> => {
    const metrics = P.metrics.map(metric=>({metric,state,count:state==='empty'?0:state==='ready'?50:3,p50:state==='empty'?null:0,p95:state==='empty'?null:45}))
    return {from:q.from,to:q.to,minSamples:20,metrics,trend:[{from:q.from,to:q.to,metrics}]}
  }
}
export default { title:'Admin/Performance',component:PerformanceDashboard,parameters:{layout:'fullscreen'},args:{load:fixture('ready')} } satisfies Meta<typeof PerformanceDashboard>
type Story = StoryObj<typeof PerformanceDashboard>
export const Ready:Story = {}
export const Empty:Story = {args:{load:fixture('empty')}}
export const Insufficient:Story = {args:{load:fixture('insufficient')}}
export const Loading:Story = {args:{load:()=>new Promise(()=>{})}}
export const Error:Story = {args:{load:async()=>{throw new Error('unavailable')}}}
