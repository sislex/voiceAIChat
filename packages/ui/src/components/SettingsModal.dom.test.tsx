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

describe('SettingsModal · Инструкции', () => {
  /** Список инструкций из последнего вызова onChange. */
  const last = (onChange: ReturnType<typeof vi.fn>): Array<{ id: string; title?: string; enabled?: boolean; text?: string; kind?: string }> =>
    (onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as { chatInstructions: never[] }).chatInstructions
  const open = async (onChange = vi.fn()) => {
    renderModal('admin', { onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Инструкции' }))
    return { onChange, list: screen.getByRole('list', { name: 'Инструкции чата' }) }
  }

  it('показывает чекбоксы всех инструкций и отправляет список с выключенной', async () => {
    const { onChange, list } = await open()
    expect(within(list).getAllByRole('checkbox')).toHaveLength(5)
    await userEvent.click(within(list).getByRole('checkbox', { name: 'Открывать терминал в чате' }))
    const sent = last(onChange)
    expect(sent.find((it: { id: string }) => it.id === 'console')?.enabled).toBe(false)
    expect(sent.find((it: { id: string }) => it.id === 'explorer')?.enabled).toBe(true)
    await expectNoViolations()
  })

  it('редактор: правка текста встроенной сохраняется как text, стандартный текст — без text', async () => {
    const { onChange, list } = await open()
    await userEvent.click(within(list).getByRole('button', { name: 'Изменить: Открывать терминал в чате' }))
    const editor = screen.getByTestId('instruction-editor')
    const text = within(editor).getByLabelText('Текст инструкции') as HTMLTextAreaElement
    expect(text.value).toContain('```tool')
    // Сохранение без правок — text не появляется.
    await userEvent.click(within(editor).getByRole('button', { name: 'Сохранить' }))
    expect(last(onChange).find((it: { id: string }) => it.id === 'console')?.text).toBeUndefined()
    // С правкой — появляется.
    await userEvent.click(within(list).getByRole('button', { name: 'Изменить: Открывать терминал в чате' }))
    await userEvent.clear(screen.getByLabelText('Текст инструкции'))
    await userEvent.type(screen.getByLabelText('Текст инструкции'), 'Мой текст')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(last(onChange).find((it: { id: string }) => it.id === 'console')?.text).toBe('Мой текст')
  })

  it('дублирование делает свою инструкцию с текстом оригинала; добавление создаёт пустую', async () => {
    const { onChange, list } = await open()
    await userEvent.click(within(list).getByRole('button', { name: 'Дублировать: Уточняющие вопросы с вариантами' }))
    const dup = last(onChange)
    expect(dup).toHaveLength(6)
    expect(dup[3]).toMatchObject({ title: 'Уточняющие вопросы с вариантами (копия)', enabled: true })
    expect(dup[3].kind).toBeUndefined()
    expect(dup[3].text).toContain('```questions')
    await userEvent.click(screen.getByRole('button', { name: '+ Добавить инструкцию' }))
    const added = last(onChange)
    expect(added.at(-1)).toMatchObject({ title: 'Новая инструкция', enabled: true, text: '' })
  })

  it('удаление встроенной — через подтверждение; после него доступно «Восстановить стандартные»', async () => {
    const onChange = vi.fn()
    const items = DEFAULT_SETTINGS.chatInstructions.filter((it) => it.id !== 'image')
    renderModal('admin', { onChange, settings: { ...DEFAULT_SETTINGS, chatInstructions: items } })
    await userEvent.click(screen.getByRole('button', { name: 'Инструкции' }))
    await userEvent.click(screen.getByRole('button', { name: 'Восстановить стандартные (1)' }))
    expect(last(onChange).map((it: { id: string }) => it.id)).toContain('image')
    await userEvent.click(screen.getByRole('button', { name: 'Удалить: Открывать проводник в чате' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(last(onChange).map((it: { id: string }) => it.id)).not.toContain('explorer')
  })
})

describe('PersonalizationPage', () => {
  it('валидирует полные даты и допускает частичные', () => {
    expect(isValidPersonalizationDate({ ...DEFAULT_SETTINGS.personalization, birthDay: 31, birthMonth: 2 })).toBe(false)
    expect(isValidPersonalizationDate({ ...DEFAULT_SETTINGS.personalization, birthMonth: 2, birthYear: 1990 })).toBe(true)
    expect(isValidPersonalizationDate({ ...DEFAULT_SETTINGS.personalization, birthYear: 1990 })).toBe(true)
  })

  it('показывает отдельную страницу и сохраняет настройки', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    render(<PersonalizationPage user={{ name: 'alexey', role: 'developer' }} value={DEFAULT_SETTINGS.personalization} onSave={save} onCancel={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Персонализация — alexey' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Имя или обращение'), 'Лёша')
    await userEvent.selectOptions(screen.getByLabelText('Объём'), 'brief')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ preferredName: 'Лёша', responseStyle: 'brief' }))
  })

  it('сообщает о невозможной дате доступным alert', async () => {
    render(<PersonalizationPage user={{ name: 'alexey', role: 'developer' }} value={DEFAULT_SETTINGS.personalization} onSave={vi.fn()} onCancel={vi.fn()} />)
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
    renderModal('developer', { llmAccess: denied })
    const select = screen.getByLabelText('Модель Claude')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['default', 'sonnet', 'haiku'])
    expect(opts).not.toContain('opus[1m]')
    expect(opts).not.toContain('fable')
  })

  it('без запретов у роли user меню то же, что у админа', () => {
    renderModal('developer')
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

describe('SettingsModal — тема интерфейса', () => {
  it('показывает зелёную тему и сохраняет её выбор', async () => {
    const onChange = vi.fn()
    renderModal('admin', { onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Интерфейс' }))

    const select = screen.getByLabelText('Тема интерфейса')
    expect(within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value))
      .toEqual(['light', 'dark', 'green'])

    await userEvent.selectOptions(select, 'green')
    expect(onChange).toHaveBeenCalledWith({ theme: 'green' })
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
    renderModal('developer', { engines: [{ id: 'work', name: 'Рабочий', kind: 'codex', isDefault: true }], onChange })
    await userEvent.selectOptions(screen.getByLabelText('Исполнитель LLM'), 'work')
    expect(onChange).toHaveBeenCalledWith({ llmEngineId: 'work', llmProvider: 'codex' })
  })
})


describe('SettingsModal — TTL временных генераций', () => {
  it('показывает безопасный default, валидирует и сохраняет целые дни', async () => {
    const onChange = vi.fn()
    renderModal('developer', { onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Хранилище' }))
    const input = screen.getByLabelText('TTL временных генераций в днях')
    expect(input).toHaveValue(30)
    expect(screen.getByText(/Безопасное значение по умолчанию — 30 дней/)).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, '1.5')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.clear(input)
    await userEvent.type(input, '45')
    await userEvent.tab()
    expect(onChange).toHaveBeenCalledWith({ generatedFilesTtlDays: 45 })
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
