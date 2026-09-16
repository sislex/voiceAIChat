import { describe, it, expect, vi, afterEach } from 'vitest'

// @testCase tc-regression-global-llm
import { expectLabelledIconButtons, expectNoViolations } from '@voicechat/ui-foundation/test/a11y'
import { screen, within, waitFor } from '@testing-library/react'
import { render } from '../test/uiRender'
import userEvent from '@testing-library/user-event'
import { SettingsModal, type SettingsModalProps } from './SettingsModal'
import { PersonalizationPage, isValidPersonalizationDate } from './SettingsPage'
import { DEFAULT_SETTINGS, type UserRole } from '@shared/types'
import type { UserLlmAccess } from '@shared/llmAccess'

import { OnboardingModal } from './OnboardingModal'
import { initialOnboarding, ONBOARDING_STATUSES, type OnboardingState } from '@shared/types'
import { createFakeApi } from '@voicechat/ui-foundation/test/fakeApi'
import type { RendererOnboardingBridge, SttUpdate, IpcEventPayload } from '@shared/ipc'
import { createBrowserAudioController } from '../audio/browserAudio'
import { AudioCapture } from '../audio/audioCapture'

vi.mock('../audio/browserAudio', () => ({ createBrowserAudioController: vi.fn() }))

function onboardingFixture() {
  const api = createFakeApi()
  const save = vi.fn(async (onboarding: OnboardingState) => { await api['settings:save']({ onboarding }) })
  const done = vi.fn()
  const props = {
    api, settings: { ...DEFAULT_SETTINGS }, onSave: save, onDone: done,
    modelPresent: true, modelLabel: 'base', downloading: false, downloadPercent: 0,
    onDownloadModel: vi.fn(), hasVoice: true
  }
  return { api, save, done, props }
}

describe('resumable onboarding', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

  // @testCase TC-NEG-1
  it('releases a microphone grant that arrives after recording was cancelled', async () => {
    let grant!: (stream: MediaStream) => void
    const getUserMedia = vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve }))
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    const capture = new AudioCapture({ workletUrl: '/pcm.js', onChunk: vi.fn() })
    expect(getUserMedia).not.toHaveBeenCalled()
    const started = capture.start()
    const cancelled = expect(started).rejects.toThrow('Запись отменена')
    await capture.stop()
    const stop = vi.fn()
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await cancelled
    expect(stop).toHaveBeenCalledTimes(1)
  })

  // @testCase TC-UI-1
  it.each(ONBOARDING_STATUSES)('renders accessible diagnostics and an exit for %s', async status => {
    const f = onboardingFixture()
    const onboarding = initialOnboarding()
    onboarding.results.microphone = { status, diagnostic: 'Long diagnostic '.repeat(30) }
    render(<OnboardingModal {...f.props} settings={{ ...DEFAULT_SETTINGS, onboarding }} />)
    expect(screen.getByRole('button', { name: 'Продолжить в чате' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Пропустить шаг' })).toBeTruthy()
    await expectNoViolations()
    const user = userEvent.setup()
    const exit = screen.getByRole('button', { name: 'Продолжить в чате' })
    for (let i = 0; i < 20 && document.activeElement !== exit; i++) await user.tab()
    expect(document.activeElement).toBe(exit)
    expect(exit.hasAttribute('disabled')).toBe(false)
    await user.keyboard('{Enter}')
    expect(f.done).toHaveBeenCalledTimes(1)
  })

  // @testCase TC-STATE-1
  it('invalidates a changed voice without discarding microphone and machine successes', async () => {
    const f = onboardingFixture()
    const onboarding = initialOnboarding()
    for (const step of ['microphone', 'tts', 'machine'] as const) onboarding.results[step] = { status: 'success', diagnostic: 'Verified' }
    const view = render(<OnboardingModal {...f.props} settings={{ ...DEFAULT_SETTINGS, onboarding }} />)
    await waitFor(() => expect(f.save).toHaveBeenCalled())
    view.rerender(<OnboardingModal {...f.props} settings={{ ...DEFAULT_SETTINGS, onboarding, voice: 'changed' }} />)
    await waitFor(() => expect(f.api._state.settings.onboarding?.results.tts.status).toBe('warning'))
    expect(f.api._state.settings.onboarding?.results.microphone.status).toBe('success')
    expect(f.api._state.settings.onboarding?.results.machine.status).toBe('success')
  })

  // @testCase TC-STATE-1
  it('keeps the saved step selected when another resource becomes unavailable', async () => {
    const f = onboardingFixture()
    const onboarding = initialOnboarding()
    onboarding.current = 'machine'
    onboarding.results.tts = { status: 'success', diagnostic: 'Played' }
    render(<OnboardingModal {...f.props} settings={{ ...DEFAULT_SETTINGS, onboarding }} unavailableSteps={['tts']} />)
    await waitFor(() => expect(f.api._state.settings.onboarding?.results.tts.status).toBe('warning'))
    expect(f.api._state.settings.onboarding?.current).toBe('machine')
    expect(screen.getByRole('heading', { name: 'Машина' })).toBeTruthy()
  })

  // @testCase TC-NEG-1
  it('does not request permission, open a diagnostic connection or send a test on mount and recovery', async () => {
    const f = onboardingFixture()
    const progress = initialOnboarding()
    progress.results.microphone.status = 'checking'
    progress.results.tts = { status: 'success', diagnostic: 'Played' }
    const open = vi.fn()
    render(<OnboardingModal {...f.props} settings={{ ...DEFAULT_SETTINGS, onboarding: progress }} bridge={{ open }} />)
    expect(screen.getByText(/Проверка прервана/)).toBeTruthy()
    expect(open).not.toHaveBeenCalled()
    expect(createBrowserAudioController).not.toHaveBeenCalled()
    await waitFor(() => expect(f.save).toHaveBeenCalled())
    expect(f.api._state.settings.onboarding?.results.tts.status).toBe('success')
    expect(f.api._state.settings.onboarding?.results.microphone.status).toBe('warning')
    expect(open).not.toHaveBeenCalled()
    expect(createBrowserAudioController).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить в чате' }))
    expect(f.done).toHaveBeenCalledTimes(1)
  })

  // @testCase TC-STATE-1
  it('keeps unsaved results visible, retries persistence and resets only onboarding', async () => {
    const f = onboardingFixture()
    f.save.mockRejectedValueOnce(new Error('Storage unavailable'))
    render(<OnboardingModal {...f.props} />)
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Повторить сохранение' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Пропустить шаг' }))
    await waitFor(() => expect(f.api._state.settings.onboarding?.results.microphone.status).toBe('skipped'))
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить только прогресс' }))
    await waitFor(() => expect(f.api._state.settings.onboarding?.results.microphone.status).toBe('idle'))
    expect(f.api._state.settings.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(f.api._state.settings.voice).toBe(DEFAULT_SETTINGS.voice)
    expect(f.api._state.conversations).toEqual([])
  })

  // @testCase TC-DEGRADED-1
  // @testCase TC-UI-1
  it('keeps chat exit available after a service error without claiming a working LLM', async () => {
    const f = onboardingFixture()
    f.api['system:capabilities'] = vi.fn().mockRejectedValue(new Error('offline'))
    render(<OnboardingModal {...f.props} />)
    await userEvent.click(screen.getByRole('button', { name: 'Проверить / повторить' }))
    await screen.findByText(/Ошибка: Проверка не завершилась/)
    expect(f.api._state.settings.onboarding?.results.llm.status).not.toBe('success')
    await userEvent.click(screen.getByRole('button', { name: 'Продолжить в чате' }))
    expect(f.done).toHaveBeenCalled()
  })

  // @testCase TC-NEG-1
  it('ignores a late check result after reset', async () => {
    const f = onboardingFixture()
    let resolve!: (value: Awaited<ReturnType<typeof f.api['agents:list']>>) => void
    f.api['agents:list'] = vi.fn(() => new Promise<Awaited<ReturnType<typeof f.api['agents:list']>>>(r => { resolve = r }))
    render(<OnboardingModal {...f.props} />)
    await userEvent.click(screen.getByRole('button', { name: /4\. Машина/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Проверить / повторить' }))
    await userEvent.click(screen.getByRole('button', { name: 'Сбросить только прогресс' }))
    resolve([])
    await waitFor(() => expect(f.api._state.settings.onboarding?.results.machine.status).toBe('idle'))
  })

  // @testCase TC-VOICE-1
  // @testCase TC-NEG-1
  it.each([
    { provider: 'claude' as const, failure: '' },
    { provider: 'codex' as const, failure: '' },
    ...['permission', 'recognition', 'llm', 'tts', 'autoplay'].map(failure => ({ provider: 'codex' as const, failure }))
  ])('checks the complete voice chain through $provider with failure=$failure', async ({ provider, failure }) => {
    const f = onboardingFixture()
    f.props.settings.llmProvider = provider
    let final: (value: SttUpdate) => void = () => {}
    let answer: (value: IpcEventPayload<'claude:done'>) => void = () => {}
    let audio: (value: { audio: ArrayBuffer }) => void = () => {}
    const noop = () => () => {}
    const conn: ReturnType<RendererOnboardingBridge['open']> = {
      audio: { audioStart: vi.fn(), audioChunk: vi.fn(), audioStop: vi.fn() },
      stt: { onFinal: cb => { final = cb; return () => { final = () => {} } }, onPartial: noop, onError: noop,
        download: vi.fn(), onDownloadProgress: noop, onDownloadDone: noop, onDownloadError: noop },
      tts: { onAudio: cb => { audio = cb; return () => { audio = () => {} } }, onError: noop,
        speak: vi.fn(() => queueMicrotask(() => audio({ audio: new ArrayBuffer(8) }))), cancel: vi.fn(),
        downloadVoice: vi.fn(), onVoiceProgress: noop, onVoiceDone: noop, onVoiceError: noop },
      claude: { onDone: cb => { answer = cb; return () => { answer = () => {} } }, onToken: noop, onError: noop, onLog: noop,
        send: vi.fn(payload => queueMicrotask(() => answer({ conversationId: payload.conversationId, text: 'Ответ', engine: provider }))),
        cancel: vi.fn() },
      close: vi.fn()
    }
    const start = vi.fn(async () => {
      if (failure === 'permission') throw new DOMException('Denied', 'NotAllowedError')
    })
    const stop = vi.fn(async () => { final({ text: failure === 'recognition' ? '' : 'Проверка', segments: [{ speakerId: 1, text: 'Проверка' }] }) })
    vi.mocked(createBrowserAudioController).mockReturnValue({ start, stop })
    f.api['auth:status'] = vi.fn(async () => ({
      claude: { provider: 'claude' as const, loggedIn: provider === 'claude' },
      codex: { provider: 'codex' as const, loggedIn: provider === 'codex' && failure !== 'llm' }
    }))
    f.api['system:capabilities'] = vi.fn(async () => ({
      stt: { available: true, reason: '' }, tts: { available: true, reason: '' }, memoryLimitBytes: 1e10, cpuCount: 4
    }))
    f.api['stt:status'] = vi.fn(async () => ({ present: true, model: DEFAULT_SETTINGS.whisperModel }))
    f.api['tts:voices'] = vi.fn().mockResolvedValue([{ id: 'voice' }])
    let ended: (() => void) | null = null
    vi.stubGlobal('AudioContext', class {
      state = 'running'
      destination = {}
      resume = async () => { if (failure === 'autoplay') throw new DOMException('Blocked', 'NotAllowedError') }
      close = async () => {}
      decodeAudioData = async () => { if (failure === 'tts') throw new Error('Invalid audio'); return {} }
      createBufferSource() {
        return { buffer: null, connect() {}, start() {}, stop() {},
          set onended(cb: (() => void) | null) { ended = cb } }
      }
    })
    render(<OnboardingModal {...f.props} bridge={{ open: () => conn }} />)
    await userEvent.click(screen.getByRole('button', { name: /5\. Голосовой запрос/ }))
    expect(start).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Проверить / повторить' }))
    if (failure !== 'permission') await userEvent.click(await screen.findByRole('button', { name: 'Завершить запись' }))
    if (failure) {
      await waitFor(() => expect(f.api._state.settings.onboarding?.results.voice.status).toBe('error'))
      const failedStep = ['permission', 'recognition'].includes(failure) ? 'microphone' : failure === 'llm' ? 'llm' : 'tts'
      expect(f.api._state.settings.onboarding?.results[failedStep].status).toBe('error')
      if (failedStep !== 'microphone') expect(f.api._state.settings.onboarding?.results.microphone.status).toBe('success')
      if (failedStep === 'tts') expect(f.api._state.settings.onboarding?.results.llm.status).toBe('success')
      expect(f.api._state.settings.onboarding?.results.tts.status).not.toBe('success')
      if (failure === 'autoplay') expect(f.api._state.settings.onboarding?.results.tts.diagnostic).toContain('Воспроизведение запрещено')
      await userEvent.click(screen.getByRole('button', { name: 'Продолжить в чате' }))
      expect(f.done).toHaveBeenCalledTimes(1)
      expect(conn.close).toHaveBeenCalledTimes(1)
      return
    }
    await waitFor(() => expect(ended).not.toBeNull())
    expect(f.api._state.settings.onboarding?.results.voice.status).toBe('checking')
    ;(ended as (() => void) | null)?.()
    await waitFor(() => expect(f.api._state.settings.onboarding?.results.voice.status).toBe('success'))
    expect(conn.claude.send).toHaveBeenCalledTimes(1)
    expect(conn.tts.speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ответ' }))
    expect(conn.close).toHaveBeenCalledTimes(1)
  })
})

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

describe('SettingsModal · Команды на машинах', () => {
  // @testCase TC-UI-1
  it('отправляет серверные патчи из трёх контролов', async () => {
    const onChange = vi.fn()
    renderModal('admin', { onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Интерфейс' }))
    await userEvent.selectOptions(screen.getByLabelText('Уведомления о завершении команд'), 'all')
    await userEvent.selectOptions(screen.getByLabelText('Длительность уведомления команд'), '15')
    await userEvent.click(screen.getByRole('switch', { name: 'Системные уведомления команд' }))
    expect(onChange).toHaveBeenCalledWith({ machineCommandNotices: 'all' })
    expect(onChange).toHaveBeenCalledWith({ machineCommandNoticeSeconds: 15 })
    expect(onChange).toHaveBeenCalledWith({ machineCommandSystemNotifications: false })
  })

  // @testCase TC-UI-2
  it('в режиме off сохраняет значения зависимых контролов, но блокирует их', async () => {
    renderModal('admin', { settings: {
      ...DEFAULT_SETTINGS, machineCommandNotices: 'off', machineCommandNoticeSeconds: 30,
      machineCommandSystemNotifications: true
    } })
    await userEvent.click(screen.getByRole('button', { name: 'Интерфейс' }))
    const duration = screen.getByLabelText('Длительность уведомления команд') as HTMLSelectElement
    const system = screen.getByRole('switch', { name: 'Системные уведомления команд' })
    expect(duration).toBeDisabled()
    expect(duration.value).toBe('30')
    expect(system).toBeDisabled()
    expect(system).toHaveAttribute('aria-checked', 'true')
  })
})

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
    // Шесть встроенных инструкций: консоль, проводник, панель кода, вопросы, картинки, разрешение на правки.
    expect(within(list).getAllByRole('checkbox')).toHaveLength(6)
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
    expect(dup).toHaveLength(7)
    const copy = dup.find((item: { title?: string }) => item.title === 'Уточняющие вопросы с вариантами (копия)')
    expect(copy).toMatchObject({ enabled: true })
    expect(copy?.kind).toBeUndefined()
    expect(String(copy?.text)).toContain('```questions')
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

describe('SettingsModal — общая LLM-вкладка', () => {
  // @testCase TC-UI-LLM-NAV
  it('открывает LLM-редактор с текущими engine, provider и model и сохраняет patch', async () => {
    const onChange = vi.fn()
    renderModal('developer', {
      initialSection: 'aiAssist',
      settings: { ...DEFAULT_SETTINGS, llmEngineId: 'work', llmProvider: 'codex', codexModel: 'gpt-6-astra' },
      engines: [{ id: 'work', name: 'Рабочий', kind: 'codex', isDefault: true }],
      onChange
    })

    await userEvent.click(screen.getByRole('button', { name: 'LLM' }))
    expect(screen.getByRole('button', { name: 'LLM' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('llm-settings-editor')).toBeInTheDocument()
    expect(screen.getByLabelText('Исполнитель LLM')).toHaveValue('work')
    expect(screen.getByLabelText('Движок')).toHaveValue('codex')
    expect(screen.getByLabelText('Модель Codex')).toHaveValue('gpt-6-astra')

    await userEvent.selectOptions(screen.getByLabelText('Модель Codex'), 'gpt-5.6-sol')
    expect(onChange).toHaveBeenCalledWith({ codexModel: 'gpt-5.6-sol' })
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
  // @testCase TC-UI-1
  it('показывает gpt-6-astra из общего каталога и сохраняет точный id', async () => {
    const onChange = vi.fn()
    renderModal('admin', { settings: { ...DEFAULT_SETTINGS, llmProvider: 'codex' }, onChange })
    const select = screen.getByLabelText('Модель Codex')
    const opts = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)
    expect(opts).toEqual(['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'])
    await userEvent.selectOptions(select, 'gpt-5.5')
    expect(onChange).toHaveBeenCalledWith({ codexModel: 'gpt-5.5' })
  })

  // @testCase TC-UI-2
  it('персональный запрет скрывает только gpt-6-astra', () => {
    renderModal('developer', { settings: { ...DEFAULT_SETTINGS, llmProvider: 'codex', codexModel: 'gpt-5.6-sol' }, llmAccess: [{ provider: 'codex', modelId: 'gpt-6-astra' }] })
    const values = within(screen.getByLabelText('Модель Codex')).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
    expect(values).not.toContain('gpt-6-astra')
    expect(values).toContain('gpt-5.6-sol')
  })

  // @testCase TC-UI-1
  // @testCase TC-UI-2
  it('AI-помощник использует тот же каталог и deny-list Codex', async () => {
    renderModal('developer', {
      settings: { ...DEFAULT_SETTINGS, aiAssistProvider: 'codex', aiAssistModel: 'gpt-5.6-sol' },
      llmAccess: [{ provider: 'codex', modelId: 'gpt-5.6-luna' }]
    })
    await userEvent.click(screen.getByRole('button', { name: 'AI-помощник' }))
    const values = within(screen.getByLabelText('Модель AI-помощника')).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)
    expect(values).toContain('gpt-6-astra')
    expect(values).not.toContain('gpt-5.6-luna')
  })

  // @testCase TC-REG-1
  it('модель из старых настроек не теряется отдельным пунктом', () => {
    renderModal('admin', { settings: { ...DEFAULT_SETTINGS, llmProvider: 'codex', codexModel: '' } })
    const select = screen.getByLabelText('Модель Codex') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(within(select).getByRole('option', { name: 'По умолчанию (из codex)' })).toBeInTheDocument()
  })
})

describe('SettingsModal — тема интерфейса', () => {
  // @testCase TC4
  it('показывает зелёную тему и сохраняет её выбор', async () => {
    const onChange = vi.fn()
    renderModal('admin', { onChange })
    await userEvent.click(screen.getByRole('button', { name: 'Интерфейс' }))

    const select = screen.getByLabelText('Тема интерфейса')
    expect(within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value))
      .toEqual(['light', 'dark', 'green', 'system'])

    await userEvent.selectOptions(select, 'green')
    expect(onChange).toHaveBeenCalledWith({ theme: 'green' })
  })
})

describe('SettingsModal — настройки не загружены', () => {
  it('показывает баннер с повтором вместо молчаливых дефолтов', async () => {
    const onRetryLoad = vi.fn()
    renderModal('admin', { settingsLoaded: false, onRetryLoad })

    const banner = screen.getByTestId('settings-not-loaded')
    expect(banner).toHaveTextContent('Настройки не загружены')
    await userEvent.click(within(banner).getByRole('button', { name: 'Повторить' }))
    expect(onRetryLoad).toHaveBeenCalledTimes(1)
  })

  it('при загруженных настройках баннера нет', () => {
    renderModal('admin')
    expect(screen.queryByTestId('settings-not-loaded')).not.toBeInTheDocument()
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
