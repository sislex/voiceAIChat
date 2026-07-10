// TTS-движок на Piper (локально, офлайн). Синтезирует во временный WAV и отдаёт
// байты. spawn инжектируется для тестов. Готов к любому исполняемому piper
// (pip-скрипт в dev, бандл в prod).

import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TtsVoiceInfo } from '@voicechat/shared'
import { prepareTtsText } from '@voicechat/shared'
import { piperVoiceFile, piperVoicesFromFiles } from './piperVoices'
import type { SpeakOptions, TtsAudio, TtsEngine } from './types'

export type SpawnFn = (command: string, args: string[]) => ChildProcess

export interface PiperTtsOptions {
  /** Путь к исполняемому piper (или python для `python -m piper`). */
  piperBin: string
  /** Каталог с ONNX-голосами Piper. */
  voicesDir: string
  /** Префикс аргументов (напр. ['-m','piper'] для запуска через python). */
  argsPrefix?: string[]
  spawn?: SpawnFn
}

let tempCounter = 0

export class PiperTtsEngine implements TtsEngine {
  private current: ChildProcess | null = null
  private readonly spawnFn: SpawnFn

  constructor(private readonly opts: PiperTtsOptions) {
    this.spawnFn = opts.spawn ?? (nodeSpawn as unknown as SpawnFn)
  }

  async synthesize(text: string, opts: SpeakOptions): Promise<TtsAudio> {
    const clean = prepareTtsText(text)
    const voicePath = join(this.opts.voicesDir, piperVoiceFile(opts.voice))
    const wavPath = join(tmpdir(), `voicechat-piper-${process.pid}-${tempCounter++}.wav`)
    const args = [...(this.opts.argsPrefix ?? []), '-m', voicePath, '-f', wavPath]

    await new Promise<void>((resolve, reject) => {
      let stderr = ''
      let child: ChildProcess
      try {
        child = this.spawnFn(this.opts.piperBin, args)
      } catch (err) {
        reject(new Error(`Не удалось запустить piper: ${err instanceof Error ? err.message : err}`))
        return
      }
      this.current = child
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString()
      })
      child.on('error', (err) => reject(new Error(`piper: ${err.message}`)))
      child.on('close', (code) => {
        this.current = null
        if (code === 0) resolve()
        else reject(new Error(`piper завершился с кодом ${code}${stderr ? `: ${stderr.trim()}` : ''}`))
      })
      child.stdin?.end(clean)
    })

    try {
      const buf = await fs.readFile(wavPath)
      const audio = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return { audio, mime: 'audio/wav' }
    } finally {
      await fs.rm(wavPath, { force: true }).catch(() => {})
    }
  }

  cancel(): void {
    if (this.current) {
      try {
        this.current.kill('SIGTERM')
      } catch {
        /* уже завершён */
      }
      this.current = null
    }
  }

  async listVoices(): Promise<TtsVoiceInfo[]> {
    try {
      const files = await fs.readdir(this.opts.voicesDir)
      return piperVoicesFromFiles(files)
    } catch {
      return []
    }
  }
}
