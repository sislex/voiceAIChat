import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnyQaStageRun, IntegrationTestRun, IntegrationTestTaskState } from '@shared/qa'
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

const stageRun=(result:Record<string,unknown>|null):AnyQaStageRun=>({
  id:'aq1',projectId:'p1',taskId:'t1',kind:'automatedQaRun',stage:'automated_qa',status:result?.passed===true?'success':'failed',
  attempt:1,triggeredBy:'alexey',branch:'CHAT-380',commitSha:'b'.repeat(40),llmEngineId:null,llmProvider:'claude',llmModel:'',
  currentStep:'tests',progress:{current:1,total:1,label:'npm test'},log:[],result,scenario:null,gateReasons:[],error:null,
  createdAt:1,startedAt:2,finishedAt:3,canCancel:false,canRetry:true
} as AnyQaStageRun)

it('показывает вердикт этапа человеку, а не дамп JSON',async()=>{
  window.qa={listStageRuns:vi.fn().mockResolvedValue([stageRun({
    mode:'command',gatePassed:false,passed:false,summary:'Команда автотестов завершилась с кодом 1',
    classification:'implementation_defect',command:'npm test',exitCode:1,durationMs:12000,
    logTail:'FAIL src/a.test.ts',steps:[],screenshotUrl:null
  })])} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="automated_qa"/>)
  expect(await screen.findByText('Команда автотестов завершилась с кодом 1')).toBeInTheDocument()
  expect(screen.getByText('Дефект реализации — задача уходит на доработку')).toBeInTheDocument()
  expect(screen.getByText('команда в воркспейсе')).toBeInTheDocument()
  expect(screen.queryByText(/"gatePassed"/)).not.toBeInTheDocument()
})

it('различает инфраструктурный сбой и перечисляет шаги сценария',async()=>{
  window.qa={listStageRuns:vi.fn().mockResolvedValue([stageRun({
    mode:'playwright',gatePassed:false,passed:false,summary:'Сценарий провален на шаге «Создать задачу»',
    classification:'infrastructure',command:'http://localhost:5173',exitCode:null,durationMs:9000,logTail:'',
    steps:[{id:'s1',title:'Открыть доску',status:'passed',detail:'',durationMs:100},{id:'s2',title:'Создать задачу',status:'failed',detail:'локатор не найден',durationMs:200}],
    screenshotUrl:'/api/qa/runs/aq1/screenshot'
  })])} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="automated_qa"/>)
  expect(await screen.findByText('Инфраструктурный сбой — автопроход остановлен, задача не возвращается')).toBeInTheDocument()
  expect(screen.getByText(/Создать задачу — провален/)).toBeInTheDocument()
  expect(screen.getByAltText('Снимок экрана в момент вердикта')).toHaveAttribute('src','/api/qa/runs/aq1/screenshot')
})

it('старый ран без вердикта показывается как есть, а не пустым блоком',async()=>{
  window.qa={listStageRuns:vi.fn().mockResolvedValue([stageRun({gatePassed:true})])} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="automated_qa"/>)
  expect(await screen.findByText('Результат')).toBeInTheDocument()
  expect(screen.getByText(/"gatePassed": true/)).toBeInTheDocument()
})

it('снимок сценария виден, а повтор обещает воспроизвести именно его',async()=>{
  const retryStageRun=vi.fn()
  window.qa={listStageRuns:vi.fn().mockResolvedValue([{
    ...stageRun({mode:'playwright',gatePassed:false,passed:false,summary:'Сценарий провален',classification:'implementation_defect',command:'http://x',exitCode:null,durationMs:1,logTail:'',steps:[],screenshotUrl:null}),
    scenario:{startUrl:'http://localhost:5173',steps:[{id:'s1',title:'Открыть доску',action:{kind:'click',selector:'#b'}}]}
  }]),retryStageRun} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="automated_qa"/>)
  expect(await screen.findByText('Что прогонялось: 1 шаг(ов) с http://localhost:5173')).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Повторить тот же сценарий'})).toBeInTheDocument()
})
