import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { SettingsModal, type SettingsModalProps } from './SettingsModal'
import { DEFAULT_SETTINGS, type UserRole } from '@shared/types'
import { encodeAgentConnection } from '@shared/agentProtocol'

/** Минимальные пропы модалки: всё пустое/no-op, кроме роли и переопределений. */
function renderModal(role: UserRole, overrides: Partial<SettingsModalProps> = {}): void {
  const props: SettingsModalProps = {
    settings: { ...DEFAULT_SETTINGS },
    mics: [],
    voices: [],
    voiceCatalog: [],
    voicesDownloadable: false,
    voiceDownloads: {},
    whisperModels: [],
    capabilities: null,
    mcpServers: [],
    loginStatus: null,
    agents: [],
    onCreateAgent: vi.fn().mockResolvedValue(null),
    onDeleteAgent: vi.fn(),
    onSetAgentPolicy: vi.fn(),
    onRegenerateAgentToken: vi.fn().mockResolvedValue(null),
    onDownloadDesktopApp: vi.fn(),
    onDownloadAgentApp: vi.fn(),
    onDownloadAgentScript: vi.fn(),
    onGetConnectionString: vi.fn().mockResolvedValue(null),
    onChange: vi.fn(),
    onDownloadVoice: vi.fn(),
    onDeleteVoice: vi.fn(),
    onDeleteModel: vi.fn(),
    role,
    onClose: vi.fn(),
    ...overrides
  }
  render(<SettingsModal {...props} />)
}

describe('SettingsModal — фильтр моделей по роли', () => {
  it('admin видит все модели (opus, fable, sonnet, haiku)', () => {
    renderModal('admin')
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['opus', 'sonnet', 'fable', 'haiku'])
  })

  it('user не видит opus и fable — только sonnet/haiku', () => {
    renderModal('user')
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['sonnet', 'haiku'])
    expect(opts).not.toContain('opus')
    expect(opts).not.toContain('fable')
  })
})

describe('SettingsModal — команды установки агента', () => {
  it('после создания машины кнопка Windows копирует powershell-команду с установщиком', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const conn = encodeAgentConnection({ server: 'wss://example.com/agent', token: 'tok1' })
    renderModal('admin', {
      onCreateAgent: vi.fn().mockResolvedValue({ id: 'a1', name: 'Win', token: 'tok1' }),
      onGetConnectionString: vi.fn().mockResolvedValue(conn)
    })
    // fireEvent, а не userEvent: тот подменяет navigator.clipboard своим стабом.
    fireEvent.change(screen.getByLabelText('Имя новой машины'), { target: { value: 'Win' } })
    fireEvent.click(screen.getByLabelText('Добавить машину'))
    fireEvent.click(
      await screen.findByLabelText('Скопировать команду установки для Windows (PowerShell)')
    )
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const cmd = writeText.mock.calls[0][0] as string
    // Команда самодостаточна: обход ExecutionPolicy, адрес установщика и строка подключения.
    expect(cmd).toContain('powershell -NoProfile -ExecutionPolicy Bypass')
    expect(cmd).toContain('https://example.com/api/agents/install-windows.ps1')
    expect(cmd).toContain(conn)
  })
})
