import { screen, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetAssistantContext } from '@shared/widgetAssistant'
import { WidgetAssistantFrame, WidgetProposalCard } from './WidgetAssistantFrame'
import { KanbanAssistant, ProjectAssistantChatSelector, projectAssistantChatSource, projectAssistantChatState, relativeTime } from './KanbanAssistant'
import { createFakeApi } from '../test/fakeApi'

const context: WidgetAssistantContext<any> = {
  version: 1,
  widget: { kind: 'kanban', instanceId: 'p1', title: 'Board' },
  project: null,
  selection: { openTask: { id: 't1', title: 'Old' } },
  recentActions: []
}

describe('WidgetAssistantFrame', () => {
  it('opens a generic assistant beside the widget and closes it explicitly', async () => {
    const close = vi.fn()
    render(<WidgetAssistantFrame open widget={<div>Kanban</div>} assistant={<div>Chat</div>} onOpenChange={close} />)
    expect(screen.getByText('Kanban')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Ассистент' })).toHaveTextContent('Chat')
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'vertical')
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть ассистента' }))
    expect(close).toHaveBeenCalledWith(false)
  })

  it('supports the standalone page variant', () => {
    render(<WidgetAssistantFrame mode="page" open widget={<div>Widget only</div>} assistant={<div>Assistant</div>} />)
    expect(screen.getByTestId('widget-assistant-frame')).toHaveClass('widget-assistant--page')
  })

  it('hideHeader: рамка не рисует свою шапку и крестик — их даёт сам ассистент', () => {
    render(<WidgetAssistantFrame open hideHeader widget={<div>Kanban</div>} assistant={<div>Chat</div>} onOpenChange={vi.fn()} />)
    expect(screen.getByRole('complementary', { name: 'Ассистент' })).toHaveTextContent('Chat')
    expect(screen.queryByRole('button', { name: 'Закрыть ассистента' })).not.toBeInTheDocument()
  })

  it('persists a message and sends the latest safe context through the normal LLM transport', async () => {
    const api = createFakeApi()
    const selected = await api['conversations:create']({ title: 'Выбранный' })
    await api['conversations:setProject']({ id: selected.id, projectId: 'p1' })
    await api['messages:add']({ conversationId: selected.id, role: 'ai', text: 'История выбранного', time: '10:00' })
    const send = vi.fn()
    let emitError!: (event: { conversationId: string; message: string }) => void
    const transport = { send, onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn((callback) => { emitError = callback; return () => {} }) } as any
    const onCommand = vi.fn()
    const view = render(<KanbanAssistant projectId="p1" conversationId={selected.id} context={context as any} api={api} llmEngines={[]} transport={transport} onCommand={onCommand} />)
    const next = { ...context, selection: { board: { projectId: 'p1', columns: [], revision: '9', tasks: [{ id: 't2', type: 'epic', title: 'UI', updatedAt: 9 }] }, openTask: { id: 't2', title: 'Current' }, selectedField: 'description' } }
    view.rerender(<KanbanAssistant projectId="p1" conversationId={selected.id} context={next as any} api={api} llmEngines={[]} transport={transport} onCommand={onCommand} />)
    expect(await screen.findByText('История выбранного')).toBeInTheDocument()
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Поле ввода сообщения' })).toBeEnabled())
    await userEvent.type(screen.getByRole('textbox', { name: 'Поле ввода сообщения' }), 'UI')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить сообщение' }))
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0]?.[0].assistantContext.selection.openTask.id).toBe('t2')
    expect(send.mock.calls[0]?.[0].assistantContext.selection.selectedField).toBe('description')
    expect(send.mock.calls[0]?.[0].assistantContext.toolResults.query).toMatchObject({ source: 'ui', revision: '9', items: [{ id: 't2', kind: 'epic', title: 'UI' }] })
    expect(send.mock.calls[0]?.[0].conversationId).toBe(selected.id)
    emitError({ conversationId: selected.id, message: 'Модель временно недоступна' })
    expect(await screen.findByRole('alert')).toHaveTextContent('Модель временно недоступна')
    expect(screen.getByRole('textbox', { name: 'Поле ввода сообщения' })).toBeEnabled()
    expect(await api['kanbanAssistant:get']({ projectId: 'p1', conversationId: selected.id })).toMatchObject({ messages: [{ text: 'История выбранного' }, { role: 'u0', text: 'UI' }] })
  })

  it('список чатов проекта: статусы, выбор с сохранением, создание, поиск и удаление', async () => {
    const api = createFakeApi()
    const regular = await api['conversations:create']({ title: 'Обычный чат' })
    await api['conversations:setProject']({ id: regular.id, projectId: 'p1' })
    await api['kanbanAssistant:get']({ projectId: 'p1' })
    localStorage.setItem('voicechat.projectAssistantChat.p1', regular.id)
    const select = vi.fn()
    const view = render(<ProjectAssistantChatSelector projectId="p1" api={api} selectedId={null} onSelect={select} projectName="ChatAI" />)

    const list = await screen.findByRole('navigation', { name: 'Чаты канбана' })
    expect(await within(list).findByRole('button', { name: /^Обычный чат/ })).toBeInTheDocument()
    expect(within(list).getByRole('button', { name: /^Ассистент · p1/ })).toHaveTextContent('Ассистент доски')
    expect(screen.getByText('Проект · ChatAI')).toBeInTheDocument()
    // Сохранённый выбор восстанавливается при загрузке.
    expect(select).toHaveBeenCalledWith(regular.id)
    view.rerender(<ProjectAssistantChatSelector projectId="p1" api={api} selectedId={regular.id} onSelect={select} projectName="ChatAI" />)
    expect(within(list).getByRole('button', { name: /^Обычный чат/ })).toHaveAttribute('aria-current', 'true')

    await userEvent.type(screen.getByRole('searchbox', { name: 'Найти чат' }), 'Обычный')
    expect(within(list).queryByRole('button', { name: /^Ассистент · p1/ })).not.toBeInTheDocument()
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Найти чат' }))

    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(2))
    const createdId = select.mock.calls[1]?.[0]
    expect((await api['conversations:get']({ id: createdId }))?.conversation.projectId).toBe('p1')
    expect(localStorage.getItem('voicechat.projectAssistantChat.p1')).toBe(createdId)

    // Чат ассистента удалить нельзя, обычный — можно; удалённый текущий уступает место ассистенту.
    expect(within(list).queryByRole('button', { name: /Удалить Ассистент/ })).not.toBeInTheDocument()
    await userEvent.click(within(list).getByRole('button', { name: 'Удалить Обычный чат' }))
    await vi.waitFor(() => expect(within(list).queryByRole('button', { name: /^Обычный чат/ })).not.toBeInTheDocument())
    expect(select).toHaveBeenLastCalledWith(expect.not.stringMatching(regular.id))
    expect(projectAssistantChatSource({ assistantKind: 'browser' } as any)).toBe('browser')
    expect(projectAssistantChatState('developing')).toBe('working')
    expect(projectAssistantChatState('planned')).toBe('waiting')
    expect(projectAssistantChatState('done')).toBe('done')
    expect(projectAssistantChatState(undefined)).toBe('ready')
    expect(relativeTime(1000, 30_000)).toBe('Только что')
    expect(relativeTime(0, 5 * 60_000)).toBe('5 мин назад')
    expect(relativeTime(0, 30 * 3_600_000)).toBe('Вчера')
  })

  it('пустой экран макета: подсказка подставляет текст, шапка показывает проект и статус, настройки открываются', async () => {
    const api = createFakeApi()
    await api['kanbanAssistant:get']({ projectId: 'p1' })
    const transport = { send: vi.fn(), onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) } as any
    const withProject = { ...context, project: { id: 'p1', name: 'ChatAI', description: '', technologies: [], skills: [], typeChain: [] } }
    render(<KanbanAssistant projectId="p1" context={withProject as any} api={api} llmEngines={[]} transport={transport} onCommand={vi.fn()} />)

    expect(await screen.findByRole('heading', { level: 2, name: 'С чего начнём?' })).toBeInTheDocument()
    expect(await screen.findByRole('status')).toHaveTextContent('Готов к работе')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Ассистент · p1/)
    const input = screen.getByRole('textbox', { name: 'Поле ввода сообщения' })
    await vi.waitFor(() => expect(input).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /Продумать функцию/ }))
    expect(input).toHaveValue('Помоги спланировать новую функцию для продукта')
    expect(screen.getByRole('button', { name: 'Отправить сообщение' })).toBeEnabled()

    // Enter отправляет, Shift+Enter — перенос строки.
    await userEvent.clear(input)
    await userEvent.type(input, 'строка{Shift>}{Enter}{/Shift}вторая')
    expect(input).toHaveValue('строка\nвторая')
    expect(transport.send).not.toHaveBeenCalled()
    await userEvent.type(input, '{Enter}')
    await vi.waitFor(() => expect(transport.send).toHaveBeenCalledTimes(1))
    // После отправки лента переключается в режим сообщений: пузырь пользователя и индикатор набора.
    await vi.waitFor(() => expect(document.querySelector('.ka-bubble')?.textContent).toBe('строка\nвторая'))
    expect(screen.getByTestId('kanban-assistant-streaming')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Готовит ответ…')
    expect(screen.queryByRole('heading', { level: 2, name: 'С чего начнём?' })).not.toBeInTheDocument()

    expect(screen.queryByRole('region', { name: 'Настройки ассистента' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Настройки ассистента' }))
    expect(screen.getByRole('region', { name: 'Настройки ассистента' })).toHaveTextContent('LLM:')
  })

  it('со списком чатов: выдвижная колонка открывается кнопкой в шапке и закрывается выбором чата; крестик закрывает панель', async () => {
    const api = createFakeApi()
    await api['kanbanAssistant:get']({ projectId: 'p1' })
    const transport = { send: vi.fn(), onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) } as any
    const onSelect = vi.fn(); const onClose = vi.fn()
    render(<KanbanAssistant projectId="p1" context={context as any} api={api} llmEngines={[]} transport={transport} onCommand={vi.fn()} onSelectConversation={onSelect} onClose={onClose} />)

    const toggle = await screen.findByRole('button', { name: 'Открыть канбан-чаты' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('navigation', { name: 'Чаты канбана' })
    await userEvent.click(await within(list).findByRole('button', { name: /^Ассистент · p1/ }))
    expect(onSelect).toHaveBeenCalled()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Закрыть ассистента' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('различает загрузку, пустой диалог, ошибку и отсутствие транспорта', async () => {
    const api = createFakeApi()
    let resolveLoad!: (value: Awaited<ReturnType<typeof api['kanbanAssistant:get']>>) => void
    const original = api['kanbanAssistant:get']
    api['kanbanAssistant:get'] = vi.fn(() => new Promise((resolve) => { resolveLoad = resolve })) as typeof api['kanbanAssistant:get']
    const view = render(<KanbanAssistant projectId="p1" context={context as any} api={api} llmEngines={[]} transport={undefined} onCommand={vi.fn()} />)
    expect(screen.getByText('Загружаем разговор…')).toBeInTheDocument()
    resolveLoad(await original({ projectId: 'p1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('транспорт не подключён')

    const failing = createFakeApi()
    failing['kanbanAssistant:get'] = vi.fn(async () => { throw new Error('Модель временно недоступна') }) as typeof failing['kanbanAssistant:get']
    view.rerender(<KanbanAssistant projectId="p2" context={context as any} api={failing} llmEngines={[]} transport={undefined} onCommand={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Модель временно недоступна')
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument()
  })

  it('never applies a proposal until confirmation and cancellation is inert', async () => {
    const confirm = vi.fn(); const cancel = vi.fn()
    render(<WidgetProposalCard context={context} proposal={{ type: 'propose.rephrase', projectId: 'p1', taskId: 't1', field: 'title', value: 'New' }} onConfirm={confirm} onCancel={cancel} />)
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByText('Old')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(cancel).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('показывает прогресс плана работ и позволяет его остановить', async () => {
    const api = createFakeApi()
    const conversation = (await api['kanbanAssistant:get']({ projectId: 'p1' })).conversation
    const plan = {
      id: 'plan-1', projectId: 'p1', conversationId: conversation.id, owner: 'ann', title: 'Серия задач',
      status: 'running', error: null, createdAt: 1, updatedAt: 1,
      items: [
        { id: 'i0', position: 0, kind: 'create_task', title: 'Завести карточку', taskId: 't1', dependsOn: [], payload: {}, status: 'done', runId: null, attempts: 0, error: null, startedAt: null, finishedAt: null },
        { id: 'i1', position: 1, kind: 'run_ci', title: 'Разработка', taskId: 't1', dependsOn: [0], payload: {}, status: 'running', runId: 'r1', attempts: 0, error: null, startedAt: null, finishedAt: null }
      ]
    }
    api['orchestrations:list'] = vi.fn(async () => [plan]) as any
    const cancel = vi.fn(async () => ({ ...plan, status: 'cancelled' }))
    api['orchestrations:cancel'] = cancel as any
    const transport = { send: vi.fn(), onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) } as any
    const openTask = vi.fn()
    render(<KanbanAssistant projectId="p1" context={context as any} api={api} llmEngines={[]} transport={transport} onCommand={vi.fn()} onOpenTask={openTask} />)

    const panel = await screen.findByRole('region', { name: 'План работ: Серия задач' })
    expect(panel).toHaveTextContent('идёт · 1/2')
    expect(panel).toHaveTextContent('Разработка')

    // Шаг с задачей — кнопка: из панели видно, о какой карточке идёт речь.
    await userEvent.click(within(panel).getByRole('button', { name: 'Разработка' }))
    expect(openTask).toHaveBeenCalledWith('t1')

    await userEvent.click(within(panel).getByRole('button', { name: 'Остановить' }))
    expect(cancel).toHaveBeenCalledWith({ planId: 'plan-1' })
    // Остановленный план остаётся на виду с итогом, пока его не скроют руками.
    const stopped = await screen.findByRole('region', { name: 'План работ: Серия задач' })
    expect(stopped).toHaveTextContent('отменён')
    await userEvent.click(within(stopped).getByRole('button', { name: 'Скрыть план Серия задач' }))
    await vi.waitFor(() => expect(screen.queryByRole('region', { name: /План работ/ })).not.toBeInTheDocument())
  })

  it('тумблер «Автопилот» переключает режим применения изменений', async () => {
    const api = createFakeApi()
    await api['kanbanAssistant:get']({ projectId: 'p1' })
    const transport = { send: vi.fn(), onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) } as any
    render(<KanbanAssistant projectId="p1" context={context as any} api={api} llmEngines={[]} transport={transport} onCommand={vi.fn()} />)

    const toggle = await screen.findByRole('checkbox', { name: /Автопилот/ })
    expect(toggle).toBeChecked()
    await userEvent.click(toggle)
    await vi.waitFor(() => expect(toggle).not.toBeChecked())
    expect(screen.getByText('каждое изменение — с подтверждением')).toBeInTheDocument()
  })
})
