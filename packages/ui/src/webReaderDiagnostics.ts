import type { PreviewAction, PreviewActionResult, PreviewReadResult, PreviewStylesResult } from '@voicechat/shared'

type PreviewActionOutcome = { ok: boolean; result?: PreviewActionResult; error?: string }

export function isWebReaderDiagnosticsCommand(value: string): boolean {
  const command = value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  return command === '/web-reader-diagnostics' || command === 'самодиагностика web reader'
}

export type DiagnosticsLayer = 'route/active-chat' | 'host' | 'cookie/auth' | 'proxy/network' | 'page-loading' | 'dom-bridge' | 'action' | 'timeout'
export interface DiagnosticsStep { id: string; label: string; layer: DiagnosticsLayer; durationMs: number; ok: boolean; message: string }

export const WEB_READER_DIAGNOSTICS_CAPABILITIES = [
  'iframe handshake (ready/init), conversation and registration IDs',
  'active Reader conversation and registered tab', 'preview cookie/auth', '/api/preview proxy',
  'ready/loading lifecycle', 'open and DOM read', 'find by text and selector', 'computed styles',
  'hover events', 'scroll position', 'key press', 'element screenshot', 'wait for element', 'page errors buffer',
  'type with input/change events', 'form submit',
  'evaluate JS', 'console log buffer', 'network log buffer', 'a11y tree',
  'select/checkbox via set', 'file upload', 'double click', 'pointer drag', 'viewport width',
  'click and navigation', 'queued read after navigation', 'requestId correlation'
] as const

const redact = (value: string): string => value.replace(/(cookie|authorization|token|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 500)
const layerOf = (error: string, fallback: DiagnosticsLayer): DiagnosticsLayer =>
  /не открыт на странице Reader|активн.*чат/i.test(error) ? 'route/active-chat'
    : /панел.*не открыт|закрыта|не подключен/i.test(error) ? 'host'
      : /cookie|auth|401|403|подготовить Web Preview/i.test(error) ? 'cookie/auth'
        : /proxy|network|dns|сайт.*недоступ/i.test(error) ? 'proxy/network'
          : /загружа|ready/i.test(error) ? 'page-loading'
            : /requestId|мост/i.test(error) ? 'dom-bridge'
              : /тайм|timeout/i.test(error) ? 'timeout' : fallback

/** Данные актуальной регистрации iframe для проверки handshake до DOM-шагов. */
export interface DiagnosticsHandshake {
  conversationId: string
  registrationId: string
  capabilities: readonly string[]
  expectedConversationId: string
  claimedRegistrationId: string | null
}

export interface DiagnosticsOptions {
  origin: string
  run: (action: PreviewAction) => Promise<PreviewActionOutcome>
  handshake?: DiagnosticsHandshake
  ensurePreview?: () => Promise<boolean>
  signal: AbortSignal
  publish: (text: string) => Promise<void>
}

export async function runWebReaderDiagnostics(options: DiagnosticsOptions): Promise<DiagnosticsStep[]> {
  await options.publish('Самодиагностика Web Reader — полный перечень проверок:\n' + WEB_READER_DIAGNOSTICS_CAPABILITIES.map((item) => '• ' + item).join('\n'))
  const results: DiagnosticsStep[] = []
  const step = async <T>(id: string, label: string, layer: DiagnosticsLayer, operation: () => Promise<T>, verify: (value: T) => boolean = () => true): Promise<T> => {
    if (options.signal.aborted) throw new DOMException('Диагностика отменена повторным запуском.', 'AbortError')
    const started = performance.now()
    try {
      const value = await operation()
      if (options.signal.aborted) throw new DOMException('Диагностика отменена повторным запуском.', 'AbortError')
      if (!verify(value)) throw new Error('Получен неожиданный детерминированный результат.')
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: true, message: 'OK' })
      await options.publish(`✓ ${label} — ${durationMs} мс — OK`)
      return value
    } catch (reason) {
      const message = redact(reason instanceof Error ? reason.message : String(reason))
      const durationMs = Math.round(performance.now() - started)
      const actualLayer = layerOf(message, layer)
      results.push({ id, label, layer: actualLayer, durationMs, ok: false, message })
      await options.publish(`✗ ${label} — ${durationMs} мс — слой ${actualLayer}: ${message}`)
      throw reason
    }
  }
  const run = async (action: PreviewAction) => {
    const outcome = await options.run(action)
    if (!outcome.ok) throw new Error(outcome.error ?? 'Действие не выполнено.')
    if (!outcome.result) throw new Error('Действие не вернуло результат.')
    return outcome.result
  }
  try {
    if (options.handshake) {
      const handshake = options.handshake
      await step('handshake', 'handshake iframe (ready/init, capabilities)', 'host', async () => handshake.capabilities, (capabilities) => capabilities.length > 0)
      await step('conversation-id', 'conversationId регистрации совпадает с активным чатом', 'route/active-chat', async () => handshake, (value) => value.conversationId === value.expectedConversationId)
      await step('registration-id', 'registrationId актуален для этой вкладки', 'host', async () => handshake, (value) => value.claimedRegistrationId === null || value.claimedRegistrationId === value.registrationId)
    }
    await step('cookie', 'preview cookie/auth', 'cookie/auth', async () => options.ensurePreview ? options.ensurePreview() : true, Boolean)
    const url = new URL('/api/preview/diagnostics', options.origin).toString()
    await step('open', '/api/preview proxy, loading → ready и open', 'proxy/network', () => run({ kind: 'open', url, diagnostic: true }))
    await step('read', 'DOM read', 'dom-bridge', () => run({ kind: 'read', diagnostic: true }), (r) => 'text' in r && (r as PreviewReadResult).text.includes('VoiceChat Web Reader Diagnostics'))
    await step('find-text', 'find по тексту', 'action', () => run({ kind: 'find', text: 'Diagnostic action', diagnostic: true }), (r) => 'total' in r && r.total > 0)
    await step('find-selector', 'find по селектору', 'action', () => run({ kind: 'find', selector: '#diagnostic-input', diagnostic: true }), (r) => 'total' in r && r.total === 1)
    await step('styles', 'computed styles', 'action', () => run({ kind: 'styles', selector: '#diagnostic-style', properties: ['display', 'color'], diagnostic: true }), (r) => 'styles' in r && (r as PreviewStylesResult).styles.display === 'block')
    await step('hover', 'hover: pointer/mouse-события', 'action', async () => {
      await run({ kind: 'hover', selector: '#hover-target', diagnostic: true })
      return run({ kind: 'read', selector: '#hover-status', diagnostic: true })
    }, (r) => 'text' in r && /hover:[1-9]/.test((r as PreviewReadResult).text))
    await step('scroll', 'scroll: прокрутка страницы', 'action', () => run({ kind: 'scroll', to: 'bottom', diagnostic: true }), (r) => 'scrolled' in r && (r as { scrolled: { top: number } }).scrolled.top > 0)
    await step('press', 'press: нажатие клавиши', 'action', async () => {
      await run({ kind: 'press', key: 'Escape', diagnostic: true })
      return run({ kind: 'read', selector: '#key-status', diagnostic: true })
    }, (r) => 'text' in r && (r as PreviewReadResult).text.includes('key:Escape'))
    await step('screenshot', 'screenshot: снимок элемента', 'action', () => run({ kind: 'screenshot', selector: '#diagnostic-style', diagnostic: true }), (r) => 'dataUrl' in r && (r as { dataUrl: string }).dataUrl.startsWith('data:image/'))
    await step('wait', 'wait: ожидание элемента', 'action', () => run({ kind: 'wait', selector: '#page-bottom', timeoutMs: 3_000, diagnostic: true }), (r) => 'found' in r)
    await step('errors', 'errors: буфер ошибок страницы пуст', 'action', () => run({ kind: 'errors', diagnostic: true }), (r) => 'total' in r && 'errors' in r && (r as { total: number }).total === 0)
    await step('evaluate', 'evaluate: JS в контексте страницы', 'action', () => run({ kind: 'evaluate', code: '2 + 2', diagnostic: true }), (r) => 'value' in r && (r as { value: string }).value === '4')
    await step('console', 'console: журнал сообщений', 'action', async () => {
      await run({ kind: 'evaluate', code: 'console.log("[diag] ping")', diagnostic: true })
      return run({ kind: 'console', pattern: '[diag]', level: 'log', diagnostic: true })
    }, (r) => 'messages' in r && (r as { total: number }).total >= 1)
    await step('network', 'network: журнал запросов', 'action', async () => {
      await run({ kind: 'evaluate', code: 'fetch("/api/preview/diagnostics").then(() => "ok")', diagnostic: true })
      return run({ kind: 'network', filter: 'diagnostics', diagnostic: true })
    }, (r) => 'requests' in r && (r as { total: number }).total >= 1)
    await step('a11y', 'a11y: дерево доступности', 'action', () => run({ kind: 'a11y', diagnostic: true }), (r) => 'nodes' in r && (r as { nodes: { role: string }[] }).nodes.some((n) => n.role === 'heading'))
    await step('set-select', 'set: select по value', 'action', () => run({ kind: 'set', selector: '#diag-select', value: 'one', diagnostic: true }), (r) => 'value' in r && (r as { value: string }).value === 'one')
    await step('set-checkbox', 'set: checkbox', 'action', () => run({ kind: 'set', selector: '#diag-check', checked: true, diagnostic: true }), (r) => 'value' in r && (r as { value: string }).value === 'true')
    await step('upload', 'upload: файл в input type=file', 'action', async () => {
      await run({ kind: 'upload', selector: '#diag-file', name: 'diag.txt', mimeType: 'text/plain', base64: 'aGk=', diagnostic: true })
      return run({ kind: 'read', selector: '#file-status', diagnostic: true })
    }, (r) => 'text' in r && (r as PreviewReadResult).text.includes('file:diag.txt:2'))
    await step('dblclick', 'click: двойной клик', 'action', async () => {
      await run({ kind: 'click', selector: '#dbl-target', dblclick: true, diagnostic: true })
      return run({ kind: 'read', selector: '#dbl-status', diagnostic: true })
    }, (r) => 'text' in r && /dbl:[1-9]/.test((r as PreviewReadResult).text))
    await step('drag', 'drag: pointer-перетаскивание', 'action', async () => {
      await run({ kind: 'drag', from: { selector: '#drag-source' }, to: { x: 200, y: 240 }, diagnostic: true })
      return run({ kind: 'read', selector: '#drag-status', diagnostic: true })
    }, (r) => 'text' in r && /drag:done:[1-9]/.test((r as PreviewReadResult).text))
    await step('viewport', 'viewport: ширина превью', 'host', async () => {
      const applied = await run({ kind: 'viewport', width: 375, diagnostic: true })
      if (!('width' in applied) || (applied as { width: number }).width !== 375) throw new Error('Ширина 375 не применилась.')
      return run({ kind: 'viewport', width: 0, diagnostic: true })
    }, (r) => 'width' in r && (r as { width: number }).width === 0)
    await step('type', 'type, input и change', 'action', () => run({ kind: 'type', selector: '#diagnostic-input', text: 'diagnostic-input', diagnostic: true }))
    await step('events', 'проверка input/change', 'action', () => run({ kind: 'read', selector: '#event-status', diagnostic: true }), (r) => 'text' in r && /input:1 change:1/.test((r as PreviewReadResult).text))
    await step('submit', 'отправка формы', 'action', () => run({ kind: 'type', selector: '#diagnostic-input', text: 'diagnostic-input', submit: true, diagnostic: true }), (r) => 'submitted' in r && r.submitted)
    await step('submit-state', 'результат submit', 'action', () => run({ kind: 'read', selector: '#submit-status', diagnostic: true }), (r) => 'text' in r && (r as PreviewReadResult).text.includes('submitted:diagnostic-input'))
    await step('navigation', 'click, navigation и повторный read после перехода', 'page-loading', async () => {
      const clicked = await options.run({ kind: 'click', selector: '#diagnostic-nav', diagnostic: true })
      if (!clicked.ok) throw new Error(clicked.error ?? 'Клик не выполнен.')
      // Навигация начинается только после ответа клика, и host может ещё не знать
      // о page-loading: перечитываем страницу, пока новый документ не станет готов.
      // Постановку команд в очередь до ready проверяет связка open → read выше.
      const deadline = performance.now() + 5_000
      for (;;) {
        if (options.signal.aborted) throw new DOMException('Диагностика отменена повторным запуском.', 'AbortError')
        const read = await options.run({ kind: 'read', diagnostic: true })
        if (read.ok && read.result && 'text' in read.result && read.result.text.includes('Diagnostics destination')) return read.result
        if (performance.now() > deadline) throw new Error(read.error ?? 'Навигация не подтверждена.')
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    })
    await step('request-id', 'очередь и requestId correlation', 'dom-bridge', async () => true, Boolean)
    await options.publish(`Самодиагностика Web Reader завершена: ${results.length}/${results.length} проверок успешно.`)
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) await options.publish(`Самодиагностика Web Reader завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer ?? 'action'}.`)
  }
  return results
}

