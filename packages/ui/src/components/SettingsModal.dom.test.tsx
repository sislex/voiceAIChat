import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { screen, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { SettingsModal, type SettingsModalProps } from './SettingsModal'
import { DEFAULT_SETTINGS, type UserRole } from '@shared/types'

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
    onDownloadDesktopApp: vi.fn(),
    onDownloadAgentApp: vi.fn(),
    onDownloadAgentScript: vi.fn(),
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

describe('SettingsModal — модели Claude', () => {
  it('admin видит меню CLI целиком и в его порядке', () => {
    renderModal('admin')
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option')
    expect(opts.map((o) => (o as HTMLOptionElement).value)).toEqual(['default', 'opus[1m]', 'fable', 'sonnet', 'haiku'])
    expect(opts.map((o) => o.textContent)).toEqual([
      'Default (recommended)', 'Opus (1M context)', 'Fable', 'Sonnet', 'Haiku'
    ])
  })

  it('user не видит opus и fable — только default/sonnet/haiku', () => {
    renderModal('user')
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['default', 'sonnet', 'haiku'])
    expect(opts).not.toContain('opus[1m]')
    expect(opts).not.toContain('fable')
  })

  it('сохраняет выбранный id как есть — он же уйдёт в CLI', async () => {
    const onChange = vi.fn()
    renderModal('admin', { onChange })
    await userEvent.selectOptions(screen.getByLabelText('Модель Claude'), 'opus[1m]')
    expect(onChange).toHaveBeenCalledWith({ model: 'opus[1m]' })
  })
})

describe('SettingsModal — модели Codex', () => {
  it('показывает актуальный список в порядке меню', async () => {
    const onChange = vi.fn()
    renderModal('admin', { settings: { ...DEFAULT_SETTINGS, llmProvider: 'codex' }, onChange })
    const select = screen.getByLabelText('Модель Codex')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'])
    await userEvent.selectOptions(select, 'gpt-5.5')
    expect(onChange).toHaveBeenCalledWith({ codexModel: 'gpt-5.5' })
  })

  it('модель из старых настроек не теряется отдельным пунктом', () => {
    renderModal('admin', { settings: { ...DEFAULT_SETTINGS, llmProvider: 'codex', codexModel: '' } })
    const select = screen.getByLabelText('Модель Codex') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(within(select).getByRole('option', { name: 'По умолчанию (из codex)' })).toBeInTheDocument()
  })
})

describe('SettingsModal — машины вынесены отдельно', () => {
  it('не показывает управление машинами в настройках', () => {
    renderModal('admin')
    expect(screen.queryByTestId('agent-list')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Имя новой машины')).not.toBeInTheDocument()
  })
})


describe('SettingsModal — глобальная блокировка голосового ввода', () => {
  it('отключает настройки распознавания и микрофона', async () => {
    renderModal('admin', { voiceInputEnabled: false })
    await userEvent.click(screen.getByRole('button', { name: 'Распознавание' }))

    expect(screen.getByTestId('stt-blocked')).toHaveTextContent(
      'Голосовой ввод временно недоступен для всех пользователей'
    )
    expect(screen.getByLabelText('Модель распознавания')).toBeDisabled()
    expect(screen.getByLabelText('Диаризация спикеров')).toBeDisabled()
    expect(screen.getByLabelText('Микрофон')).toBeDisabled()
  })

  it('отключает hands-free и перебивание голосом', async () => {
    renderModal('admin', { voiceInputEnabled: false })
    await userEvent.click(screen.getByRole('button', { name: 'Голосовой диалог' }))

    expect(screen.getByLabelText('Режим hands-free')).toBeDisabled()
    expect(screen.getByLabelText('Перебивание голосом')).toBeDisabled()
  })
})

describe('SettingsModal — выбор исполнителя', () => {
  it('показывает доступные записи и сохраняет id вместе с kind', async () => {
    const onChange = vi.fn()
    renderModal('user', { engines: [{ id: 'work', name: 'Рабочий', kind: 'codex', isDefault: true }], onChange })
    await userEvent.selectOptions(screen.getByLabelText('Исполнитель LLM'), 'work')
    expect(onChange).toHaveBeenCalledWith({ llmEngineId: 'work', llmProvider: 'codex' })
  })
})


describe('SettingsModal — доступность', () => {
  // Разделы перечислены руками, а не собраны из DOM: если раздел переименуют или
  // потеряют, тест должен упасть, а не тихо проверить меньше экранов.
  const SECTIONS = ['Агент', 'AI-помощник', 'Скачать', 'Распознавание', 'Озвучка', 'Голосовой диалог', 'Интерфейс']

  it('без нарушений axe в каждом разделе меню', async () => {
    renderModal('admin')
    await expectNoViolations()
    expectLabelledIconButtons()
    for (const section of SECTIONS) {
      await userEvent.click(screen.getByRole('button', { name: section }))
      await expectNoViolations()
      expectLabelledIconButtons()
    }
  })

  it('фокус при открытии уходит внутрь окна, а Tab из него не выпадает', async () => {
    // Под окном настроек лежит вся страница; без ловушки Tab уводил бы фокус
    // туда, и вернуться в окно с клавиатуры было бы нельзя.
    const outside = document.createElement('button')
    outside.textContent = 'снаружи'
    document.body.appendChild(outside)
    renderModal('admin')
    const dialog = screen.getByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
    for (let i = 0; i < 12; i++) {
      await userEvent.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    await userEvent.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
    outside.remove()
  })
})
