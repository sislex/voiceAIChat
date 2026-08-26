// Самодиагностика Make — по образцу Консоли/Reader. Проверяет весь путь панели проекта:
// REST состояния проекта отвечает, превью отдаётся с preview-cookie (тем же каналом,
// что iframe), запись файла возвращается чтением и рассылается событием make.changed
// (им панель узнаёт о правках ассистента). Модуль чистый: внешнее — пробами.

export function isMakeDiagnosticsCommand(value: string): boolean {
  const command = value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  return command === '/make-diagnostics' || command === 'самодиагностика make' || command === 'самодиагностика проекта'
}

export type MakeDiagnosticsLayer = 'api' | 'preview' | 'files' | 'events'
export interface MakeDiagnosticsStep {
  id: string
  label: string
  layer: MakeDiagnosticsLayer
  durationMs: number
  ok: boolean
  message: string
}

export const MAKE_DIAGNOSTICS_CAPABILITIES = [
  'REST проекта отвечает (список файлов и снимков)',
  'превью отдаётся с preview-cookie, как в iframe панели',
  'запись файла возвращается чтением (round-trip)',
  'о записи приходит событие make.changed'
] as const

/** Пробы внешнего мира: App замыкает window.api / window.make / fetch. */
export interface MakeDiagnosticsProbes {
  /** Число файлов проекта. */
  state(): Promise<{ files: number; snapshots: number }>
  /** HTTP-статус запроса превью index.html с cookie. */
  previewStatus(): Promise<number>
  /** Записать служебный файл, прочитать и удалить; вернуть прочитанное содержимое. */
  writeReadDelete(path: string, content: string): Promise<string>
  /** Ждать make.changed с этим путём не дольше timeoutMs. */
  waitChanged(path: string, timeoutMs: number): Promise<boolean>
}

export interface MakeDiagnosticsOptions {
  probes: MakeDiagnosticsProbes
  signal: AbortSignal
  publish: (text: string) => Promise<void>
  marker?: () => string
}

export async function runMakeDiagnostics(options: MakeDiagnosticsOptions): Promise<MakeDiagnosticsStep[]> {
  const { probes } = options
  await options.publish('Самодиагностика Make — перечень проверок:\n' + MAKE_DIAGNOSTICS_CAPABILITIES.map((item) => '• ' + item).join('\n'))
  const results: MakeDiagnosticsStep[] = []
  const step = async (id: string, label: string, layer: MakeDiagnosticsLayer, operation: () => Promise<string>): Promise<void> => {
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
      const message = (reason instanceof Error ? reason.message : String(reason)).slice(0, 300)
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: false, message })
      await options.publish(`✗ ${label} — ${durationMs} мс — слой ${layer}: ${message}`)
      throw reason
    }
  }

  const marker = (options.marker ?? (() => `VCMAKE${Math.abs(Date.now() % 1_000_000).toString(36)}`))()
  const path = `_diag-${marker}.txt`
  try {
    await step('api', 'REST проекта', 'api', async () => {
      const s = await probes.state()
      return `файлов: ${s.files}, снимков: ${s.snapshots}`
    })
    await step('preview', 'превью с cookie', 'preview', async () => {
      const status = await probes.previewStatus()
      if (status !== 200) throw new Error(`превью ответило ${status} — cookie не выпущена или маршрут закрыт`)
      return 'index.html отдаётся'
    })
    // Событие ловим той же записью, чтобы не гнать вторую; итог — отдельным шагом после.
    let changed = false
    await step('files', 'запись и чтение файла', 'files', async () => {
      const waiter = probes.waitChanged(path, 5_000)
      const read = await probes.writeReadDelete(path, marker)
      if (read !== marker) throw new Error('прочитанное содержимое не совпало с записанным')
      changed = await waiter
      return 'round-trip успешен, файл удалён'
    })
    results.push({ id: 'events', label: 'событие make.changed', layer: 'events', durationMs: 0, ok: changed, message: changed ? 'получено' : 'не пришло за 5 с' })
    await options.publish(changed ? '✓ событие make.changed — получено' : '✗ событие make.changed — слой events: не пришло за 5 с (панель не узнает о правках ассистента)')
    const failed = results.filter((r) => !r.ok).length
    await options.publish(failed === 0
      ? `Самодиагностика Make завершена: ${results.length}/${results.length} проверок успешно.`
      : `Самодиагностика Make завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer}.`)
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
      await options.publish(`Самодиагностика Make завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer ?? 'api'}.`)
    }
  }
  return results
}
