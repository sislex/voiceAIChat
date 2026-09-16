import { useEffect, useRef, useState } from 'react'
import { Button, Dialog } from '@voicechat/ui-kit'
import {
  DEFAULT_SETTINGS, ONBOARDING_STEPS, initialOnboarding, parseOnboarding, onboardingTransition,
  type OnboardingState, type OnboardingStep, type OnboardingResult, type Settings
} from '@shared/types'
import type { RendererApi, RendererOnboardingBridge } from '@shared/ipc'
import { allowedModels, clampModel, isProviderAllowed } from '@shared/llmAccess'
import { createBrowserAudioController } from '../audio/browserAudio'

export interface OnboardingModalProps {
  modelPresent: boolean
  modelLabel: string
  downloading: boolean
  downloadPercent: number
  onDownloadModel: () => void
  hasVoice: boolean
  onDone: () => void
  open?: boolean
  settings?: Settings
  onSave?: (state: OnboardingState) => Promise<void>
  api?: RendererApi
  bridge?: RendererOnboardingBridge
  unavailableSteps?: OnboardingStep[]
}

const labels: Record<OnboardingStep, string> = {
  microphone: 'Микрофон / Whisper', tts: 'Озвучка TTS',
  llm: 'Claude / Codex', machine: 'Машина', voice: 'Голосовой запрос'
}
const statuses = {
  idle: 'Не проверено', checking: 'Проверяется', success: 'Работает',
  warning: 'Требует внимания', error: 'Ошибка', skipped: 'Пропущено'
}

/** Only fixed messages are persisted: transport errors can contain credentials. */
export function OnboardingModal(props: OnboardingModalProps): JSX.Element | null {
  const settings = props.settings ?? DEFAULT_SETTINGS
  const api = props.api ?? window.api
  const bridge = props.bridge ?? window.onboarding
  const [state, setState] = useState(() => {
    const parsed = parseOnboarding(settings.onboarding, true)
    if (parsed) return parsed
    const initial = initialOnboarding()
    if (settings.onboarding != null) initial.results.microphone = {
      status: 'warning', diagnostic: 'Сохранённый прогресс повреждён или устарел. Проверьте шаги заново.'
    }
    return initial
  })
  const current = useRef(state)
  const [saveError, setSaveError] = useState(false)
  const [phase, setPhase] = useState('')
  const [recording, setRecording] = useState(false)
  const operation = useRef<AbortController | null>(null)
  const operationStep = useRef<OnboardingStep | null>(null)
  const stopRecording = useRef<(() => void) | null>(null)
  const saveQueue = useRef(Promise.resolve())
  const alive = useRef(true)
  const saveVersion = useRef(0)
  const configuration = JSON.stringify({
    microphone: JSON.stringify([settings.whisperModel, settings.micDeviceId]),
    tts: JSON.stringify([settings.voice]),
    llm: JSON.stringify([settings.llmProvider, settings.model, settings.codexModel, settings.llmEngineId, settings.execTarget]),
    machine: JSON.stringify([settings.execTarget]),
    voice: JSON.stringify([settings.whisperModel, settings.micDeviceId, settings.voice,
      settings.llmProvider, settings.model, settings.codexModel, settings.llmEngineId, settings.execTarget])
  })
  const previousConfiguration = useRef('')

  function persist(next: OnboardingState): void {
    next = { ...next, configuration: JSON.parse(configuration) as Record<OnboardingStep, string> }
    current.current = next
    setState(next)
    const version = ++saveVersion.current
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      if (!alive.current) return
      if (!props.onSave) throw new Error('No persistence adapter')
      await props.onSave(next)
    }).then(() => {
      if (alive.current && version === saveVersion.current) setSaveError(false)
    }, () => {
      if (alive.current) setSaveError(true)
    })
  }
  function cancel(): void {
    operation.current?.abort()
    operation.current = null
    stopRecording.current = null
    setRecording(false)
  }
  function interrupt(): void {
    cancel()
    const restored = parseOnboarding(current.current, true)!
    persist(restored)
  }
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; operation.current?.abort() }
  }, [])
  useEffect(() => {
    if (configuration === previousConfiguration.current) return
    previousConfiguration.current = configuration
    const fingerprints = JSON.parse(configuration) as Record<OnboardingStep, string>
    const next = parseOnboarding(current.current, true)!
    let changed = false
    for (const step of ONBOARDING_STEPS) {
      if (next.configuration?.[step] !== undefined && next.configuration[step] !== fingerprints[step]) {
        next.results[step] = { status: 'warning', diagnostic: 'Настройки изменились. Повторите проверку.' }
        changed = true
      }
    }
    if (changed) cancel()
    next.configuration = fingerprints
    persist(next)
  }, [configuration])
  useEffect(() => {
    if (props.open === false && operation.current) interrupt()
  }, [props.open])
  useEffect(() => {
    if (!navigator.permissions?.query) return
    let disposed = false
    let permission: PermissionStatus | undefined
    const changed = (): void => {
      if (disposed || permission?.state === 'granted') return
      if (operationStep.current === 'microphone' || operationStep.current === 'voice') operation.current?.abort()
      if (current.current.results.microphone.status === 'success') {
        persist({ ...onboardingTransition(current.current, 'microphone', { status: 'warning', diagnostic: 'Разрешение микрофона изменилось. Проверьте запись снова.' }), current: current.current.current })
      }
    }
    void navigator.permissions.query({ name: 'microphone' as PermissionName }).then(value => {
      if (disposed) return
      permission = value
      permission.addEventListener('change', changed)
      changed()
    }).catch(() => {})
    return () => { disposed = true; permission?.removeEventListener('change', changed) }
  }, [])

  const unavailable = JSON.stringify(props.unavailableSteps ?? [])
  useEffect(() => {
    for (const step of JSON.parse(unavailable) as OnboardingStep[]) {
      if (current.current.results[step].status === 'success') {
        persist({ ...onboardingTransition(current.current, step, { status: 'warning', diagnostic: 'Ресурс или права доступа изменились. Проверьте шаг снова.' }), current: current.current.current })
      }
    }
  }, [unavailable])

  function transition(step: OnboardingStep, result: OnboardingResult): void {
    persist(onboardingTransition(current.current, step, result))
  }

  async function check(step: OnboardingStep): Promise<void> {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    operationStep.current = step
    const signal = controller.signal
    const cleanup: Array<() => void> = []
    let timer = setTimeout(() => controller.abort(), 120_000)
    cleanup.push(() => clearTimeout(timer))
    let cleaned = false
    const release = (): void => {
      if (cleaned) return
      cleaned = true
      cleanup.reverse().forEach(fn => fn())
    }
    signal.addEventListener('abort', release, { once: true })
    let playback: AudioContext | null = null
    let unlocked: Promise<void> = Promise.resolve()
    let activeStage: OnboardingStep = step
    const recordResult = (target: OnboardingStep, result: OnboardingResult): void => {
      if (target === step) transition(target, result)
      else persist({ ...current.current, results: { ...current.current.results, [target]: result } })
    }
    const llmResult = (result: OnboardingResult): void => recordResult('llm', result)
    transition(step, { status: 'checking', diagnostic: '' })
    const ensureActive = (): void => { if (signal.aborted) throw new Error('Cancelled') }
    const wait = <T,>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const abort = (): void => reject(new Error('Cancelled'))
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
    let stageDescription = labels[step]
    const announce = (message: string): void => {
      ensureActive()
      clearTimeout(timer)
      timer = setTimeout(() => controller.abort(), 120_000)
      stageDescription = message
      setPhase(message)
    }
    let diagnostic: ReturnType<RendererOnboardingBridge['open']> | undefined
    const connection = (): ReturnType<RendererOnboardingBridge['open']> => {
      ensureActive()
      if (!diagnostic) {
        if (!bridge) throw new Error('Host unavailable')
        diagnostic = bridge.open()
        cleanup.push(() => diagnostic?.close())
      }
      return diagnostic
    }
    const waitEvent = <T,>(subscribe: (resolve: (value: T) => void, reject: () => void) => Array<() => void>): Promise<T> =>
      new Promise((resolve, reject) => {
        ensureActive()
        const offs: Array<() => void> = []
        const done = (value: T): void => { offs.forEach(off => off()); resolve(value) }
        const fail = (): void => { offs.forEach(off => off()); reject(new Error('Service failed')) }
        offs.push(...subscribe(done, fail))
        signal.addEventListener('abort', fail, { once: true })
        offs.push(() => signal.removeEventListener('abort', fail))
        cleanup.push(fail)
      })
    async function recognize(): Promise<string> {
      activeStage = 'microphone'
      announce('Запись: произнесите короткую фразу, затем нажмите «Завершить запись».')
      const capabilities = await wait(api['system:capabilities']())
      const status = await wait(api['stt:status']())
      ensureActive()
      if (!capabilities.stt.available || !status.present) throw new Error('STT unavailable')
      const conn = connection()
      const audio = createBrowserAudioController(conn.audio)
      if (!audio) throw new Error('Microphone unavailable')
      cleanup.push(() => { void audio.stop().catch(() => {}) })
      const result = waitEvent<string>((resolve, reject) => [
        conn.stt.onFinal(update => update.text.trim() ? resolve(update.text.trim()) : reject()),
        conn.stt.onError(reject)
      ])
      // Attach a rejection handler before awaiting permission.
      void result.catch(() => {})
      await wait(audio.start({ deviceId: settings.micDeviceId }))
      ensureActive()
      setRecording(true)
      stopRecording.current = () => {
        setRecording(false)
        stopRecording.current = null
        announce('Whisper: распознавание…')
        void audio.stop().catch(() => controller.abort())
      }
      return result
    }
    async function answer(text: string): Promise<string> {
      activeStage = 'llm'
      announce('Claude / Codex: проверка прав и авторизации…')
      const access = await wait(api['llm:access']())
      const login = await wait(api['auth:status']())
      ensureActive()
      const providers = (['claude', 'codex'] as const).filter(p =>
        isProviderAllowed(access, p) && allowedModels(access, p).length > 0 && login[p].loggedIn)
      const summary = (['claude', 'codex'] as const).map(p =>
        `${p}: ${!isProviderAllowed(access, p) || !allowedModels(access, p).length ? 'запрещён' : login[p].loggedIn ? 'вход подтверждён' : 'нужен вход'}`).join('; ')
      announce(summary)
      const provider = providers.includes(settings.llmProvider) ? settings.llmProvider : providers[0]
      if (!provider) {
        llmResult({ status: 'error', diagnostic: summary + '. Ответ LLM недоступен.' })
        throw new Error('LLM unavailable')
      }
      const model = provider === 'codex' ? settings.codexModel : settings.model
      const selectedModel = clampModel(access, provider, model)
      if (selectedModel === null) throw new Error('LLM unavailable')
      const conversation = await wait(api['conversations:create']({ title: 'Проверка голосового чата' }))
      ensureActive()
      await wait(api['conversations:setExecTarget']({
        id: conversation.id, execTarget: settings.execTarget,
        llmEngineId: settings.llmEngineId, llmProvider: provider, llmModel: selectedModel
      }))
      ensureActive()
      await wait(api['messages:add']({
        conversationId: conversation.id, role: 'u1', text, time: new Date().toLocaleTimeString()
      }))
      ensureActive()
      const conn = connection()
      cleanup.push(() => conn.claude.cancel({ conversationId: conversation.id }))
      const result = waitEvent<string>((resolve, reject) => [
        conn.claude.onDone(m => {
          if (m.conversationId !== conversation.id) return
          if (!m.text.trim() || (m.engine && m.engine !== provider)) return reject()
          llmResult({ status: 'success', diagnostic: summary + `. Ответ получен через ${provider}.` })
          resolve(m.text)
        }),
        conn.claude.onError(m => { if (m.conversationId === conversation.id) reject() })
      ])
      conn.claude.send({ conversationId: conversation.id, segments: [{ speakerId: 1, text }], execTarget: settings.execTarget })
      return result
    }
    async function play(text: string): Promise<void> {
      activeStage = 'tts'
      announce('TTS: синтез и воспроизведение…')
      const capabilities = await wait(api['system:capabilities']())
      const voices = await wait(api['tts:voices']())
      ensureActive()
      if (!capabilities.tts.available || !voices.length || !globalThis.AudioContext) throw new Error('TTS unavailable')
      const conn = connection()
      if (!playback) throw new Error('Playback unavailable')
      const context = playback
      await wait(unlocked)
      ensureActive()
      if (context.state !== 'running') throw new Error('Playback blocked')
      const bytes = waitEvent<ArrayBuffer>((resolve, reject) => [conn.tts.onAudio(m => resolve(m.audio)), conn.tts.onError(reject)])
      conn.tts.speak({ text, voice: settings.voice })
      const buffer = await wait(context.decodeAudioData(await bytes))
      ensureActive()
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      cleanup.push(() => { source.onended = null; try { source.stop() } catch { /* Already ended. */ } })
      await waitEvent<void>((resolve) => {
        source.onended = () => resolve()
        source.start()
        return [() => { source.onended = null }]
      })
    }
    try {
      if ((step === 'tts' || step === 'voice') && globalThis.AudioContext) {
        // Resume during the click, before the first network round trip.
        playback = new AudioContext()
        const ownedPlayback = playback
        cleanup.push(() => { void ownedPlayback.close().catch(() => {}) })
        unlocked = playback.resume()
        void unlocked.catch(() => {})
      }
      if (step === 'machine') {
        announce('Проверка выбранной машины…')
        const machines = await wait(api['agents:list']())
        ensureActive()
        const selected = settings.execTarget
        const machine = machines.find(m => m.id === selected)
        transition(step, selected && selected !== 'none'
          ? { status: machine?.online ? 'success' : 'error', diagnostic: machine?.online ? 'Выбранная машина доступна.' : 'Машина отключена или недоступна вашему пользователю. Проверьте LLM отдельно.' }
          : { status: 'warning', diagnostic: 'Удалённая машина не выбрана. Доступность ответа проверяется на шаге Claude / Codex.' })
      } else if (step === 'llm') {
        await answer('Ответь кратко: проверка связи.')
      } else {
        if (step === 'tts') await play('Проверка озвучки голосового чата.')
        else {
          const transcript = await recognize()
          ensureActive()
          if (step === 'voice') {
            recordResult('microphone', { status: 'success', diagnostic: 'Микрофон записал звук, Whisper распознал речь.' })
            const reply = await answer(transcript)
            ensureActive()
            await play(reply)
            ensureActive()
            recordResult('tts', { status: 'success', diagnostic: 'Синтез и завершение воспроизведения подтверждены.' })
          }
        }
        ensureActive()
        transition(step, { status: 'success', diagnostic: step === 'voice'
          ? 'Подтверждены запись, распознавание, ответ LLM и завершение воспроизведения.'
          : step === 'tts' ? 'Синтез и завершение воспроизведения подтверждены.' : 'Микрофон записал звук, Whisper распознал речь.' })
      }
    } catch (error) {
      const errorName = error && typeof error === 'object' && 'name' in error && typeof error.name === 'string' ? error.name : ''
      const permission = activeStage === 'microphone' && ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(errorName)
        ? 'Микрофон недоступен: проверьте разрешение, подключение и использование другим приложением. '
        : activeStage === 'tts' && errorName === 'NotAllowedError'
          ? 'Воспроизведение запрещено. Разрешите звук в браузере и повторите проверку. '
          : ''
      if (alive.current && operation.current === controller) {
        const failed: OnboardingResult = { status: 'error', diagnostic: signal.aborted
          ? 'Проверка отменена или превышено время ожидания. Повторите или пропустите шаг. Этап: ' + stageDescription
          : activeStage === 'llm' && current.current.results.llm.status === 'error'
            ? current.current.results.llm.diagnostic
            : ('Проверка не завершилась. ' + permission + 'Этап: ' + stageDescription + ' Проверьте подключение и настройки этого сервиса; повторите или пропустите шаг.').slice(0, 600) }
        if (step === 'voice') recordResult(activeStage, failed)
        transition(step, failed)
      }
    } finally {
      signal.removeEventListener('abort', release)
      release()
      if (operation.current === controller) {
        operation.current = null
        setRecording(false)
        stopRecording.current = null
      }
    }
  }

  if (props.open === false) return null
  const step = state.current
  const result = state.results[step]
  return (
    <Dialog title={labels[step] + " — первый запуск"} ariaLabel="Добро пожаловать" size="md" padded className="ob-dialog"
      testId="onboarding-overlay" onClose={() => { interrupt(); props.onDone() }}
      footer={<div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <Button onClick={() => { interrupt(); props.onDone() }}>Продолжить в чате</Button>
        <Button variant="ghost" onClick={() => { cancel(); persist(initialOnboarding()) }}>Сбросить только прогресс</Button>
      </div>}>
      <div className="mdbody" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <p>Настройка необязательна. Мастер можно закрыть и возобновить из настроек.</p>
        <p>При сбое голосовых функций используйте текст, если доступен Claude или Codex. Наличие модели или голоса ещё не подтверждает работу.</p>
        {saveError && <div role="alert">Прогресс не сохранён. Текущие результаты доступны до закрытия приложения.
          <Button onClick={() => persist(current.current)}>Повторить сохранение</Button></div>}
        <nav aria-label="Шаги первого запуска" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {ONBOARDING_STEPS.map((id, index) => <Button key={id} aria-current={id === step ? 'step' : undefined}
            onClick={() => persist({ ...current.current, current: id })}>{index + 1}. {labels[id]} — {statuses[state.results[id].status]}</Button>)}
        </nav>
        <h2>{labels[step]}</h2>
        <p role="status">{statuses[result.status]}{result.diagnostic ? ': ' + result.diagnostic : ''}</p>
        {operation.current && <p role="status">{phase}</p>}
        {step === 'microphone' && <p>{props.modelPresent ? 'Модель установлена: ' + props.modelLabel : 'Модель отсутствует.'}
          {!props.modelPresent && <Button onClick={props.onDownloadModel} disabled={props.downloading}>Скачать модель</Button>}
          {props.downloading && <span data-testid="ob-progress"> Скачивание… {props.downloadPercent}%</span>}</p>}
        {step === 'tts' && !props.hasVoice && <p>Установленные голоса отсутствуют. Проверьте настройки TTS Runner.</p>}
        <p>{step === 'voice' ? 'Кнопка запускает запись, отправку распознанного текста в отдельный тестовый чат и озвучку ответа.'
          : step === 'microphone' ? 'Кнопка запросит разрешение микрофона и начнёт запись.'
          : step === 'llm' ? 'Кнопка проверит оба провайдера и отправит короткий запрос через выбранный доступный провайдер.'
          : step === 'tts' ? 'Кнопка запустит синтез и воспроизведение тестовой фразы.' : 'Проверяется доступность выбранной машины.'}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button variant="primary" disabled={!!operation.current} onClick={() => void check(step)}>Проверить / повторить</Button>
          {recording && <Button onClick={() => stopRecording.current?.()}>Завершить запись</Button>}
          <Button onClick={() => { interrupt(); transition(step, { status: 'skipped', diagnostic: 'Пропущено пользователем; работоспособность не проверена.' }) }}>Пропустить шаг</Button>
        </div>
      </div>
    </Dialog>
  )
}
