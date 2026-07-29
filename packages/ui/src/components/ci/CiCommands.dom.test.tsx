import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CiCommands {...p} />)
    expect(screen.getByText('deploy')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Удалить'))
    await waitFor(() => expect(p.onDelete).toHaveBeenCalledWith('cmd-9'))
    expect(p.onUsage).toHaveBeenCalledWith('cmd-9')
  })

  it('глобальные настройки только для чтения у обычного пользователя', () => {
    render(<CiCommands {...props({ role: 'user' })} />)
    fireEvent.click(screen.getByRole('button', { name: /Глобальные настройки CI/ }))
    expect(screen.getByText('только чтение')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Сохранить настройки' })).toBeNull()
  })
})
