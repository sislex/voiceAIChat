import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi, type FakeApi } from '../test/fakeApi'
import { MakeTaskLinksDialog } from './MakeTaskLinksDialog'

/** Make-проект, привязанный к проекту с одной карточкой. */
async function scene(api: FakeApi): Promise<{ makeId: string; taskId: string; projectId: string }> {
  const project = await api['projects:create']({ name: 'Piara' })
  const board = await api['board:get']({ id: project.id })
  const task = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0].id, title: 'Экран оплаты' })
  const make = await api['conversations:create']({ title: 'Проект 1', assistantKind: 'make' })
  await api['conversations:setProject']({ id: make.id, projectId: project.id })
  return { makeId: make.id, taskId: task.id, projectId: project.id }
}

describe('MakeTaskLinksDialog — «Задачи проекта» в панели Make', () => {
  it('связывает открытую страницу с карточкой и показывает связь в списке', async () => {
    const api = createFakeApi([])
    const { makeId } = await scene(api)

    render(<MakeTaskLinksDialog conversationId={makeId} currentPath="pay.html" api={api} onClose={() => {}} />)
    expect(await screen.findByTestId('make-task-links-empty')).toBeInTheDocument()
    // Страница подставлена из открытого файла — связывают обычно то, что видно.
    // Ждём поле, а не берём его сразу: форма и пустое состояние появляются
    // разными рендерами, и на полном прогоне гейта порядок иногда обратный.
    expect(await screen.findByLabelText('Страница дизайна')).toHaveValue('pay.html')

    await userEvent.click(screen.getByRole('button', { name: 'Связать с задачей' }))

    expect(await screen.findByText('Экран оплаты')).toBeInTheDocument()
    expect(screen.getByText('pay.html')).toBeInTheDocument()
  })

  it('ведёт на карточку связанной задачи', async () => {
    const api = createFakeApi([])
    const { makeId, taskId, projectId } = await scene(api)
    await api['make:linkTask']({ conversationId: makeId, taskId, path: 'index.html' })
    const onOpenTask = vi.fn()

    render(<MakeTaskLinksDialog conversationId={makeId} currentPath="" api={api} onOpenTask={onOpenTask} onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: `Открыть карточку TASK-${taskId}` }))

    expect(onOpenTask).toHaveBeenCalledWith(projectId, taskId)
  })

  it('без привязки к проекту объясняет, почему связывать не с чем', async () => {
    const api = createFakeApi([])
    const make = await api['conversations:create']({ title: 'Личный макет', assistantKind: 'make' })

    render(<MakeTaskLinksDialog conversationId={make.id} currentPath="" api={api} onClose={() => {}} />)

    expect(await screen.findByText(/не привязан к проекту/)).toBeInTheDocument()
  })
})
