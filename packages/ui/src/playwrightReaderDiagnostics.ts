import type { BrowserSessionMetadata } from '@shared/types'

// Самодиагностика Playwright Reader — по образцу webReaderDiagnostics/chatDiagnostics,
// но проверяет путь изолированного Chromium (browser-runner) через мост window.browser.
// Модуль чистый: DOM/сети не трогает, всё внешнее приходит пробами — поэтому
// тестируется моками. Проверки НЕ разрушительны: не уводят страницу пользователя,
// а лишь поднимают/переиспользуют сессию, читают метаданные, кадр и делают reload.

export function isPlaywrightReaderDiagnosticsCommand(value: string): boolean {
  const command = value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  return command === '/playwright-reader-diagnostics' || command === 'самодиагностика playwright reader'
}

export type PlaywrightReaderDiagnosticsLayer = 'bridge' | 'session' | 'frame' | 'command'
export interface PlaywrightReaderDiagnosticsStep {
  id: string
  label: string
  layer: PlaywrightReaderDiagnosticsLayer
  durationMs: number
  ok: boolean
  message: string
}

export const PLAYWRIGHT_READER_DIAGNOSTICS_CAPABILITIES = [
  'браузерный мост window.browser подключён',
  'изолированный Chromium разговора поднимается (start)',
  'метаданные сессии (вкладка, вьюпорт, состояние)',
  'кадр screencast (screenshot)',
  'команда живой сессии (reload) выполняется',
  'кадр после команды обновляется'
] as const

const redact = (value: string): string =>
  value.replace(/(cookie|authorization|token|password|api[-_]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]').slice(0, 500)

/** Пробы внешнего мира: вызывающий (App) замыкает доступ к мосту window.browser. */
export interface PlaywrightReaderDiagnosticsProbes {
  /** Подключён ли браузерный мост (в desktop/сервере без раннера его нет). */
  bridgePresent(): boolean
  /** Идемпотентно поднимает/переиспользует сессию разговора; метаданные. */
  start(): Promise<BrowserSessionMetadata>
  /** Кадр текущей вкладки как data-URL (пусто — провал). */
  screenshot(): Promise<string>
  /** Ненавязчивая команда живой сессии (reload) — метаданные после. */
  reload(): Promise<BrowserSessionMetadata>
}

export interface PlaywrightReaderDiagnosticsOptions {
  probes: PlaywrightReaderDiagnosticsProbes
  signal: AbortSignal
  publish: (text: string) => Promise<void>
}

export async function runPlaywrightReaderDiagnostics(
  options: PlaywrightReaderDiagnosticsOptions
): Promise<PlaywrightReaderDiagnosticsStep[]> {
  const { probes } = options
  await options.publish(
    'Самодиагностика Playwright Reader — перечень проверок:\n' +
      PLAYWRIGHT_READER_DIAGNOSTICS_CAPABILITIES.map((item) => '• ' + item).join('\n')
  )
  const results: PlaywrightReaderDiagnosticsStep[] = []
  const step = async (
    id: string,
    label: string,
    layer: PlaywrightReaderDiagnosticsLayer,
    operation: () => Promise<string>
  ): Promise<void> => {
    if (options.signal.aborted) throw new DOMException('Диагностика отменена.', 'AbortError')
    const started = performance.now()
    try {
      const note = await operation()
      if (options.signal.aborted) throw new DOMException('Диагностика отменена.', 'AbortError')
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: true, message: note || 'OK' })
      await options.publish(`✓ ${label} — ${durationMs} мс — ${note || 'OK'}`)
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') throw reason
      const message = redact(reason instanceof Error ? reason.message : String(reason))
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: false, message })
      await options.publish(`✗ ${label} — ${durationMs} мс — слой ${layer}: ${message}`)
      throw reason
    }
  }

  try {
    await step('bridge', 'браузерный мост', 'bridge', async () => {
      if (!probes.bridgePresent()) throw new Error('window.browser не подключён — раннер недоступен')
      return 'подключён'
    })
    let meta: BrowserSessionMetadata | null = null
    await step('start', 'запуск Chromium', 'session', async () => {
      meta = await probes.start()
      if (!meta?.incarnation) throw new Error('сессия не вернула incarnation')
      return meta.currentUrl ? `сессия готова: ${meta.currentUrl}` : 'сессия готова'
    })
    await step('meta', 'метаданные сессии', 'session', async () => {
      if (!meta) throw new Error('нет метаданных сессии')
      const viewport = meta.viewport ? `${meta.viewport.width}×${meta.viewport.height}` : 'вьюпорт неизвестен'
      return `состояние ${meta.state ?? 'ready'}, ${viewport}`
    })
    await step('frame', 'кадр screencast', 'frame', async () => {
      const dataUrl = await probes.screenshot()
      if (!dataUrl || !dataUrl.startsWith('data:')) throw new Error('кадр не получен')
      return `кадр ${Math.round(dataUrl.length / 1024)} КБ`
    })
    await step('reload', 'команда живой сессии', 'command', async () => {
      const next = await probes.reload()
      if (!next?.incarnation) throw new Error('reload не вернул метаданные')
      return 'reload выполнен'
    })
    await step('frame-after', 'кадр после команды', 'frame', async () => {
      const dataUrl = await probes.screenshot()
      if (!dataUrl || !dataUrl.startsWith('data:')) throw new Error('кадр после команды не получен')
      return 'кадр обновлён'
    })
    await options.publish(
      `Самодиагностика Playwright Reader завершена: ${results.length}/${results.length} проверок успешно.`
    )
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
      await options.publish(
        `Самодиагностика Playwright Reader завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer ?? 'bridge'}.`
      )
    }
  }
  return results
}
