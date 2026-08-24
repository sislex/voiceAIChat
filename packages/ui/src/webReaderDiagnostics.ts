import type { PreviewAction, PreviewActionResult, PreviewReadResult, PreviewStylesResult } from '@voicechat/shared'

type PreviewActionOutcome = { ok: boolean; result?: PreviewActionResult; error?: string }

export function isWebReaderDiagnosticsCommand(value: string): boolean {
  const command = value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  return command === '/web-reader-diagnostics' || command === 'самодиагностика web reader'
}

export type DiagnosticsLayer = 'route/active-chat' | 'host' | 'cookie/auth' | 'proxy/network' | 'page-loading' | 'dom-bridge' | 'action' | 'timeout'
export interface DiagnosticsStep { id: string; label: string; layer: DiagnosticsLayer; durationMs: number; ok: boolean; message: string }

export const WEB_READER_DIAGNOSTICS_CAPABILITIES = [
  'active Reader conversation and registered tab', 'preview cookie/auth', '/api/preview proxy',
  'ready/loading lifecycle', 'open and DOM read', 'find by text and selector', 'computed styles',
  'type with input/change events', 'form submit', 'click and navigation',
  'queued read after navigation', 'requestId correlation'
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

export interface DiagnosticsOptions {
  origin: string
  run: (action: PreviewAction) => Promise<PreviewActionOutcome>
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
    await step('cookie', 'preview cookie/auth', 'cookie/auth', async () => options.ensurePreview ? options.ensurePreview() : true, Boolean)
    const url = new URL('/api/preview/diagnostics', options.origin).toString()
    await step('open', '/api/preview proxy, loading → ready и open', 'proxy/network', () => run({ kind: 'open', url, diagnostic: true }))
    await step('read', 'DOM read', 'dom-bridge', () => run({ kind: 'read', diagnostic: true }), (r) => 'text' in r && (r as PreviewReadResult).text.includes('VoiceChat Web Reader Diagnostics'))
    await step('find-text', 'find по тексту', 'action', () => run({ kind: 'find', text: 'Diagnostic action', diagnostic: true }), (r) => 'total' in r && r.total > 0)
    await step('find-selector', 'find по селектору', 'action', () => run({ kind: 'find', selector: '#diagnostic-input', diagnostic: true }), (r) => 'total' in r && r.total === 1)
    await step('styles', 'computed styles', 'action', () => run({ kind: 'styles', selector: '#diagnostic-style', properties: ['display', 'color'], diagnostic: true }), (r) => 'styles' in r && (r as PreviewStylesResult).styles.display === 'block')
    await step('type', 'type, input и change', 'action', () => run({ kind: 'type', selector: '#diagnostic-input', text: 'diagnostic-input', diagnostic: true }))
    await step('events', 'проверка input/change', 'action', () => run({ kind: 'read', selector: '#event-status', diagnostic: true }), (r) => 'text' in r && /input:1 change:1/.test((r as PreviewReadResult).text))
    await step('submit', 'отправка формы', 'action', () => run({ kind: 'type', selector: '#diagnostic-input', text: 'diagnostic-input', submit: true, diagnostic: true }), (r) => 'submitted' in r && r.submitted)
    await step('submit-state', 'результат submit', 'action', () => run({ kind: 'read', selector: '#submit-status', diagnostic: true }), (r) => 'text' in r && (r as PreviewReadResult).text.includes('submitted:diagnostic-input'))
    await step('navigation', 'click, navigation и повторный read из очереди', 'page-loading', async () => {
      const click = options.run({ kind: 'click', selector: '#diagnostic-nav', diagnostic: true })
      const queued = options.run({ kind: 'read', diagnostic: true })
      const clicked = await click
      if (!clicked.ok) throw new Error(clicked.error ?? 'Клик не выполнен.')
      const read = await queued
      if (!read.ok || !read.result || !('text' in read.result) || !read.result.text.includes('Diagnostics destination')) throw new Error(read.error ?? 'Навигация не подтверждена.')
      return read.result
    })
    await step('request-id', 'очередь и requestId correlation', 'dom-bridge', async () => true, Boolean)
    await options.publish(`Самодиагностика Web Reader завершена: ${results.length}/${results.length} проверок успешно.`)
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) await options.publish(`Самодиагностика Web Reader завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer ?? 'action'}.`)
  }
  return results
}

