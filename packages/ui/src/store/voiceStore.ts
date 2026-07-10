// Стор renderer (Шаг 5): единый источник состояния UI.
//
// Фреймворк-независим — обычное замыкание с getState/subscribe/actions, чтобы
// логику можно было тестировать без React. Голосовые переходы идут строго через
// машину состояний (src/shared/stateMachine.ts). Данные (разговоры, сообщения,
// настройки) — реальные, из SQLite через window.api (IPC). Рост транскрипта и
// ответ — мок-пайплайн (см. mockPipeline.ts).

import type { RendererApi, SttSegmentWire, SttStatus, SttUpdate, UploadInfo } from '@shared/ipc'
import type {
  CatalogVoice,
  Conversation,
  Message,
  MessageRole,
  Settings,
  TtsVoiceInfo,
  WhisperModel,
  WhisperModelInfo
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { transition, type VoiceEvent } from '@shared/stateMachine'
import type { VoiceState } from '@shared/types'
import type { LiveSegment } from '../lib/view'
import { flushSpeakable, splitSpeakable } from '../lib/sentences'
import type { AudioController } from '../audio/browserAudio'
import type { MicDevice } from '../audio/microphones'
import {
  DEFAULT_DELAYS,
  formatTime,
  mockReply,
  type PipelineDelays,
  titleFromText,
  transcriptFrames
} from './mockPipeline'

/** Полное состояние приложения в renderer. */
export interface AppState {
  voice: VoiceState
  conversations: Conversation[]
  activeId: string | null
  messages: Message[]
  liveSegments: LiveSegment[]
  settings: Settings
  settingsOpen: boolean
  draft: string
  /** Вложения, прикреплённые к следующему сообщению (ещё не отправлены). */
  attachments: UploadInfo[]
  /** Доступные микрофоны для выбора в настройках. */
  mics: MicDevice[]
  /** Реальные голоса TTS активного движка для выбора в настройках. */
  ttsVoices: TtsVoiceInfo[]
  /** Каталог скачиваемых голосов Piper. */
  voiceCatalog: CatalogVoice[]
  /** Доступно ли скачивание голосов (активен Piper). */
  voicesDownloadable: boolean
  /** Прогресс скачивания по id голоса (0–100); наличие ключа = идёт загрузка. */
  voiceDownloads: Record<string, number>
  /** Модели Whisper на диске (наличие/размер) — для управления местом. */
  whisperModels: WhisperModelInfo[]
  /** Стримящийся ответ Claude (растёт по токенам); пусто — нет активного стрима. */
  streamingReply: string
  /** id сообщения, которое сейчас озвучивается по кнопке (ручной повтор); null — нет. */
  speakingMessageId: string | null
  /** Доступна ли озвучка (кнопка ▶ на ответах). */
  ttsAvailable: boolean
  /** Текст последней ошибки для баннера (null — нет). */
  error: string | null
  /** Наличие локальной модели Whisper (для баннера первого запуска). */
  modelPresent: boolean
  /** Идёт ли скачивание модели. */
  downloading: boolean
  /** Прогресс скачивания модели (0–100). */
  downloadPercent: number
}

export interface StoreDeps {
  api: RendererApi
  /** Источник времени (для формата HH:MM). По умолчанию Date.now. */
  now?: () => number
  /** Переопределение задержек пайплайна (для тестов). */
  delays?: Partial<PipelineDelays>
  /** Контроллер захвата аудио. Отсутствует в тестах/headless → запись пропускается. */
  audio?: AudioController | null
  /** Источник списка микрофонов (enumerateDevices). Отсутствует → mics пуст. */
  listMics?: () => Promise<MicDevice[]>
  /**
   * true — live-транскрипт и финал приходят от реального STT (события stt:*),
   * мок-рост транскрипта отключён. false (по умолчанию) — мок-пайплайн.
   */
  sttEnabled?: boolean
  /**
   * true — ответ приходит от реального Claude (события claude:*), мок-ответ
   * отключён. false (по умолчанию) — мок-ответ.
   */
  claudeEnabled?: boolean
  /** Отправка реплики в Claude (renderer → main). Обязателен при claudeEnabled. */
  sendClaudePrompt?: (
    conversationId: string,
    segments: SttSegmentWire[],
    attachments?: string[]
  ) => void
  /** Отмена текущего запроса к Claude (renderer → main). */
  cancelClaude?: () => void
  /** Запрос статуса модели Whisper (наличие). */
  getSttStatus?: () => Promise<SttStatus>
  /** Запуск скачивания модели Whisper (renderer → main). */
  startModelDownload?: () => void
  /**
   * true — длительность speaking задаёт реальный TTS (события tts:*),
   * иначе (по умолчанию) — фиксированный мок-таймер.
   */
  ttsEnabled?: boolean
  /** Озвучить текст (renderer → main). Обязателен при ttsEnabled. */
  speakText?: (text: string, voice: string) => void
  /** Прервать озвучку (renderer → main). */
  cancelTts?: () => void
  /** Запустить скачивание голоса Piper (renderer → main). */
  startVoiceDownload?: (id: string) => void
}

/** Действия, дергаемые из UI. Все асинхронные операции инкапсулированы здесь. */
export interface StoreActions {
  init(): Promise<void>
  newConversation(): void
  selectConversation(id: string): Promise<void>
  deleteConversation(id: string): Promise<void>
  openSettings(): void
  closeSettings(): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  setDraft(value: string): void
  submitText(): Promise<void>
  /** Отменить текущий запрос к Claude и вернуться в idle (случайно отправил). */
  cancelRequest(): void
  /** Удалить сообщение из истории (БД + лента). */
  deleteMessage(id: string): Promise<void>
  /** Исправить сообщение пользователя: удалить его и все последующие, переспросить. */
  editMessage(id: string, newText: string): Promise<void>
  /** Прикрепить файл к следующему сообщению (загрузка на сервер). */
  addAttachment(file: File): Promise<void>
  /** Убрать прикреплённый файл по id. */
  removeAttachment(id: string): void
  startVoice(): void
  stopVoice(): void
  stopSpeak(): void
  /** Применить частичную гипотезу распознавания (stt:partial). */
  applySttPartial(update: SttUpdate): void
  /** Применить финальный транскрипт (stt:final) — запускает ответ. */
  applySttFinal(update: SttUpdate): void
  /** Обработать ошибку распознавания (stt:error). */
  applySttError(message: string): void
  /** Применить фрагмент ответа Claude (claude:token). */
  applyClaudeToken(delta: string): void
  /** Применить завершение ответа Claude (claude:done) — фиксирует сообщение. */
  applyClaudeDone(text: string): void
  /** Обработать ошибку Claude (claude:error). */
  applyClaudeError(message: string): void
  /** Скрыть баннер ошибки. */
  dismissError(): void
  /** Запустить скачивание модели Whisper. */
  downloadModel(): void
  /** Прогресс скачивания модели (stt:downloadProgress). */
  applyDownloadProgress(percent: number): void
  /** Скачивание модели завершено (stt:downloadDone). */
  applyDownloadDone(): void
  /** Ошибка скачивания модели (stt:downloadError). */
  applyDownloadError(message: string): void
  /** Один клип озвучки доигран (tts:audio закончился). */
  applyTtsDone(): void
  /** Ошибка озвучки (tts:error). */
  applyTtsError(message: string): void
  /** Ручной повтор озвучки сообщения по кнопке (toggle ▶/⏹). */
  replayMessage(id: string, text: string): void
  /** Запустить скачивание голоса Piper по id. */
  downloadVoice(id: string): void
  /** Удалить установленный голос Piper (освободить место). */
  deleteVoice(id: string): Promise<void>
  /** Удалить файл модели Whisper (освободить место). */
  deleteModel(model: WhisperModel): Promise<void>
  /** Прогресс скачивания голоса (tts:voiceProgress). */
  applyVoiceProgress(id: string, percent: number): void
  /** Голос скачан (tts:voiceDone) — обновляет списки. */
  applyVoiceDone(id: string): void
  /** Ошибка скачивания голоса (tts:voiceError). */
  applyVoiceError(id: string, message: string): void
  /** Отмена всех активных таймеров пайплайна (напр. при размонтировании). */
  dispose(): void
}

export interface VoiceStore {
  getState(): AppState
  subscribe(listener: () => void): () => void
  actions: StoreActions
}

function initialState(): AppState {
  return {
    voice: 'idle',
    conversations: [],
    activeId: null,
    messages: [],
    liveSegments: [],
    settings: { ...DEFAULT_SETTINGS },
    settingsOpen: false,
    draft: '',
    attachments: [],
    mics: [],
    ttsVoices: [],
    voiceCatalog: [],
    voicesDownloadable: false,
    voiceDownloads: {},
    whisperModels: [],
    streamingReply: '',
    speakingMessageId: null,
    ttsAvailable: false,
    error: null,
    modelPresent: true,
    downloading: false,
    downloadPercent: 0
  }
}

/** Кодирует File в base64 (без префикса data:) для загрузки на сервер. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Текст сообщения пользователя с пометкой о вложениях (для истории). */
function composeUserText(text: string, attachments: UploadInfo[]): string {
  if (attachments.length === 0) return text
  const note = `📎 ${attachments.map((a) => a.name).join(', ')}`
  return text ? `${text}\n\n${note}` : note
}

export function createVoiceStore(deps: StoreDeps): VoiceStore {
  const { api } = deps
  const now = deps.now ?? Date.now
  const delays: PipelineDelays = { ...DEFAULT_DELAYS, ...deps.delays }
  const audio = deps.audio ?? null
  const sttEnabled = deps.sttEnabled ?? false
  const claudeEnabled = deps.claudeEnabled ?? false
  const ttsEnabled = deps.ttsEnabled ?? false

  let state = { ...initialState(), ttsAvailable: ttsEnabled }
  const listeners = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()

  function getState(): AppState {
    return state
  }

  function setState(patch: Partial<AppState>): void {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** Планирование шага пайплайна с отменяемым таймером. */
  function schedule(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      timers.delete(id)
      fn()
    }, ms)
    timers.add(id)
  }

  function cancelTimers(): void {
    timers.forEach((id) => clearTimeout(id))
    timers.clear()
  }

  /** Голосовой переход через машину состояний. Возвращает true, если он допустим. */
  function dispatchVoice(event: VoiceEvent): boolean {
    const res = transition(state.voice, event)
    if (res.ok) setState({ voice: res.state })
    return res.ok
  }

  async function refreshConversations(): Promise<void> {
    const conversations = await api['conversations:list']()
    setState({ conversations })
  }

  /** Создаёт разговор, если активного нет; заголовок — из первой реплики. */
  async function ensureConversation(titleSeed: string): Promise<string | null> {
    if (state.activeId) return state.activeId
    const conv = await api['conversations:create']({ title: titleFromText(titleSeed) })
    setState({ activeId: conv.id, messages: [] })
    await refreshConversations()
    return conv.id
  }

  /** Персист сообщения в БД и добавление в ленту. */
  async function persistMessage(role: MessageRole, text: string): Promise<void> {
    const conversationId = state.activeId
    if (!conversationId) return
    const message = await api['messages:add']({
      conversationId,
      role,
      text,
      time: formatTime(now())
    })
    setState({ messages: [...state.messages, message] })
  }

  // --- TTS: сессия и очередь синтеза по предложениям (стриминг) --------------
  interface TtsSession {
    kind: 'pipeline' | 'replay'
    messageId: string | null
    queued: number
    played: number
    sourceComplete: boolean
  }
  let ttsSession: TtsSession | null = null
  let ttsBuffer = '' // накопление токенов для нарезки на предложения

  /** Активна ли автоозвучка ответа: есть TTS и включён тумблер настройки. */
  function autoSpeakActive(): boolean {
    return ttsEnabled && !!deps.speakText && state.settings.autoSpeak
  }

  function enqueueSpeak(text: string): void {
    if (!ttsEnabled || !deps.speakText || !ttsSession) return
    const t = text.trim()
    if (!t) return
    ttsSession.queued += 1
    deps.speakText(t, state.settings.voice)
  }

  /** Начинает pipeline-озвучку: сессия + переход thinking → speaking. */
  function startPipelineSpeaking(): void {
    if (ttsSession) return
    ttsSession = { kind: 'pipeline', messageId: null, queued: 0, played: 0, sourceComplete: false }
    if (state.voice === 'thinking') dispatchVoice('reply_ready')
  }

  /** Завершает сессию, когда все чанки синтезированы и проиграны. */
  function finishTtsSessionIfDone(): void {
    const s = ttsSession
    if (!s || !s.sourceComplete || s.played < s.queued) return
    ttsSession = null
    if (s.kind === 'pipeline' && state.voice === 'speaking') dispatchVoice('speaking_done')
    if (s.kind === 'replay') setState({ speakingMessageId: null })
  }

  /** Сброс TTS: очередь синтеза/воспроизведения, сессия, буфер. */
  function resetTts(): void {
    ttsSession = null
    ttsBuffer = ''
    deps.cancelTts?.()
    if (state.speakingMessageId) setState({ speakingMessageId: null })
  }

  /** Фиксация мок-ответа и переход thinking → speaking → idle (без стрима). */
  async function finishReply(fullText: string): Promise<void> {
    const text = fullText.trim()
    setState({ streamingReply: '' })
    if (!text) {
      if (state.voice === 'thinking') dispatchVoice('reset') // пустой ответ → idle
      return
    }
    await persistMessage('ai', text)
    await refreshConversations()
    if (!dispatchVoice('reply_ready')) return // thinking → speaking
    if (autoSpeakActive()) {
      ttsSession = { kind: 'pipeline', messageId: null, queued: 0, played: 0, sourceComplete: false }
      enqueueSpeak(text)
      ttsSession.sourceComplete = true
      finishTtsSessionIfDone()
    } else {
      schedule(() => {
        dispatchVoice('speaking_done') // speaking → idle (мок-таймер)
      }, delays.speak)
    }
  }

  /** Мок-ответ (когда реальный Claude недоступен/выключен). */
  async function produceReplyMock(prompt: string): Promise<void> {
    await finishReply(mockReply(prompt))
  }

  /** Роутинг ответа: реальный Claude (стрим событиями) или мок-пайплайн. */
  function beginReply(segments: SttSegmentWire[], attachments: string[] = []): void {
    if (claudeEnabled && deps.sendClaudePrompt && state.activeId) {
      setState({ streamingReply: '' })
      ttsBuffer = ''
      deps.sendClaudePrompt(state.activeId, segments, attachments)
      return
    }
    const prompt = segments.map((s) => s.text).join(' ')
    schedule(() => void produceReplyMock(prompt), delays.think)
  }

  /** Отмена текущего ответа: запрос к Claude и озвучка (barge-in/смена разговора). */
  function cancelReply(): void {
    deps.cancelClaude?.()
    resetTts()
    if (state.streamingReply) setState({ streamingReply: '' })
  }

  // --- Публичные действия -------------------------------------------------

  async function init(): Promise<void> {
    const [settings, conversations] = await Promise.all([
      api['settings:get'](),
      api['conversations:list']()
    ])
    setState({ settings, conversations })
    await refreshMics()
    await refreshModelStatus()
    await refreshWhisperModels()
    await refreshTtsVoices()
    await refreshVoiceCatalog()
    if (conversations.length > 0) {
      await selectConversation(conversations[0].id)
    }
  }

  /**
   * Грузит реальные голоса TTS; если выбранный отсутствует — переключает на
   * дефолтный голос (если он доступен), иначе на первый из списка.
   */
  async function refreshTtsVoices(): Promise<void> {
    const voices = await api['tts:voices']()
    setState({ ttsVoices: voices })
    if (voices.length > 0 && !voices.some((v) => v.id === state.settings.voice)) {
      const fallback = voices.find((v) => v.id === DEFAULT_SETTINGS.voice) ?? voices[0]
      await updateSettings({ voice: fallback.id })
    }
  }

  /** Грузит каталог скачиваемых голосов Piper. */
  async function refreshVoiceCatalog(): Promise<void> {
    const catalog = await api['tts:catalog']()
    setState({ voiceCatalog: catalog.voices, voicesDownloadable: catalog.downloadable })
  }

  /** Грузит список моделей Whisper с размерами (для управления местом). */
  async function refreshWhisperModels(): Promise<void> {
    if (!api['stt:models']) return
    try {
      setState({ whisperModels: await api['stt:models']() })
    } catch (err) {
      console.warn('[stt] не удалось получить список моделей', err)
    }
  }

  /** Удалить установленный голос Piper и обновить списки. */
  async function deleteVoice(id: string): Promise<void> {
    await api['tts:deleteVoice']({ id })
    await refreshVoiceCatalog()
    await refreshTtsVoices()
  }

  /** Удалить файл модели Whisper и обновить список/статус. */
  async function deleteModel(model: WhisperModel): Promise<void> {
    await api['stt:deleteModel']({ model })
    await refreshWhisperModels()
    await refreshModelStatus()
  }

  function downloadVoice(id: string): void {
    if (!deps.startVoiceDownload || id in state.voiceDownloads) return
    setState({ voiceDownloads: { ...state.voiceDownloads, [id]: 0 }, error: null })
    deps.startVoiceDownload(id)
  }

  function applyVoiceProgress(id: string, percent: number): void {
    setState({ voiceDownloads: { ...state.voiceDownloads, [id]: percent } })
  }

  async function applyVoiceDone(id: string): Promise<void> {
    const next = { ...state.voiceDownloads }
    delete next[id]
    setState({ voiceDownloads: next })
    await refreshVoiceCatalog()
    await refreshTtsVoices()
  }

  function applyVoiceError(id: string, message: string): void {
    const next = { ...state.voiceDownloads }
    delete next[id]
    setState({ voiceDownloads: next, error: message })
  }

  async function refreshModelStatus(): Promise<void> {
    if (!deps.getSttStatus) return
    try {
      const status = await deps.getSttStatus()
      setState({ modelPresent: status.present })
    } catch (err) {
      console.warn('[stt] не удалось получить статус модели', err)
    }
  }

  async function refreshMics(): Promise<void> {
    if (!deps.listMics) return
    try {
      setState({ mics: await deps.listMics() })
    } catch (err) {
      console.warn('[audio] не удалось получить список микрофонов', err)
    }
  }

  /** Запуск реального захвата (fire-and-forget); ошибки не рвут UX-цикл. */
  function startCapture(): void {
    if (!audio) return
    void audio
      .start({ deviceId: state.settings.micDeviceId })
      .then(() => refreshMics()) // после разрешения появляются реальные метки
      .catch((err) => console.warn('[audio] запуск захвата не удался', err))
  }

  function stopCapture(): void {
    if (!audio) return
    void audio.stop().catch((err) => console.warn('[audio] остановка захвата не удалась', err))
  }

  function newConversation(): void {
    cancelTimers()
    stopCapture()
    cancelReply()
    dispatchVoice('reset')
    setState({
      activeId: null,
      messages: [],
      liveSegments: [],
      draft: '',
      attachments: [],
      voice: 'idle',
      streamingReply: ''
    })
  }

  async function selectConversation(id: string): Promise<void> {
    cancelTimers()
    stopCapture()
    cancelReply()
    setState({ liveSegments: [], voice: 'idle', streamingReply: '' })
    const res = await api['conversations:get']({ id })
    if (res) {
      setState({ activeId: res.conversation.id, messages: res.messages })
    }
  }

  async function deleteConversation(id: string): Promise<void> {
    await api['conversations:delete']({ id })
    const wasActive = state.activeId === id
    await refreshConversations()
    if (wasActive) {
      const next = state.conversations[0]
      if (next) await selectConversation(next.id)
      else newConversation()
    }
  }

  function openSettings(): void {
    setState({ settingsOpen: true })
  }

  function closeSettings(): void {
    setState({ settingsOpen: false })
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...state.settings, ...patch }
    setState({ settings })
    await api['settings:save'](settings)
  }

  function setDraft(value: string): void {
    setState({ draft: value })
  }

  async function submitText(): Promise<void> {
    const text = state.draft.trim()
    const atts = state.attachments
    if ((!text && atts.length === 0) || state.voice !== 'idle') return
    setState({ error: null })
    await ensureConversation(text || atts.map((a) => a.name).join(', '))
    await persistMessage('u1', composeUserText(text, atts))
    setState({ draft: '', attachments: [] })
    await refreshConversations()
    if (!dispatchVoice('submit_text')) return // idle → thinking
    beginReply(
      [{ speakerId: 1, text: text || 'См. приложенные файлы.' }],
      atts.map((a) => a.id)
    )
  }

  function cancelRequest(): void {
    // Пользователь случайно отправил — отменяем запрос и возвращаемся в idle.
    if (state.voice !== 'thinking' && state.voice !== 'speaking') return
    cancelTimers()
    cancelReply() // отмена запроса к Claude + сброс озвучки + очистка стрима
    dispatchVoice('reset') // thinking/speaking → idle
  }

  async function deleteMessage(id: string): Promise<void> {
    if (!state.activeId) return
    await api['messages:delete']({ conversationId: state.activeId, messageId: id })
    setState({ messages: state.messages.filter((m) => m.id !== id) })
    await refreshConversations()
  }

  async function editMessage(id: string, newText: string): Promise<void> {
    const text = newText.trim()
    if (!state.activeId || !text || state.voice !== 'idle') return
    const idx = state.messages.findIndex((m) => m.id === id)
    if (idx < 0) return
    const role = state.messages[idx].role
    // Удаляем правимое сообщение и все последующие (в БД и в ленте) — перегенерация.
    const removed = state.messages.slice(idx)
    for (const m of removed) {
      await api['messages:delete']({ conversationId: state.activeId, messageId: m.id })
    }
    setState({ messages: state.messages.slice(0, idx), error: null })
    await persistMessage(role, text)
    await refreshConversations()
    if (!dispatchVoice('submit_text')) return // idle → thinking
    beginReply([{ speakerId: 1, text }])
  }

  async function addAttachment(file: File): Promise<void> {
    try {
      const dataBase64 = await fileToBase64(file)
      const info = await api['uploads:add']({ name: file.name, dataBase64 })
      setState({ attachments: [...state.attachments, info] })
    } catch (err) {
      setState({
        error: `Не удалось загрузить файл: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  function removeAttachment(id: string): void {
    setState({ attachments: state.attachments.filter((a) => a.id !== id) })
  }

  function startVoice(): void {
    // mic_press: idle → listening, либо barge-in speaking → listening.
    if (!dispatchVoice('mic_press')) return
    cancelTimers() // на barge-in гасим таймеры озвучки
    deps.cancelTts?.() // и прерываем реальную озвучку
    setState({ liveSegments: [], error: null })
    startCapture() // реальный захват аудио → чанки в main
    if (!sttEnabled) startTranscriptGrowth() // мок-транскрипт только без реального STT
  }

  /** Постепенно наращивает live-транскрипт по кадрам, пока идёт запись. */
  function startTranscriptGrowth(): void {
    const frames = transcriptFrames(state.settings.diarization)
    let i = 0
    const step = (): void => {
      if (state.voice !== 'listening' || i >= frames.length) return
      setState({ liveSegments: frames[i] })
      i += 1
      if (i < frames.length) schedule(step, delays.frame)
    }
    step()
  }

  function stopVoice(): void {
    // stop_listening: listening → transcribing.
    if (!dispatchVoice('stop_listening')) return
    cancelTimers()
    stopCapture()
    // При реальном STT финал придёт событием stt:final → applySttFinal.
    if (sttEnabled) return
    // Мок-путь: имитируем финализацию из накопленного мок-транскрипта.
    const finalSegments =
      state.liveSegments.length > 0 ? state.liveSegments : [{ speakerId: 1, text: '(тишина)' }]
    schedule(() => {
      if (!dispatchVoice('transcribed')) return // transcribing → thinking
      void finalizeAndReply(finalSegments)
    }, delays.transcribe)
  }

  /** Частичная гипотеза распознавания → обновление live-блока (только при записи). */
  function applySttPartial(update: SttUpdate): void {
    if (state.voice !== 'listening') return
    const segments = update.segments.map((s) => ({ speakerId: s.speakerId, text: s.text }))
    if (segments.length > 0) setState({ liveSegments: segments })
  }

  /** Финальный транскрипт: фиксируем реплики и запускаем ответ. */
  async function applySttFinal(update: SttUpdate): Promise<void> {
    if (state.voice !== 'transcribing' && state.voice !== 'listening') return
    // Если стоп ещё не был нажат (быстрый финал) — досрочно уходим из listening.
    if (state.voice === 'listening') dispatchVoice('stop_listening')

    const text = update.text.trim()
    if (update.segments.length === 0 || !text) {
      // Ничего не распознано — тихо возвращаемся в idle.
      dispatchVoice('reset')
      setState({ liveSegments: [] })
      return
    }
    if (!dispatchVoice('transcribed')) return // transcribing → thinking
    const segments = update.segments.map((s) => ({ speakerId: s.speakerId, text: s.text }))
    await finalizeAndReply(segments)
  }

  /** Ошибка распознавания: гасим запись и возвращаемся в idle. */
  function applySttError(message: string): void {
    console.warn('[stt] ошибка распознавания:', message)
    cancelTimers()
    stopCapture()
    if (state.voice === 'listening' || state.voice === 'transcribing') dispatchVoice('error')
    setState({ liveSegments: [], error: message })
  }

  /**
   * Фрагмент ответа Claude: растим отображаемый текст и, если включён TTS,
   * нарезаем поток на предложения и озвучиваем их на лету (не дожидаясь конца).
   */
  function applyClaudeToken(delta: string): void {
    if (state.voice !== 'thinking' && state.voice !== 'speaking') return
    setState({ streamingReply: state.streamingReply + delta })
    if (!autoSpeakActive()) return
    ttsBuffer += delta
    const { chunks, rest } = splitSpeakable(ttsBuffer)
    ttsBuffer = rest
    for (const chunk of chunks) {
      if (!ttsSession) startPipelineSpeaking()
      enqueueSpeak(chunk)
    }
  }

  /** Завершение ответа Claude: фиксируем сообщение; TTS дозвучивает хвост. */
  async function applyClaudeDone(text: string): Promise<void> {
    if (state.voice !== 'thinking' && state.voice !== 'speaking') {
      setState({ streamingReply: '' })
      ttsBuffer = ''
      return
    }

    if (!autoSpeakActive()) {
      // Без автоозвучки — единый ответ, короткий таймер speaking → idle.
      void finishReply(text || state.streamingReply)
      return
    }

    const full = (text || state.streamingReply).trim()
    setState({ streamingReply: '' })
    if (full) {
      await persistMessage('ai', full)
      await refreshConversations()
    }
    // Дозвучиваем незавершённый хвост (закрывая незавершённый блок кода).
    const tail = flushSpeakable(ttsBuffer)
    ttsBuffer = ''
    for (const chunk of tail) {
      if (!ttsSession) startPipelineSpeaking()
      enqueueSpeak(chunk)
    }
    if (ttsSession) {
      ttsSession.sourceComplete = true
      finishTtsSessionIfDone()
    } else {
      // Нечего озвучивать (пустой ответ) — возвращаемся в idle.
      if (state.voice === 'thinking') dispatchVoice('reset')
      else if (state.voice === 'speaking') dispatchVoice('speaking_done')
    }
  }

  /** Ошибка Claude: показываем баннер и возвращаемся в idle. */
  function applyClaudeError(message: string): void {
    console.warn('[claude] ошибка:', message)
    resetTts()
    setState({ streamingReply: '', error: message })
    if (state.voice === 'thinking' || state.voice === 'speaking') dispatchVoice('error')
  }

  function dismissError(): void {
    setState({ error: null })
  }

  function downloadModel(): void {
    if (!deps.startModelDownload || state.downloading) return
    setState({ downloading: true, downloadPercent: 0, error: null })
    deps.startModelDownload()
  }

  function applyDownloadProgress(percent: number): void {
    setState({ downloading: true, downloadPercent: percent })
  }

  function applyDownloadDone(): void {
    setState({ downloading: false, downloadPercent: 100, modelPresent: true })
    void refreshWhisperModels() // обновить размеры в списке моделей
  }

  function applyDownloadError(message: string): void {
    setState({ downloading: false, error: message })
  }

  /** Персист распознанных сегментов как реплик пользователя, затем ответ. */
  async function finalizeAndReply(segments: LiveSegment[]): Promise<void> {
    await ensureConversation(segments[0]?.text ?? '')
    for (const seg of segments) {
      const role = `u${state.settings.diarization ? seg.speakerId : 1}` as MessageRole
      await persistMessage(role, seg.text)
    }
    setState({ liveSegments: [] })
    await refreshConversations()
    beginReply(segments)
  }

  function stopSpeak(): void {
    // stop_speaking: speaking → idle.
    if (!dispatchVoice('stop_speaking')) return
    cancelTimers()
    resetTts()
  }

  /** Один клип озвучки доигран: считаем в сессии, завершаем при готовности. */
  function applyTtsDone(): void {
    if (!ttsSession) return
    ttsSession.played += 1
    finishTtsSessionIfDone()
  }

  /** Ошибка синтеза одного чанка: считаем его «проигранным», чтобы не зависнуть. */
  function applyTtsError(message: string): void {
    console.warn('[tts] ошибка озвучки:', message)
    if (ttsSession) {
      ttsSession.played += 1
      finishTtsSessionIfDone()
    } else if (state.voice === 'speaking') {
      dispatchVoice('speaking_done')
    }
  }

  /** Ручной повтор озвучки сообщения по кнопке (▶/⏹). Вне машины состояний. */
  function replayMessage(id: string, text: string): void {
    if (!ttsEnabled || !deps.speakText) return
    if (state.speakingMessageId === id) {
      resetTts() // повторный клик — стоп
      return
    }
    if (state.voice === 'speaking')
      dispatchVoice('stop_speaking') // прервать авто-озвучку → idle
    else if (state.voice !== 'idle') return // во время записи/распознавания не мешаем

    resetTts()
    ttsSession = { kind: 'replay', messageId: id, queued: 0, played: 0, sourceComplete: false }
    setState({ speakingMessageId: id })
    for (const c of flushSpeakable(text)) enqueueSpeak(c)
    ttsSession.sourceComplete = true
    finishTtsSessionIfDone()
  }

  function dispose(): void {
    cancelTimers()
  }

  return {
    getState,
    subscribe,
    actions: {
      init,
      newConversation,
      selectConversation,
      deleteConversation,
      openSettings,
      closeSettings,
      updateSettings,
      setDraft,
      submitText,
      cancelRequest,
      deleteMessage,
      editMessage,
      addAttachment,
      removeAttachment,
      startVoice,
      stopVoice,
      stopSpeak,
      applySttPartial,
      applySttFinal,
      applySttError,
      applyClaudeToken,
      applyClaudeDone,
      applyClaudeError,
      dismissError,
      downloadModel,
      applyDownloadProgress,
      applyDownloadDone,
      applyDownloadError,
      applyTtsDone,
      applyTtsError,
      replayMessage,
      downloadVoice,
      deleteVoice,
      deleteModel,
      applyVoiceProgress,
      applyVoiceDone,
      applyVoiceError,
      dispose
    }
  }
}
