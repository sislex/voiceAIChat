import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { IntegrationTestRun, IntegrationTestTaskState } from '@shared/qa'
import { QaStageRunPanel } from './QaStageRunPanel'
const run=(patch:Partial<IntegrationTestRun>={}):IntegrationTestRun=>({id:'r1',projectId:'p1',taskId:'t1',developmentRunId:'d1',linkedFixRunId:null,branch:'CHAT-229',commitSha:'a'.repeat(40),attempt:1,status:'running',readinessRunId:'prep',snapshotVersion:'v1',testCases:[],automationLinks:[],commands:[],log:'started',failureClassification:null,failureReason:null,blockerReasons:[],summary:'',createdAt:1,startedAt:1,finishedAt:null,staleReason:null,canCancel:true,canRetry:false,...patch})
const state=(latestRun:IntegrationTestRun|null=run()):IntegrationTestTaskState=>({activeRun:latestRun?.status==='running'?latestRun:null,latestRun,runs:latestRun?[latestRun]:[],testCases:[],launchReasons:[],canStart:false,canComplete:false,gateReasons:[]})
afterEach(()=>{delete window.qa})
it('shows the integration log and cancels the active run',async()=>{
  const cancelIntegration=vi.fn().mockResolvedValue(run({status:'cancelled'}))
  window.qa={getIntegration:vi.fn().mockResolvedValue(state()),cancelIntegration} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests"/>)
  expect(await screen.findByText('started')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Отменить'}))
  await waitFor(()=>expect(cancelIntegration).toHaveBeenCalledWith('p1','t1','r1'))
})
it('shows concrete launch reasons and the unavailable fallback',async()=>{
  window.qa={getIntegration:vi.fn().mockResolvedValue({...state(null),launchReasons:['missing_readiness_snapshot'],canStart:false})} as unknown as typeof window.qa
  const view=render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests"/>)
  expect(await screen.findByText('missing_readiness_snapshot')).toBeInTheDocument()
  view.unmount();delete window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests"/>)
  expect(screen.getByText('Стадия недоступна')).toBeInTheDocument()
})
