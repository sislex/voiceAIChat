import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { QaTaskState } from '@shared/qa'
import { ManualQaPanel } from './ManualQaPanel'

function qaState(status: 'not_tested'|'passed'|'failed'|'blocked'|'not_applicable'|'stale' = 'not_tested'): QaTaskState {
  const criterion = { id:'c1',taskId:'t1',order:1,title:'Пользователь отменяет ран',description:'',preconditions:'Ран запущен',steps:'Нажать Отмена',testData:'seed-v1',expectedResult:'Ран остановлен',required:true,testType:'manual' as const,currentVersion:2,active:true,author:'owner',createdAt:1,updatedAt:2 }
  const sessionStatus = status === 'stale' ? 'stale' as const : 'active' as const
  const result = { id:'r1',sessionId:'s1',criterionId:'c1',criterionVersion:2,status,draft:false,testerId:null,assigneeId:null,startedAt:null,finishedAt:null,branch:'feature',commitSha:'abcdef12',previewId:'p1',previewSha:'abcdef12',appUrl:'https://preview',storybookUrl:'https://storybook',testDataScenario:'seed-v1',executedSteps:'',expectedResult:'Ран остановлен',actualResult:'',comment:'',environment:'Chrome',blockerReason:status==='blocked'?'preview down':'',blockerType:status==='blocked'?'environment' as const:null,blockerOwner:status==='blocked'?'ops':null,notApplicableReason:status==='not_applicable'?'CLI only':'',revision:1,attachments:[],issue:null,updatedAt:2 }
  const session = { id:'s1',taskId:'t1',projectId:'p1',branch:'feature',commitSha:'abcdef12',testRunId:'tr1',previewId:'p1',previewSha:'abcdef12',appUrl:'https://preview',storybookUrl:'https://storybook',testDataScenario:'seed-v1',criteriaSnapshot:[{criterionId:'c1',version:2,required:true}],status:sessionStatus,testerId:'qa',initiatedBy:'qa',startedAt:1,finishedAt:null,staleReason:status==='stale'?'commit_sha_changed':null,summary:'',results:[result] }
  return { criteria:[criterion],versions:[],sessions:[session],activeSession:sessionStatus==='active'?session:null }
}
afterEach(() => { delete window.qa })
describe('ManualQaPanel', () => {
  it('renders progress, criterion details, preview and history version', async () => {
    window.qa = { get: vi.fn().mockResolvedValue(qaState()), saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn() }
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    expect(await screen.findByText(/Прогресс 0\/1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name:/Критерий 1/ }))
    expect(screen.getByText('Ран запущен')).toBeTruthy()
    expect(screen.getByText(/not_tested · v2/)).toBeTruthy()
    expect(screen.getByRole('link', { name:'Открыть preview' })).toHaveAttribute('href','https://preview')
    expect(screen.getByLabelText('Скриншоты')).toHaveAttribute('multiple')
  })
  it('saves a draft with optimistic revision', async () => {
    const saveResult=vi.fn().mockResolvedValue({})
    window.qa={get:vi.fn().mockResolvedValue(qaState()),saveResult,addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button',{name:/Критерий 1/}))
    fireEvent.change(screen.getByLabelText(/Фактически выполненные шаги/),{target:{value:'Нажал Отмена'}})
    fireEvent.click(screen.getByRole('button',{name:'Сохранить черновик'}))
    await waitFor(()=>expect(saveResult).toHaveBeenCalledWith('p1','t1','r1',1,expect.objectContaining({draft:true,status:'in_progress',executedSteps:'Нажал Отмена'})))
  })
  it('creates a detailed manual QA scenario', async () => {
    const createCriterion = vi.fn().mockResolvedValue({})
    window.qa={get:vi.fn().mockResolvedValue({criteria:[],versions:[],sessions:[],activeSession:null}),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion,reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByText('Добавить сценарий ручного QA'))
    fireEvent.change(screen.getByLabelText('Название сценария'), { target: { value: 'Создание задачи B' } })
    fireEvent.change(screen.getByLabelText('Предусловия и URL'), { target: { value: 'Открыть https://preview/chat/1' } })
    fireEvent.change(screen.getByLabelText('Подробные действия'), { target: { value: '1. Нажать Создать задачу\n2. Заполнить форму' } })
    fireEvent.change(screen.getByLabelText('Данные для заполнения'), { target: { value: 'Название: QA B' } })
    fireEvent.change(screen.getByLabelText('Ожидаемый результат'), { target: { value: 'Создана задача B без ошибки' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить сценарий' }))
    await waitFor(() => expect(createCriterion).toHaveBeenCalledWith('p1', 't1', expect.objectContaining({
      title: 'Создание задачи B', preconditions: 'Открыть https://preview/chat/1', testData: 'Название: QA B', expectedResult: 'Создана задача B без ошибки'
    })))
  })

  it('moves prepared scenarios through the server gate', async () => {
    const prepared = qaState(); prepared.sessions = []; prepared.activeSession = null
    const completePreparation = vi.fn().mockResolvedValue(prepared)
    window.qa={get:vi.fn().mockResolvedValue(prepared),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation,createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Сценарии готовы — перейти в ручное QA' }))
    await waitFor(() => expect(completePreparation).toHaveBeenCalledWith('p1', 't1'))
  })

  it('shows stale reason and disables result actions', async () => {
    window.qa={get:vi.fn().mockResolvedValue(qaState('stale')),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    expect(await screen.findByText('commit_sha_changed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:/Критерий 1/}))
    expect(screen.getByRole('button',{name:'Работает'})).toBeDisabled()
  })
})
