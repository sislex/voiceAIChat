import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WhisperEngine } from './whisperEngine'
import { isModelPresent } from './models'

// Интеграционный тест реального распознавания. Тяжёлый (запускает whisper.cpp),
// поэтому запускается только при наличии собранного бинаря, модели turbo и утилиты
// macOS `say` (генерирует русский речевой сэмпл без сети/ffmpeg). Иначе — skip.

const MODELS_DIR = join(process.cwd(), 'models')
const WHISPER_CLI = join(
  process.cwd(),
  'node_modules/nodejs-whisper/cpp/whisper.cpp/build/bin/whisper-cli'
)

function sayAvailable(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    execFileSync('which', ['say'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const READY =
  isModelPresent(MODELS_DIR, 'large-v3-turbo', { existsSync, statSync }) &&
  existsSync(WHISPER_CLI) &&
  sayAvailable()

/** Извлекает Int16 PCM mono из WAV (пропускает любые чанки до 'data', downmix стерео). */
function readWavPcm(path: string): { pcm: Int16Array; sampleRate: number } {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('не RIFF')
  let sampleRate = 16_000
  let channels = 1
  let offset = 12 // после RIFF....WAVE
  let dataStart = -1
  let dataSize = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
    } else if (id === 'data') {
      dataStart = body
      dataSize = size
      break
    }
    offset = body + size + (size % 2) // чанки выровнены по 2 байта
  }
  if (dataStart < 0) throw new Error('нет data-чанка')
  const raw = new Int16Array(buf.buffer, buf.byteOffset + dataStart, dataSize / 2)
  if (channels === 1) return { pcm: Int16Array.from(raw), sampleRate }
  // downmix в mono
  const mono = new Int16Array(Math.floor(raw.length / channels))
  for (let i = 0; i < mono.length; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) sum += raw[i * channels + c]
    mono[i] = Math.round(sum / channels)
  }
  return { pcm: mono, sampleRate }
}

describe.skipIf(!READY)('WhisperEngine — реальное распознавание (integration)', () => {
  it(
    'распознаёт русскую речь толерантно по ключевым словам',
    async () => {
      const wav = join(tmpdir(), `voicechat-itest-${process.pid}.wav`)
      execFileSync('say', [
        '-v',
        'Milena',
        '--data-format=LEI16@16000',
        '-o',
        wav,
        'Привет, расскажи какая погода в Лиссабоне'
      ])
      try {
        const { pcm, sampleRate } = readWavPcm(wav)
        expect(sampleRate).toBe(16_000)

        const engine = new WhisperEngine({
          modelsDir: MODELS_DIR,
          getModel: () => 'large-v3-turbo'
        })
        expect(await engine.isReady()).toBe(true)

        const res = await engine.transcribe(pcm, sampleRate, { language: 'ru', final: true })
        const text = res.text.toLowerCase()
        // Толерантно: хотя бы одно ключевое слово распознано.
        expect(text).toMatch(/привет|погод|лиссабон/)
        expect(res.isFinal).toBe(true)
        expect(res.segments.length).toBeGreaterThan(0)
      } finally {
        rmSync(wav, { force: true })
      }
    },
    180_000
  )
})
