// Самодиагностика «Консоль с ассистентом» — по образцу web/playwright reader.
// Проверяет путь живого разделяемого PTY: мост window.pty подключён, машина в сети,
// и команда, отправленная в терминал, реально выполняется в shell пользователя
// (round-trip маркера). Именно этим каналом ассистент работает в общем терминале.
// Модуль чистый: DOM/сети не трогает, всё внешнее приходит пробами — тестируется моками.

export function isConsoleReaderDiagnosticsCommand(value: string): boolean {
  const command = value.trim().toLocaleLowerCase('ru-RU').replace(/\s+/g, ' ')
  return command === '/console-reader-diagnostics' || command === 'самодиагностика консоли'
}

export type ConsoleReaderDiagnosticsLayer = 'bridge' | 'machine' | 'session'
export interface ConsoleReaderDiagnosticsStep {
  id: string
  label: string
  layer: ConsoleReaderDiagnosticsLayer
  durationMs: number
  ok: boolean
  message: string
}

export const CONSOLE_READER_DIAGNOSTICS_CAPABILITIES = [
  'PTY-мост window.pty подключён',
  'выбрана машина-агент в сети',
  'команда доходит до shell и её вывод возвращается (round-trip маркера)'
] as const

/** Пробы внешнего мира: вызывающий (App) замыкает доступ к мосту window.pty. */
export interface ConsoleReaderDiagnosticsProbes {
  bridgePresent(): boolean
  machineOnline(): boolean
  /** Пишет `echo <marker>` в живой PTY и резолвит true, если маркер вернулся в вывод. */
  ptyRoundtrip(marker: string): Promise<boolean>
}

export interface ConsoleReaderDiagnosticsOptions {
  probes: ConsoleReaderDiagnosticsProbes
  signal: AbortSignal
  publish: (text: string) => Promise<void>
  /** Генератор маркера (в тестах — детерминированный). */
  marker?: () => string
}

export async function runConsoleReaderDiagnostics(
  options: ConsoleReaderDiagnosticsOptions
): Promise<ConsoleReaderDiagnosticsStep[]> {
  const { probes } = options
  await options.publish(
    'Самодиагностика Консоли — перечень проверок:\n' +
      CONSOLE_READER_DIAGNOSTICS_CAPABILITIES.map((item) => '• ' + item).join('\n')
  )
  const results: ConsoleReaderDiagnosticsStep[] = []
  const step = async (
    id: string,
    label: string,
    layer: ConsoleReaderDiagnosticsLayer,
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
      const message = (reason instanceof Error ? reason.message : String(reason)).slice(0, 300)
      const durationMs = Math.round(performance.now() - started)
      results.push({ id, label, layer, durationMs, ok: false, message })
      await options.publish(`✗ ${label} — ${durationMs} мс — слой ${layer}: ${message}`)
      throw reason
    }
  }

  try {
    await step('bridge', 'PTY-мост', 'bridge', async () => {
      if (!probes.bridgePresent()) throw new Error('window.pty не подключён (desktop-режим без PTY)')
      return 'подключён'
    })
    await step('machine', 'машина в сети', 'machine', async () => {
      if (!probes.machineOnline()) throw new Error('нет машины-агента в сети — открыть shell негде')
      return 'машина доступна'
    })
    await step('roundtrip', 'команда в живом терминале', 'session', async () => {
      const marker = (options.marker ?? (() => `VCDIAG${Math.abs(Date.now() % 1_000_000).toString(36)}`))()
      const ok = await probes.ptyRoundtrip(marker)
      if (!ok) throw new Error('маркер не вернулся: консоль не открыта справа или shell не отвечает')
      return 'команда выполнена, вывод получен'
    })
    await options.publish(`Самодиагностика Консоли завершена: ${results.length}/${results.length} проверок успешно.`)
  } catch (reason) {
    if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
      await options.publish(
        `Самодиагностика Консоли завершена с ошибкой. Проблемный слой: ${results.find((item) => !item.ok)?.layer ?? 'bridge'}.`
      )
    }
  }
  return results
}
