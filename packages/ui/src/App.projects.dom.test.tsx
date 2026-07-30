import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { createFakeApi, type FakeApi } from './test/fakeApi'
import { DEFAULT_SETTINGS } from '@shared/types'

const SLOW = { frame: 100_000, transcribe: 100_000, think: 100_000, speak: 100_000 }

// Раздел «Проекты» живёт по своему hash-URL и рендерится как полная страница
// (ToolFrame variant="page"), а не модалка. Между тестами сбрасываем hash —
// иначе маршрут протекает в соседние кейсы и ломает их (там ожидается чат).
afterEach(() => {
  window.location.hash = ''
  try { localStorage.removeItem('vc.lastProject') } catch { /* ignore */ }
})

async function renderWithProject(): Promise<{ api: FakeApi; projectId: string }> {
  const api = createFakeApi([])
  await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
  const p = await api['projects:create']({ name: 'Мой проект' })
  render(<App api={api} delays={SLOW} />)
  return { api, projectId: p.id }
}

describe('App — страница «Проекты» по URL', () => {
  it('#/projects рендерит список проектов как страницу (не попап)', async () => {
    window.location.hash = '#/projects'
    await renderWithProject()
    const page = await screen.findByTestId('projects-overlay')
    // Полная страница: контейнер .toolpage, без модального оверлея .ovl.
    expect(page.closest('.toolpage')).not.toBeNull()
    expect(page.closest('.ovl')).toBeNull()
    const item = await within(page).findByTestId('project-item')
    expect(item).toHaveTextContent('Мой проект')
  })

  it('клик по проекту ведёт на #/projects/:id и показывает канбан', async () => {
    window.location.hash = '#/projects'
    const { projectId } = await renderWithProject()
    const page = await screen.findByTestId('projects-overlay')
    await userEvent.click(await within(page).findByTestId('project-item'))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${projectId}`))
    const board = await screen.findByTestId('project-board')
    await waitFor(() => expect(within(board).getByTestId('kanban-board')).toBeInTheDocument())
  })

  it('на доске «Настройки» ведут на #/projects/:id/settings, а закрытие — назад к доске', async () => {
    const { projectId } = await renderWithProject()
    window.location.hash = `#/projects/${projectId}`
    const board = await screen.findByTestId('project-board')
    await userEvent.click(within(board).getByRole('button', { name: /Настройки/ }))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${projectId}/settings`))
    const settings = await screen.findByTestId('project-settings')
    // Крестик закрытия страницы возвращает к доске.
    await userEvent.click(within(settings).getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${projectId}`))
  })
})

describe('App — упавший вызов моста показывается тостом', () => {
  it('ошибка загрузки доски даёт тост с текстом и «Повторить»', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const project = await api['projects:create']({ name: 'Мой проект' })
    // Первый запрос доски падает, повтор проходит: раньше на странице проектов
    // не было видно вообще ничего — ни ошибки, ни доски.
    const realBoard = api['board:get']
    let broken = true
    api['board:get'] = async (input) => {
      if (!broken) return realBoard(input)
      broken = false
      throw new Error('Сервер недоступен')
    }
    window.location.hash = `#/projects/${project.id}`
    render(<App api={api} delays={SLOW} />)

    const toast = await screen.findByTestId('toast-error')
    expect(toast).toHaveTextContent('Сервер недоступен')
    await userEvent.click(within(toast).getByRole('button', { name: 'Повторить' }))

    const board = await screen.findByTestId('project-board')
    await waitFor(() => expect(within(board).getByTestId('kanban-board')).toBeInTheDocument())
  })
})

describe('App — авто-редирект на последний проект', () => {
  it('#/projects уводит на последний использованный проект, если он доступен', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    const p = await api['projects:create']({ name: 'Мой проект' })
    localStorage.setItem('vc.lastProject', p.id)
    window.location.hash = '#/projects'
    render(<App api={api} delays={SLOW} />)
    await waitFor(() => expect(window.location.hash).toBe(`#/projects/${p.id}`))
    const board = await screen.findByTestId('project-board')
    await waitFor(() => expect(within(board).getByTestId('kanban-board')).toBeInTheDocument())
  })

  it('если последнего проекта нет в списке — остаётся на списке проектов', async () => {
    const api = createFakeApi([])
    await api['settings:save']({ ...DEFAULT_SETTINGS, onboarded: true })
    await api['projects:create']({ name: 'Мой проект' })
    localStorage.setItem('vc.lastProject', 'ghost-project-id')
    window.location.hash = '#/projects'
    render(<App api={api} delays={SLOW} />)
    const page = await screen.findByTestId('projects-overlay')
    expect(page).toBeInTheDocument()
    // Редиректа не было — остались на #/projects.
    await new Promise((r) => setTimeout(r, 50))
    expect(window.location.hash).toBe('#/projects')
  })
})
