import { describe, expect, it } from 'vitest'
import { MAKE_DIAGNOSTICS_CAPABILITIES, isMakeDiagnosticsCommand, runMakeDiagnostics, type MakeDiagnosticsProbes } from './makeDiagnostics'

function makeProbes(over: Partial<MakeDiagnosticsProbes> = {}): MakeDiagnosticsProbes {
  return {
    state: async () => ({ files: 3, snapshots: 1 }),
    previewStatus: async () => 200,
    writeReadDelete: async (_path, content) => content,
    waitChanged: async () => true,
    ...over
  }
}

const run = (probes: MakeDiagnosticsProbes, published: string[]): Promise<{ id: string; ok: boolean; layer: string }[]> =>
  runMakeDiagnostics({ probes, signal: new AbortController().signal, publish: async (t) => { published.push(t) }, marker: () => 'X1' }) as Promise<{ id: string; ok: boolean; layer: string }[]>

describe('make diagnostics', () => {
  it('распознаёт команды запуска', () => {
    expect(isMakeDiagnosticsCommand(' Самодиагностика Make ')).toBe(true)
    expect(isMakeDiagnosticsCommand('/make-diagnostics')).toBe(true)
    expect(isMakeDiagnosticsCommand('самодиагностика проекта')).toBe(true)
    expect(isMakeDiagnosticsCommand('самодиагностика консоли')).toBe(false)
  })

  it('исправный стенд: все проверки, служебный файл с маркером, итог 4/4', async () => {
    const published: string[] = []
    let written = ''
    const results = await run(makeProbes({ writeReadDelete: async (path, content) => { written = path; return content } }), published)
    expect(published[0]).toContain(MAKE_DIAGNOSTICS_CAPABILITIES[0])
    expect(written).toBe('_diag-X1.txt')
    expect(results.map((r) => r.id)).toEqual(['api', 'preview', 'files', 'events'])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(published.at(-1)).toContain('4/4 проверок успешно')
  })

  it('превью без cookie → слой preview, прогон останавливается', async () => {
    const published: string[] = []
    const results = await run(makeProbes({ previewStatus: async () => 401 }), published)
    expect(results.map((r) => r.id)).toEqual(['api', 'preview'])
    expect(results[1]).toMatchObject({ ok: false, layer: 'preview' })
    expect(published.at(-1)).toContain('Проблемный слой: preview')
  })

  it('событие не пришло → отмечено слоем events, но round-trip засчитан', async () => {
    const published: string[] = []
    const results = await run(makeProbes({ waitChanged: async () => false }), published)
    expect(results.find((r) => r.id === 'files')?.ok).toBe(true)
    expect(results.find((r) => r.id === 'events')).toMatchObject({ ok: false, layer: 'events' })
    expect(published.at(-1)).toContain('Проблемный слой: events')
  })
})
