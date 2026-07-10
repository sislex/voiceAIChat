import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { SayTtsEngine } from './sayTts'

// Интеграционный тест реального синтеза через macOS `say`. Запускается только на
// macOS с доступным `say` (иначе skip).

function sayAvailable(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('which', ['say'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!sayAvailable())('SayTtsEngine — реальный say (integration)', () => {
  it('синтезирует русскую фразу в непустой WAV', async () => {
    const engine = new SayTtsEngine()
    const result = await engine.synthesize('Привет, это проверка озвучки.', { voice: '' })

    expect(result.mime).toBe('audio/wav')
    const buf = Buffer.from(result.audio)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    // Реальная озвучка фразы — заметно больше пустого заголовка.
    expect(buf.length).toBeGreaterThan(5000)
  }, 30_000)
})
