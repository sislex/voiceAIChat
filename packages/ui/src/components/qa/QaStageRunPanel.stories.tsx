import type { Meta, StoryObj } from '@storybook/react'
import type { AnyQaStageRun, QaRunStage, QaStageRunStatus } from '@shared/qa'
import { QaStageRunPanel } from './QaStageRunPanel'

function fixture(stage: QaRunStage, status: QaStageRunStatus): AnyQaStageRun {
  const terminal=!['queued','running','awaiting_input'].includes(status)
  return {id:`${stage}-${status}`,projectId:'p1',taskId:'t1',kind:stage==='component_qa'?'componentQaRun':stage==='integration_tests'?'integrationTestsRun':'automatedQaRun',stage,status,attempt:2,triggeredBy:'alexey',branch:'CHAT-226',commitSha:'c'.repeat(40),llmEngineId:'default',llmProvider:'codex',llmModel:'gpt-5.6-sol',currentStep:status==='awaiting_input'?'clarification':'quality-gate',progress:{current:status==='success'?4:2,total:4,label:'DOM / accessibility'},log:[{seq:1,at:Date.now(),stream:'system',text:'Ран запущен'},{seq:2,at:Date.now(),stream:status==='failed'?'err':'out',text:status==='failed'?'Проверка упала':'Проверка завершена'}],result:terminal?{gatePassed:status==='success',checks:['typecheck','DOM','integration']}:null,gateReasons:status==='gate_failed'?['missing_automation:case-1']:[],error:status==='failed'?'Команда завершилась с кодом 1':null,createdAt:Date.now(),startedAt:Date.now(),finishedAt:terminal?Date.now():null,canCancel:!terminal,canRetry:status==='failed'||status==='gate_failed'} as AnyQaStageRun
}
const meta={title:'QA/Stage runs',component:QaStageRunPanel,args:{projectId:'p1',taskId:'t1',stage:'component_qa'},decorators:[(Story,context)=>{const stage=context.args.stage as QaRunStage;const status=(context.parameters.status??'running') as QaStageRunStatus;window.qa={listStageRuns:async()=>[fixture(stage,status)],startStageRun:async()=>fixture(stage,'running'),cancelStageRun:async()=>fixture(stage,'cancelled'),retryStageRun:async()=>fixture(stage,'running'),answerStageRun:async()=>fixture(stage,'running')} as unknown as typeof window.qa;return <Story/>}]} satisfies Meta<typeof QaStageRunPanel>
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
