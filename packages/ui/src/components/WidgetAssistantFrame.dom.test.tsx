import { screen } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetAssistantContext } from '@shared/widgetAssistant'
import { WidgetAssistantFrame, WidgetProposalCard } from './WidgetAssistantFrame'
import { KanbanAssistant } from './KanbanAssistant'

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

  it('sends the latest synchronized widget context with each message', async () => {
    const request = vi.fn(async (_text: string, _context: any) => ({ text: 'ok' }))
    const onCommand = vi.fn()
    const view = render(<KanbanAssistant context={context as any} request={request} onCommand={onCommand} />)
    const next = { ...context, selection: { board: { projectId: 'p1', columns: [] }, openTask: { id: 't2', title: 'Current' }, selectedField: 'description' } }
    view.rerender(<KanbanAssistant context={next as any} request={request} onCommand={onCommand} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Сообщение ассистенту' }), 'help')
    await userEvent.click(screen.getByRole('button', { name: 'Отправить' }))
    await vi.waitFor(() => expect(request).toHaveBeenCalled())
    expect(request.mock.calls[0]?.[1].selection.openTask.id).toBe('t2')
    expect(request.mock.calls[0]?.[1].selection.selectedField).toBe('description')
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
