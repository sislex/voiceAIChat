import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ComponentQaPanel, useQaRefresh } from './ComponentQaPanel'
import { expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
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
  // @testCase TC-07
  it('ignores late responses and advances freshness only after successful reads',async()=>{
    const hook=renderHook(({id})=>useQaRefresh(id),{initialProps:{id:'one'}})
    let resolve!:(value:string)=>void
    const apply=vi.fn(),fail=vi.fn()
    let pending!:Promise<void>
    act(()=>{pending=hook.result.current.request(()=>new Promise<string>(done=>{resolve=done}),apply,fail)})
    hook.rerender({id:'two'})
    await act(async()=>{resolve('old');await pending})
    expect(apply).not.toHaveBeenCalled()
    expect(hook.result.current.updatedAt).toBeNull()
    await act(async()=>{await hook.result.current.request(async()=>'new',apply,fail)})
    const timestamp=hook.result.current.updatedAt
    expect(timestamp).not.toBeNull()
    await act(async()=>{await hook.result.current.request(async()=>{throw new Error('offline')},apply,fail)})
    expect(hook.result.current.updatedAt).toBe(timestamp)
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('new')
    expect(fail).toHaveBeenCalled()
  })

  // @testCase TC-01
  // @testCase TC-08
  it('intersects search and status, opens Storybook and accessible image preview',async()=>{
    const data=state(),run=data.latestRun!
    run.scenarios=['passed','failed','not_applicable'].map((status,index)=>({...run.scenarios[0],status:status as typeof run.scenarios[number]['status'],testCase:{...run.scenarios[0].testCase,id:String(index),title:'Scenario '+index,storybookStoryId:'qa-stage-runs--automated-playwright-verdict'}}))
    run.artifacts=[{id:'shot',kind:'screenshot',url:'/shot.png',path:'',name:'Screenshot'}]
    window.qa={getComponent:vi.fn().mockResolvedValue(data)} as unknown as typeof window.qa
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false}/>)
    await screen.findByText('Scenario 0')
    fireEvent.change(screen.getByLabelText('Статус'),{target:{value:'failed'}})
    expect(screen.queryByText('Scenario 0')).toBeNull()
    expect(screen.getByText('Scenario 1')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Поиск по названию'),{target:{value:'SCENARIO 2'}})
    expect(screen.getByText('Сценарии не найдены')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Статус'),{target:{value:'not_applicable'}})
    expect(screen.getByText('Scenario 2')).toBeInTheDocument()
    expect(within(screen.getByRole('table',{name:'Сценарии'})).getByRole('link')).toHaveAttribute('href',expect.stringContaining('qa-stage-runs--automated-playwright-verdict'))
    await userEvent.click(screen.getByRole('button',{name:'Увеличить: Screenshot'}))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Screenshot')
    await expectNoViolations()
    fireEvent.keyDown(document,{key:'Escape'})
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button',{name:'Увеличить: Screenshot'})).toHaveFocus()
  })
  // @testCase TC-06
  // @testCase TC-09
  it('keeps the requested historical attempt and exports every scenario despite filters',async()=>{
    const data=state(),old={...data.latestRun!,id:'old',attempt:1,branch:'old-branch'}
    data.runs=[data.latestRun!,old]
    const changed=vi.fn()
    window.qa={getComponent:vi.fn().mockResolvedValue(data)} as unknown as typeof window.qa
    const create=vi.fn().mockReturnValue('blob:report')
    Object.defineProperty(URL,'createObjectURL',{configurable:true,value:create})
    Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})
    const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{})
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false} runId="old" hideHistory onStateChange={changed}/>)
    await screen.findByText('old-branch')
    fireEvent.change(screen.getByLabelText('Поиск по названию'),{target:{value:'no results'}})
    fireEvent.click(screen.getByRole('button',{name:'Скачать отчёт'}))
    const text=await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsText(create.mock.calls[0][0])})
    expect(text).toContain('old-branch')
    expect(text).toContain('Button default')
    expect(changed).toHaveBeenCalledWith(data)
    expect(screen.queryByTestId('component-qa-history')).toBeNull()
    expect(screen.queryByRole('button',{name:'Перейти к созданию интеграционных автотестов'})).toBeNull()
    click.mockRestore()
  })

  it('restores completed run and exposes its audit trail',async()=>{
    window.qa={get:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),completePreparation:vi.fn(),startSession:vi.fn(),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),requestFix:vi.fn(),getComponent:vi.fn().mockResolvedValue(state()),completeComponent:vi.fn()}
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false}/>)
    expect(await screen.findByText('CHAT-227')).toBeInTheDocument()
    expect(screen.getByText(/Button default/)).toBeInTheDocument()
    expect(screen.getByText(/Component QA пройден/)).toBeInTheDocument()
  })
  // Статусы печатались сырыми: `passed` рядом с русским «Component QA пройден».
  it('подписывает статусы рана и команд по-русски',async()=>{
    window.qa={get:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),completePreparation:vi.fn(),startSession:vi.fn(),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),requestFix:vi.fn(),getComponent:vi.fn().mockResolvedValue(state()),completeComponent:vi.fn()}
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false}/>)
    // Статус рана — общая лозенга карточки, команда — строка ленты с той же
    // подписью: сырых `passed`/`failed` в панели быть не должно.
    expect(await screen.findByTestId('status-pill')).toHaveTextContent('Пройден')
    expect(screen.getByTestId('status-pill')).toHaveClass('vc-pill--success')
    expect(screen.getByText('Component tests')).toBeInTheDocument()
    expect(screen.getByText(/Пройден · exit 0/)).toBeInTheDocument()
    expect(screen.queryByText(/— passed,/)).not.toBeInTheDocument()
  })

  it('advances only through server gate action',async()=>{
    const completeComponent=vi.fn().mockResolvedValue(state().latestRun)
    window.qa={get:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),completePreparation:vi.fn(),startSession:vi.fn(),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),requestFix:vi.fn(),getComponent:vi.fn().mockResolvedValue(state()),completeComponent}
    render(<ComponentQaPanel projectId="p1" taskId="t1" active={false}/>)
    await userEvent.click(await screen.findByRole('button',{name:'Перейти к созданию интеграционных автотестов'}))
    await waitFor(()=>expect(completeComponent).toHaveBeenCalledWith('p1','t1','cq1'))
  })
})
