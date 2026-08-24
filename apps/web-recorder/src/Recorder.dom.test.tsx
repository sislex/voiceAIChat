// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { PREVIEW_ACTION_COMMAND_TYPE } from '@shared/previewActions'
import { Recorder } from './Recorder'

/*
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, PREVIEW_PAGE_LOADING_TYPE, PREVIEW_PAGE_READY_TYPE, type PreviewDomAction } from '@shared/previewActions'
import { PREVIEW_INSPECTOR_MESSAGE_TYPE } from '@shared/previewInspector'
import { WEB_RECORDER_MESSAGE_TYPE, type WebRecorderHostMessage } from '@shared/webRecorder'
import { browserId } from '@shared/webRecorder'

type Step = { kind: 'click' | 'type'; selector: string; text: string; sensitive?: boolean }
const RECORD = 'voicechat.preview.record.v1'
const sameOrigin = window.location.origin
const validUrl = (value: string): string | null => { try { const url = new URL(value.trim()); return /^https?:$/.test(url.protocol) ? url.toString() : null } catch { return null } }

/** Standalone recorder: its state and preview iframe never belong to ChatAI. * /
export function Recorder(): JSX.Element {
  const [url, setUrl] = useState<string | null>(null); const [draft, setDraft] = useState(''); const [recording, setRecording] = useState(false)
  const [steps, setSteps] = useState<Step[]>([]); const [error, setError] = useState<string | null>(null); const frame = useRef<HTMLIFrameElement>(null); const pageReady = useRef(false); const currentUrl = useRef<string | null>(null)
  const reply = (message: object): void => window.parent.postMessage({ type: WEB_RECORDER_MESSAGE_TYPE, ...message }, '*')
  useEffect(() => { reply({ kind: 'ready' }); const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || event.data?.type !== WEB_RECORDER_MESSAGE_TYPE) return
    const message = event.data as WebRecorderHostMessage
    if (message.kind === 'set-url') { pageReady.current = false; currentUrl.current = message.url; setUrl(message.url); setDraft(message.url ?? ''); setError(null); reply({ kind:'page-status', status:message.url ? 'loading' : 'empty', url:message.url }) }
    if (message.kind === 'run-action') { if (!pageReady.current || !frame.current?.contentWindow) { reply({ kind:'action-result', requestId:message.requestId, ok:false, error:'Страница ещё загружается.' }); return }; frame.current.contentWindow.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: message.requestId, action: message.action }, sameOrigin) }
  }; window.addEventListener('message', receive); return () => window.removeEventListener('message', receive) }, [])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: RECORD, enabled: recording }, sameOrigin) }, [recording, url])
  useEffect(() => { const receive = (event: MessageEvent) => {
    if (event.origin !== sameOrigin || event.source !== frame.current?.contentWindow) return
    const data = event.data
    if (data?.type === PREVIEW_PAGE_READY_TYPE) { pageReady.current = true; reply({ kind:'page-status', status:'ready', url:currentUrl.current }); return }
    if (data?.type === PREVIEW_PAGE_LOADING_TYPE) { pageReady.current = false; reply({ kind:'page-status', status:'loading', url:currentUrl.current }); return }
    if (data?.type === PREVIEW_ACTION_RESULT_TYPE) { reply({ kind: 'action-result', requestId:data.requestId, ok:data.ok, ...(data.result ? {result:data.result}:{ }), ...(data.error ? {error:data.error}:{ }) }); return }
    if (data?.type === PREVIEW_INSPECTOR_MESSAGE_TYPE) { reply({ kind:'element', element:data.payload }); return }
    if (data?.type === RECORD && data.step && (data.step.kind === 'click' || data.step.kind === 'type') && typeof data.step.selector === 'string') setSteps((old) => [...old, { kind:data.step.kind, selector:data.step.selector, text:typeof data.step.text === 'string' ? data.step.text : '', sensitive:data.step.sensitive === true }])
  }; window.addEventListener('message', receive); return () => window.removeEventListener('message', receive) }, [])
  const open = (): void => { const next = validUrl(draft); if (draft && !next) { setError('Введите адрес с протоколом http:// или https://'); return }; setUrl(next); reply({ kind:'save-url', url:next }); setError(null) }
  const run = async (): Promise<void> => { if (!frame.current?.contentWindow || !url) return; for (const step of steps) { if (step.sensitive) { setError('Чувствительное значение не сохранено'); return }; frame.current.contentWindow.postMessage({type:PREVIEW_ACTION_COMMAND_TYPE,requestId:'scenario-'+browserId(),action:step as PreviewDomAction},sameOrigin) } }
  return <section className="webpreview" aria-label="Web Reader">
    <form className="webpreview-bar" onSubmit={(event) => { event.preventDefault(); open() }}>
      <label className="webpreview-address"><span className="vc-sr-only">Адрес превью</span><input type="url" value={draft} placeholder="https://example.com" onChange={(event) => setDraft(event.target.value)} /></label>
      <button className="vc-btn vc-btn--secondary">Открыть</button>
      <button className="vc-btn vc-btn--secondary" type="button" disabled={!url} onClick={() => setRecording((value) => !value)}>{recording ? 'Остановить запись' : 'Записать сценарий'}</button>
    </form>
    {error && <p className="webpreview-error" role="alert">{error}</p>}
    {steps.length > 0 && <section className="webpreview-scenario" aria-label="Сценарий автотеста"><button className="vc-btn vc-btn--secondary" onClick={() => void run()}>Запустить</button><ol>
      {steps.map((step, index) => <li key={index}><code>{step.kind}</code><input aria-label={'Селектор шага ' + (index + 1)} value={step.selector} onChange={(event) => setSteps((all) => all.map((item, i) => i === index ? { ...item, selector: event.target.value } : item))} />
        {step.kind === 'type' && <input aria-label={'Значение шага ' + (index + 1)} value={step.sensitive ? '••••••' : step.text} readOnly={step.sensitive} onChange={(event) => setSteps((all) => all.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} />}
        {step.sensitive && <em>секрет не сохранён</em>}</li>)}
    </ol></section>}
    {url ? <iframe ref={frame} className="webpreview-frame" src={'/api/preview?url=' + encodeURIComponent(url)} title="Предпросмотр сайта" onLoad={() => { setTimeout(() => { if (pageReady.current) return; let message = 'Сайт недоступен или вернул страницу, которую Web Reader не может прочитать.'; try { const body = frame.current?.contentDocument?.body?.textContent?.trim(); if (body) { const parsed = JSON.parse(body) as { message?: unknown }; if (typeof parsed.message === 'string') message = parsed.message } } catch { /* не-JSON страница без клиентского моста * / }; reply({ kind:'page-status', status:'error', url, error:message }) }, 0) }} onError={() => { pageReady.current = false; reply({ kind:'page-status', status:'error', url, error:'Не удалось загрузить сайт: сетевая ошибка.' }) }} /> : <div className="webpreview-empty">Укажите http/https-адрес проекта</div>}
  </section>
}
*/

const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')

afterEach(() => {
  vi.restoreAllMocks()
  if (originalCryptoDescriptor) Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor)
  else delete (globalThis as { crypto?: Crypto }).crypto
})

describe('Recorder scenario', () => {
  it('runs every step with a distinct requestId without randomUUID', () => {
    let byte = 0
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++byte); return bytes } })
    render(<Recorder />)
    fireEvent.change(screen.getByPlaceholderText('https://example.com'), { target: { value: 'http://example.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Открыть' }))
    const frame = screen.getByTitle('Предпросмотр сайта') as HTMLIFrameElement
    const postMessage = vi.spyOn(frame.contentWindow as Window, 'postMessage')
    for (const step of [
      { kind: 'click', selector: '#buy', text: '' },
      { kind: 'type', selector: '#search', text: 'shoes' }
    ]) {
      fireEvent(window, new MessageEvent('message', {
        origin: window.location.origin,
        source: frame.contentWindow,
        data: { type: 'voicechat.preview.record.v1', step }
      }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Запустить' }))
    const commands = postMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .filter((message) => message.type === PREVIEW_ACTION_COMMAND_TYPE)
    expect(commands).toHaveLength(2)
    expect(commands.every((command) => command.requestId?.startsWith('scenario-'))).toBe(true)
    expect(new Set(commands.map((command) => command.requestId))).toHaveLength(2)
  })
})
