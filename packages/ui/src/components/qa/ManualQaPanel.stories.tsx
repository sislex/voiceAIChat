import type { Meta, StoryObj } from '@storybook/react'
import type { QaResultStatus, QaTaskState } from '@shared/qa'
import { ManualQaPanel } from './ManualQaPanel'

function state(status: QaResultStatus | null): QaTaskState {
  const criterion={id:'c1',taskId:'t1',order:1,title:'Пользователь может отменить ран',description:'Проверка отмены',preconditions:'Ран выполняется',steps:'1. Открыть ран\n2. Нажать Отмена',testData:'qa-seed-v3',expectedResult:'Ран остановлен, токены больше не расходуются',required:true,testType:'manual' as const,currentVersion:2,active:true,author:'owner',createdAt:1,updatedAt:2}
  if (status===null) return {criteria:[criterion],versions:[],sessions:[],activeSession:null}
  const result={id:'r1',sessionId:'s1',criterionId:'c1',criterionVersion:2,status,draft:false,testerId:'qa',assigneeId:null,startedAt:1,finishedAt:null,branch:'feature/164',commitSha:'abcdef123456',previewId:'preview-1',previewSha:'abcdef123456',appUrl:'https://preview.example',storybookUrl:'https://storybook.example',testDataScenario:'qa-seed-v3',executedSteps:'Открыт ран',expectedResult:criterion.expectedResult,actualResult:status==='failed'?'Ран продолжился':'',comment:'',environment:'Chrome / macOS',blockerReason:status==='blocked'?'Preview недоступен':'',blockerType:status==='blocked'?'environment' as const:null,blockerOwner:status==='blocked'?'ops':null,notApplicableReason:status==='not_applicable'?'Сценарий CLI-only':'',revision:1,attachments:[],issue:null,updatedAt:2}
  const session={id:'s1',taskId:'t1',projectId:'p1',branch:'feature/164',commitSha:'abcdef123456',testRunId:'tests-1',previewId:'preview-1',previewSha:'abcdef123456',appUrl:'https://preview.example',storybookUrl:'https://storybook.example',testDataScenario:'qa-seed-v3',criteriaSnapshot:[{criterionId:'c1',version:2,required:true}],status:status==='stale'?'stale' as const:'active' as const,testerId:'qa',initiatedBy:'qa',startedAt:1,finishedAt:null,staleReason:status==='stale'?'commit_sha_changed':null,summary:'',results:[result]}
  return {criteria:[criterion],versions:[],sessions:[session],activeSession:session.status==='active'?session:null}
}
const meta={title:'QA/Manual QA',component:ManualQaPanel,args:{projectId:'p1',taskId:'t1'},decorators:[(Story,context)=>{window.qa={get:async()=>context.parameters.qaState as QaTaskState,saveResult:async()=>{throw new Error('Story only')},addAttachment:async()=>{throw new Error('Story only')},complete:async()=>{throw new Error('Story only')},createCriterion:async()=>{throw new Error('Story only')},reviseCriterion:async()=>{throw new Error('Story only')},startSession:async()=>{throw new Error('Story only')}};return <Story/>}]} satisfies Meta<typeof ManualQaPanel>
export default meta
type Story=StoryObj<typeof meta>
export const Empty:Story={parameters:{qaState:state(null)}}
export const Partial:Story={parameters:{qaState:state('in_progress')}}
export const Failed:Story={parameters:{qaState:state('failed')}}
export const Blocked:Story={parameters:{qaState:state('blocked')}}
export const Stale:Story={parameters:{qaState:state('stale')}}
export const RequirementChange:Story={parameters:{qaState:state('failed')}}
export const Successful:Story={parameters:{qaState:state('passed')}}
