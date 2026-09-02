import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../test/uiRender'
import { createFakeApi, type FakeApi } from '../../test/fakeApi'
import { TaskDesigns } from './TaskDesigns'

/** Проект с задачей и Make-чатом, привязанным к тому же проекту. */
async function scene(api: FakeApi): Promise<{ projectId: string; taskId: string; makeId: string }> {
  const project = await api['projects:create']({ name: 'Piara' })
  const board = await api['board:get']({ id: project.id })
  const task = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0].id, title: 'Экран оплаты' })
  const make = await api['conversations:create']({ title: 'Проект 1', assistantKind: 'make' })
  await api['conversations:setProject']({ id: make.id, projectId: project.id })
  await api['make:write']({ conversationId: make.id, path: 'index.html', content: '<h1>Проект 14</h1>' })
  await api['make:write']({ conversationId: make.id, path: 'pay.html', content: '<h1>Оплата</h1>' })
  await api['make:write']({ conversationId: make.id, path: 'styles/app.css', content: 'body{}' })
  return { projectId: project.id, taskId: task.id, makeId: make.id }
}

describe('TaskDesigns — секция «Дизайн» карточки', () => {
  it('связывает карточку со страницей Make-проекта и показывает её в списке', async () => {
    const api = createFakeApi([])
    window.api = api as unknown as typeof window.api
    const { projectId, taskId } = await scene(api)

    render(<TaskDesigns projectId={projectId} taskId={taskId} />)
    expect(await screen.findByTestId('task-designs-empty')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Связать дизайн' }))
    expect(await screen.findByRole('option', { name: 'Проект 1' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Выбранные файлы' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'pay.html' }))
    await userEvent.type(screen.getByLabelText('Подпись дизайна'), 'Экран оплаты')
    await userEvent.click(screen.getByRole('button', { name: 'Связать' }))

    expect(await screen.findByText('Экран оплаты')).toBeInTheDocument()
    expect(screen.getByText('pay.html')).toBeInTheDocument()
    // Не-HTML-совместимых файлов в выборе нет: pay.html получает живое превью.
    expect(screen.getByRole('link', { name: 'Превью' })).toHaveAttribute('href', expect.stringContaining(`/api/preview/make/`))
    expect(screen.getByRole('link', { name: 'Превью' })).toHaveAttribute('href', expect.stringContaining('pay.html'))
  })

  it('переводит в Make по кнопке и снимает связь', async () => {
    const api = createFakeApi([])
    window.api = api as unknown as typeof window.api
    const { projectId, taskId, makeId } = await scene(api)
    await api['tasks:linkDesign']({ projectId, taskId, conversationId: makeId, path: 'pay.html', label: 'Оплата' })
    const onOpenMake = vi.fn()

    render(<TaskDesigns projectId={projectId} taskId={taskId} onOpenMake={onOpenMake} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Открыть в Make' }))
    expect(onOpenMake).toHaveBeenCalledWith(makeId)

    await userEvent.click(screen.getByRole('button', { name: 'Убрать дизайн Оплата' }))
    expect(await screen.findByTestId('task-designs-empty')).toBeInTheDocument()
  })

  it('выбирает несколько файлов и атомарно заменяет набор при редактировании', async () => {
    const api = createFakeApi([])
    window.api = api as unknown as typeof window.api
    const { projectId, taskId } = await scene(api)
    render(<TaskDesigns projectId={projectId} taskId={taskId} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Связать дизайн' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Выбранные файлы' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'pay.html' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'styles/app.css' }))
    await userEvent.click(screen.getByRole('button', { name: 'Связать' }))
    expect(await screen.findByText('pay.html, styles/app.css')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Изменить' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'pay.html' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('styles/app.css')).toBeInTheDocument()
    expect(screen.queryByText('pay.html, styles/app.css')).not.toBeInTheDocument()
  })

  it('без привязанных Make-проектов объясняет, где взять источник', async () => {
    const api = createFakeApi([])
    window.api = api as unknown as typeof window.api
    const project = await api['projects:create']({ name: 'Пусто' })
    const board = await api['board:get']({ id: project.id })
    const task = await api['tasks:create']({ projectId: project.id, columnId: board.columns[0].id, title: 'Задача' })

    render(<TaskDesigns projectId={project.id} taskId={task.id} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Связать дизайн' }))

    expect(await screen.findByText(/Привяжите Make-проект к этому проекту/)).toBeInTheDocument()
  })
})
