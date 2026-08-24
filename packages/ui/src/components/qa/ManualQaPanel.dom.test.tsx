import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(await screen.findByText(/Проверено 0\/1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name:/Тест 1/ }))
    expect(screen.getByText('Ран запущен')).toBeTruthy()
    expect(screen.getByText(/Без результата · v2/)).toBeTruthy()
    expect(screen.getByRole('link', { name:'Открыть preview' })).toHaveAttribute('href','https://preview')
    expect(screen.getByLabelText('Скриншоты')).toHaveAttribute('multiple')
  })
  it('renders per-scenario controls and saves success with optimistic revision', async () => {
    const saved = { ...qaState('passed').activeSession!.results[0], revision: 2 }
    const saveResult=vi.fn().mockResolvedValue(saved)
    window.qa={get:vi.fn().mockResolvedValue(qaState()),saveResult,addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    expect(await screen.findByRole('button',{name:'Работает'})).toHaveAttribute('aria-pressed','false')
    expect(screen.getByRole('button',{name:'Не работает'})).toBeTruthy()
    expect(screen.getByLabelText('Комментарий')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:'Работает'}))
    fireEvent.click(screen.getByRole('button',{name:'Сохранить результат'}))
    await waitFor(()=>expect(saveResult).toHaveBeenCalledWith('p1','t1','r1',1,expect.objectContaining({draft:false,status:'passed'})))
    expect(await screen.findByText('Сохранено: Работает')).toBeTruthy()
  })

  it('requires a comment for failure and preserves it after a save error', async () => {
    const saveResult=vi.fn().mockRejectedValue(new Error('QA result revision conflict'))
    window.qa={get:vi.fn().mockResolvedValue(qaState()),saveResult,addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    await screen.findByRole('button',{name:'Не работает'})
    fireEvent.click(screen.getByRole('button',{name:'Не работает'}))
    fireEvent.click(screen.getByRole('button',{name:'Сохранить результат'}))
    expect(screen.getByRole('alert')).toHaveTextContent('Опишите фактический результат')
    expect(saveResult).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Комментарий (обязательно)'), { target: { value: 'На шаге 2 ран продолжает работать' } })
    fireEvent.click(screen.getByRole('button',{name:'Сохранить результат'}))
    await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('revision conflict'))
    expect(screen.getByLabelText('Комментарий (обязательно)')).toHaveValue('На шаге 2 ран продолжает работать')
    expect(screen.getByRole('button',{name:'Повторить сохранение'})).toBeEnabled()
  })

  it('submits blocked with the existing blocker contract', async () => {
    const saved = { ...qaState('blocked').activeSession!.results[0], comment:'Preview недоступен', revision:2 }
    const saveResult=vi.fn().mockResolvedValue(saved)
    window.qa={get:vi.fn().mockResolvedValue(qaState()),saveResult,addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button',{name:'Нет возможности проверить'}))
    fireEvent.change(screen.getByLabelText('Комментарий (обязательно)'), { target:{ value:'Preview недоступен' } })
    fireEvent.click(screen.getByRole('button',{name:'Сохранить результат'}))
    await waitFor(()=>expect(saveResult).toHaveBeenCalledWith('p1','t1','r1',1,expect.objectContaining({
      status:'blocked', comment:'Preview недоступен', blockerReason:'Preview недоступен', blockerType:'other'
    })))
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

  it('shows terminal preparation error and retries it once', async () => {
    const failed: QaTaskState = { criteria:[], versions:[], sessions:[], activeSession:null, preparation:{ id:'prep',taskId:'t1',branch:'CHAT-195',commitSha:'abc',status:'failed',attempt:2,maxAttempts:2,error:'Невалидный JSON',attempts:[],createdAt:1,finishedAt:2,canRetry:true } }
    const running = { ...failed.preparation!, status:'running' as const, attempt:1, error:null, finishedAt:null, canRetry:false }
    const retryPreparation = vi.fn().mockResolvedValue(running)
    window.qa={get:vi.fn().mockResolvedValueOnce(failed).mockResolvedValue({ ...failed, preparation:running }),retryPreparation,saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Невалидный JSON')
    fireEvent.click(screen.getByRole('button',{name:'Повторить создание сценариев'}))
    await waitFor(()=>expect(retryPreparation).toHaveBeenCalledTimes(1))
    expect(await screen.findByRole('status')).toHaveTextContent('Попытка 1 из 2')
  })

  it('shows stale reason and disables result actions', async () => {
    window.qa={get:vi.fn().mockResolvedValue(qaState('stale')),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    expect(await screen.findByText('commit_sha_changed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button',{name:/Тест 1/}))
    expect(screen.getByRole('button',{name:'Работает'})).toBeDisabled()
  })

  it('shows exactly three mutually exclusive results even for an optional test', async () => {
    const state = qaState()
    state.criteria[0].required = false
    state.activeSession!.criteriaSnapshot[0].required = false
    window.qa={get:vi.fn().mockResolvedValue(state),saveResult:vi.fn(),addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    const group = await screen.findByRole('group', { name:/Результат теста/ })
    expect(within(group).getAllByRole('button')).toHaveLength(3)
    for (const name of ['Работает', 'Нет возможности проверить', 'Не работает']) {
      fireEvent.click(within(group).getByRole('button', { name }))
      expect(within(group).getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true')
      expect(within(group).getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true')).toHaveLength(1)
    }
    expect(within(group).queryByRole('button', { name:'Пропустить' })).toBeNull()
  })

  it('saves dirty results before completing and guards a double click', async () => {
    const initial = qaState()
    const passed = qaState('passed')
    const saved = { ...passed.activeSession!.results[0], revision:2 }
    const get = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(passed)
    const saveResult = vi.fn().mockResolvedValue(saved)
    let resolveComplete!: () => void
    const complete = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveComplete = resolve }))
    window.qa={get,saveResult,addAttachment:vi.fn(),complete,completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button',{name:'Работает'}))
    const next = screen.getByRole('button',{name:'Следующий этап'})
    fireEvent.click(next)
    fireEvent.click(next)
    await waitFor(() => expect(saveResult).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(complete).toHaveBeenCalledTimes(1))
    expect(saveResult.mock.invocationCallOrder[0]).toBeLessThan(complete.mock.invocationCallOrder[0])
    expect(next).toBeDisabled()
    resolveComplete()
  })

  it('does not transition when flushing a dirty result fails', async () => {
    const saveResult = vi.fn().mockRejectedValue(new Error('Конфликт ревизии'))
    const complete = vi.fn()
    window.qa={get:vi.fn().mockResolvedValue(qaState()),saveResult,addAttachment:vi.fn(),complete,completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix:vi.fn()}
    render(<ManualQaPanel projectId="p1" taskId="t1" />)
    fireEvent.click(await screen.findByRole('button',{name:'Работает'}))
    fireEvent.click(screen.getByRole('button',{name:'Следующий этап'}))
    await waitFor(() => expect(saveResult).toHaveBeenCalledTimes(1))
    expect(complete).not.toHaveBeenCalled()
    expect(screen.getByText(/Не удалось сохранить изменения тестов/)).toBeTruthy()
  })

  it('saves a failure before requesting fix', async () => {
    const initial = qaState()
    const failed = qaState('failed')
    failed.activeSession!.results[0].comment = 'Кнопка не отвечает'
    const saved = { ...failed.activeSession!.results[0], revision:2 }
    const get = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(failed)
    const saveResult = vi.fn().mockResolvedValue(saved)
    const requestFix = vi.fn().mockResolvedValue({ id:'run-fix' })
    const onFixStarted = vi.fn()
    window.qa={get,saveResult,addAttachment:vi.fn(),complete:vi.fn(),completePreparation:vi.fn(),createCriterion:vi.fn(),reviseCriterion:vi.fn(),startSession:vi.fn(),requestFix}
    render(<ManualQaPanel projectId="p1" taskId="t1" onFixStarted={onFixStarted} />)
    fireEvent.click(await screen.findByRole('button',{name:'Не работает'}))
    fireEvent.change(screen.getByLabelText('Комментарий (обязательно)'), { target:{ value:'Кнопка не отвечает' } })
    fireEvent.click(screen.getByRole('button',{name:'Отправить на доработку'}))
    await waitFor(() => expect(requestFix).toHaveBeenCalledTimes(1))
    expect(saveResult.mock.invocationCallOrder[0]).toBeLessThan(requestFix.mock.invocationCallOrder[0])
    expect(onFixStarted).toHaveBeenCalledWith('run-fix')
  })
})
