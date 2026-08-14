import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComponentQaPanel } from './ComponentQaPanel'
import type { ComponentQaTaskState } from '@shared/qa'

const state=():ComponentQaTaskState=>({activeRun:null,launchReasons:[],canStart:false,canComplete:true,gateReasons:[],runs:[],latestRun:{
  id:'cq1',projectId:'p1',taskId:'t1',developmentRunId:'dev1',linkedFixRunId:null,branch:'CHAT-227',commitSha:'a'.repeat(40),attempt:2,status:'passed',uiImpact:'existing_components',readinessRunId:'prep1',readinessVersion:'v1',
  scenarios:[{testCase:{id:'TC-1',title:'Button default',description:'',preconditions:'Storybook',testData:'fixture',steps:'render',expectedResult:'visible',required:true,testType:'ui',automatable:true,automationLinks:[],notAutomatedReason:'',alternativeManualVerification:'',comments:''},version:1,semanticHash:'v1',status:'passed',actualResult:'visible',diagnostic:''}],
  components:[{id:'button',name:'Button',storybookStoryId:'ui-button--default',reusable:true,coverage:{stories:true,states:true,fixtures:true,playFunctions:true,domTests:true,accessibility:true,visual:true},exclusionReason:'',alternativeVerification:''}],
  commands:[{commandId:'component',name:'Component tests',command:'npm run test:storybook',exitCode:0,durationMs:42,status:'passed',stdout:'ok',stderr:'',diagnostic:'',artifacts:[]}],
  artifacts:[],failureClassification:null,blockerReasons:[],summary:'Component QA пройден',log:'ok',storybookUrl:'https://storybook.test',createdAt:1,startedAt:2,finishedAt:3,staleReason:null,canCancel:false,canRetry:false
}})

afterEach(()=>{delete window.qa})
describe('ComponentQaPanel',()=>{
  it('restores completed run and exposes its audit trail',async()=>{
    window.qa={get:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),completePreparation:vi.fn(),startSession:vi.fn(),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),requestFix:vi.fn(),getComponent:vi.fn().mockResolvedValue(state()),completeComponent:vi.fn()}
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false}/>)
    expect(await screen.findByText('CHAT-227')).toBeInTheDocument()
    expect(screen.getByText(/Button default/)).toBeInTheDocument()
    expect(screen.getByText(/Component QA пройден/)).toBeInTheDocument()
  })
  it('advances only through server gate action',async()=>{
    const completeComponent=vi.fn().mockResolvedValue(state().latestRun)
    window.qa={get:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),completePreparation:vi.fn(),startSession:vi.fn(),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),requestFix:vi.fn(),getComponent:vi.fn().mockResolvedValue(state()),completeComponent}
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false}/>)
    await userEvent.click(await screen.findByRole('button',{name:'Перейти к созданию интеграционных автотестов'}))
    await waitFor(()=>expect(completeComponent).toHaveBeenCalledWith('p1','t1','cq1'))
  })
})
