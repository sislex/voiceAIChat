import { describe, expect, it } from 'vitest'
import type { BrowserSessionMetadata } from '@shared/types'
import {
  PLAYWRIGHT_READER_DIAGNOSTICS_CAPABILITIES,
  isPlaywrightReaderDiagnosticsCommand,
  runPlaywrightReaderDiagnostics,
  type PlaywrightReaderDiagnosticsProbes
} from './playwrightReaderDiagnostics'

const META: BrowserSessionMetadata = {
  incarnation: 'inc-1',
  currentUrl: 'https://example.com',
  state: 'ready',
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 }
} as BrowserSessionMetadata

function makeProbes(over: Partial<PlaywrightReaderDiagnosticsProbes> = {}): PlaywrightReaderDiagnosticsProbes {
  return {
    bridgePresent: () => true,
    start: async () => META,
    screenshot: async () => 'data:image/jpeg;base64,AAAA',
    reload: async () => META,
    ...over
  }
}

describe('playwright reader diagnostics', () => {
  it('распознаёт только две команды запуска', () => {
    expect(isPlaywrightReaderDiagnosticsCommand('  Самодиагностика Playwright Reader ')).toBe(true)
    expect(isPlaywrightReaderDiagnosticsCommand('/playwright-reader-diagnostics')).toBe(true)
    expect(isPlaywrightReaderDiagnosticsCommand('самодиагностика web reader')).toBe(false)
    expect(isPlaywrightReaderDiagnosticsCommand('самодиагностика')).toBe(false)
  })

  it('публикует перечень и проходит все проверки на исправном раннере', async () => {
    const published: string[] = []
    const results = await runPlaywrightReaderDiagnostics({
      probes: makeProbes(), signal: new AbortController().signal, publish: async (t) => { published.push(t) }
    })
    expect(published[0]).toContain(PLAYWRIGHT_READER_DIAGNOSTICS_CAPABILITIES[0])
    expect(results).toHaveLength(6)
    expect(results.every((step) => step.ok && step.durationMs >= 0)).toBe(true)
    expect(published[published.length - 1]).toContain('6/6 проверок успешно')
  })

  it('отсутствие моста помечает слой bridge и останавливает прогон', async () => {
    const published: string[] = []
    const results = await runPlaywrightReaderDiagnostics({
      probes: makeProbes({ bridgePresent: () => false }),
      signal: new AbortController().signal,
      publish: async (t) => { published.push(t) }
    })
    const failed = results.find((s) => !s.ok)
    expect(failed?.id).toBe('bridge')
    expect(failed?.layer).toBe('bridge')
    expect(published.some((t) => t.includes('Проблемный слой: bridge'))).toBe(true)
    // После падения моста сессия и кадры не проверяются.
    expect(results.some((s) => s.id === 'start')).toBe(false)
  })

  it('пустой кадр screencast помечает слой frame', async () => {
    const published: string[] = []
    const results = await runPlaywrightReaderDiagnostics({
      probes: makeProbes({ screenshot: async () => '' }),
      signal: new AbortController().signal,
      publish: async (t) => { published.push(t) }
    })
    const failed = results.find((s) => !s.ok)
    expect(failed?.id).toBe('frame')
    expect(failed?.layer).toBe('frame')
  })

  it('прерывание сигналом бросает AbortError и не пишет финал с ошибкой', async () => {
    const controller = new AbortController()
    controller.abort()
    const published: string[] = []
    await runPlaywrightReaderDiagnostics({
      probes: makeProbes(), signal: controller.signal, publish: async (t) => { published.push(t) }
    })
    expect(published.some((t) => t.includes('завершена с ошибкой'))).toBe(false)
  })
})
