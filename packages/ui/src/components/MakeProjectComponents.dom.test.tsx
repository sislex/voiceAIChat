// Режим «Проект» в Make: проверяем сценарий целиком через мост-фейк — выбор копии,
// запуск Storybook, кадр стори, правку файла и заведение тикета.
import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../test/uiRender'
import { createFakeApi } from '../test/fakeApi'
import { MakeProjectComponents, workspaceLabel } from './MakeProjectComponents'
import { makeGitWorkspace } from '../test/fixtures/git'

function setup(overrides: Partial<ReturnType<typeof createFakeApi>> = {}) {
  const api = { ...createFakeApi(), ...overrides }
  return { api }
}

describe('MakeProjectComponents', () => {
  it('показывает компоненты рабочей копии и стори выбранного', async () => {
    const { api } = setup()
    render(<MakeProjectComponents projectId="p1" api={api} />)

    expect(await screen.findByRole('button', { name: /UI\/Button/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /UI\/Button/ }))
    expect(await screen.findByRole('button', { name: 'Primary' })).toBeTruthy()
  })

  it('запускает Storybook и показывает кадр выбранной стори', async () => {
    const { api } = setup()
    render(<MakeProjectComponents projectId="p1" api={api} />)

    await screen.findByRole('button', { name: /UI\/Button/ })
    expect(screen.getByText('Storybook остановлен')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Запустить Storybook' }))
    await waitFor(() => expect(screen.getByText('Storybook работает')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: /UI\/Button/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Primary' }))

    const frame = await screen.findByTitle('Стори компонента')
    expect(frame.getAttribute('src')).toContain('/api/preview?url=')
    expect(decodeURIComponent(frame.getAttribute('src') ?? '')).toContain('machine.internal:6006/iframe.html')
    expect(decodeURIComponent(frame.getAttribute('src') ?? '')).toContain('id=ui-button--primary')
  })

  it('пока Storybook не поднят, объясняет, что делать, вместо пустого кадра', async () => {
    const { api } = setup()
    render(<MakeProjectComponents projectId="p1" api={api} />)
    expect(await screen.findByText('Storybook ещё не запущен')).toBeTruthy()
  })

  it('правка файла уходит в рабочую копию и включает кнопку задачи', async () => {
    const saved: Array<{ path: string; content: string }> = []
    const api = createFakeApi()
    const withSpy = {
      ...api,
      'projects:gitSaveFile': async (arg: { id: string; workspace: string; path: string; content: string }) => {
        saved.push({ path: arg.path, content: arg.content })
        return api['projects:gitSaveFile'](arg)
      }
    }
    render(<MakeProjectComponents projectId="p1" api={withSpy} />)

    await userEvent.click(await screen.findByRole('button', { name: /UI\/Button/ }))
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))

    const editor = await screen.findByLabelText(/Содержимое /)
    await userEvent.clear(editor)
    await userEvent.type(editor, 'export const Button = () => null')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(saved).toHaveLength(1))
    expect(await screen.findByRole('button', { name: /Создать задачу \(1\)/ })).toBeTruthy()
  })

  it('тикет создаётся с изменёнными путями и ведёт на карточку', async () => {
    const api = createFakeApi()
    const created: Array<{ title: string; paths: string[] }> = []
    const withSpy = {
      ...api,
      'projects:componentTicket': async (arg: { id: string; workspace: string; title: string; paths: string[] }) => {
        created.push({ title: arg.title, paths: arg.paths })
        return api['projects:componentTicket'](arg)
      }
    }
    const onOpenTask = vi.fn()
    render(<MakeProjectComponents projectId="p1" api={withSpy} onOpenTask={onOpenTask} />)

    await userEvent.click(await screen.findByRole('button', { name: /UI\/Button/ }))
    await userEvent.click(screen.getByRole('tab', { name: 'Код' }))
    const editor = await screen.findByLabelText(/Содержимое /)
    await userEvent.type(editor, ' ')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await userEvent.click(await screen.findByRole('button', { name: /Создать задачу/ }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Создать и подготовить к слиянию' }))

    await waitFor(() => expect(created).toHaveLength(1))
    expect(created[0]?.paths).toEqual(['packages/ui/src/components/ui/Button.stories.tsx'])
    expect(onOpenTask).toHaveBeenCalledWith('p1', 'task-new')
  })

  it('офлайн-машина объясняется, а запуск блокируется', async () => {
    const api = createFakeApi()
    const offline = {
      ...api,
      'projects:gitWorkspaces': async () => [makeGitWorkspace({ online: false })]
    }
    render(<MakeProjectComponents projectId="p1" api={offline} />)
    expect(await screen.findByText('Машина этой копии не в сети')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Запустить Storybook' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('workspaceLabel', () => {
  it('называет копию задачей и машиной, а общую копию — «Копия проекта»', () => {
    expect(workspaceLabel(makeGitWorkspace())).toContain('#42')
    expect(workspaceLabel(makeGitWorkspace({ kind: 'project-worktree', taskSeq: null, taskTitle: null })))
      .toBe('Копия проекта · MacBook')
  })
})
