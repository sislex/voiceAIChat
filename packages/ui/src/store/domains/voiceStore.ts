// voiceStore — клиентский голосовой конвейер и только он (CHAT-236).
//
// Он не создаёт разговор, не сохраняет сообщение, не выбирает LLM, не знает про
// сайдбар и не меняет адрес: готовую транскрипцию он публикует событием, а что
// с ней делать — решает AppRuntime. Переходы автомата берутся из чистого
// `transition()` (@shared/stateMachine); стор лишь исполняет их эффекты.

import type { SttUpdate } from '@shared/ipc'
import { transition, type VoiceEvent } from '@shared/stateMachine'
import type { VoiceState } from '@shared/types'
import type { LiveSegment } from '../../lib/view'
import { flushSpeakable, splitSpeakable } from '../../lib/sentences'
import { VadDetector } from '../../lib/vad'
import type { SttPort, TtsPort, VoiceInputPort } from '../../clients/types'
import type { EffectiveVoiceSettings } from '../contracts'
import { createStoreCore, type Store } from '../createStore'
import { DEFAULT_DELAYS, type PipelineDelays, transcriptFrames } from '../mockPipeline'

/** Пауза перед авто-стартом записи после ответа (hands-free). */
const HANDS_FREE_GAP_MS = 400

export interface VoiceDomainState {
  /** Текущее состояние голосового автомата. */
  voice: VoiceState
  /** Живые сегменты распознавания (растут во время записи). */
  liveSegments: LiveSegment[]
  /** id сообщения, которое озвучивается по кнопке (ручной повтор); null — нет. */
  speakingMessageId: string | null
}

/** Готовая транскрипция: её адресует Chat, а не сам голосовой стор. */
export interface VoiceTranscriptFinal {
  text: string
  segments: LiveSegment[]
}

export interface VoiceActions {
  /** Переход автомата; false — переход недопустим из текущего состояния. */
  dispatch(event: VoiceEvent): boolean
  /**
   * Восстановление живого хода после reconnect/F5: сервер прислал незавершённый
   * ход разговора, локального нажатия не было. Возвращает false, если автомат
   * занят своим циклом и трогать его нельзя.
   */
  restoreThinking(): boolean
  startVoice(): void
  stopVoice(): void
  stopSpeak(): void
  /** Кадр энергии микрофона: barge-in во время озвучки и hands-free-пауза. */
  applyMicEnergy(rms: number): void
  applySttPartial(update: SttUpdate): void
  applySttFinal(update: SttUpdate): Promise<void>
  applySttError(message: string): void
  applyTtsAudioReceived(): void
  applyTtsDone(): void
  applyTtsError(message: string): void
  /** Ручной повтор озвучки сообщения по кнопке (▶/⏹). Вне машины состояний. */
  replayMessage(id: string, text: string): void
  // --- Интерфейс для владельца хода (Chat через AppRuntime) ---
  /** Начало нового хода: сброс буфера озвучки. */
  beginTurn(): void
  /** Фрагмент ответа: нарезка на предложения и озвучка на лету. */
  speakDelta(delta: string): void
  /** Хвост стрима: досинтезировать и закрыть сессию. false — озвучивать нечего. */
  finishStreamedTurn(): boolean
  /** Готовый ответ целиком (мок-путь и режим без стриминга озвучки). */
  speakReply(text: string): void
  autoSpeakActive(): boolean
  /** Прервать озвучку (barge-in, смена разговора, отмена хода). */
  cancelSpeech(): void
  stopCapture(): void
  cancelTimers(): void
  /** Смена разговора: локальная запись и воспроизведение прекращаются. */
  resetForChatSwitch(): void
  reset(): void
}

export type VoiceStore = Store<VoiceDomainState, VoiceActions>

export interface VoiceDeps {
  /** Захват микрофона. Отсутствует в тестах/headless → запись пропускается. */
  voiceInput?: VoiceInputPort | null
  stt: SttPort
  tts: TtsPort
  /** Актуальные голосовые настройки (владелец — settingsStore). */
  getSettings: () => EffectiveVoiceSettings
  /** Источник времени (замеры перцептивной задержки). */
  now?: () => number
  /** Задержки мок-пайплайна (тесты ускоряют их). */
  delays?: Partial<PipelineDelays>
  /** Готовая транскрипция — её адресует AppRuntime. */
  onTranscriptFinal?: (final: VoiceTranscriptFinal) => void | Promise<void>
  /** Клиентские тайминги STT/TTS для консоли активности. */
  onTiming?: (kind: 'stt' | 'tts', label: string, ms: number) => void
  /** Ошибка распознавания/озвучки — баннер оболочки (null снимает баннер). */
  onError?: (message: string | null) => void
  /** Список микрофонов обновляется после выдачи разрешения. */
  onMicsChanged?: () => void
}

function initialState(): VoiceDomainState {
  return { voice: 'idle', liveSegments: [], speakingMessageId: null }
}

/** Сессия синтеза: очередь чанков и признак «источник закончился». */
interface TtsSession {
  kind: 'pipeline' | 'replay'
  messageId: string | null
  queued: number
  played: number
  sourceComplete: boolean
}

export function createVoiceStore(deps: VoiceDeps): VoiceStore {
  const core = createStoreCore<VoiceDomainState>(initialState())
  const { getState, setState } = core
  const now = deps.now ?? Date.now
  const delays: PipelineDelays = { ...DEFAULT_DELAYS, ...deps.delays }
  const audio = deps.voiceInput ?? null
  const sttEnabled = deps.stt.enabled
  const ttsEnabled = deps.tts.enabled

  // --- VAD: barge-in (speaking) и hands-free авто-пауза (listening) --------
  const bargeVad = new VadDetector()
  const handsVad = new VadDetector()
  let bargeMonitorStop: (() => void) | null = null

  let ttsSession: TtsSession | null = null
  let ttsBuffer = '' // накопление токенов для нарезки на предложения
  let sttStartAt = 0 // момент остановки записи (реальный STT)
  let ttsReqAt = 0 // момент запроса синтеза первого чанка ответа
  let ttsAudioLogged = false

  function settings(): EffectiveVoiceSettings {
    return deps.getSettings()
  }

  /** Держит энерго-монитор включённым ровно в состоянии speaking при bargeIn. */
  function syncBargeMonitor(): void {
    const want = getState().voice === 'speaking' && settings().bargeIn && !!audio?.monitor
    if (want && !bargeMonitorStop) {
      bargeVad.reset()
      // Плейсхолдер, пока промис стартует (чтобы не запустить два монитора).
      bargeMonitorStop = () => {}
      void audio!
        .monitor!(settings().micDeviceId, (r) => applyMicEnergy(r))
        .then((stop) => {
          if (getState().voice === 'speaking' && !core.disposed()) bargeMonitorStop = stop
          else stop() // уже вышли из speaking, пока стартовали
        })
        .catch(() => {
          bargeMonitorStop = null
        })
    } else if (!want && bargeMonitorStop) {
      bargeMonitorStop()
      bargeMonitorStop = null
    }
  }

  /** Голосовой переход через машину состояний. Возвращает true, если он допустим. */
  function dispatchVoice(event: VoiceEvent): boolean {
    const prev = getState().voice
    const res = transition(prev, event)
    if (res.ok) {
      setState({ voice: res.state })
      syncBargeMonitor()
      // Hands-free: ход завершён (speaking → idle) → снова слушаем.
      if (res.state === 'idle' && prev === 'speaking' && settings().handsFree) {
        core.timer(() => {
          if (getState().voice === 'idle' && settings().handsFree) startVoice()
        }, HANDS_FREE_GAP_MS)
      }
    }
    return res.ok
  }

  function applyMicEnergy(rmsValue: number): void {
    const { voice } = getState()
    if (voice === 'speaking' && settings().bargeIn) {
      if (bargeVad.push(rmsValue) === 'speech-start') startVoice() // barge-in
    } else if (voice === 'listening' && settings().handsFree) {
      if (handsVad.push(rmsValue) === 'speech-end') stopVoice() // авто-пауза
    }
  }

  /** Запуск реального захвата (fire-and-forget); ошибки не рвут UX-цикл. */
  function startCapture(): void {
    if (!audio) return
    handsVad.reset() // новая сессия слушания — сбрасываем детектор паузы
    void audio
      .start({
        deviceId: settings().micDeviceId,
        onEnergy: (r) => applyMicEnergy(r) // hands-free авто-пауза по тишине
      })
      .then(() => deps.onMicsChanged?.()) // после разрешения появляются реальные метки
      .catch((err) => console.warn('[audio] запуск захвата не удался', err))
  }

  function stopCapture(): void {
    if (!audio) return
    void audio.stop().catch((err) => console.warn('[audio] остановка захвата не удалась', err))
  }

  core.onDispose(() => {
    stopCapture()
    bargeMonitorStop?.()
    bargeMonitorStop = null
    deps.tts.cancel?.()
  })

  // --- Очередь синтеза по предложениям --------------------------------------

  function autoSpeakActive(): boolean {
    return ttsEnabled && !!deps.tts.speak && settings().autoSpeak
  }

  function enqueueSpeak(text: string): void {
    if (!ttsEnabled || !deps.tts.speak || !ttsSession) return
    const t = text.trim()
    if (!t) return
    if (ttsReqAt === 0) {
      ttsReqAt = now() // засекаем генерацию речи (запрос → первое аудио)
      ttsAudioLogged = false
    }
    ttsSession.queued += 1
    deps.tts.speak(t, settings().voice)
  }

  function logTiming(kind: 'stt' | 'tts', label: string, ms: number): void {
    if (!settings().showConsole) return
    deps.onTiming?.(kind, label, ms)
  }

  function applyTtsAudioReceived(): void {
    if (ttsReqAt > 0 && !ttsAudioLogged) {
      logTiming('tts', 'Генерация речи', now() - ttsReqAt)
      ttsAudioLogged = true
    }
  }

  /** Начинает pipeline-озвучку: сессия + переход thinking → speaking. */
  function startPipelineSpeaking(): void {
    if (ttsSession) return
    ttsSession = { kind: 'pipeline', messageId: null, queued: 0, played: 0, sourceComplete: false }
    if (getState().voice === 'thinking') dispatchVoice('reply_ready')
  }

  /** Завершает сессию, когда все чанки синтезированы и проиграны. */
  function finishTtsSessionIfDone(): void {
    const s = ttsSession
    if (!s || !s.sourceComplete || s.played < s.queued) return
    ttsSession = null
    ttsReqAt = 0
    ttsAudioLogged = false
    if (s.kind === 'pipeline' && getState().voice === 'speaking') dispatchVoice('speaking_done')
    if (s.kind === 'replay' && getState().speakingMessageId) setState({ speakingMessageId: null })
  }

  /** Сброс TTS: очередь синтеза/воспроизведения, сессия, буфер. */
  function resetTts(): void {
    ttsSession = null
    ttsBuffer = ''
    ttsReqAt = 0
    ttsAudioLogged = false
    deps.tts.cancel?.()
    if (getState().speakingMessageId) setState({ speakingMessageId: null })
  }

  // --- Запись ---------------------------------------------------------------

  function startVoice(): void {
    if (!deps.stt.inputEnabled) return
    // mic_press: idle → listening, либо barge-in speaking → listening.
    if (!dispatchVoice('mic_press')) return
    core.clearTimers() // на barge-in гасим таймеры озвучки
    deps.tts.cancel?.() // и прерываем реальную озвучку
    setState({ liveSegments: [] })
    deps.onError?.(null)
    startCapture()
    if (!sttEnabled) startTranscriptGrowth() // мок-транскрипт только без реального STT
  }

  /** Постепенно наращивает live-транскрипт по кадрам, пока идёт запись. */
  function startTranscriptGrowth(): void {
    const frames = transcriptFrames(settings().diarization)
    let i = 0
    const step = (): void => {
      if (getState().voice !== 'listening' || i >= frames.length) return
      setState({ liveSegments: frames[i] })
      i += 1
      if (i < frames.length) core.timer(step, delays.frame)
    }
    step()
  }

  function stopVoice(): void {
    // stop_listening: listening → transcribing.
    if (!dispatchVoice('stop_listening')) return
    core.clearTimers()
    stopCapture()
    // При реальном STT финал придёт событием stt:final → applySttFinal.
    if (sttEnabled) {
      sttStartAt = now() // засекаем распознавание (стоп → финал)
      return
    }
    // Мок-путь: имитируем финализацию из накопленного мок-транскрипта.
    const finalSegments =
      getState().liveSegments.length > 0 ? getState().liveSegments : [{ speakerId: 1, text: '(тишина)' }]
    core.timer(() => {
      if (!dispatchVoice('transcribed')) return // transcribing → thinking
      void publishFinal(finalSegments)
    }, delays.transcribe)
  }

  async function publishFinal(segments: LiveSegment[]): Promise<void> {
    setState({ liveSegments: [] })
    await deps.onTranscriptFinal?.({ text: segments.map((s) => s.text).join(' '), segments })
  }

  function applySttPartial(update: SttUpdate): void {
    if (getState().voice !== 'listening') return
    const segments = update.segments.map((s) => ({ speakerId: s.speakerId, text: s.text }))
    if (segments.length > 0) setState({ liveSegments: segments })
  }

  async function applySttFinal(update: SttUpdate): Promise<void> {
    const { voice } = getState()
    // Поздний ответ уже закрытой записи игнорируем.
    if (voice !== 'transcribing' && voice !== 'listening') return
    // Если стоп ещё не был нажат (быстрый финал) — досрочно уходим из listening.
    if (voice === 'listening') dispatchVoice('stop_listening')

    if (sttStartAt > 0) {
      logTiming('stt', 'Распознавание речи', now() - sttStartAt)
      sttStartAt = 0
    }
    const text = update.text.trim()
    if (update.segments.length === 0 || !text) {
      // Ничего не распознано — тихо возвращаемся в idle.
      dispatchVoice('reset')
      setState({ liveSegments: [] })
      return
    }
    if (!dispatchVoice('transcribed')) return // transcribing → thinking
    await publishFinal(update.segments.map((s) => ({ speakerId: s.speakerId, text: s.text })))
  }

  function applySttError(message: string): void {
    console.warn('[stt] ошибка распознавания:', message)
    core.clearTimers()
    stopCapture()
    const { voice } = getState()
    if (voice === 'listening' || voice === 'transcribing') dispatchVoice('error')
    setState({ liveSegments: [] })
    deps.onError?.(message)
  }

  function stopSpeak(): void {
    // stop_speaking: speaking → idle.
    if (!dispatchVoice('stop_speaking')) return
    core.clearTimers()
    resetTts()
  }

  function applyTtsDone(): void {
    if (!ttsSession) return
    ttsSession.played += 1
    finishTtsSessionIfDone()
  }

  function applyTtsError(message: string): void {
    console.warn('[tts] ошибка озвучки:', message)
    if (ttsSession) {
      ttsSession.played += 1
      finishTtsSessionIfDone()
    } else if (getState().voice === 'speaking') {
      dispatchVoice('speaking_done')
    }
  }

  function replayMessage(id: string, text: string): void {
    if (!ttsEnabled || !deps.tts.speak) return
    if (getState().speakingMessageId === id) {
      resetTts() // повторный клик — стоп
      return
    }
    if (getState().voice === 'speaking') dispatchVoice('stop_speaking') // прервать авто-озвучку → idle
    else if (getState().voice !== 'idle') return // во время записи/распознавания не мешаем

    resetTts()
    ttsSession = { kind: 'replay', messageId: id, queued: 0, played: 0, sourceComplete: false }
    setState({ speakingMessageId: id })
    for (const c of flushSpeakable(text)) enqueueSpeak(c)
    ttsSession.sourceComplete = true
    finishTtsSessionIfDone()
  }

  return {
    getState,
    subscribe: core.subscribe,
    dispose: core.dispose,
    actions: {
      dispatch: dispatchVoice,
      restoreThinking() {
        if (getState().voice !== 'idle') return false
        setState({ voice: 'thinking' })
        return true
      },
      startVoice,
      stopVoice,
      stopSpeak,
      applyMicEnergy,
      applySttPartial,
      applySttFinal,
      applySttError,
      applyTtsAudioReceived,
      applyTtsDone,
      applyTtsError,
      replayMessage,
      beginTurn() {
        ttsBuffer = ''
      },
      speakDelta(delta) {
        if (!autoSpeakActive()) return
        ttsBuffer += delta
        const { chunks, rest } = splitSpeakable(ttsBuffer)
        ttsBuffer = rest
        for (const chunk of chunks) {
          if (!ttsSession) startPipelineSpeaking()
          enqueueSpeak(chunk)
        }
      },
      finishStreamedTurn() {
        // Дозвучиваем незавершённый хвост (закрывая незавершённый блок кода).
        const tail = flushSpeakable(ttsBuffer)
        ttsBuffer = ''
        for (const chunk of tail) {
          if (!ttsSession) startPipelineSpeaking()
          enqueueSpeak(chunk)
        }
        if (!ttsSession) return false
        ttsSession.sourceComplete = true
        finishTtsSessionIfDone()
        return true
      },
      speakReply(text) {
        if (autoSpeakActive()) {
          ttsSession = { kind: 'pipeline', messageId: null, queued: 0, played: 0, sourceComplete: false }
          enqueueSpeak(text)
          ttsSession.sourceComplete = true
          finishTtsSessionIfDone()
          return
        }
        core.timer(() => {
          dispatchVoice('speaking_done') // speaking → idle (мок-таймер)
        }, delays.speak)
      },
      autoSpeakActive,
      cancelSpeech: resetTts,
      stopCapture,
      cancelTimers: () => core.clearTimers(),
      resetForChatSwitch() {
        core.clearTimers()
        stopCapture()
        resetTts()
        dispatchVoice('reset')
        // Чат открывают заново — автомат обязан оказаться в idle, даже если
        // переход `reset` из текущего состояния не описан.
        setState({ liveSegments: [], voice: 'idle' })
      },
      reset() {
        core.clearTimers()
        stopCapture()
        resetTts()
        core.resetState(initialState())
      }
    }
  }
}

