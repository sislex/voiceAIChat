import { describe, it, expect, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { render } from '../../test/uiRender'
import { TaskActivityPanel, formatMinutes } from './TaskActivityPanel'
import type { TaskActivity } from '@shared/projects'

/** Мосты панели: активность в замыкании, как её отдал бы сервер. */
function makeApi(initial?: Partial<TaskActivity>) {
  const activity: TaskActivity = { comments: [], worklog: [], history: [], totalMinutes: 0, ...initial }
  const commentDelete = vi.fn(async ({ commentId }: { commentId: string }) => {
    activity.comments = activity.comments.filter((comment) => comment.id !== commentId)
    return { ok: true as const }
  })
  return {
    activity,
    commentDelete,
    api: {
      'tasks:activity': vi.fn(async () => ({ ...activity, comments: [...activity.comments], worklog: [...activity.worklog] })),
      'tasks:commentAdd': vi.fn(async ({ text }: { text: string }) => {
        const comment = { id: `c-${activity.comments.length + 1}`, taskId: 't1', author: 'admin', via: 'user' as const, text, createdAt: 1725100000000, updatedAt: null }
        activity.comments.push(comment)
        return comment
      }),
      'tasks:commentUpdate': vi.fn(async ({ commentId, text }: { commentId: string; text: string }) => {
        const comment = activity.comments.find((entry) => entry.id === commentId)!
        comment.text = text; comment.updatedAt = 1725100100000
        return comment
      }),
      'tasks:commentDelete': commentDelete,
      'tasks:worklogAdd': vi.fn(async ({ minutes, comment }: { minutes: number; comment?: string }) => {
        const entry = { id: `w-${activity.worklog.length + 1}`, taskId: 't1', author: 'admin', minutes, comment: comment ?? '', startedAt: 1725100000000, createdAt: 1725100000000, updatedAt: null }
        activity.worklog.push(entry); activity.totalMinutes += minutes
        return entry
      }),
      'tasks:worklogUpdate': vi.fn(),
      'tasks:worklogDelete': vi.fn(async () => ({ ok: true as const }))
    }
  }
}

describe('TaskActivityPanel', () => {
  it('комментарий добавляется, правится с пометкой «изменён» и удаляется с подтверждением', async () => {
    const { api } = makeApi()
    render(<TaskActivityPanel projectId="p1" taskId="t1" api={api as never} />)

    fireEvent.change(await screen.findByRole('textbox', { name: 'Новый комментарий' }), { target: { value: 'Первый!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    const comment = await screen.findByTestId('task-comment')
    expect(comment.textContent).toContain('Первый!')

    fireEvent.click(within(comment).getByRole('button', { name: 'Изменить' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Текст комментария' }), { target: { value: 'Первый (правка)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(screen.getByTestId('task-comment').textContent).toContain('Первый (правка)'))
    expect(screen.getByTestId('task-comment').textContent).toContain('изменён')

    // Удаление — только через подтверждение (кликом, не моком). Кнопок
    // «Удалить» две: в карточке и в окне подтверждения — берём ту, что в окне.
    fireEvent.click(within(screen.getByTestId('task-comment')).getByRole('button', { name: 'Удалить' }))
    const confirmDialog = await screen.findByText('Удалить комментарий?')
    const overlay = confirmDialog.closest('[role="dialog"], .vc-dialog-overlay') as HTMLElement
    fireEvent.click(within(overlay).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(screen.queryByTestId('task-comment')).not.toBeInTheDocument())
  })

  it('запись модели помечена бейджем, история показывает «было → стало»', async () => {
    const { api } = makeApi({
      comments: [{ id: 'c1', taskId: 't1', author: 'admin', via: 'model', text: 'Предлагаю уточнить критерии', createdAt: 1, updatedAt: null }],
      history: [{ id: 'h1', taskId: 't1', actor: 'marina', via: 'user', field: 'title', from: 'Старое', to: 'Новое', at: 2 }]
    })
    render(<TaskActivityPanel projectId="p1" taskId="t1" api={api as never} />)

    const comment = await screen.findByTestId('task-comment')
    expect(within(comment).getByTitle(/модель канбан-ассистента/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /История/ }))
    const event = await screen.findByTestId('task-history-event')
    expect(event.textContent).toContain('Название')
    expect(event.textContent).toContain('Старое')
    expect(event.textContent).toContain('Новое')
  })

  it('ворклог записывает минуты и показывает итог в часах', async () => {
    const { api } = makeApi()
    render(<TaskActivityPanel projectId="p1" taskId="t1" api={api as never} />)
    fireEvent.click(await screen.findByRole('button', { name: /Ворклог/ }))

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Затраченное время в минутах' }), { target: { value: '90' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Комментарий к ворклогу' }), { target: { value: 'вёрстка' } })
    fireEvent.click(screen.getByRole('button', { name: 'Записать' }))

    const entry = await screen.findByTestId('task-worklog-entry')
    expect(entry.textContent).toContain('1 ч 30 м')
    expect(entry.textContent).toContain('вёрстка')
    expect(screen.getByRole('button', { name: /Ворклог \(1 ч 30 м\)/ })).toBeInTheDocument()
  })

  it('форматирование минут: часы и минуты как в Jira', () => {
    expect(formatMinutes(45)).toBe('45 м')
    expect(formatMinutes(60)).toBe('1 ч')
    expect(formatMinutes(135)).toBe('2 ч 15 м')
    expect(formatMinutes(0)).toBe('0 м')
  })
})
