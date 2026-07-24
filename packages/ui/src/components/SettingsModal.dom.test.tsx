import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SettingsModal, type SettingsModalProps } from './SettingsModal'
import { DEFAULT_SETTINGS, type UserRole } from '@shared/types'

/** Минимальные пропы модалки: всё пустое/no-op, кроме роли. */
function renderModal(role: UserRole): void {
  const props: SettingsModalProps = {
    settings: { ...DEFAULT_SETTINGS },
    mics: [],
    voices: [],
    voiceCatalog: [],
    voicesDownloadable: false,
    voiceDownloads: {},
    whisperModels: [],
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
    onClose: vi.fn()
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
