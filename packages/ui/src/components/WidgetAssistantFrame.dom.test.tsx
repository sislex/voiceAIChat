import { screen } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetAssistantContext } from '@shared/widgetAssistant'
import { WidgetAssistantFrame, WidgetProposalCard } from './WidgetAssistantFrame'
import { KanbanAssistant } from './KanbanAssistant'
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
    const send = vi.fn()
    const transport = { send, onToken: vi.fn(() => () => {}), onDone: vi.fn(() => () => {}), onError: vi.fn(() => () => {}) } as any
    const onCommand = vi.fn()
    const view = render(<KanbanAssistant projectId="p1" context={context as any} api={api} llmEngines={[]} transport={transport} onCommand={onCommand} />)
    const next = { ...context, selection: { board: { projectId: 'p1', columns: [] }, openTask: { id: 't2', title: 'Current' }, selectedField: 'description' } }
    view.rerender(<KanbanAssistant projectId="p1" context={next as any} api={api} llmEngines={[]} transport={transport} onCommand={onCommand} />)
    await vi.waitFor(() => expect(screen.getByRole('textbox', { name: 'Сообщение ассистенту' })).toBeEnabled())
    await userEvent.type(screen.getByRole('textbox', { name: 'Сообщение ассистенту' }), 'help')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await vi.waitFor(() => expect(send).toHaveBeenCalled())
    expect(send.mock.calls[0]?.[0].assistantContext.selection.openTask.id).toBe('t2')
    expect(send.mock.calls[0]?.[0].assistantContext.selection.selectedField).toBe('description')
    expect(await api['kanbanAssistant:get']({ projectId: 'p1' })).toMatchObject({ messages: [{ role: 'u0', text: 'help' }] })
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
