import type { Meta, StoryObj } from '@storybook/react'
import type { AnyQaStageRun, QaRunStage, QaStageRunStatus } from '@shared/qa'
import { QaStageRunPanel } from './QaStageRunPanel'

function fixture(stage: QaRunStage, status: QaStageRunStatus): AnyQaStageRun {
  const terminal=!['queued','running','awaiting_input'].includes(status)
  return {id:`${stage}-${status}`,projectId:'p1',taskId:'t1',kind:stage==='component_qa'?'componentQaRun':stage==='integration_tests'?'integrationTestsRun':'automatedQaRun',stage,status,attempt:2,triggeredBy:'alexey',branch:'CHAT-226',commitSha:'c'.repeat(40),llmEngineId:'default',llmProvider:'codex',llmModel:'gpt-5.6-sol',currentStep:status==='awaiting_input'?'clarification':'quality-gate',progress:{current:status==='success'?4:2,total:4,label:'DOM / accessibility'},log:[{seq:1,at:Date.now(),stream:'system',text:'Ран запущен'},{seq:2,at:Date.now(),stream:status==='failed'?'err':'out',text:status==='failed'?'Проверка упала':'Проверка завершена'}],result:terminal?{gatePassed:status==='success',checks:['typecheck','DOM','integration']}:null,scenarios:null,gateReasons:status==='gate_failed'?['missing_automation:case-1']:[],error:status==='failed'?'Команда завершилась с кодом 1':null,createdAt:Date.now(),startedAt:Date.now(),finishedAt:terminal?Date.now():null,canCancel:!terminal,canRetry:status==='failed'||status==='gate_failed'} as AnyQaStageRun
}
const meta={title:'QA/Stage runs',component:QaStageRunPanel,args:{projectId:'p1',taskId:'t1',stage:'component_qa'},decorators:[(Story,context)=>{const stage=context.args.stage as QaRunStage;const status=(context.parameters.status??'running') as QaStageRunStatus;const verdict=context.parameters.verdict as Record<string,unknown>|undefined;const run=verdict?{...fixture(stage,verdict.passed===true?'success':'failed'),result:verdict}:fixture(stage,status);window.qa={listStageRuns:async()=>[run],startStageRun:async()=>fixture(stage,'running'),cancelStageRun:async()=>fixture(stage,'cancelled'),retryStageRun:async()=>fixture(stage,'running'),answerStageRun:async()=>fixture(stage,'running')} as unknown as typeof window.qa;return <Story/>}]} satisfies Meta<typeof QaStageRunPanel>
export default meta
type Story=StoryObj<typeof meta>

export const ComponentActive:Story={args:{stage:'component_qa'},parameters:{status:'running'}}
export const ComponentSuccess:Story={args:{stage:'component_qa'},parameters:{status:'success'}}
export const ComponentFailed:Story={args:{stage:'component_qa'},parameters:{status:'failed'}}
export const ComponentAwaitingAnswer:Story={args:{stage:'component_qa'},parameters:{status:'awaiting_input'}}
export const IntegrationActive:Story={args:{stage:'integration_tests'},parameters:{status:'running'}}
export const IntegrationSuccess:Story={args:{stage:'integration_tests'},parameters:{status:'success'}}
export const IntegrationFailed:Story={args:{stage:'integration_tests'},parameters:{status:'failed'}}
export const IntegrationAwaitingAnswer:Story={args:{stage:'integration_tests'},parameters:{status:'awaiting_input'}}
export const AutomatedActive:Story={args:{stage:'automated_qa'},parameters:{status:'running'}}
export const AutomatedSuccess:Story={args:{stage:'automated_qa'},parameters:{status:'success'}}
export const AutomatedFailed:Story={args:{stage:'automated_qa'},parameters:{status:'failed'}}
export const AutomatedAwaitingAnswer:Story={args:{stage:'automated_qa'},parameters:{status:'awaiting_input'}}

// Вердикт этапа: состояния достижимы только ответом сервера, поэтому живут в
// витрине — иначе проверить их вёрстку негде.
export const AutomatedCommandVerdict:Story={args:{stage:'automated_qa'},parameters:{verdict:{
  mode:'command',gatePassed:false,passed:false,summary:'Команда автотестов завершилась с кодом 1',
  classification:'implementation_defect',command:'npm test',exitCode:1,durationMs:184000,
  logTail:'FAIL src/components/TaskCard.dom.test.tsx\n  × показывает флаг',steps:[],screenshotUrl:null
}}}
export const AutomatedInfrastructureVerdict:Story={args:{stage:'automated_qa'},parameters:{verdict:{
  mode:'command',gatePassed:false,passed:false,summary:'Лимит времени Automated QA исчерпан',
  classification:'infrastructure',command:'npm test',exitCode:null,durationMs:1800000,logTail:'',steps:[],screenshotUrl:null
}}}
export const AutomatedPlaywrightVerdict:Story={args:{stage:'automated_qa'},parameters:{verdict:{
  mode:'playwright',gatePassed:false,passed:false,summary:'Сценарий провален на шаге «Создать задачу»',
  classification:'implementation_defect',command:'http://localhost:5173/#/projects/p1',exitCode:null,durationMs:9400,
  logTail:'Создать задачу — failed: локатор «#create» не найден',
  steps:[
    {id:'s1',title:'Открыть доску',status:'passed',detail:'',durationMs:820},
    {id:'s2',title:'Создать задачу',status:'failed',detail:'локатор «#create» не найден',durationMs:5200},
    {id:'s3',title:'Проверить карточку',status:'skipped',detail:'Пропущен после провала предыдущего шага',durationMs:0}
  ],
  screenshotUrl:null
}}}
/**
 * Ошибки консоли страницы в вердикте (круг 27). Провалом сами по себе не
 * считаются, но при разборе шага отвечают быстрее снимка экрана.
 */
export const AutomatedPlaywrightPageErrors:Story={args:{stage:'automated_qa'},parameters:{verdict:{
  mode:'playwright',gatePassed:false,passed:false,summary:'Сценарий «Доска» провален на шаге «Создать задачу»',
  classification:'implementation_defect',command:'http://localhost:5173/#/projects/p1',exitCode:null,durationMs:11200,
  logTail:'Доска: Создать задачу — failed: локатор «#create» не найден',
  steps:[
    {id:'s1',title:'Доска: Открыть доску',status:'passed',detail:'',durationMs:900},
    {id:'s2',title:'Доска: Создать задачу',status:'failed',detail:'локатор «#create» не найден',durationMs:5200}
  ],
  pageErrors:[
    'Доска: Uncaught TypeError: Cannot read properties of undefined (reading \'columns\') at BoardView.tsx:142',
    'Доска: Failed to load resource: the server responded with a status of 500 (/api/projects/p1/board)'
  ],
  screenshotUrl:null
}}}
export const AutomatedPlaywrightPassed:Story={args:{stage:'automated_qa'},parameters:{verdict:{
  mode:'playwright',gatePassed:true,passed:true,summary:'Сценарий пройден: 3 шаг(ов)',
  classification:null,command:'http://localhost:5173/#/projects/p1',exitCode:null,durationMs:7300,logTail:'',
  steps:[
    {id:'s1',title:'Открыть доску',status:'passed',detail:'',durationMs:820},
    {id:'s2',title:'Создать задачу',status:'passed',detail:'',durationMs:3100},
    {id:'s3',title:'Проверить карточку',status:'passed',detail:'',durationMs:3380}
  ],
  screenshotUrl:null
}}}
