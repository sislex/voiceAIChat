import { describe, it, expect, vi } from 'vitest'
import { expectLabelledIconButtons, expectNoViolations } from '../test/a11y'
import { screen, within } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { SettingsModal, type SettingsModalProps } from './SettingsModal'
import { PersonalizationPage, isValidPersonalizationDate } from './SettingsPage'
import { DEFAULT_SETTINGS, type UserRole } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'

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

describe('PersonalizationPage', () => {
  it('валидирует полные даты и допускает частичные', () => {
    expect(isValidPersonalizationDate({ ...DEFAULT_SETTINGS.personalization, birthDay: 31, birthMonth: 2 })).toBe(false)
    expect(isValidPersonalizationDate({ ...DEFAULT_SETTINGS.personalization, birthMonth: 2, birthYear: 1990 })).toBe(true)
    expect(isValidPersonalizationDate({ ...DEFAULT_SETTINGS.personalization, birthYear: 1990 })).toBe(true)
  })

  it('показывает отдельную страницу и сохраняет настройки', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<PersonalizationPage user={{ name: 'alexey', role: 'user' }} value={DEFAULT_SETTINGS.personalization} onSave={save} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Персонализация — alexey' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Имя или обращение'), 'Лёша')
    await userEvent.selectOptions(screen.getByLabelText('Объём'), 'brief')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ preferredName: 'Лёша', responseStyle: 'brief' }))
  })

  it('сообщает о невозможной дате доступным alert', async () => {
    render(<PersonalizationPage user={{ name: 'alexey', role: 'user' }} value={DEFAULT_SETTINGS.personalization} onSave={vi.fn()} onCancel={vi.fn()} />)
    await userEvent.selectOptions(screen.getByLabelText('День'), '31')
    await userEvent.selectOptions(screen.getByLabelText('Месяц'), '2')
    expect(screen.getByRole('alert')).toHaveTextContent('Такой даты не существует')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
  })
})

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

  // Меню сужает персональный доступ (`llmAccess`), а не роль: запреты — данные
  // пользователя, их правит админ в карточке на `#/users/:name`.
  it('запреты доступа убирают opus и fable — остаются default/sonnet/haiku', () => {
    const denied: UserLlmAccess[] = [{ provider: 'claude', modelId: 'opus[1m]' }, { provider: 'claude', modelId: 'fable' }]
    renderModal('user', { llmAccess: denied })
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['default', 'sonnet', 'haiku'])
    expect(opts).not.toContain('opus[1m]')
    expect(opts).not.toContain('fable')
  })

  it('без запретов у роли user меню то же, что у админа', () => {
    renderModal('user')
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['default', 'opus[1m]', 'fable', 'sonnet', 'haiku'])
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
    expect(opts).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'])
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
  const SECTIONS = ['LLM', 'AI-помощник', 'Скачать', 'Распознавание', 'Озвучка', 'Голосовой диалог', 'Интерфейс']

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
