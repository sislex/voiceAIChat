import type { WebReaderFrameProps } from './panelContract'
export type { WebReaderFrameProps, WebReaderFramePlatform } from './panelContract'
import { useEffect, useRef, useState } from 'react'
import type { PreviewAction } from '@shared/previewActions'
import type { WebRecorderHostMessage } from '@shared/webRecorder'
import { browserId } from '@shared/browserId'
import { prepareReaderPreview } from './preparePreview'
import { ReaderActionHistory } from './ReaderActionHistory'
import { previewActionProgressLabel } from './actionLabel'
import { createReaderHostBridge, type ReaderHostBridge, type ReaderHostRegistration, type PreviewActionOutcome } from './hostBridge'


export function WebReaderFrame({ conversationId, conversationUrl, projectUrl, platform, ensurePreview, onSave, onSelectElement, onAreaScreenshot, onRegisterHost, actions = [], onRepeatAction, onRevealAction, onClearActions, pageErrorCount = 0, onAsk, onControl, manual = false, confirmRequest = null, onConfirmAction, onDenyAction, actionError = null, onRetryAction, pageError, onAskError, pendingAction = null, onPageTitle, src = '/web-recorder/' }: WebReaderFrameProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [previewSession, setPreviewSession] = useState<'pending' | 'ready' | 'failed'>('ready')
  const [retryKey, setRetryKey] = useState(0)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // A dismissed page error stays hidden until a different error text arrives.
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  // Long-running model actions show elapsed seconds so the person knows the panel is busy, not stuck.
  const [pendingSeconds, setPendingSeconds] = useState(0)
  // Progress of a multi-step sequence: "шаг 2 из 5" tells the person how long the routine still is.
  const [sequenceProgress, setSequenceProgress] = useState<{ done: number; total: number; action: PreviewAction } | null>(null)
  // Report of this panel session goes to the chat draft: the person forwards it to the task or the team.
  const registrationRef = useRef<ReaderHostRegistration | null>(null)
  const reportToChat = async (): Promise<void> => {
    const registration = registrationRef.current
    if (!registration) return
    const outcome = await registration.run({ kind: 'report' })
    const report = outcome.ok ? outcome.result as { history?: string[]; checks?: { summary: string; pass: boolean }[]; passed?: number; failed?: number; actions?: number } : null
    if (!report) return
    const lines = [
      `Отчёт Web Reader: действий ${report.actions ?? 0}, проверок пройдено ${report.passed ?? 0}, не пройдено ${report.failed ?? 0}.`,
      ...(report.history?.length ? [`Страницы: ${report.history.join(', ')}`] : []),
      ...(report.checks ?? []).map((item) => `${item.pass ? '✓' : '✗'} ${item.summary}`)
    ]
    callbacks.current.onAsk?.(lines.join('\n'))
  }
  useEffect(() => {
    if (!pendingAction) { setPendingSeconds(0); return }
    const started = Date.now()
    const timer = setInterval(() => setPendingSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [pendingAction])
  const retrySave = useRef<(() => void) | null>(null)
  const retryOpen = useRef<(() => void) | null>(null)
  const gateSequence = useRef(0)
  const savedByReader = useRef<string | null | undefined>(undefined)
  const url = conversationUrl ?? projectUrl
  const callbacks = useRef({ onSave, onSelectElement, onAreaScreenshot, onRegisterHost, ensurePreview, onPageTitle, onAsk, onControl })
  callbacks.current = { onSave, onSelectElement, onAreaScreenshot, onRegisterHost, ensurePreview, onPageTitle, onAsk, onControl }

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
      onRegistration: (registration) => { registrationRef.current = registration ? { ...registration } : null; return callbacks.current.onRegisterHost?.(registration ? {
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
      } : null) },
      onSaveUrl: (nextUrl) => { void save(nextUrl).catch(() => {}) },
      onPageTitle: (title) => callbacks.current.onPageTitle?.(title),
      onAsk: (text) => callbacks.current.onAsk?.(text),
      onControl: (manual) => callbacks.current.onControl?.(manual),
      onSequenceProgress: (progress) => { if (alive) setSequenceProgress(progress) },
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
      callbacks.current.onPageTitle?.(null)
      callbacks.current.onControl?.(false)
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
    {pageError && pageError !== dismissedError && <div className="webpreview-error webpreview-page-error" role="alert"><span>{pageError}{pageErrorCount > 1 && <small> и ещё {pageErrorCount - 1}</small>}</span>{onAskError && <button className="vc-btn vc-btn--secondary vc-btn--sm" type="button" onClick={() => onAskError(pageError)}>Исправить</button>}<button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" aria-label="Скрыть ошибку страницы" onClick={() => setDismissedError(pageError)}>×</button></div>}
    {pendingAction && <p className="webpreview-live" role="status" aria-live="polite"><span className="webpreview-live__dot" aria-hidden="true" />Ассистент {sequenceProgress ? `выполняет шаг ${sequenceProgress.done + 1} из ${sequenceProgress.total}: ${previewActionProgressLabel(sequenceProgress.action)}` : previewActionProgressLabel(pendingAction)}…{pendingSeconds >= 3 && <span className="webpreview-live__time"> {pendingSeconds} с</span>}</p>}
    {confirmRequest && <div className="webpreview-confirm" role="alertdialog" aria-live="assertive" aria-label="Подтверждение действия ассистента"><span>Ассистент хочет: {previewActionProgressLabel(confirmRequest.action)} — {confirmRequest.reason} ({confirmRequest.target}). Разрешить?</span><button className="vc-btn vc-btn--primary vc-btn--sm" type="button" onClick={() => onConfirmAction?.({ ...confirmRequest.action, confirm: true } as PreviewAction)}>Разрешить</button><button className="vc-btn vc-btn--secondary vc-btn--sm" type="button" onClick={() => onDenyAction?.()}>Отказать</button></div>}
    {actionError && !pendingAction && <div className="webpreview-error webpreview-action-error" role="status" aria-live="polite"><span>Ассистент не смог: {previewActionProgressLabel(actionError.action)} — {actionError.error}</span>{onRetryAction && !/Только я управляю/.test(actionError.error) && <button className="vc-btn vc-btn--secondary vc-btn--sm" type="button" onClick={() => onRetryAction(actionError.action)}>Повторить</button>}</div>}
    <ReaderActionHistory key={`history-${conversationId}`} actions={actions} onRepeat={onRepeatAction} onReveal={onRevealAction} onClear={onClearActions} currentUrl={conversationUrl} manual={manual} />
    {actions.length > 0 && onAsk && <p className="webpreview-report"><button className="vc-btn vc-btn--ghost vc-btn--sm" type="button" disabled={manual} title={manual ? 'Управляете вы: отчёт соберётся после возврата управления' : undefined} onClick={() => { void reportToChat() }}>Отчёт в чат</button></p>}
    {previewSession === 'pending' && <div className="webpreview-empty" role="status">Подключение Web Preview…</div>}
    {previewSession === 'failed' && <div className="webpreview-empty" role="alert"><span>Не удалось подготовить Web Preview.</span><button className="vc-btn vc-btn--secondary" type="button" onClick={() => retryOpen.current ? retryOpen.current() : setRetryKey((value) => value + 1)}>Повторить</button></div>}
    <iframe key={conversationId} ref={frameRef} className="webpreview-frame" src={src} title="Web Reader" aria-hidden={previewSession !== 'ready'} tabIndex={previewSession === 'ready' ? 0 : -1} {...{ inert: previewSession !== 'ready' ? '' : undefined }} />
  </section>
}
