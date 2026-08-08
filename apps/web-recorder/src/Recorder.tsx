import { useEffect, useRef, useState } from 'react'
import { PREVIEW_ACTION_COMMAND_TYPE, PREVIEW_ACTION_RESULT_TYPE, type PreviewDomAction } from '@shared/previewActions'
import { PREVIEW_INSPECTOR_MESSAGE_TYPE } from '@shared/previewInspector'
import { WEB_RECORDER_MESSAGE_TYPE, type WebRecorderHostMessage } from '@shared/webRecorder'

type Step = { kind: 'click' | 'type'; selector: string; text: string; sensitive?: boolean }
const RECORD = 'voicechat.preview.record.v1'
const sameOrigin = window.location.origin
const validUrl = (value: string): string | null => { try { const url = new URL(value.trim()); return /^https?:$/.test(url.protocol) ? url.toString() : null } catch { return null } }

/** Standalone recorder: its state and preview iframe never belong to ChatAI. */
export function Recorder(): JSX.Element {
  const [url, setUrl] = useState<string | null>(null); const [draft, setDraft] = useState(''); const [recording, setRecording] = useState(false)
  const [steps, setSteps] = useState<Step[]>([]); const [error, setError] = useState<string | null>(null); const frame = useRef<HTMLIFrameElement>(null)
  const reply = (message: object): void => window.parent.postMessage({ type: WEB_RECORDER_MESSAGE_TYPE, ...message }, '*')
  useEffect(() => { reply({ kind: 'ready' }); const receive = (event: MessageEvent) => {
    if (event.source !== window.parent || event.data?.type !== WEB_RECORDER_MESSAGE_TYPE) return
    const message = event.data as WebRecorderHostMessage
    if (message.kind === 'set-url') { setUrl(message.url); setDraft(message.url ?? ''); setError(null) }
    if (message.kind === 'run-action') frame.current?.contentWindow?.postMessage({ type: PREVIEW_ACTION_COMMAND_TYPE, requestId: message.requestId, action: message.action }, sameOrigin)
  }; window.addEventListener('message', receive); return () => window.removeEventListener('message', receive) }, [])
  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: RECORD, enabled: recording }, sameOrigin) }, [recording, url])
  useEffect(() => { const receive = (event: MessageEvent) => {
    if (event.origin !== sameOrigin || event.source !== frame.current?.contentWindow) return
    const data = event.data
    if (data?.type === PREVIEW_ACTION_RESULT_TYPE) { reply({ kind: 'action-result', requestId:data.requestId, ok:data.ok, ...(data.result ? {result:data.result}:{ }), ...(data.error ? {error:data.error}:{ }) }); return }
    if (data?.type === PREVIEW_INSPECTOR_MESSAGE_TYPE) { reply({ kind:'element', element:data.payload }); return }
    if (data?.type === RECORD && data.step && (data.step.kind === 'click' || data.step.kind === 'type') && typeof data.step.selector === 'string') setSteps((old) => [...old, { kind:data.step.kind, selector:data.step.selector, text:typeof data.step.text === 'string' ? data.step.text : '', sensitive:data.step.sensitive === true }])
  }; window.addEventListener('message', receive); return () => window.removeEventListener('message', receive) }, [])
  const open = (): void => { const next = validUrl(draft); if (draft && !next) { setError('Введите адрес с протоколом http:// или https://'); return }; setUrl(next); reply({ kind:'save-url', url:next }); setError(null) }
  const run = async (): Promise<void> => { if (!frame.current?.contentWindow || !url) return; for (const step of steps) { if (step.sensitive) { setError('Чувствительное значение не сохранено'); return }; frame.current.contentWindow.postMessage({type:PREVIEW_ACTION_COMMAND_TYPE,requestId:'scenario-'+crypto.randomUUID(),action:step as PreviewDomAction},sameOrigin) } }
  return <section className="webpreview" aria-label="Веб-рекордер">
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
    {url ? <iframe ref={frame} className="webpreview-frame" src={'/api/preview?url=' + encodeURIComponent(url)} title="Предпросмотр сайта" /> : <div className="webpreview-empty">Укажите http/https-адрес проекта</div>}
  </section>
}
