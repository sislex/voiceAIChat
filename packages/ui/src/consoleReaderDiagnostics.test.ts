import { describe, expect, it } from 'vitest'
import {
  CONSOLE_READER_DIAGNOSTICS_CAPABILITIES,
  isConsoleReaderDiagnosticsCommand,
  runConsoleReaderDiagnostics,
  type ConsoleReaderDiagnosticsProbes
} from './consoleReaderDiagnostics'

function makeProbes(over: Partial<ConsoleReaderDiagnosticsProbes> = {}): ConsoleReaderDiagnosticsProbes {
  return {
    bridgePresent: () => true,
    machineOnline: () => true,
    ptyRoundtrip: async () => true,
    ...over
  }
}

const run = (probes: ConsoleReaderDiagnosticsProbes, published: string[], signal = new AbortController().signal): Promise<unknown> =>
  runConsoleReaderDiagnostics({ probes, signal, publish: async (t) => { published.push(t) }, marker: () => 'VCDIAGX' })

describe('console reader diagnostics', () => {
  it('распознаёт только две команды запуска', () => {
    expect(isConsoleReaderDiagnosticsCommand('  Самодиагностика консоли ')).toBe(true)
    expect(isConsoleReaderDiagnosticsCommand('/console-reader-diagnostics')).toBe(true)
    expect(isConsoleReaderDiagnosticsCommand('самодиагностика')).toBe(false)
    expect(isConsoleReaderDiagnosticsCommand('самодиагностика web reader')).toBe(false)
  })

  it('проходит все проверки на исправном стенде', async () => {
    const published: string[] = []
    const results = await runConsoleReaderDiagnostics({ probes: makeProbes(), signal: new AbortController().signal, publish: async (t) => { published.push(t) }, marker: () => 'VCDIAGX' }) as { ok: boolean }[]
    expect(published[0]).toContain(CONSOLE_READER_DIAGNOSTICS_CAPABILITIES[0])
    expect(results).toHaveLength(3)
    expect(results.every((s) => s.ok)).toBe(true)
    expect(published[published.length - 1]).toContain('3/3 проверок успешно')
  })

  it('нет моста → слой bridge, прогон останавливается', async () => {
    const published: string[] = []
    const results = await run(makeProbes({ bridgePresent: () => false }), published) as { id: string; layer: string; ok: boolean }[]
    const failed = results.find((s) => !s.ok)
    expect(failed?.id).toBe('bridge')
    expect(results.some((s) => s.id === 'machine')).toBe(false)
    expect(published.some((t) => t.includes('Проблемный слой: bridge'))).toBe(true)
  })

  it('маркер не вернулся → слой session', async () => {
    const published: string[] = []
    const results = await run(makeProbes({ ptyRoundtrip: async () => false }), published) as { id: string; layer: string; ok: boolean }[]
    const failed = results.find((s) => !s.ok)
    expect(failed?.id).toBe('roundtrip')
    expect(failed?.layer).toBe('session')
  })

  it('прерывание сигналом не пишет финал с ошибкой', async () => {
    const controller = new AbortController()
    controller.abort()
    const published: string[] = []
    await run(makeProbes(), published, controller.signal)
    expect(published.some((t) => t.includes('завершена с ошибкой'))).toBe(false)
  })
})
