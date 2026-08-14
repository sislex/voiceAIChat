import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnyQaStageRun } from '@shared/qa'
import { QaStageRunPanel } from './QaStageRunPanel'

const run = (patch: Partial<AnyQaStageRun> = {}): AnyQaStageRun => ({
  id:'r1',projectId:'p1',taskId:'t1',kind:'integrationTestsRun',stage:'integration_tests',status:'running',
  attempt:1,triggeredBy:'owner',branch:'CHAT-226',commitSha:'a'.repeat(40),llmEngineId:null,llmProvider:'claude',
  llmModel:'opus',currentStep:'tests',progress:{current:1,total:3,label:'typecheck'},log:[{seq:1,at:1,stream:'out',text:'started'}],
  result:null,gateReasons:[],error:null,createdAt:1,startedAt:1,finishedAt:null,canCancel:true,canRetry:false,...patch
} as AnyQaStageRun)
afterEach(() => { delete window.qa })

it('shows only selected stage history and supports cancellation', async () => {
  const cancelStageRun = vi.fn().mockResolvedValue(run({status:'cancelled',canCancel:false,canRetry:true}))
  window.qa = { listStageRuns:vi.fn().mockResolvedValue([run()]),cancelStageRun } as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests" />)
  expect(await screen.findByText('started')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Отменить'}))
  await waitFor(() => expect(cancelStageRun).toHaveBeenCalledWith('r1'))
})

it('renders gate failure and retries a terminal attempt', async () => {
  const failed=run({status:'gate_failed',gateReasons:['missing_automation:case-1'],canCancel:false,canRetry:true})
  const retryStageRun=vi.fn().mockResolvedValue(run())
  window.qa={listStageRuns:vi.fn().mockResolvedValue([failed]),retryStageRun} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests" />)
  expect(await screen.findByText('missing_automation:case-1')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Повторить'}))
  await waitFor(()=>expect(retryStageRun).toHaveBeenCalledWith('r1'))
})

it('answers an integration run waiting for clarification', async () => {
  const answerStageRun=vi.fn().mockResolvedValue(run())
  window.qa={listStageRuns:vi.fn().mockResolvedValue([run({status:'awaiting_input'})]),answerStageRun} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests" />)
  const input=await screen.findByLabelText('Ответ модели')
  fireEvent.change(input,{target:{value:'Use the existing fixture'}})
  fireEvent.click(screen.getByRole('button',{name:'Отправить'}))
  await waitFor(()=>expect(answerStageRun).toHaveBeenCalledWith('r1','Use the existing fixture'))
})
