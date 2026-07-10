import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PiperTtsEngine } from './piperTts'

// Интеграционный тест реального Piper (pip piper-tts в .venv-piper). Запускается
// только при наличии бинаря и голоса, иначе skip.

const PIPER_BIN = join(process.cwd(), '.venv-piper', 'bin', 'piper')
const VOICES_DIR = join(process.cwd(), 'models', 'piper')
const READY =
  existsSync(PIPER_BIN) && existsSync(join(VOICES_DIR, 'ru_RU-irina-medium.onnx'))

describe.skipIf(!READY)('PiperTtsEngine — реальный Piper (integration)', () => {
  it('синтезирует русскую фразу в непустой WAV @22050', async () => {
    const engine = new PiperTtsEngine({ piperBin: PIPER_BIN, voicesDir: VOICES_DIR })
    const result = await engine.synthesize('Привет, это проверка голоса Piper.', {
      voice: 'ru_RU-irina-medium'
    })

    const buf = Buffer.from(result.audio)
    expect(buf.toString('ascii', 0, 4)).toBe('RIFF')
    expect(buf.toString('ascii', 8, 12)).toBe('WAVE')
    expect(buf.readUInt32LE(24)).toBe(22_050) // sampleRate
    expect(buf.length).toBeGreaterThan(10_000)
  }, 30_000)
})
