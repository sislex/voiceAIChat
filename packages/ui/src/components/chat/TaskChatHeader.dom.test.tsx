import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { TaskChatContext } from '@shared/projects'
import { TaskChatHeader } from './TaskChatHeader'

function ctx(over: Partial<TaskChatContext> = {}): TaskChatContext {
  return {
    projectId: 'p1',
    projectName: 'Voice Chat',
    epic: { id: 'e1', title: 'Канбан', key: 'VC-1' },
    story: { id: 's1', title: 'Карточка', key: 'VC-2' },
    task: { id: 't1', title: 'Скролл', key: 'VC-3', type: 'task' },
    columnName: 'Разработка',
    columnSemantic: 'development',
    agentId: 'a1',
    agentName: 'Прод-машина',
    workdir: '/repos/vc/3',
    run: { id: 'run-1', status: 'running', mode: 'plan', startedAt: 1000, durationMs: null },
    ...over
  }
}

describe('TaskChatHeader', () => {
  it('показывает иерархию, этап, машину, папку и режим рана', () => {
    render(<TaskChatHeader context={ctx()} onOpenTask={vi.fn()} now={() => 96_000} />)
    expect(screen.getByText('Voice Chat')).toBeInTheDocument()
    expect(screen.getByText('VC-1 Канбан')).toBeInTheDocument()
    expect(screen.getByText('VC-2 Карточка')).toBeInTheDocument()
    expect(screen.getByText('VC-3 Скролл')).toBeInTheDocument()
    expect(screen.getByText('Разработка')).toBeInTheDocument()
    expect(screen.getByText('Режим: План')).toBeInTheDocument()
    expect(screen.getByText(/Прод-машина/)).toBeInTheDocument()
    expect(screen.getByText(/\/repos\/vc\/3/)).toBeInTheDocument()
  })

  it('у активного рана показывает время работы, у завершённого — итог', () => {
    const { unmount } = render(<TaskChatHeader context={ctx()} onOpenTask={vi.fn()} now={() => 96_000} />)
    expect(screen.getByTestId('task-chat-elapsed')).toHaveTextContent('В работе 1м 35с')
    unmount()

    render(
      <TaskChatHeader
        context={ctx({ run: { id: 'run-1', status: 'success', mode: 'development', startedAt: 1000, durationMs: 42_000 } })}
        onOpenTask={vi.fn()}
        now={() => 999_999}
      />
    )
    expect(screen.getByTestId('task-chat-elapsed')).toHaveTextContent('Работа заняла 42с')
  })

  it('кнопка ведёт в задачу, а шапка разворачивается в ленту рана', () => {
    const onOpenTask = vi.fn()
    render(
      <TaskChatHeader
        context={ctx()}
        onOpenTask={onOpenTask}
        renderRunFeed={(runId) => <div data-testid="feed">лента {runId}</div>}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Открыть задачу' }))
    expect(onOpenTask).toHaveBeenCalledWith('p1', 't1')

    // Свёрнута по умолчанию — раскрывается по клику.
    expect(screen.queryByTestId('feed')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Лента рана' }))
    expect(screen.getByTestId('feed')).toHaveTextContent('лента run-1')
    fireEvent.click(screen.getByRole('button', { name: 'Скрыть ленту рана' }))
    expect(screen.queryByTestId('feed')).not.toBeInTheDocument()
  })

  it('без рана нет ни таймера, ни переключателя ленты', () => {
    render(<TaskChatHeader context={ctx({ run: null })} onOpenTask={vi.fn()} renderRunFeed={() => <div />} />)
    expect(screen.queryByTestId('task-chat-elapsed')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Лента рана' })).not.toBeInTheDocument()
  })
})
