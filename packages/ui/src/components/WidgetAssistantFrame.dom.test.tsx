import { screen } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetAssistantContext } from '@shared/widgetAssistant'
import { WidgetAssistantFrame, WidgetProposalCard } from './WidgetAssistantFrame'
import { KanbanAssistant, ProjectAssistantChatSelector, projectAssistantChatSource } from './KanbanAssistant'
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

  it('persists a message and sends the latest safe context through the normal LLM transport', async () => {
    const api = createFakeApi()
    const selected = await api['conversations:create']({ title: 'Выбранный' })
    await api['conversations:setProject']({ id: selected.id, projectId: 'p1' })
    await api['messages:add']({ conversationId: selected.id, role: 'ai', text: 'История выбранного', time: '10:00' })
    const send = vi.fn()
    const transport = { send, onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) } as any
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
    expect(await api['kanbanAssistant:get']({ projectId: 'p1', conversationId: selected.id })).toMatchObject({ messages: [{ text: 'История выбранного' }, { role: 'u0', text: 'UI' }] })
  })

  it('shows project chats in the shell header with their source labels and persists the selection', async () => {
    const api = createFakeApi()
    const regular = await api['conversations:create']({ title: 'Обычный чат' })
    await api['conversations:setProject']({ id: regular.id, projectId: 'p1' })
    await api['kanbanAssistant:get']({ projectId: 'p1' })
    localStorage.setItem('voicechat.projectAssistantChat.p1', regular.id)
    const select = vi.fn()
    const view = render(<ProjectAssistantChatSelector projectId="p1" api={api} selectedId={null} onSelect={select} />)

    const selector = await screen.findByRole('combobox', { name: 'Чат ассистента' })
    expect(await screen.findByRole('option', { name: 'Обычный чат · chat' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Ассистент · p1 · kanban/ })).toBeInTheDocument()
    await userEvent.selectOptions(selector, regular.id)
    expect(select).toHaveBeenCalledWith(regular.id)
    expect(localStorage.getItem('voicechat.projectAssistantChat.p1')).toBe(regular.id)
    view.rerender(<ProjectAssistantChatSelector projectId="p1" api={api} selectedId={regular.id} onSelect={select} />)
    await userEvent.click(screen.getByRole('button', { name: 'Новый чат' }))
    await vi.waitFor(() => expect(select).toHaveBeenCalledTimes(3))
    const createdId = select.mock.calls[2]?.[0]
    expect((await api['conversations:get']({ id: createdId }))?.conversation.projectId).toBe('p1')
    expect(projectAssistantChatSource({ assistantKind: 'browser' } as any)).toBe('browser')
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
})
