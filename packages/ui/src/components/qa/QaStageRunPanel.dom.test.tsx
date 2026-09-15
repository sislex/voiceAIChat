import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnyQaStageRun, IntegrationTestRun, IntegrationTestTaskState } from '@shared/qa'
import { expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { QaStageRunPanel, automatedQaReport, integrationQaReport } from './QaStageRunPanel'
const run=(patch:Partial<IntegrationTestRun>={}):IntegrationTestRun=>({id:'r1',projectId:'p1',taskId:'t1',developmentRunId:'d1',linkedFixRunId:null,branch:'CHAT-229',commitSha:'a'.repeat(40),attempt:1,status:'running',readinessRunId:'prep',snapshotVersion:'v1',testCases:[],automationLinks:[],commands:[],log:'started',failureClassification:null,failureReason:null,blockerReasons:[],summary:'',createdAt:1,startedAt:1,finishedAt:null,staleReason:null,canCancel:true,canRetry:false,...patch})
const state=(latestRun:IntegrationTestRun|null=run()):IntegrationTestTaskState=>({activeRun:latestRun?.status==='running'?latestRun:null,latestRun,runs:latestRun?[latestRun]:[],testCases:[],launchReasons:[],canStart:false,canComplete:false,gateReasons:[]})
afterEach(()=>{delete window.qa})
// @testCase TC-09
it('exports Automated and Integration reports with errors and artifacts',()=>{
 const result={mode:'playwright',summary:'Broken',steps:[{id:'s',title:'Step',status:'failed',detail:'Failure',pageErrors:['Console error']}],pageErrors:['Other error'],screenshotUrl:'/shot.png'}
 const automated=automatedQaReport(stageRun(result))
 expect(automated).toContain('Console error')
 expect(automated).toContain('Other error')
 expect(automated).toContain('/shot.png')
 const integration=integrationQaReport(run({commands:[{commandId:'one',name:'Test',command:'test',status:'failed',exitCode:1,durationMs:1,stdout:'Output',stderr:'Failure',diagnostic:''}]}))
 expect(integration).toContain('Output')
 expect(integration).toContain('Failure')
})
// @testCase TC-02
// @testCase TC-08
it('groups automation and exclusions with workspace file navigation',async()=>{
  const item={id:'tc',title:'Login',description:'',preconditions:'',steps:'Click',testData:'',expectedResult:'OK',required:true,testType:'integration' as const,automatable:true,automationLinks:[{testId:'tc',path:'src/login.test.ts',commitSha:'a'.repeat(40),updatedAt:1}],notAutomatedReason:'',alternativeManualVerification:'',comments:''}
  window.qa={getIntegration:vi.fn().mockResolvedValue(state(run({testCases:[item,{...item,id:'manual',title:'Clipboard',automatable:false,notAutomatedReason:'Real clipboard required'}]})))} as unknown as typeof window.qa
  window.api={...window.api,'projects:gitWorkspaces':vi.fn().mockResolvedValue([{id:'ws:one',taskId:'t1',expectedSha:'a'.repeat(40),released:false}])}
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests"/>)
  expect(await screen.findByText('Автоматизируемые (1)')).toBeInTheDocument()
  expect(screen.getByText('Исключённые (1)')).toBeInTheDocument()
  expect(await screen.findByRole('link',{name:'src/login.test.ts'})).toHaveAttribute('href','?file=src%2Flogin.test.ts#/projects/p1/code/ws%3Aone')
  fireEvent.click(screen.getByText('Причина исключения'))
  expect(screen.getByText('Real clipboard required')).toBeVisible()
  await expectNoViolations()
})
// @testCase TC-03
it('shows ordered durations and retries selected failed scenarios only',async()=>{
  const scenario={name:'Login',startUrl:'https://test',steps:[]}
  const data={...stageRun({mode:'playwright',summary:'Failed',steps:[{id:'one',scenarioId:'aq1:scenario:0',title:'Passed step',status:'passed',detail:'',durationMs:10},{id:'two',scenarioId:'aq1:scenario:1',title:'Failed step',status:'failed',detail:'',durationMs:20,pageErrors:['Page broke']}],pageErrors:['Page broke','Outside steps']}),scenarios:[scenario,{...scenario,name:'Create'}]}
  const retryStageRun=vi.fn()
  window.qa={listStageRuns:vi.fn().mockResolvedValue([data]),retryStageRun} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="automated_qa"/>)
  await screen.findByText('Failed step — провален')
  expect(screen.getByText(/20 мс/)).toBeInTheDocument()
  expect(screen.getAllByText('Page broke')).toHaveLength(1)
  expect(screen.getByText('Outside steps')).toBeInTheDocument()
  await expectNoViolations()
  fireEvent.click(screen.getByRole('button',{name:'Повторить только упавшие шаги'}))
  await waitFor(()=>expect(retryStageRun).toHaveBeenCalledWith('aq1',['aq1:scenario:1']))
})
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
  currentStep:'tests',progress:{current:1,total:1,label:'npm test'},log:[],result,scenarios:null,gateReasons:[],error:null,
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
    scenarios:[{name:'Вход',startUrl:'http://localhost:5173',steps:[{id:'s1',title:'Открыть доску',action:{kind:'click',selector:'#b'}}]}]
  }]),retryStageRun} as unknown as typeof window.qa
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="automated_qa"/>)
  expect(await screen.findByText('Что прогонялось: сценариев 1, шагов 1')).toBeInTheDocument()
  expect(screen.getByText('Вход')).toBeInTheDocument()
  expect(screen.getByRole('button',{name:'Повторить те же сценарии'})).toBeInTheDocument()
})

// @testCase TC-07
it('снимок перечитывается по WS-событию этапа, а не опросом по таймеру',async()=>{
  vi.useFakeTimers()
  const getIntegration=vi.fn().mockResolvedValue(state())
  window.qa={getIntegration} as unknown as typeof window.qa
  let emit:((event:{projectId:string;taskId:string;stage:string})=>void)|undefined
  window.board={
    subscribe:vi.fn(),unsubscribe:vi.fn(),onChanged:vi.fn(()=>()=>{}),onConnected:vi.fn(()=>()=>{}),
    onPreparationRunUpdated:vi.fn(()=>()=>{}),onTaskRepositoriesUpdated:vi.fn(()=>()=>{}),
    onQaStageUpdated:vi.fn((cb)=>{emit=cb as typeof emit;return ()=>{emit=undefined}}),
    onImprovementsUpdated:vi.fn(()=>()=>{}),onReconnect:vi.fn(()=>()=>{})
  } as unknown as typeof window.board
  render(<QaStageRunPanel projectId="p1" taskId="t1" stage="integration_tests"/>)
  await vi.waitFor(()=>expect(getIntegration).toHaveBeenCalledTimes(1))

  // Активный ран больше не означает опрос: без событий запросов не прибавляется.
  await vi.advanceTimersByTimeAsync(6000)
  expect(getIntegration).toHaveBeenCalledTimes(1)

  // Чужой этап и чужая задача панель не трогают.
  emit?.({projectId:'p1',taskId:'t1',stage:'component_qa'})
  emit?.({projectId:'p1',taskId:'other',stage:'integration_tests'})
  await vi.advanceTimersByTimeAsync(600)
  expect(getIntegration).toHaveBeenCalledTimes(1)

  // Своё событие — один перезапрос; серия событий схлопывается дебаунсом.
  emit?.({projectId:'p1',taskId:'t1',stage:'integration_tests'})
  emit?.({projectId:'p1',taskId:'t1',stage:'integration_tests'})
  await vi.advanceTimersByTimeAsync(600)
  expect(getIntegration).toHaveBeenCalledTimes(2)
  delete window.board
  vi.useRealTimers()
})
