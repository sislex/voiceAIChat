import type { WebReaderFrameProps } from './panelContract'
export type { WebReaderFrameProps, WebReaderFramePlatform } from './panelContract'
import { useEffect, useRef, useState } from 'react'
import type { PreviewAction } from '@shared/previewActions'
import type { WebRecorderHostMessage } from '@shared/webRecorder'
import { browserId } from '@shared/browserId'
import { prepareReaderPreview } from './preparePreview'
import { createReaderHostBridge, type ReaderHostBridge, type PreviewActionOutcome } from './hostBridge'

function previewActionLabel(action: PreviewAction): string {
  switch (action.kind) {
    case 'open': return `Открыл ${action.url}`
    case 'click': return `Нажал ${action.text ?? action.selector ?? 'элемент'}`
    case 'type': return `Ввёл текст в ${action.selector}`
    case 'read': return `Прочитал ${action.selector ?? 'страницу'}`
    case 'accessibility': return `Inspected browser accessibility: ${action.selector}`
    case 'probe': return `Осмотрел элемент ${action.selector}`
    case 'audit': return 'Проверил страницу'
    case 'find': return `Нашёл ${action.text ?? action.selector ?? 'элементы'}`
    case 'screenshot': return 'Сделал снимок страницы'
    case 'errors': return 'Проверил ошибки страницы'
    case 'back': return 'Перешёл назад'
    case 'forward': return 'Перешёл вперёд'
    default: return `Выполнил: ${action.kind}`
  }
}

export function WebReaderFrame({ conversationId, conversationUrl, projectUrl, platform, ensurePreview, onSave, onSelectElement, onAreaScreenshot, onRegisterHost, actions = [], onRepeatAction, pageError, onAskError, src = '/web-recorder/' }: WebReaderFrameProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [previewSession, setPreviewSession] = useState<'pending' | 'ready' | 'failed'>('ready')
  const [retryKey, setRetryKey] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const retrySave = useRef<(() => void) | null>(null)
  const retryOpen = useRef<(() => void) | null>(null)
  const gateSequence = useRef(0)
  const savedByReader = useRef<string | null | undefined>(undefined)
  const url = conversationUrl ?? projectUrl
  const callbacks = useRef({ onSave, onSelectElement, onAreaScreenshot, onRegisterHost, ensurePreview })
  callbacks.current = { onSave, onSelectElement, onAreaScreenshot, onRegisterHost, ensurePreview }

  // Мост живёт со смонтированным iframe одного разговора и создаётся в эффекте:
  // dispose необратим, а StrictMode в dev прогоняет mount → cleanup → mount —
  // мост из useMemo оставался бы мёртвым после повторного mount.
  const bridgeRef = useRef<ReaderHostBridge | null>(null)
  const [bridgeGeneration, setBridgeGeneration] = useState(0)
  useEffect(() => {
    savedByReader.current = undefined
    setSaveError(null)
    setSaving(false)
    const preparation = new AbortController()
    let saveSequence = 0
    let alive = true
    let modelSequence = 0
    let openingGate: Promise<boolean> | null = null
    let saveQueue: Promise<void> = Promise.resolve()
    let lastSave: { url: string | null; promise: Promise<void> } | undefined
    const save = (nextUrl: string | null): Promise<void> => {
      if (lastSave?.url === nextUrl) return lastSave.promise
      savedByReader.current = nextUrl
      const saveToken = ++saveSequence
      retrySave.current = null
      setSaving(true)
      setSaveError(null)
      // Callback принадлежит разговору в момент запроса: позднее сохранение
      // не должно использовать callback уже выбранного другого разговора.
      const saver = callbacks.current.onSave
      const promise = saveQueue.catch(() => {}).then(() => saver(nextUrl)).catch(error => {
        if (alive && saveToken === saveSequence) {
          if (savedByReader.current === nextUrl) savedByReader.current = undefined
          setSaveError('Страница открыта, но её адрес не удалось сохранить.')
          retrySave.current = () => { void save(nextUrl).catch(() => {}) }
        }
        throw error
      }).finally(() => {
        if (alive && saveToken === saveSequence) setSaving(false)
      })
      lastSave = { url: nextUrl, promise }
      saveQueue = promise
      void promise.catch(() => { if (lastSave?.promise === promise) lastSave = undefined })
      return promise
    }
    const bridge = createReaderHostBridge({
      conversationId,
      newId: browserId,
      send: (message: WebRecorderHostMessage) => {
        const target = frameRef.current?.contentWindow
        if (!target) throw new Error('Reader iframe недоступен')
        target.postMessage(message, platform.origin)
      },
      capabilities: ['mcp-actions', 'diagnostics', 'inspector', 'recording'],
      onRegistration: (registration) => callbacks.current.onRegisterHost?.(registration ? {
        ...registration,
        run: async function runRegistered(action: PreviewAction): Promise<PreviewActionOutcome> {
          if (action.kind !== 'open') {
            const sequence = modelSequence
            if (openingGate && !await openingGate) return { ok: false, error: 'Не удалось подготовить Web Preview.' }
            if (!alive || sequence !== modelSequence) return { ok: false, error: 'Адрес страницы изменён — повтори действие.' }
            return registration.run(action)
          }
          retryOpen.current = null
          const sequence = ++modelSequence
          const gateToken = ++gateSequence.current
          const ensure = callbacks.current.ensurePreview
          if (ensure) {
            setPreviewSession('pending')
            const gate = prepareReaderPreview(ensure, preparation.signal)
            openingGate = gate
            const ok = await gate
            if (openingGate === gate) openingGate = null
            if (!alive || sequence !== modelSequence || gateToken !== gateSequence.current || registration.registrationId !== bridge.registrationId()) return { ok: false, error: 'Открытие страницы отменено.' }
            if (!ok) { setPreviewSession('failed'); retryOpen.current = () => { void runRegistered(action) }; return { ok: false, error: 'Не удалось подготовить Web Preview.' } }
          }
          setPreviewSession('ready')
          const outcome = await registration.run(action)
          if (!outcome.ok || !alive || sequence !== modelSequence || gateToken !== gateSequence.current) return outcome
          const result = outcome.result as { url?: string } | undefined
          try { await save(result?.url ?? action.url) }
          catch { return { ok: false, error: 'Страница открыта, но её адрес не удалось сохранить.' } }
          return outcome
        }
      } : null),
      onSaveUrl: (nextUrl) => { void save(nextUrl).catch(() => {}) },
      onElement: (element) => callbacks.current.onSelectElement?.(element),
      onAreaScreenshot: (shot) => callbacks.current.onAreaScreenshot?.(shot)
    })
    bridgeRef.current = bridge
    setBridgeGeneration((value) => value + 1)
    const unsubscribe = platform.subscribeMessages((event) => {
      if (event.origin !== platform.origin || event.source !== frameRef.current?.contentWindow) return
      bridge.receive(event.data)
    })
    return () => {
      alive = false
      preparation.abort()
      modelSequence++
      retrySave.current = null
      retryOpen.current = null
      unsubscribe()
      bridge.dispose()
      if (bridgeRef.current === bridge) bridgeRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  // Cookie-гейт: целевой URL уходит Reader-у только после успешного ensurePreview.
  useEffect(() => {
    const bridge = bridgeRef.current
    // Первый commit проходит с generation 0 (state моста ещё не применён) —
    // гейт запускается один раз на поколение моста, иначе ensurePreview дублировался бы.
    if (!bridge || bridgeGeneration === 0) return
    // Эхо сохранённой навигации не должно запускать cookie-гейт и новый iframe.
    if (url === savedByReader.current && previewSession === 'ready') return
    const sequence = ++gateSequence.current
    if (!url) {
      setPreviewSession('ready')
      bridge.setUrl(null)
      return
    }
    if (!ensurePreview) {
      setPreviewSession('ready')
      bridge.setUrl(url)
      return
    }
    setPreviewSession('pending')
    bridge.setUrl(null)
    let alive = true
    const preparation = new AbortController()
    void prepareReaderPreview(ensurePreview, preparation.signal).then(
      (ok) => {
        if (!alive || sequence !== gateSequence.current) return
        if (!ok) { setPreviewSession('failed'); return }
        setPreviewSession('ready')
        bridge.setUrl(url)
      },
      () => { if (alive && sequence === gateSequence.current) setPreviewSession('failed') }
    )
    return () => { alive = false; preparation.abort() }
  }, [bridgeGeneration, ensurePreview, url, retryKey])

  return <section className="webpreview" aria-label="Web Reader">
    {saving && <p role="status">Сохраняем адрес страницы…</p>}
    {saveError && <div className="webpreview-error" role="alert"><span>{saveError}</span><button className="vc-btn vc-btn--secondary" type="button" onClick={() => retrySave.current?.()}>Повторить сохранение</button></div>}
    {pageError && <div className="webpreview-error" role="alert"><span>{pageError}</span>{onAskError && <button className="vc-btn vc-btn--secondary vc-btn--sm" type="button" onClick={() => onAskError(pageError)}>Исправить</button>}</div>}
    {actions.length > 0 && <section className="webpreview-scenario" aria-label="Действия ассистента">
      <strong>Действия ассистента</strong>
      <ol>{actions.map((item) => <li key={item.id}><span>{previewActionLabel(item.action)}</span>{onRepeatAction && <button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" onClick={() => onRepeatAction(item.action)}>Повторить</button>}</li>)}</ol>
    </section>}
    {previewSession === 'pending' && <div className="webpreview-empty" role="status">Подключение Web Preview…</div>}
    {previewSession === 'failed' && <div className="webpreview-empty" role="alert"><span>Не удалось подготовить Web Preview.</span><button className="vc-btn vc-btn--secondary" type="button" onClick={() => retryOpen.current ? retryOpen.current() : setRetryKey((value) => value + 1)}>Повторить</button></div>}
    <iframe key={conversationId} ref={frameRef} className="webpreview-frame" src={src} title="Web Reader" aria-hidden={previewSession !== 'ready'} tabIndex={previewSession === 'ready' ? 0 : -1} {...{ inert: previewSession !== 'ready' ? '' : undefined }} />
  </section>
}
