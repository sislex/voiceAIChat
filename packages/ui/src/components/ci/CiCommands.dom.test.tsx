import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { render } from '../../test/uiRender'
import type { CiCommand, CiGlobalSettings } from '@shared/ci'
import { DEFAULT_CI_GLOBAL_SETTINGS } from '@shared/ci'
import { CiCommands, type CiCommandsProps } from './CiCommands'

function mkCommand(over: Partial<CiCommand> = {}): CiCommand {
  return {
    id: 'cmd-1', scope: 'global', projectId: null, name: 'build', script: 'npm run build',
    description: 'сборка', workdir: '', timeoutSec: null, env: {}, allowFailure: false,
    isCleanup: false, availableToModel: false, version: 1, createdBy: 'admin',
    createdAt: 1, updatedAt: 1, deletedAt: null, ...over
  }
}

function props(over: Partial<CiCommandsProps> = {}): CiCommandsProps {
  const settings: CiGlobalSettings = { ...DEFAULT_CI_GLOBAL_SETTINGS }
  return {
    commands: [], settings, suggestions: [], workspaces: [], role: 'admin', projects: [],
    onCreate: vi.fn(async () => mkCommand()),
    onUpdate: vi.fn(async () => {}),
    onDelete: vi.fn(async () => {}),
    onUsage: vi.fn(async () => ({ projects: [], tasks: [] })),
    onSaveSettings: vi.fn(async () => {}),
    onResolveSuggestion: vi.fn(async () => {}),
    ...over
  }
}

describe('CiCommands', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('создаёт команду через форму', async () => {
    const p = props()
    render(<CiCommands {...p} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Команда' }))
    fireEvent.change(screen.getByPlaceholderText('build'), { target: { value: 'lint' } })
    fireEvent.change(screen.getByPlaceholderText('npm ci && npm run build'), { target: { value: 'npm run lint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    await waitFor(() => expect(p.onCreate).toHaveBeenCalledTimes(1))
    expect((p.onCreate as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ name: 'lint', script: 'npm run lint' })
  })

  it('показывает команды и удаляет с подтверждением', async () => {
    const p = props({ commands: [mkCommand({ id: 'cmd-9', name: 'deploy' })] })
    render(<CiCommands {...p} />)
    expect(screen.getByText('deploy')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Удалить'))
    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByRole('heading', { name: 'Удалить команду «deploy»?' })).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить' }))
    await waitFor(() => expect(p.onDelete).toHaveBeenCalledWith('cmd-9'))
    expect(p.onUsage).toHaveBeenCalledWith('cmd-9')
    // Удаление ничем себя не показывало — теперь есть тост.
    expect(await screen.findByText('Команда удалена')).toBeInTheDocument()
  })

  it('глобальные настройки только для чтения у обычного пользователя', () => {
    render(<CiCommands {...props({ role: 'user' })} />)
    fireEvent.click(screen.getByRole('button', { name: /Глобальные настройки CI/ }))
    expect(screen.getByText('только чтение')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить настройки' })).toBeNull()
  })
})

describe('CiCommands — состояния загрузки, пустоты и ошибки', () => {
  it('первая загрузка справочника — скелетон рядов', () => {
    render(<CiCommands {...props({ status: 'loading' })} />)
    expect(screen.getAllByTestId('ci-command-skeleton')).toHaveLength(4)
  })

  it('пустой справочник предлагает создать команду', () => {
    render(<CiCommands {...props({ status: 'ready' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Создать команду' }))
    expect(screen.getByTestId('ci-command-form')).toHaveTextContent('Новая команда')
  })

  it('ошибка загрузки видна и повторяется кнопкой', () => {
    const onRetry = vi.fn()
    render(<CiCommands {...props({ status: 'error', error: 'нет доступа', onRetry })} />)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не удалось загрузить команды')
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
