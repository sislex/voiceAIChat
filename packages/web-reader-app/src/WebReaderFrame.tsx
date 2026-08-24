import { useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewElementPayload } from '@shared/previewInspector'
import type { WebRecorderHostMessage } from '@shared/webRecorder'
import { browserId } from '@shared/browserId'
import { createReaderHostBridge, type ReaderHostBridge, type ReaderHostRegistration } from './hostBridge'

// Host-адаптер самостоятельного iframe-приложения Web Reader. Владеет только
// транспортом: iframe /web-recorder/, проверка event.origin/event.source,
// cookie-гейт ensurePreview. Вся логика lifecycle — в createReaderHostBridge;
// чат, LLM и сохранение previewUrl остаются у вызывающего host. Платформа
// (origin и подписка на message) инъецируется — пакет не трогает window сам.

export interface WebReaderFramePlatform {
  /** Origin приложения: им проверяется event.origin и подписывается postMessage. */
  origin: string
  subscribeMessages: (listener: (event: MessageEvent) => void) => () => void
}

export interface WebReaderFrameProps {
  conversationId: string
  conversationUrl: string | null
  projectUrl: string | null
  platform: WebReaderFramePlatform
  /** Выпуск preview-cookie по Bearer-токену (web); в desktop моста нет — гейт открыт. */
  ensurePreview?: (() => Promise<boolean>) | undefined
  onSave: (url: string | null) => Promise<void>
  onSelectElement?: ((element: PreviewElementPayload) => void) | undefined
  /** Актуальная регистрация iframe (или null): host сверяет по ней MCP-команды. */
  onRegisterHost?: ((registration: ReaderHostRegistration | null) => void) | undefined
  /** Адрес standalone-сборки Reader; production и dev-proxy раздают /web-recorder/. */
  src?: string
}

export function WebReaderFrame({ conversationId, conversationUrl, projectUrl, platform, ensurePreview, onSave, onSelectElement, onRegisterHost, src = '/web-recorder/' }: WebReaderFrameProps): JSX.Element {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [previewSession, setPreviewSession] = useState<'pending' | 'ready' | 'failed'>('ready')
  const [retryKey, setRetryKey] = useState(0)
  const gateSequence = useRef(0)
  const url = conversationUrl ?? projectUrl
  const callbacks = useRef({ onSave, onSelectElement, onRegisterHost })
  callbacks.current = { onSave, onSelectElement, onRegisterHost }

  // Мост живёт со смонтированным iframe одного разговора: смена разговора
  // размонтирует компонент (key у вызывающего) и dispose-ит старый lifecycle.
  const bridge: ReaderHostBridge = useMemo(() => createReaderHostBridge({
    conversationId,
    newId: browserId,
    send: (message: WebRecorderHostMessage) => {
      frameRef.current?.contentWindow?.postMessage(message, platform.origin)
    },
    capabilities: ['mcp-actions', 'diagnostics', 'inspector', 'recording'],
    onRegistration: (registration) => callbacks.current.onRegisterHost?.(registration),
    onSaveUrl: (nextUrl) => void callbacks.current.onSave(nextUrl),
    onElement: (element) => callbacks.current.onSelectElement?.(element)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [conversationId])

  useEffect(() => {
    const unsubscribe = platform.subscribeMessages((event) => {
      if (event.origin !== platform.origin || event.source !== frameRef.current?.contentWindow) return
      bridge.receive(event.data)
    })
    return () => {
      unsubscribe()
      bridge.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge])

  // Cookie-гейт: целевой URL уходит Reader-у только после успешного ensurePreview.
  useEffect(() => {
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
    void ensurePreview().then(
      (ok) => {
        if (!alive || sequence !== gateSequence.current) return
        if (!ok) { setPreviewSession('failed'); return }
        setPreviewSession('ready')
        bridge.setUrl(url)
      },
      () => { if (alive && sequence === gateSequence.current) setPreviewSession('failed') }
    )
    return () => { alive = false }
  }, [bridge, ensurePreview, url, retryKey])

  return <section className="webpreview" aria-label="Web Reader">
    {url && previewSession === 'pending' && <div className="webpreview-empty" role="status">Подключение Web Preview…</div>}
    {url && previewSession === 'failed' && <div className="webpreview-empty" role="alert"><span>Не удалось подготовить Web Preview.</span><button className="vc-btn vc-btn--secondary" type="button" onClick={() => setRetryKey((value) => value + 1)}>Повторить</button></div>}
    <iframe key={conversationId} ref={frameRef} className="webpreview-frame" src={src} title="Web Reader" aria-hidden={previewSession !== 'ready'} />
  </section>
}
