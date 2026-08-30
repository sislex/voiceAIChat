// settingsStore — пользовательские настройки, каталоги и capabilities (CHAT-236).
//
// Chat и Voice не повторяют фильтрацию моделей и проверку возможностей: они
// читают нормализованные селекторы отсюда. Серверный gate это не отменяет —
// клиентское скрытие недоступной функции остаётся украшением.

import type { LoginStatusMap } from '@shared/auth'
import type { LlmEngineOption } from '@shared/admin'
import type { McpServer } from '@shared/mcp'
import type { SystemCapabilities } from '@shared/protocol'
import type { UserLlmAccess } from '@shared/llmAccess'
import { allowedModels, isProviderAllowed } from '@shared/llmAccess'
import type {
  CatalogVoice,
  LlmProvider,
  Settings,
  TtsVoiceInfo,
  WhisperModel,
  WhisperModelInfo
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { MicDevice } from '../../audio/microphones'
import type { SettingsClient, SttPort, TtsPort } from '../../clients/types'
import { createStoreCore, type Store } from '../createStore'
import type { EffectiveVoiceSettings } from '../contracts'
import { THEME_KEY } from '../contracts'



export interface SettingsState {
  settings: Settings
  /**
   * Настройки пришли с сервера (а не остались дефолтами стора). Пока это не так,
   * состояние показывать можно, а строить на нём сохранение — нет: дефолты
   * уехали бы на сервер как осознанный выбор. Ровно так настройки «сбрасывались»
   * после деплоя: сервер на пару секунд недоступен, `settings:get` падает,
   * а первое же изменение уносит на сервер дефолты.
   */
  settingsLoaded: boolean
  /** Доступные LLM-движки и их модели. */
  llmEngines: LlmEngineOption[]
  /** Персональные запреты моделей текущего пользователя; пусто = полный доступ. */
  llmAccess: UserLlmAccess[]
  /** Возможности системы (ресурсы контейнера). null — ещё не загружено. */
  capabilities: SystemCapabilities | null
  /** Подключённые MCP-серверы (read-only показ в настройках). */
  mcpServers: McpServer[]
  /** Статус входа claude/codex; null — ещё не загружен. */
  loginStatus: LoginStatusMap | null
  /** Доступные микрофоны для выбора в настройках. */
  mics: MicDevice[]
  /** Реальные голоса TTS активного движка. */
  ttsVoices: TtsVoiceInfo[]
  /** Каталог скачиваемых голосов Piper. */
  voiceCatalog: CatalogVoice[]
  /** Доступно ли скачивание голосов (активен Piper). */
  voicesDownloadable: boolean
  /** Прогресс скачивания по id голоса (0–100); наличие ключа = идёт загрузка. */
  voiceDownloads: Record<string, number>
  /** Модели Whisper на диске (наличие/размер). */
  whisperModels: WhisperModelInfo[]
  /** Наличие локальной модели Whisper (для баннера первого запуска). */
  modelPresent: boolean
  /** Идёт ли скачивание модели. */
  downloading: boolean
  /** Прогресс скачивания модели (0–100). */
  downloadPercent: number
  /** Доступна ли озвучка (кнопка ▶ на ответах). */
  ttsAvailable: boolean
}

export interface SettingsActions {
  /** Загрузить настройки, движки и права (защищённый bootstrap). */
  load(): Promise<void>
  /** Догрузить каталоги и возможности — они не блокируют показ чата. */
  loadCatalogs(): Promise<void>
  updateSettings(patch: Partial<Settings>): Promise<void>
  completeOnboarding(): Promise<void>
  refreshMics(): Promise<void>
  refreshLoginStatus(): Promise<void>
  applyLoginStatus(status: LoginStatusMap): void
  downloadModel(): void
  applyDownloadProgress(percent: number): void
  applyDownloadDone(): void
  applyDownloadError(message: string): void
  downloadVoice(id: string): void
  applyVoiceProgress(id: string, percent: number): void
  applyVoiceDone(id: string): Promise<void>
  applyVoiceError(id: string, message: string): void
  deleteVoice(id: string): Promise<void>
  deleteModel(model: WhisperModel): Promise<void>
  /** Машину удалили: сбросить ссылки на неё в настройках. */
  forgetAgent(id: string): void
  reset(): void
  // --- Селекторы (нормализованный публичный вид) ---
  selectAllowedProviders(): LlmProvider[]
  selectAllowedModels(provider: LlmProvider): Array<{ id: string; label: string; hint?: string }>
  selectVoiceInputAvailability(): { available: boolean; reason: string | null }
  selectEffectiveVoiceSettings(): EffectiveVoiceSettings
}

export type SettingsStore = Store<SettingsState, SettingsActions>

export interface SettingsDeps {
  settings: SettingsClient
  stt: SttPort
  tts: TtsPort
  /**
   * Предпочтения взгляда (порт `prefs`). Здесь живёт только зеркало темы:
   * источник правды — сервер, но до его ответа интерфейс обязан рисоваться той
   * же темой, а не светлой по умолчанию — иначе перезагрузка во время деплоя
   * выглядит как сброшенные настройки.
   */
  prefs?: { get(key: string): string | null; set(key: string, value: string): void; remove(key: string): void }
  /** Ошибка/успех операции — тостом (владелец очереди тостов — shellStore). */
  notifyError?: (message: string) => void
}

function initialState(ttsAvailable: boolean, theme: Settings['theme'] = DEFAULT_SETTINGS.theme): SettingsState {
  return {
    settings: { ...DEFAULT_SETTINGS, theme },
    settingsLoaded: false,
    llmEngines: [],
    llmAccess: [],
    capabilities: null,
    mcpServers: [],
    loginStatus: null,
    mics: [],
    ttsVoices: [],
    voiceCatalog: [],
    voicesDownloadable: false,
    voiceDownloads: {},
    whisperModels: [],
    modelPresent: true,
    downloading: false,
    downloadPercent: 0,
    ttsAvailable
  }
}

export function createSettingsStore(deps: SettingsDeps): SettingsStore {
  const client = deps.settings
  const savedTheme = (): Settings['theme'] => {
    const value = deps.prefs?.get(THEME_KEY)
    return value === 'dark' || value === 'light' || value === 'green' ? value : DEFAULT_SETTINGS.theme
  }
  const core = createStoreCore<SettingsState>(initialState(deps.tts.enabled, savedTheme()))
  const { getState, setState } = core

  /** Зеркалим тему в предпочтения: следующий старт нарисует её ещё до ответа сервера. */
  function rememberTheme(settings: Settings): void {
    deps.prefs?.set(THEME_KEY, settings.theme)
  }

  /**
   * База для сохранения — только настройки, которые сервер уже подтвердил.
   * Если загрузка не удалась, догоняем её здесь; не вышло и это — патч не
   * уходит вовсе (ошибка всплывает вызывающему), потому что запись дефолтов
   * необратимо затёрла бы серверную запись.
   */
  async function baseSettings(): Promise<Settings> {
    if (getState().settingsLoaded) return getState().settings
    const settings = await client['settings:get']()
    setState({ settings, settingsLoaded: true })
    rememberTheme(settings)
    return settings
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...(await baseSettings()), ...patch }
    setState({ settings, settingsLoaded: true })
    rememberTheme(settings)
    // На сервер уходит только патч: полный снимок этой вкладки затёр бы поля,
    // изменённые в соседней вкладке или на другом устройстве.
    await client['settings:save'](patch)
  }

  /**
   * Грузит реальные голоса активного движка. Выбор пользователя при этом не
   * переписывается: после деплоя движок TTS поднимается раньше, чем его голоса
   * (том с голосами, догрузка Piper), и запись фолбэка в БД теряла выбранный
   * голос навсегда. Пока голоса нет — его подменяет `selectEffectiveVoice`.
   */
  async function refreshTtsVoices(): Promise<void> {
    setState({ ttsVoices: await client['tts:voices']() })
  }

  /** Голос для синтеза: сохранённый, а если его сейчас нет — дефолтный или первый доступный. */
  function selectEffectiveVoice(): string {
    const { settings, ttsVoices } = getState()
    if (ttsVoices.length === 0 || ttsVoices.some((v) => v.id === settings.voice)) return settings.voice
    const fallback = ttsVoices.find((v) => v.id === DEFAULT_SETTINGS.voice) ?? ttsVoices[0]
    return fallback.id
  }

  async function refreshVoiceCatalog(): Promise<void> {
    const catalog = await client['tts:catalog']()
    setState({ voiceCatalog: catalog.voices, voicesDownloadable: catalog.downloadable })
  }

  async function refreshWhisperModels(): Promise<void> {
    if (!client['stt:models']) return
    try {
      setState({ whisperModels: await client['stt:models']() })
    } catch (err) {
      console.warn('[stt] не удалось получить список моделей', err)
    }
  }

  async function refreshModelStatus(): Promise<void> {
    if (!client.sttStatus) return
    try {
      const status = await client.sttStatus()
      setState({ modelPresent: status.present })
    } catch (err) {
      console.warn('[stt] не удалось получить статус модели', err)
    }
  }

  async function refreshMics(): Promise<void> {
    if (!client.listMics) return
    try {
      setState({ mics: await client.listMics() })
    } catch (err) {
      console.warn('[audio] не удалось получить список микрофонов', err)
    }
  }

  async function refreshCapabilities(): Promise<void> {
    if (!client['system:capabilities']) return
    try {
      setState({ capabilities: await client['system:capabilities']() })
    } catch (err) {
      console.warn('[system] не удалось получить возможности системы', err)
    }
  }

  async function refreshMcpServers(): Promise<void> {
    if (!client['mcp:list']) return
    try {
      setState({ mcpServers: await client['mcp:list']() })
    } catch (err) {
      console.warn('[mcp] не удалось получить список серверов', err)
    }
  }

  async function refreshLoginStatus(): Promise<void> {
    if (!client['auth:status']) return
    try {
      setState({ loginStatus: await client['auth:status']() })
    } catch (err) {
      console.warn('[auth] не удалось получить статус входа', err)
    }
  }

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      async load() {
        // Права и каталог движков нужны раньше любой фильтрации моделей, но их
        // отказ не должен оставлять настройки дефолтными: на дефолтах интерфейс
        // выглядит «сброшенным», а сохранение уносит их на сервер.
        const [settings, llmEngines, llmAccess] = await Promise.all([
          client['settings:get'](),
          client['llm:engines']().catch((err: unknown) => {
            console.warn('[settings] каталог движков LLM недоступен', err)
            return getState().llmEngines
          }),
          client['llm:access']().catch((err: unknown) => {
            console.warn('[settings] права на модели недоступны', err)
            return getState().llmAccess
          })
        ])
        setState({ settings, settingsLoaded: true, llmEngines, llmAccess })
        rememberTheme(settings)
      },
      async loadCatalogs() {
        await refreshMics()
        await refreshModelStatus()
        await refreshWhisperModels()
        await refreshTtsVoices()
        await refreshVoiceCatalog()
        await refreshCapabilities()
        await refreshMcpServers()
      },
      updateSettings,
      async completeOnboarding() {
        await updateSettings({ onboarded: true })
      },
      refreshMics,
      refreshLoginStatus,
      applyLoginStatus(status) { setState({ loginStatus: status }) },
      downloadModel() {
        if (!client.startModelDownload || getState().downloading) return
        setState({ downloading: true, downloadPercent: 0 })
        client.startModelDownload()
      },
      applyDownloadProgress(percent) {
        setState({ downloading: true, downloadPercent: percent })
      },
      applyDownloadDone() {
        setState({ downloading: false, downloadPercent: 100, modelPresent: true })
        void refreshWhisperModels() // обновить размеры в списке моделей
      },
      applyDownloadError(message) {
        setState({ downloading: false })
        deps.notifyError?.(message)
      },
      downloadVoice(id) {
        if (!client.startVoiceDownload || id in getState().voiceDownloads) return
        setState({ voiceDownloads: { ...getState().voiceDownloads, [id]: 0 } })
        client.startVoiceDownload(id)
      },
      applyVoiceProgress(id, percent) {
        setState({ voiceDownloads: { ...getState().voiceDownloads, [id]: percent } })
      },
      async applyVoiceDone(id) {
        const next = { ...getState().voiceDownloads }
        delete next[id]
        setState({ voiceDownloads: next })
        await refreshVoiceCatalog()
        await refreshTtsVoices()
      },
      applyVoiceError(id, message) {
        const next = { ...getState().voiceDownloads }
        delete next[id]
        setState({ voiceDownloads: next })
        deps.notifyError?.(message)
      },
      async deleteVoice(id) {
        await client['tts:deleteVoice']({ id })
        await refreshVoiceCatalog()
        await refreshTtsVoices()
      },
      async deleteModel(model) {
        await client['stt:deleteModel']({ model })
        await refreshWhisperModels()
        await refreshModelStatus()
      },
      forgetAgent(id) {
        const { settings } = getState()
        if (settings.execTarget !== id && settings.defaultAgentId !== id) return
        setState({
          settings: {
            ...settings,
            ...(settings.execTarget === id ? { execTarget: null } : {}),
            ...(settings.defaultAgentId === id ? { defaultAgentId: null } : {})
          }
        })
      },
      reset() {
        // Тема — настройка взгляда: она переживает выход, как и свёрнутый сайдбар.
        core.resetState(initialState(deps.tts.enabled, savedTheme()))
      },
      selectAllowedProviders() {
        const access = getState().llmAccess
        return (['claude', 'codex'] as LlmProvider[]).filter((provider) => isProviderAllowed(access, provider))
      },
      selectAllowedModels(provider) {
        return allowedModels(getState().llmAccess, provider)
      },
      selectVoiceInputAvailability() {
        if (!deps.stt.inputEnabled) return { available: false, reason: 'Голосовой ввод отключён' }
        if (!deps.stt.enabled) return { available: false, reason: 'Распознавание речи недоступно' }
        const capabilities = getState().capabilities
        if (capabilities && !capabilities.stt.available) {
          return { available: false, reason: capabilities.stt.reason || 'Распознавание речи недоступно' }
        }
        return { available: true, reason: null }
      },
      selectEffectiveVoiceSettings() {
        const { settings } = getState()
        return {
          micDeviceId: settings.micDeviceId,
          voice: selectEffectiveVoice(),
          handsFree: settings.handsFree,
          bargeIn: settings.bargeIn,
          autoSpeak: settings.autoSpeak,
          diarization: settings.diarization,
          showConsole: settings.showConsole
        }
      }
    }
  }
}

